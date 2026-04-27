/**
 * Opencode adapter runtime event-pump helpers.
 *
 * Owns the bridge between the opencode SDK event subscribe stream and the
 * shared `runtimeEventQueue`. The session lifecycle module
 * (`OpencodeAdapter.runtime.session.ts`) calls into `attachEventStreamFiber`
 * after it has acquired a runtime + opened the SDK event stream; this module
 * then forks the consume loop, runs every incoming SDK event through the
 * f03 pure mapper (with the per-context partHint cache), funnels the produced
 * `ProviderRuntimeEvent` array into the runtime queue, and falls back to a
 * graceful `stopSessionInternal` if the upstream stream errors out.
 *
 * The pump deliberately stays in its own file (rather than living in
 * `runtime.session.ts`) so that:
 *   - the session module can stay focused on lifecycle / acquireRelease
 *     ordering and stay under the 500-line lint cap, and
 *   - f05's streaming integration test can import the pump entry points
 *     directly without spinning up the full session module.
 *
 * No Effect service tag here — the f05 entry Layer wires `OpencodeAdapterDeps`
 * + the runFork-with-services function and hands them to `attachEventStreamFiber`.
 *
 * @module OpencodeAdapter.runtime.events
 */
import { Cause, Effect, Exit, type Fiber, Stream } from 'effect'

import type { OpencodeAdapterDeps } from './OpencodeAdapter.deps.ts'
import { mapOpencodeEvent } from './OpencodeAdapter.pure.ts'
import { toolLifecycleItemTypeForTool } from './OpencodeAdapter.toolSummary.ts'
import { readOpencodeSubtaskDelegation } from '../../opencodeChildThreads.ts'
import {
  emitMappedEvents,
  emitRuntimeErrorEvent,
  emitTaskProgressEvent,
  prepareMapperContext,
  readPartHintFromEvent,
} from './OpencodeAdapter.runtime.eventBase.ts'
import type {
  OpencodeEvent,
  OpencodeSessionContext,
  ProviderRuntimeEvent,
} from './OpencodeAdapter.types.ts'

function rememberPendingPromptRequests(
  context: OpencodeSessionContext,
  event: OpencodeEvent
): void {
  if (event.type === 'permission.asked') {
    const info = event.properties
    context.pendingPermissions.set(info.id, {
      requestID: info.id,
      permission: info.permission,
    })
    return
  }
  if (event.type === 'permission.replied') {
    context.pendingPermissions.delete(event.properties.requestID)
    return
  }
  if (event.type === 'question.asked') {
    const info = event.properties
    // Mirror the pure mapper's `q${index}` keying so respondToUserInput can
    // rebuild the positional answers array from the ids we exposed upstream.
    const questionIds = info.questions.map((_, index) => `q${index}`)
    context.pendingQuestions.set(info.id, {
      requestID: info.id,
      questionIds,
    })
    return
  }
  if (event.type === 'question.replied' || event.type === 'question.rejected') {
    context.pendingQuestions.delete(event.properties.requestID)
  }
}

function trackInFlightToolParts(context: OpencodeSessionContext, event: OpencodeEvent): void {
  const turnState = context.turnState
  if (!turnState) return
  if (event.type === 'message.part.updated') {
    const part = event.properties.part
    if (part.type !== 'tool') return
    const status = part.state.status
    if (status === 'pending' || status === 'running') {
      turnState.inFlightToolParts.set(part.id, toolLifecycleItemTypeForTool(part.tool))
      return
    }
    if (status === 'completed' || status === 'error') {
      turnState.inFlightToolParts.delete(part.id)
    }
    return
  }
  if (event.type === 'message.part.removed') {
    turnState.inFlightToolParts.delete(event.properties.partID)
  }
}

function rememberChildSessionRelations(
  context: OpencodeSessionContext,
  event: OpencodeEvent
): void {
  if (event.type === 'message.part.updated') {
    const delegation = readOpencodeSubtaskDelegation(event.properties)
    if (delegation) {
      context.pendingChildDelegations.push({
        parentProviderSessionId: delegation.parentProviderSessionId,
        agentLabel: delegation.agentLabel,
        prompt: delegation.prompt,
        description: delegation.description,
        modelSelection: delegation.modelSelection,
        command: delegation.command,
      })
    }
    return
  }

  if (event.type === 'session.created') {
    const session = event.properties.info
    if (!session.parentID || !context.relatedSessionIds.has(session.parentID)) {
      return
    }
    context.relatedSessionIds.add(session.id)
    const delegationIndex = context.pendingChildDelegations.findIndex(
      entry => entry.parentProviderSessionId === session.parentID
    )
    if (delegationIndex >= 0) {
      const [delegation] = context.pendingChildDelegations.splice(delegationIndex, 1)
      if (delegation) {
        context.childDelegationsBySessionId.set(session.id, delegation)
      }
    }
    return
  }

  if (event.type === 'session.updated') {
    const info = event.properties.info
    if (typeof info.id !== 'string') {
      return
    }
    if (typeof info.parentID === 'string' && context.relatedSessionIds.has(info.parentID)) {
      context.relatedSessionIds.add(info.id)
    }
    return
  }

  if (event.type === 'session.deleted') {
    context.relatedSessionIds.delete(event.properties.sessionID)
    context.childDelegationsBySessionId.delete(event.properties.sessionID)
  }
}

function milestoneSummary(label: string, startedAtMs: number, nowMs: number): string {
  const elapsedMs = Math.max(0, nowMs - startedAtMs)
  return `${label} after ${elapsedMs}ms.`
}

const markStartupMilestones = Effect.fn('opencode.markStartupMilestones')(function* (
  deps: OpencodeAdapterDeps,
  context: OpencodeSessionContext,
  event: OpencodeEvent
) {
  const startupTrace = context.turnState?.startupTrace
  if (!startupTrace) return

  const nowMs = Date.now()
  if (startupTrace.firstEventAtMs === undefined) {
    startupTrace.firstEventAtMs = nowMs
    const summary = milestoneSummary(
      'First runtime event received',
      startupTrace.promptDispatchedAtMs,
      nowMs
    )
    yield* emitTaskProgressEvent(deps, context, startupTrace.taskId, summary, {
      summary,
    })
  }

  if (event.type === 'message.part.delta' && startupTrace.firstContentDeltaAtMs === undefined) {
    startupTrace.firstContentDeltaAtMs = nowMs
    const summary = milestoneSummary(
      'First response token received',
      startupTrace.promptDispatchedAtMs,
      nowMs
    )
    yield* emitTaskProgressEvent(deps, context, startupTrace.taskId, summary, {
      summary,
    })
  }

  if (
    event.type === 'message.part.updated' &&
    event.properties.part.type === 'tool' &&
    startupTrace.firstToolAtMs === undefined
  ) {
    startupTrace.firstToolAtMs = nowMs
    const summary = milestoneSummary(
      'First tool activity received',
      startupTrace.promptDispatchedAtMs,
      nowMs
    )
    yield* emitTaskProgressEvent(deps, context, startupTrace.taskId, summary, {
      summary,
      lastToolName: event.properties.part.tool,
    })
  }
})

function reconcileTerminalTurnState(
  context: OpencodeSessionContext,
  produced: ReadonlyArray<ProviderRuntimeEvent>
): void {
  const turnState = context.turnState
  if (!turnState) return

  const terminalEvent = produced.find(
    event => event.type === 'turn.completed' && String(event.turnId) === String(turnState.turnId)
  )
  if (!terminalEvent || terminalEvent.type !== 'turn.completed') return

  turnState.inFlightToolParts.clear()
  context.turnState = undefined
  context.session = {
    ...context.session,
    status: terminalEvent.payload.state === 'failed' ? 'error' : 'ready',
    activeTurnId: undefined,
    updatedAt: terminalEvent.createdAt,
  }
}

/**
 * Resolve any value to a best-effort string error message.
 *
 * Lives here (instead of in `eventBase.ts`) because the eventBase already has
 * its own private copy and the lint rule that bans cross-module duplication
 * means we keep this one private to the pump.
 */
function pumpErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'string') return cause
  return fallback
}

/**
 * Type alias for the runFork helper supplied by `Effect.runForkWith(services)`.
 *
 * The session module captures the active services via `Effect.services()` and
 * passes the resulting runFork into the pump so the spawned fiber inherits
 * the live `Random` / `Clock` / file-system layers from the entry Layer.
 */
export type EventStreamRunFork = <A, E>(effect: Effect.Effect<A, E>) => Fiber.Fiber<A, E>

/**
 * Per-event handler. Looks up the partHint cache for the active session,
 * builds a fresh mapper context (with the pre-allocated stamp pool from f04),
 * runs the f03 pure mapper, and forwards the produced runtime events.
 */
export const handleIncomingEvent = (
  deps: OpencodeAdapterDeps,
  context: OpencodeSessionContext,
  event: OpencodeEvent,
  cacheLookup: (event: OpencodeEvent) => ReturnType<typeof readPartHintFromEvent>
): Effect.Effect<void> =>
  Effect.gen(function* () {
    rememberChildSessionRelations(context, event)
    rememberPendingPromptRequests(context, event)
    trackInFlightToolParts(context, event)
    yield* markStartupMilestones(deps, context, event)
    const hint = cacheLookup(event)
    const mapperContext = yield* prepareMapperContext(deps, context)
    const produced = mapOpencodeEvent(event, mapperContext, hint)
    if (produced.length > 0) {
      yield* emitMappedEvents(deps, produced)
      reconcileTerminalTurnState(context, produced)
    }
  })

/**
 * Drive the SDK event stream into the runtime queue. Stops as soon as the
 * `context.stopped` flag flips, so the session module's finalizer can short-
 * circuit the loop without waiting for the upstream iterator to drain.
 */
export const runEventStream = (
  deps: OpencodeAdapterDeps,
  context: OpencodeSessionContext,
  stream: AsyncIterable<OpencodeEvent>,
  cacheLookup: (event: OpencodeEvent) => ReturnType<typeof readPartHintFromEvent>
): Effect.Effect<void, Error> =>
  Stream.fromAsyncIterable(stream, cause =>
    cause instanceof Error ? cause : new Error(String(cause))
  ).pipe(
    Stream.takeWhile(() => !context.stopped),
    Stream.runForEach(event => handleIncomingEvent(deps, context, event, cacheLookup))
  )

/**
 * Handle the `Exit` produced by `runEventStream`. If the stream failed for a
 * reason other than interruption, emit a runtime error event before triggering
 * the graceful session-stop callback supplied by the session module.
 */
export const handleStreamExit = Effect.fn('opencode.handleStreamExit')(function* (
  deps: OpencodeAdapterDeps,
  context: OpencodeSessionContext,
  exit: Exit.Exit<void, Error>,
  onExit: () => Effect.Effect<void>
) {
  if (context.stopped) return
  if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
    const message = pumpErrorMessage(Cause.squash(exit.cause), 'Opencode event stream failed.')
    yield* emitRuntimeErrorEvent(deps, context, message)
  }
  yield* onExit()
})

export interface AttachEventStreamFiberInput {
  readonly deps: OpencodeAdapterDeps
  readonly context: OpencodeSessionContext
  readonly stream: AsyncIterable<OpencodeEvent>
  readonly runFork: EventStreamRunFork
  readonly cacheLookup: (event: OpencodeEvent) => ReturnType<typeof readPartHintFromEvent>
  readonly onExit: () => Effect.Effect<void>
}

/**
 * Fork the consume loop and stash the resulting fiber on the session context
 * so the lifecycle finalizer can interrupt it during shutdown. The observer
 * clears the slot if the fiber finishes naturally so subsequent stop calls
 * become no-ops.
 */
export function attachEventStreamFiber(input: AttachEventStreamFiberInput): void {
  const fiber = input.runFork(
    Effect.exit(runEventStream(input.deps, input.context, input.stream, input.cacheLookup)).pipe(
      Effect.flatMap(exit => handleStreamExit(input.deps, input.context, exit, input.onExit))
    )
  )
  input.context.eventStreamFiber = fiber
  fiber.addObserver(() => {
    if (input.context.eventStreamFiber === fiber) {
      input.context.eventStreamFiber = undefined
    }
  })
}
