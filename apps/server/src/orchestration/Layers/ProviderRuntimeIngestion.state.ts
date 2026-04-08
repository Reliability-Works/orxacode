import { MessageId, ThreadId, TurnId } from '@orxa-code/contracts'
import { Cache, Effect, Option } from 'effect'

import {
  BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_CACHE_CAPACITY,
  BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_TTL,
  BUFFERED_PROPOSED_PLAN_BY_ID_CACHE_CAPACITY,
  BUFFERED_PROPOSED_PLAN_BY_ID_TTL,
  MAX_BUFFERED_ASSISTANT_CHARS,
  TURN_MESSAGE_IDS_BY_TURN_CACHE_CAPACITY,
  TURN_MESSAGE_IDS_BY_TURN_TTL,
  providerTurnKey,
} from './ProviderRuntimeIngestion.helpers.ts'

export type ProposedPlanBufferEntry = { text: string; createdAt: string }

export interface ProviderRuntimeIngestionCaches {
  readonly turnMessageIdsByTurnKey: Cache.Cache<string, Set<MessageId>>
  readonly bufferedAssistantTextByMessageId: Cache.Cache<MessageId, string>
  readonly bufferedProposedPlanById: Cache.Cache<string, ProposedPlanBufferEntry>
}

export const makeProviderRuntimeIngestionCaches =
  (): Effect.Effect<ProviderRuntimeIngestionCaches> =>
    Effect.gen(function* () {
      const turnMessageIdsByTurnKey = yield* Cache.make<string, Set<MessageId>>({
        capacity: TURN_MESSAGE_IDS_BY_TURN_CACHE_CAPACITY,
        timeToLive: TURN_MESSAGE_IDS_BY_TURN_TTL,
        lookup: () => Effect.succeed(new Set<MessageId>()),
      })

      const bufferedAssistantTextByMessageId = yield* Cache.make<MessageId, string>({
        capacity: BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_CACHE_CAPACITY,
        timeToLive: BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_TTL,
        lookup: () => Effect.succeed(''),
      })

      const bufferedProposedPlanById = yield* Cache.make<string, ProposedPlanBufferEntry>({
        capacity: BUFFERED_PROPOSED_PLAN_BY_ID_CACHE_CAPACITY,
        timeToLive: BUFFERED_PROPOSED_PLAN_BY_ID_TTL,
        lookup: () => Effect.succeed({ text: '', createdAt: '' }),
      })

      return {
        turnMessageIdsByTurnKey,
        bufferedAssistantTextByMessageId,
        bufferedProposedPlanById,
      }
    })

const createAssistantMessageIdOps = (
  turnMessageIdsByTurnKey: Cache.Cache<string, Set<MessageId>>
) => {
  const remember = (threadId: ThreadId, turnId: TurnId, messageId: MessageId) =>
    Cache.getOption(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId)).pipe(
      Effect.flatMap(existingIds =>
        Cache.set(
          turnMessageIdsByTurnKey,
          providerTurnKey(threadId, turnId),
          Option.match(existingIds, {
            onNone: () => new Set([messageId]),
            onSome: ids => {
              const nextIds = new Set(ids)
              nextIds.add(messageId)
              return nextIds
            },
          })
        )
      )
    )

  const forget = (threadId: ThreadId, turnId: TurnId, messageId: MessageId) =>
    Cache.getOption(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId)).pipe(
      Effect.flatMap(existingIds =>
        Option.match(existingIds, {
          onNone: () => Effect.void,
          onSome: ids => {
            const nextIds = new Set(ids)
            nextIds.delete(messageId)
            if (nextIds.size === 0) {
              return Cache.invalidate(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId))
            }
            return Cache.set(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId), nextIds)
          },
        })
      )
    )

  const getForTurn = (threadId: ThreadId, turnId: TurnId) =>
    Cache.getOption(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId)).pipe(
      Effect.map(existingIds =>
        Option.getOrElse(existingIds, (): Set<MessageId> => new Set<MessageId>())
      )
    )

  const clearForTurn = (threadId: ThreadId, turnId: TurnId) =>
    Cache.invalidate(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId))

  return { remember, forget, getForTurn, clearForTurn } as const
}

const createAssistantTextOps = (
  bufferedAssistantTextByMessageId: Cache.Cache<MessageId, string>
) => {
  const append = (messageId: MessageId, delta: string) =>
    Cache.getOption(bufferedAssistantTextByMessageId, messageId).pipe(
      Effect.flatMap(
        Effect.fn('appendBufferedAssistantText')(function* (existingText) {
          const nextText = Option.match(existingText, {
            onNone: () => delta,
            onSome: text => `${text}${delta}`,
          })
          if (nextText.length <= MAX_BUFFERED_ASSISTANT_CHARS) {
            yield* Cache.set(bufferedAssistantTextByMessageId, messageId, nextText)
            return ''
          }

          // Safety valve: flush full buffered text as an assistant delta to cap memory.
          yield* Cache.invalidate(bufferedAssistantTextByMessageId, messageId)
          return nextText
        })
      )
    )

  const take = (messageId: MessageId) =>
    Cache.getOption(bufferedAssistantTextByMessageId, messageId).pipe(
      Effect.flatMap(existingText =>
        Cache.invalidate(bufferedAssistantTextByMessageId, messageId).pipe(
          Effect.as(Option.getOrElse(existingText, () => ''))
        )
      )
    )

  const clear = (messageId: MessageId) =>
    Cache.invalidate(bufferedAssistantTextByMessageId, messageId)

  return { append, take, clear } as const
}

const createProposedPlanOps = (
  bufferedProposedPlanById: Cache.Cache<string, ProposedPlanBufferEntry>
) => {
  const append = (planId: string, delta: string, createdAt: string) =>
    Cache.getOption(bufferedProposedPlanById, planId).pipe(
      Effect.flatMap(existingEntry => {
        const existing = Option.getOrUndefined(existingEntry)
        return Cache.set(bufferedProposedPlanById, planId, {
          text: `${existing?.text ?? ''}${delta}`,
          createdAt:
            existing?.createdAt && existing.createdAt.length > 0 ? existing.createdAt : createdAt,
        })
      })
    )

  const take = (planId: string) =>
    Cache.getOption(bufferedProposedPlanById, planId).pipe(
      Effect.flatMap(existingEntry =>
        Cache.invalidate(bufferedProposedPlanById, planId).pipe(
          Effect.as(Option.getOrUndefined(existingEntry))
        )
      )
    )

  const clear = (planId: string) => Cache.invalidate(bufferedProposedPlanById, planId)

  return { append, take, clear } as const
}

const createClearTurnStateForSession = (
  caches: ProviderRuntimeIngestionCaches,
  clearAssistantMessageState: (messageId: MessageId) => Effect.Effect<void>
) =>
  Effect.fn('clearTurnStateForSession')(function* (threadId: ThreadId) {
    const prefix = `${threadId}:`
    const proposedPlanPrefix = `plan:${threadId}:`
    const turnKeys = Array.from(yield* Cache.keys(caches.turnMessageIdsByTurnKey))
    const proposedPlanKeys = Array.from(yield* Cache.keys(caches.bufferedProposedPlanById))
    yield* Effect.forEach(
      turnKeys,
      Effect.fn(function* (key) {
        if (!key.startsWith(prefix)) {
          return
        }

        const messageIds = yield* Cache.getOption(caches.turnMessageIdsByTurnKey, key)
        if (Option.isSome(messageIds)) {
          yield* Effect.forEach(messageIds.value, clearAssistantMessageState, {
            concurrency: 1,
          }).pipe(Effect.asVoid)
        }

        yield* Cache.invalidate(caches.turnMessageIdsByTurnKey, key)
      }),
      { concurrency: 1 }
    ).pipe(Effect.asVoid)
    yield* Effect.forEach(
      proposedPlanKeys,
      key =>
        key.startsWith(proposedPlanPrefix)
          ? Cache.invalidate(caches.bufferedProposedPlanById, key)
          : Effect.void,
      { concurrency: 1 }
    ).pipe(Effect.asVoid)
  })

export const createProviderRuntimeIngestionStateOps = (caches: ProviderRuntimeIngestionCaches) => {
  const messageIdOps = createAssistantMessageIdOps(caches.turnMessageIdsByTurnKey)
  const textOps = createAssistantTextOps(caches.bufferedAssistantTextByMessageId)
  const planOps = createProposedPlanOps(caches.bufferedProposedPlanById)

  const clearAssistantMessageState = (messageId: MessageId) => textOps.clear(messageId)

  const clearTurnStateForSession = createClearTurnStateForSession(
    caches,
    clearAssistantMessageState
  )

  return {
    rememberAssistantMessageId: messageIdOps.remember,
    forgetAssistantMessageId: messageIdOps.forget,
    getAssistantMessageIdsForTurn: messageIdOps.getForTurn,
    clearAssistantMessageIdsForTurn: messageIdOps.clearForTurn,
    appendBufferedAssistantText: textOps.append,
    takeBufferedAssistantText: textOps.take,
    clearBufferedAssistantText: textOps.clear,
    appendBufferedProposedPlan: planOps.append,
    takeBufferedProposedPlan: planOps.take,
    clearBufferedProposedPlan: planOps.clear,
    clearAssistantMessageState,
    clearTurnStateForSession,
  } as const
}

export type ProviderRuntimeIngestionStateOps = ReturnType<
  typeof createProviderRuntimeIngestionStateOps
>
