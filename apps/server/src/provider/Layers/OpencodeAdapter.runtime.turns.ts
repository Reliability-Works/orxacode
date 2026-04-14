/**
 * Opencode adapter runtime turn-lifecycle helpers.
 *
 * Owns `sendTurn` (push a user prompt through the SDK, open a turn state,
 * emit `turn.started`) and `interruptTurn` (abort the SDK session, close
 * the in-flight turn via `mapTurnAbort`). Interrupt-first semantics match
 * the Claude adapter: if a turn is already running on `sendTurn`, we
 * interrupt it before opening the new one.
 *
 * Plan-mode propagation lives here rather than on `startSession` because
 * opencode's `ProviderSessionStartInput` has no `interactionMode` field —
 * only `ProviderSendTurnInput` does. When `turn.interactionMode === 'plan'`,
 * the adapter dispatches the turn against the opencode `plan` agent; in any
 * other mode it dispatches against the default (`build`) agent.
 *
 * @module OpencodeAdapter.runtime.turns
 */
import {
  type ProviderSendTurnInput,
  type ProviderTurnStartResult,
  RuntimeTaskId,
  type ThreadId,
  TurnId,
} from '@orxa-code/contracts'
import { Effect, Random } from 'effect'

import {
  type ProviderAdapterError,
  ProviderAdapterRequestError,
  ProviderAdapterValidationError,
} from '../Errors.ts'
import type { OpencodeAdapterDeps } from './OpencodeAdapter.deps.ts'
import { mapInterruptedToolCalls, mapTurnAbort } from './OpencodeAdapter.pure.ts'
import {
  abortOpencodeSessionIgnoring,
  emitMappedEvents,
  emitTaskProgressEvent,
  prepareMapperContext,
  requireOpencodeSession,
} from './OpencodeAdapter.runtime.eventBase.ts'
import { sendOpencodePrompt } from './OpencodeAdapter.sdk.ts'
import {
  PROVIDER,
  type OpencodeSessionContext,
  type OpencodeTurnState,
} from './OpencodeAdapter.types.ts'

const DEFAULT_AGENT = 'build'
const PLAN_AGENT = 'plan'

function startupTaskId(turnId: TurnId): RuntimeTaskId {
  return RuntimeTaskId.makeUnsafe(`opencode-startup-${turnId}`)
}

function describeElapsedMs(startedAtMs: number, nowMs: number): string {
  const elapsedMs = Math.max(0, nowMs - startedAtMs)
  return `${elapsedMs}ms`
}

function toErrorMessageLocal(cause: unknown, fallback: string): string {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'string') return cause
  return fallback
}

function toRequestError(
  threadId: ThreadId,
  method: string,
  cause: unknown
): ProviderAdapterRequestError {
  const detail = toErrorMessageLocal(cause, `Unknown ${method} failure`)
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method: `opencode:${method}`,
    detail: `[thread ${threadId}] ${detail}`,
    cause,
  })
}

function resolveAgent(input: ProviderSendTurnInput): string {
  const modelSelection =
    input.modelSelection?.provider === 'opencode' ? input.modelSelection : undefined
  if (modelSelection?.agentId) return modelSelection.agentId
  return input.interactionMode === 'plan' ? PLAN_AGENT : DEFAULT_AGENT
}

function resolveVariant(input: ProviderSendTurnInput): string | undefined {
  if (input.modelSelection?.provider !== 'opencode') return undefined
  return input.modelSelection.variant
}

function splitModelString(
  raw: string
): { readonly providerID: string; readonly modelID: string } | undefined {
  const slash = raw.indexOf('/')
  if (slash <= 0 || slash === raw.length - 1) return undefined
  return {
    providerID: raw.slice(0, slash),
    modelID: raw.slice(slash + 1),
  }
}

const DEFAULT_PROVIDER_ID = 'anthropic'
const DEFAULT_MODEL_ID = 'claude-3-5-sonnet-latest'

function resolveModelTuple(
  context: OpencodeSessionContext,
  input: ProviderSendTurnInput
): { readonly providerID: string; readonly modelID: string } {
  const modelSelection =
    input.modelSelection?.provider === 'opencode' ? input.modelSelection : undefined
  if (modelSelection?.model) {
    const parsed = splitModelString(modelSelection.model)
    if (parsed) return parsed
    return {
      providerID: context.currentProviderId ?? DEFAULT_PROVIDER_ID,
      modelID: modelSelection.model,
    }
  }
  return {
    providerID: context.currentProviderId ?? DEFAULT_PROVIDER_ID,
    modelID: context.currentModelId ?? DEFAULT_MODEL_ID,
  }
}

const abortInflightTurn = Effect.fn('opencode.abortInflightTurn')(function* (
  deps: OpencodeAdapterDeps,
  context: OpencodeSessionContext,
  reason: string
) {
  // Always ask the SDK to abort even when we have no local turnState. Client
  // and server state can drift: the UI may still show "Working" while our
  // turnState was cleared by a stray `session.idle` or a missed event. If we
  // skip the abort in that window, the SDK session keeps running server-side
  // and the stop button looks broken. `session.abort` is idempotent — a
  // redundant call is harmless.
  yield* abortOpencodeSessionIgnoring(context, 'Failed to abort opencode session.')
  if (context.turnState) {
    const inFlight = Array.from(context.turnState.inFlightToolParts, ([partId, itemType]) => ({
      partId,
      itemType,
    }))
    // 1 stamp per synthesized tool completion + 1 for `turn.aborted`.
    const mapperContext = yield* prepareMapperContext(deps, context, inFlight.length + 1)
    const interruptedToolEvents = mapInterruptedToolCalls(inFlight, mapperContext)
    if (interruptedToolEvents.length > 0) {
      yield* emitMappedEvents(deps, interruptedToolEvents)
    }
    const abortEvents = mapTurnAbort(reason, mapperContext)
    if (abortEvents.length > 0) {
      yield* emitMappedEvents(deps, abortEvents)
    }
    context.turnState.inFlightToolParts.clear()
    context.turnState = undefined
    context.session = {
      ...context.session,
      status: 'ready',
      activeTurnId: undefined,
    }
  }
})

const openTurn = Effect.fn('opencode.openTurn')(function* (
  deps: OpencodeAdapterDeps,
  context: OpencodeSessionContext
) {
  const turnId = TurnId.makeUnsafe(yield* Random.nextUUIDv4)
  const startedAt = yield* deps.nowIso
  const turnState: OpencodeTurnState = {
    turnId,
    startedAt,
    providerMessageIds: new Set<string>(),
    startupTrace: {
      taskId: startupTaskId(turnId),
      promptDispatchedAtMs: Date.now(),
      promptAcceptedAtMs: undefined,
      firstEventAtMs: undefined,
      firstContentDeltaAtMs: undefined,
      firstToolAtMs: undefined,
    },
    inFlightToolParts: new Map(),
  }
  context.turnState = turnState
  context.session = {
    ...context.session,
    status: 'running',
    activeTurnId: turnId,
    updatedAt: startedAt,
  }
  const stamp = yield* deps.makeEventStamp()
  yield* deps.offerRuntimeEvent({
    type: 'turn.started',
    eventId: stamp.eventId,
    provider: PROVIDER,
    createdAt: stamp.createdAt,
    threadId: context.session.threadId,
    turnId,
    payload: {},
    providerRefs: {},
  })
  return turnState
})

export const sendTurn = (
  deps: OpencodeAdapterDeps
): ((
  input: ProviderSendTurnInput
) => Effect.Effect<ProviderTurnStartResult, ProviderAdapterError>) =>
  Effect.fn('opencode.sendTurn')(function* (input) {
    const context = yield* requireOpencodeSession(deps, input.threadId)
    if (!input.input) {
      return yield* new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: 'sendTurn',
        issue: 'Opencode sendTurn requires non-empty input text.',
      })
    }

    if (context.turnState) {
      yield* abortInflightTurn(
        deps,
        context,
        'Interrupted by new user turn before previous turn completed.'
      )
    }

    const turnState = yield* openTurn(deps, context)
    yield* emitTaskProgressEvent(
      deps,
      context,
      turnState.startupTrace.taskId,
      'Dispatching prompt to Opencode.',
      { summary: 'Dispatching prompt to Opencode.' }
    )
    const model = resolveModelTuple(context, input)
    const agent = resolveAgent(input)
    const variant = resolveVariant(input)
    context.currentModelId = model.modelID
    context.currentProviderId = model.providerID

    yield* Effect.tryPromise({
      try: () =>
        sendOpencodePrompt({
          client: context.runtime.client,
          sessionId: context.providerSessionId,
          text: input.input ?? '',
          providerID: model.providerID,
          modelID: model.modelID,
          agent,
          ...(variant ? { variant } : {}),
          ...(context.session.cwd ? { directory: context.session.cwd } : {}),
        }),
      catch: cause => toRequestError(input.threadId, 'session.promptAsync', cause),
    })

    const acceptedAtMs = Date.now()
    turnState.startupTrace.promptAcceptedAtMs = acceptedAtMs
    const acceptedSummary = `Prompt accepted by Opencode after ${describeElapsedMs(
      turnState.startupTrace.promptDispatchedAtMs,
      acceptedAtMs
    )}.`
    yield* emitTaskProgressEvent(deps, context, turnState.startupTrace.taskId, acceptedSummary, {
      summary: acceptedSummary,
    })

    return {
      threadId: context.session.threadId,
      turnId: turnState.turnId,
    }
  })

export const interruptTurn = (
  deps: OpencodeAdapterDeps
): ((
  threadId: ThreadId,
  turnId?: TurnId,
  providerThreadId?: string
) => Effect.Effect<void, ProviderAdapterError>) =>
  Effect.fn('opencode.interruptTurn')(function* (threadId, _turnId, providerThreadId) {
    const context = yield* requireOpencodeSession(deps, threadId)
    if (providerThreadId && providerThreadId !== context.providerSessionId) {
      yield* abortOpencodeSessionIgnoring(
        context,
        'Failed to abort delegated opencode session.',
        providerThreadId
      )
      return
    }
    // Always forward to abortInflightTurn — even with no tracked turnState we
    // need the SDK session aborted defensively. See the note in
    // abortInflightTurn for why.
    yield* abortInflightTurn(deps, context, 'Interrupted by user request.')
  })
