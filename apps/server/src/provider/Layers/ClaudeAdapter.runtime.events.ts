/**
 * Claude adapter runtime event-emitter helpers.
 *
 * Low-level helpers that emit canonical runtime events: native SDK logging,
 * runtime error/warning emitters, thread identity tracking, assistant text
 * block lifecycle (fallback delta + completion), token-usage snapshots, and
 * proposed-plan completion. These helpers are called by the higher-level
 * message and turn handlers.
 *
 * @module ClaudeAdapter.runtime.events
 */
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ProviderItemId, type ThreadTokenUsageSnapshot, type TurnId } from '@orxa-code/contracts'
import { Effect, Random } from 'effect'

import type { ClaudeAdapterDeps } from './ClaudeAdapter.deps.ts'
import { buildContentDeltaEventBase } from './ClaudeAdapter.runtime.eventBase.ts'
import { asCanonicalTurnId, asRuntimeItemId } from './ClaudeAdapter.pure.ts'
import {
  exitPlanCaptureKey,
  extractAssistantTextBlocks,
  nativeProviderRefs,
  sdkNativeItemId,
  sdkNativeMethod,
} from './ClaudeAdapter.sdk.ts'
import {
  PROVIDER,
  type AssistantTextBlockCompletionOptions,
  type AssistantTextBlockState,
  type ClaudeSessionContext,
} from './ClaudeAdapter.types.ts'

export const logNativeSdkMessage = Effect.fn('logNativeSdkMessage')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  message: SDKMessage
) {
  if (!deps.nativeEventLogger) {
    return
  }

  const observedAt = new Date().toISOString()
  const itemId = sdkNativeItemId(message)

  yield* deps.nativeEventLogger.write(
    {
      observedAt,
      event: {
        id:
          'uuid' in message && typeof message.uuid === 'string'
            ? message.uuid
            : crypto.randomUUID(),
        kind: 'notification',
        provider: PROVIDER,
        createdAt: observedAt,
        method: sdkNativeMethod(message),
        ...(typeof message.session_id === 'string' ? { providerThreadId: message.session_id } : {}),
        ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
        ...(itemId ? { itemId: ProviderItemId.makeUnsafe(itemId) } : {}),
        payload: message,
      },
    },
    context.session.threadId
  )
})

export const updateResumeCursor = Effect.fn('updateResumeCursor')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext
) {
  const threadId = context.session.threadId
  if (!threadId) return

  const resumeCursor = {
    threadId,
    ...(context.resumeSessionId ? { resume: context.resumeSessionId } : {}),
    ...(context.lastAssistantUuid ? { resumeSessionAt: context.lastAssistantUuid } : {}),
    turnCount: context.turns.length,
  }

  context.session = {
    ...context.session,
    resumeCursor,
    updatedAt: yield* deps.nowIso,
  }
})

export const ensureAssistantTextBlock = Effect.fn('ensureAssistantTextBlock')(function* (
  _deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  blockIndex: number,
  options?: {
    readonly fallbackText?: string
    readonly streamClosed?: boolean
  }
) {
  const turnState = context.turnState
  if (!turnState) {
    return undefined
  }

  const existing = turnState.assistantTextBlocks.get(blockIndex)
  if (existing && !existing.completionEmitted) {
    if (existing.fallbackText.length === 0 && options?.fallbackText) {
      existing.fallbackText = options.fallbackText
    }
    if (options?.streamClosed) {
      existing.streamClosed = true
    }
    return { blockIndex, block: existing }
  }

  const block: AssistantTextBlockState = {
    itemId: yield* Random.nextUUIDv4,
    blockIndex,
    emittedTextDelta: false,
    fallbackText: options?.fallbackText ?? '',
    streamClosed: options?.streamClosed ?? false,
    completionEmitted: false,
  }
  turnState.assistantTextBlocks.set(blockIndex, block)
  turnState.assistantTextBlockOrder.push(block)
  return { blockIndex, block }
})

export const createSyntheticAssistantTextBlock = Effect.fn('createSyntheticAssistantTextBlock')(
  function* (deps: ClaudeAdapterDeps, context: ClaudeSessionContext, fallbackText: string) {
    const turnState = context.turnState
    if (!turnState) {
      return undefined
    }

    const blockIndex = turnState.nextSyntheticAssistantBlockIndex
    turnState.nextSyntheticAssistantBlockIndex -= 1
    return yield* ensureAssistantTextBlock(deps, context, blockIndex, {
      fallbackText,
      streamClosed: true,
    })
  }
)

export const assistantTextBlockRaw = (options?: AssistantTextBlockCompletionOptions) =>
  options?.rawMethod || options?.rawPayload
    ? {
        raw: {
          source: 'claude.sdk.message' as const,
          ...(options.rawMethod ? { method: options.rawMethod } : {}),
          payload: options?.rawPayload,
        },
      }
    : {}

export const emitAssistantTextBlockFallbackDelta = Effect.fn('emitAssistantTextBlockFallbackDelta')(
  function* (
    deps: ClaudeAdapterDeps,
    context: ClaudeSessionContext,
    turnId: TurnId,
    block: AssistantTextBlockState,
    options?: AssistantTextBlockCompletionOptions
  ) {
    if (block.emittedTextDelta || block.fallbackText.length === 0) {
      return
    }

    const deltaStamp = yield* deps.makeEventStamp()
    yield* deps.offerRuntimeEvent({
      type: 'content.delta',
      ...buildContentDeltaEventBase({
        context,
        stamp: deltaStamp,
        turnId,
        itemId: block.itemId,
        providerRefs: nativeProviderRefs(context),
      }),
      payload: {
        streamKind: 'assistant_text',
        delta: block.fallbackText,
      },
      ...assistantTextBlockRaw(options),
    })
  }
)

export const emitAssistantTextBlockCompleted = Effect.fn('emitAssistantTextBlockCompleted')(
  function* (
    deps: ClaudeAdapterDeps,
    context: ClaudeSessionContext,
    turnId: TurnId,
    block: AssistantTextBlockState,
    options?: AssistantTextBlockCompletionOptions
  ) {
    const stamp = yield* deps.makeEventStamp()
    yield* deps.offerRuntimeEvent({
      type: 'item.completed',
      eventId: stamp.eventId,
      provider: PROVIDER,
      createdAt: stamp.createdAt,
      itemId: asRuntimeItemId(block.itemId),
      threadId: context.session.threadId,
      turnId,
      payload: {
        itemType: 'assistant_message',
        status: 'completed',
        title: 'Assistant message',
        ...(block.fallbackText.length > 0 ? { detail: block.fallbackText } : {}),
      },
      providerRefs: nativeProviderRefs(context),
      ...assistantTextBlockRaw(options),
    })
  }
)

export const completeAssistantTextBlock = Effect.fn('completeAssistantTextBlock')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  block: AssistantTextBlockState,
  options?: AssistantTextBlockCompletionOptions
) {
  const turnState = context.turnState
  if (!turnState || block.completionEmitted) {
    return
  }

  if (!options?.force && !block.streamClosed) {
    return
  }

  yield* emitAssistantTextBlockFallbackDelta(deps, context, turnState.turnId, block, options)

  block.completionEmitted = true
  if (turnState.assistantTextBlocks.get(block.blockIndex) === block) {
    turnState.assistantTextBlocks.delete(block.blockIndex)
  }

  yield* emitAssistantTextBlockCompleted(deps, context, turnState.turnId, block, options)
})

export const backfillAssistantTextBlocksFromSnapshot = Effect.fn(
  'backfillAssistantTextBlocksFromSnapshot'
)(function* (deps: ClaudeAdapterDeps, context: ClaudeSessionContext, message: SDKMessage) {
  const turnState = context.turnState
  if (!turnState) {
    return
  }

  const snapshotTextBlocks = extractAssistantTextBlocks(message)
  if (snapshotTextBlocks.length === 0) {
    return
  }

  const orderedBlocks = turnState.assistantTextBlockOrder.map(block => ({
    blockIndex: block.blockIndex,
    block,
  }))

  for (const [position, text] of snapshotTextBlocks.entries()) {
    const existingEntry = orderedBlocks[position]
    const entry =
      existingEntry ??
      (yield* createSyntheticAssistantTextBlock(deps, context, text).pipe(
        Effect.map(created => {
          if (!created) {
            return undefined
          }
          orderedBlocks.push(created)
          return created
        })
      ))
    if (!entry) {
      continue
    }

    if (entry.block.fallbackText.length === 0) {
      entry.block.fallbackText = text
    }

    if (entry.block.streamClosed && !entry.block.completionEmitted) {
      yield* completeAssistantTextBlock(deps, context, entry.block, {
        rawMethod: 'claude/assistant',
        rawPayload: message,
      })
    }
  }
})

export const ensureThreadId = Effect.fn('ensureThreadId')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  message: SDKMessage
) {
  if (typeof message.session_id !== 'string' || message.session_id.length === 0) {
    return
  }
  const nextThreadId = message.session_id
  context.resumeSessionId = message.session_id
  yield* updateResumeCursor(deps, context)

  if (context.lastThreadStartedId !== nextThreadId) {
    context.lastThreadStartedId = nextThreadId
    const stamp = yield* deps.makeEventStamp()
    yield* deps.offerRuntimeEvent({
      type: 'thread.started',
      eventId: stamp.eventId,
      provider: PROVIDER,
      createdAt: stamp.createdAt,
      threadId: context.session.threadId,
      payload: {
        providerThreadId: nextThreadId,
      },
      providerRefs: {},
      raw: {
        source: 'claude.sdk.message',
        method: 'claude/thread/started',
        payload: {
          session_id: message.session_id,
        },
      },
    })
  }
})

export const emitRuntimeError = Effect.fn('emitRuntimeError')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  message: string,
  cause?: unknown
) {
  if (cause !== undefined) {
    void cause
  }
  const turnState = context.turnState
  const stamp = yield* deps.makeEventStamp()
  yield* deps.offerRuntimeEvent({
    type: 'runtime.error',
    eventId: stamp.eventId,
    provider: PROVIDER,
    createdAt: stamp.createdAt,
    threadId: context.session.threadId,
    ...(turnState ? { turnId: asCanonicalTurnId(turnState.turnId) } : {}),
    payload: {
      message,
      class: 'provider_error',
      ...(cause !== undefined ? { detail: cause } : {}),
    },
    providerRefs: nativeProviderRefs(context),
  })
})

export const emitRuntimeWarning = Effect.fn('emitRuntimeWarning')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  message: string,
  detail?: unknown
) {
  const turnState = context.turnState
  const stamp = yield* deps.makeEventStamp()
  yield* deps.offerRuntimeEvent({
    type: 'runtime.warning',
    eventId: stamp.eventId,
    provider: PROVIDER,
    createdAt: stamp.createdAt,
    threadId: context.session.threadId,
    ...(turnState ? { turnId: asCanonicalTurnId(turnState.turnId) } : {}),
    payload: {
      message,
      ...(detail !== undefined ? { detail } : {}),
    },
    providerRefs: nativeProviderRefs(context),
  })
})

export const emitProposedPlanCompleted = Effect.fn('emitProposedPlanCompleted')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  input: {
    readonly planMarkdown: string
    readonly toolUseId?: string | undefined
    readonly rawSource: 'claude.sdk.message' | 'claude.sdk.permission'
    readonly rawMethod: string
    readonly rawPayload: unknown
  }
) {
  const turnState = context.turnState
  const planMarkdown = input.planMarkdown.trim()
  if (!turnState || planMarkdown.length === 0) {
    return
  }

  const captureKey = exitPlanCaptureKey({
    toolUseId: input.toolUseId,
    planMarkdown,
  })
  if (turnState.capturedProposedPlanKeys.has(captureKey)) {
    return
  }
  turnState.capturedProposedPlanKeys.add(captureKey)

  const stamp = yield* deps.makeEventStamp()
  yield* deps.offerRuntimeEvent({
    type: 'turn.proposed.completed',
    eventId: stamp.eventId,
    provider: PROVIDER,
    createdAt: stamp.createdAt,
    threadId: context.session.threadId,
    turnId: turnState.turnId,
    payload: {
      planMarkdown,
    },
    providerRefs: nativeProviderRefs(context, {
      providerItemId: input.toolUseId,
    }),
    raw: {
      source: input.rawSource,
      method: input.rawMethod,
      payload: input.rawPayload,
    },
  })
})

export const emitThreadTokenUsageSnapshot = Effect.fn('emitThreadTokenUsageSnapshot')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  usageSnapshot: ThreadTokenUsageSnapshot | undefined,
  turnId?: TurnId
) {
  if (!usageSnapshot) {
    return
  }

  const usageStamp = yield* deps.makeEventStamp()
  yield* deps.offerRuntimeEvent({
    type: 'thread.token-usage.updated',
    eventId: usageStamp.eventId,
    provider: PROVIDER,
    createdAt: usageStamp.createdAt,
    threadId: context.session.threadId,
    ...(turnId ? { turnId } : {}),
    payload: {
      usage: usageSnapshot,
    },
    providerRefs: turnId ? nativeProviderRefs(context) : {},
  })
})
