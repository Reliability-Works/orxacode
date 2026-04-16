/**
 * Claude adapter runtime turn-lifecycle helpers.
 *
 * Hosts the synthetic turn creation, turn finalization, tool-completion
 * flush, token-usage snapshot, and `completeTurn` orchestration used by the
 * live layer when the SDK emits a result message or when the stream fiber
 * exits. Each helper takes the shared `ClaudeAdapterDeps`.
 *
 * @module ClaudeAdapter.runtime.turns
 */
import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import { type ProviderRuntimeTurnStatus, TurnId } from '@orxa-code/contracts'
import { Effect, Random } from 'effect'

import type { ClaudeAdapterDeps } from './ClaudeAdapter.deps.ts'
import { asRuntimeItemId } from './ClaudeAdapter.pure.ts'
import {
  completeAssistantTextBlock,
  emitThreadTokenUsageSnapshot,
  updateResumeCursor,
} from './ClaudeAdapter.runtime.events.ts'
import { ProviderAdapterValidationError } from '../Errors.ts'
import {
  applyResultUsageSnapshot,
  buildTurnCompletionPayload,
  nativeProviderRefs,
} from './ClaudeAdapter.sdk.ts'
import { PROVIDER, type ClaudeSessionContext, type ClaudeTurnState } from './ClaudeAdapter.types.ts'

type TurnStartedRaw = {
  readonly source: 'claude.sdk.message'
  readonly method: string
  readonly payload: unknown
}

export const emitTurnStarted = Effect.fn('emitTurnStarted')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  turnId: TurnId,
  options: {
    readonly payload: { readonly model?: string; readonly effort?: string }
    readonly providerRefs: Record<string, unknown>
    readonly raw?: TurnStartedRaw
  }
) {
  const turnStartedStamp = yield* deps.makeEventStamp()
  yield* deps.offerRuntimeEvent({
    type: 'turn.started',
    eventId: turnStartedStamp.eventId,
    provider: PROVIDER,
    createdAt: turnStartedStamp.createdAt,
    threadId: context.session.threadId,
    turnId,
    payload: options.payload,
    providerRefs: options.providerRefs,
    ...(options.raw ? { raw: options.raw } : {}),
  })
})

export const startNewTurn = Effect.fn('startNewTurn')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext
) {
  const turnId = TurnId.makeUnsafe(yield* Random.nextUUIDv4)
  const startedAt = yield* deps.nowIso
  context.turnState = {
    turnId,
    startedAt,
    items: [],
    assistantTextBlocks: new Map(),
    assistantTextBlockOrder: [],
    capturedProposedPlanKeys: new Set(),
    nextSyntheticAssistantBlockIndex: -1,
  }
  return { turnId, startedAt }
})

export const snapshotThread = Effect.fn('snapshotThread')(function* (
  _deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext
) {
  const threadId = context.session.threadId
  if (!threadId) {
    return yield* new ProviderAdapterValidationError({
      provider: PROVIDER,
      operation: 'readThread',
      issue: 'Session thread id is not initialized yet.',
    })
  }
  return {
    threadId,
    turns: context.turns.map(turn => ({
      id: turn.id,
      items: [...turn.items],
    })),
  }
})

export const emitTurnCompleted = Effect.fn('emitTurnCompleted')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  status: ProviderRuntimeTurnStatus,
  errorMessage?: string,
  result?: SDKResultMessage,
  turnId?: TurnId
) {
  const stamp = yield* deps.makeEventStamp()
  yield* deps.offerRuntimeEvent({
    type: 'turn.completed',
    eventId: stamp.eventId,
    provider: PROVIDER,
    createdAt: stamp.createdAt,
    threadId: context.session.threadId,
    ...(turnId ? { turnId } : {}),
    payload: buildTurnCompletionPayload(status, errorMessage, result),
    providerRefs: turnId ? nativeProviderRefs(context) : {},
  })
})

export const completePendingTurnTools = Effect.fn('completePendingTurnTools')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  turnId: TurnId,
  status: ProviderRuntimeTurnStatus,
  result?: SDKResultMessage
) {
  for (const [index, tool] of context.inFlightTools.entries()) {
    const toolStamp = yield* deps.makeEventStamp()
    yield* deps.offerRuntimeEvent({
      type: 'item.completed',
      eventId: toolStamp.eventId,
      provider: PROVIDER,
      createdAt: toolStamp.createdAt,
      threadId: context.session.threadId,
      turnId,
      itemId: asRuntimeItemId(tool.itemId),
      payload: {
        itemType: tool.itemType,
        status: status === 'completed' ? 'completed' : 'failed',
        title: tool.title,
        ...(tool.detail ? { detail: tool.detail } : {}),
        action: tool.action,
        data: {
          toolName: tool.toolName,
          input: tool.input,
        },
      },
      providerRefs: nativeProviderRefs(context, { providerItemId: tool.itemId }),
      raw: {
        source: 'claude.sdk.message',
        method: 'claude/result',
        payload: result ?? { status },
      },
    })
    context.inFlightTools.delete(index)
  }
  context.inFlightTools.clear()
})

export const closeAssistantTextBlocksForTurn = Effect.fn('closeAssistantTextBlocksForTurn')(
  function* (
    deps: ClaudeAdapterDeps,
    context: ClaudeSessionContext,
    turnState: ClaudeTurnState,
    status: ProviderRuntimeTurnStatus,
    result?: SDKResultMessage
  ) {
    for (const block of turnState.assistantTextBlockOrder) {
      yield* completeAssistantTextBlock(deps, context, block, {
        force: true,
        rawMethod: 'claude/result',
        rawPayload: result ?? { status },
      })
    }
  }
)

export const finalizeTurnState = Effect.fn('finalizeTurnState')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  turnState: ClaudeTurnState,
  status: ProviderRuntimeTurnStatus,
  errorMessage?: string
) {
  context.turns.push({
    id: turnState.turnId,
    items: [...turnState.items],
  })

  const updatedAt = yield* deps.nowIso
  context.turnState = undefined
  context.session = {
    ...context.session,
    status: 'ready',
    activeTurnId: undefined,
    updatedAt,
    ...(status === 'failed' && errorMessage ? { lastError: errorMessage } : {}),
  }
  yield* updateResumeCursor(deps, context)
})

export const completeTurn = Effect.fn('completeTurn')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  status: ProviderRuntimeTurnStatus,
  errorMessage?: string,
  result?: SDKResultMessage
) {
  const usageSnapshot = applyResultUsageSnapshot(context, result)

  const turnState = context.turnState
  if (!turnState) {
    yield* emitThreadTokenUsageSnapshot(deps, context, usageSnapshot)
    yield* emitTurnCompleted(deps, context, status, errorMessage, result)
    return
  }

  yield* completePendingTurnTools(deps, context, turnState.turnId, status, result)
  yield* closeAssistantTextBlocksForTurn(deps, context, turnState, status, result)
  yield* emitThreadTokenUsageSnapshot(deps, context, usageSnapshot, turnState.turnId)
  yield* emitTurnCompleted(deps, context, status, errorMessage, result, turnState.turnId)
  yield* finalizeTurnState(deps, context, turnState, status, errorMessage)
})

export const ensureSyntheticAssistantTurn = Effect.fn('ensureSyntheticAssistantTurn')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext
) {
  if (context.turnState) {
    return
  }

  const { turnId, startedAt } = yield* startNewTurn(deps, context)
  context.session = {
    ...context.session,
    status: 'running',
    activeTurnId: turnId,
    updatedAt: startedAt,
  }
  yield* emitTurnStarted(deps, context, turnId, {
    payload: {},
    providerRefs: {
      ...nativeProviderRefs(context),
      providerTurnId: turnId,
    },
    raw: {
      source: 'claude.sdk.message',
      method: 'claude/synthetic-turn-start',
      payload: {},
    },
  })
})
