/**
 * Shared helpers for the Opencode adapter runtime modules.
 *
 * Centralizes the part-hint cache, the mapper-context builder, the
 * mapped-event fan-out helper, and the session lookup used by both
 * `OpencodeAdapter.runtime.session.ts` and `OpencodeAdapter.runtime.turns.ts`.
 * Keeping these helpers here keeps the session and turns files under the
 * 500-line lint cap and prevents jscpd duplication between the two modules.
 *
 * Pure functions only — no Effect access on the pure helpers. The Effect
 * helpers take the shared `OpencodeAdapterDeps` as an explicit argument.
 *
 * @module OpencodeAdapter.runtime.eventBase
 */
import { type ProviderRuntimeEvent, type RuntimeTaskId, type ThreadId } from '@orxa-code/contracts'
import { Effect } from 'effect'

import {
  type ProviderAdapterError,
  ProviderAdapterProcessError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
} from '../Errors.ts'
import type { OpencodeAdapterDeps } from './OpencodeAdapter.deps.ts'
import { emitProviderSessionExitedEvent } from './ProviderAdapter.shared.ts'
import { abortOpencodeSession } from './OpencodeAdapter.sdk.ts'
import type { OpencodeEventStamp, OpencodeMapperContext } from './OpencodeAdapter.pure.ts'
import type { OpencodeEvent, OpencodePart } from './OpencodeAdapter.types.ts'
import { PROVIDER, type OpencodeSessionContext } from './OpencodeAdapter.types.ts'

export interface PartHintEntry {
  readonly partId: string
  readonly partType: string
}

export interface PartHintCache {
  readonly remember: (part: OpencodePart) => void
  readonly lookup: (partId: string) => PartHintEntry | undefined
  readonly forget: (partId: string) => void
  readonly clear: () => void
}

export function createPartHintCache(): PartHintCache {
  const entries = new Map<string, PartHintEntry>()
  return {
    remember: part => {
      entries.set(part.id, { partId: part.id, partType: part.type })
    },
    lookup: partId => entries.get(partId),
    forget: partId => {
      entries.delete(partId)
    },
    clear: () => {
      entries.clear()
    },
  }
}

export function readPartHintFromEvent(
  event: OpencodeEvent,
  cache: PartHintCache
): PartHintEntry | undefined {
  if (event.type === 'message.part.updated') {
    cache.remember(event.properties.part)
    return { partId: event.properties.part.id, partType: event.properties.part.type }
  }
  if (event.type === 'message.part.delta') {
    return cache.lookup(event.properties.partID)
  }
  if (event.type === 'message.part.removed') {
    const hint = cache.lookup(event.properties.partID)
    cache.forget(event.properties.partID)
    return hint
  }
  return undefined
}

const MAX_EVENTS_PER_SDK_EVENT = 4

export const prepareMapperContext = Effect.fn('prepareMapperContext')(function* (
  deps: OpencodeAdapterDeps,
  context: OpencodeSessionContext,
  // Abort-path callers may synthesize one `item.completed` per in-flight
  // tool part on top of the regular SDK-event fan-out, so they pass an
  // explicit count instead of the shared per-event ceiling.
  stampCount: number = MAX_EVENTS_PER_SDK_EVENT
) {
  const stamps: Array<OpencodeEventStamp> = []
  for (let index = 0; index < stampCount; index += 1) {
    stamps.push(yield* deps.makeEventStamp())
  }
  let cursor = 0
  const mapperContext: OpencodeMapperContext = {
    threadId: context.session.threadId,
    turnId: context.turnState?.turnId,
    providerSessionId: context.providerSessionId,
    relatedSessionIds: context.relatedSessionIds,
    childDelegationsBySessionId: context.childDelegationsBySessionId,
    ...(context.turnState
      ? {
          streamedPartIds: context.turnState.streamedPartIds,
          contextWindowRef: {
            get emitted(): boolean {
              return context.turnState?.contextWindowEmitted ?? true
            },
            set emitted(value: boolean) {
              if (context.turnState) context.turnState.contextWindowEmitted = value
            },
          },
        }
      : {}),
    nextStamp: (): OpencodeEventStamp => {
      const stamp = stamps[cursor]
      if (stamp === undefined) {
        throw new Error('Opencode mapper exhausted pre-allocated event stamps.')
      }
      cursor += 1
      return stamp
    },
  }
  return mapperContext
})

export const emitMappedEvents = Effect.fn('emitMappedEvents')(function* (
  deps: OpencodeAdapterDeps,
  events: ReadonlyArray<ProviderRuntimeEvent>
) {
  for (const event of events) {
    yield* deps.offerRuntimeEvent(event)
  }
})

export const emitSessionStartedEvent = Effect.fn('emitSessionStartedEvent')(function* (
  deps: OpencodeAdapterDeps,
  context: OpencodeSessionContext,
  providerSessionId: string
) {
  const stamp = yield* deps.makeEventStamp()
  yield* deps.offerRuntimeEvent({
    type: 'session.started',
    eventId: stamp.eventId,
    provider: PROVIDER,
    createdAt: stamp.createdAt,
    threadId: context.session.threadId,
    payload: { message: `opencode session ${providerSessionId} ready` },
    providerRefs: {},
  })
})

export const emitSessionExitedEvent = (
  deps: OpencodeAdapterDeps,
  context: OpencodeSessionContext,
  reason: string,
  exitKind: 'graceful' | 'error'
): Effect.Effect<void> =>
  emitProviderSessionExitedEvent(deps, {
    provider: PROVIDER,
    threadId: context.session.threadId,
    reason,
    exitKind,
  })

export const emitRuntimeErrorEvent = Effect.fn('emitRuntimeErrorEvent')(function* (
  deps: OpencodeAdapterDeps,
  context: OpencodeSessionContext,
  message: string
) {
  const stamp = yield* deps.makeEventStamp()
  yield* deps.offerRuntimeEvent({
    type: 'runtime.error',
    eventId: stamp.eventId,
    provider: PROVIDER,
    createdAt: stamp.createdAt,
    threadId: context.session.threadId,
    ...(context.turnState ? { turnId: context.turnState.turnId } : {}),
    payload: { message, class: 'provider_error' },
    providerRefs: {},
  })
})

export const emitTaskProgressEvent = Effect.fn('emitTaskProgressEvent')(function* (
  deps: OpencodeAdapterDeps,
  context: OpencodeSessionContext,
  taskId: RuntimeTaskId,
  description: string,
  options?: {
    readonly summary?: string | undefined
    readonly lastToolName?: string | undefined
  }
) {
  const stamp = yield* deps.makeEventStamp()
  yield* deps.offerRuntimeEvent({
    type: 'task.progress',
    eventId: stamp.eventId,
    provider: PROVIDER,
    createdAt: stamp.createdAt,
    threadId: context.session.threadId,
    ...(context.turnState ? { turnId: context.turnState.turnId } : {}),
    payload: {
      taskId,
      description,
      ...(options?.summary ? { summary: options.summary } : {}),
      ...(options?.lastToolName ? { lastToolName: options.lastToolName } : {}),
    },
    providerRefs: {},
  })
})

function toErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'string') return cause
  return fallback
}

export const abortOpencodeSessionIgnoring = (
  context: OpencodeSessionContext,
  fallbackDetail: string,
  sessionIdOverride?: string
): Effect.Effect<void> =>
  Effect.tryPromise({
    try: () =>
      abortOpencodeSession({
        client: context.runtime.client,
        sessionId: sessionIdOverride ?? context.providerSessionId,
      }),
    catch: cause =>
      new ProviderAdapterProcessError({
        provider: PROVIDER,
        threadId: context.session.threadId,
        detail: toErrorMessage(cause, fallbackDetail),
        cause,
      }),
  }).pipe(Effect.ignore)

export const requireOpencodeSession = (
  deps: OpencodeAdapterDeps,
  threadId: ThreadId
): Effect.Effect<OpencodeSessionContext, ProviderAdapterError> => {
  const context = deps.sessions.get(threadId)
  if (!context) {
    return Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }))
  }
  if (context.stopped || context.session.status === 'closed') {
    return Effect.fail(new ProviderAdapterSessionClosedError({ provider: PROVIDER, threadId }))
  }
  return Effect.succeed(context)
}
