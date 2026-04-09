import {
  type AssistantDeliveryMode,
  CheckpointRef,
  MessageId,
  type OrchestrationProposedPlanId,
  type ProviderRuntimeEvent,
  ThreadId,
  TurnId,
} from '@orxa-code/contracts'
import { Cause, Effect } from 'effect'

import { runtimeEventToActivities } from './ProviderRuntimeActivities.ts'
import {
  STRICT_PROVIDER_LIFECYCLE_GUARD,
  normalizeRuntimeTurnState,
  orchestrationSessionStatusFromRuntimeState,
  proposedPlanIdForTurn,
  providerCommandId,
  sameId,
  toTurnId,
} from './ProviderRuntimeIngestion.helpers.ts'
import {
  type ProcessRuntimeEventDeps,
  type ReadModelThread,
  finalizeAssistantMessage,
  finalizeBufferedProposedPlan,
  getSourceProposedPlanReferenceForAcceptedTurnStart,
  isGitRepoForThread,
  markSourceProposedPlanImplemented,
} from './ProviderRuntimeIngestion.processEvent.helpers.ts'

export type { ProcessRuntimeEventDeps, ReadModelThread }

export interface LifecycleContext {
  readonly event: ProviderRuntimeEvent
  readonly thread: ReadModelThread
  readonly now: string
  readonly eventTurnId: TurnId | undefined
  readonly activeTurnId: TurnId | null
  readonly conflictsWithActiveTurn: boolean
  readonly missingTurnForActiveTurn: boolean
}

export function shouldApplyThreadLifecycle(ctx: LifecycleContext): boolean {
  if (!STRICT_PROVIDER_LIFECYCLE_GUARD) {
    return true
  }
  switch (ctx.event.type) {
    case 'session.exited':
      return true
    case 'session.started':
    case 'thread.started':
      return true
    case 'turn.started':
      return !ctx.conflictsWithActiveTurn
    case 'turn.completed':
      if (ctx.conflictsWithActiveTurn || ctx.missingTurnForActiveTurn) {
        return false
      }
      if (ctx.activeTurnId !== null && ctx.eventTurnId !== undefined) {
        return sameId(ctx.activeTurnId, ctx.eventTurnId)
      }
      return true
    default:
      return true
  }
}

export function isLifecycleEvent(event: ProviderRuntimeEvent): boolean {
  return (
    event.type === 'session.started' ||
    event.type === 'session.state.changed' ||
    event.type === 'session.exited' ||
    event.type === 'thread.started' ||
    event.type === 'turn.started' ||
    event.type === 'turn.completed'
  )
}

function computeNextActiveTurnId(ctx: LifecycleContext): TurnId | null {
  if (ctx.event.type === 'turn.started') {
    return ctx.eventTurnId ?? null
  }
  if (ctx.event.type === 'turn.completed' || ctx.event.type === 'session.exited') {
    return null
  }
  return ctx.activeTurnId
}

function computeLifecycleStatus(
  ctx: LifecycleContext
): 'starting' | 'running' | 'ready' | 'interrupted' | 'stopped' | 'error' {
  switch (ctx.event.type) {
    case 'session.state.changed':
      return orchestrationSessionStatusFromRuntimeState(ctx.event.payload.state)
    case 'turn.started':
      return 'running'
    case 'session.exited':
      return 'stopped'
    case 'turn.completed':
      return normalizeRuntimeTurnState(ctx.event.payload.state) === 'failed' ? 'error' : 'ready'
    case 'session.started':
    case 'thread.started':
      return ctx.activeTurnId !== null ? 'running' : 'ready'
    default:
      return ctx.activeTurnId !== null ? 'running' : 'ready'
  }
}

function computeLifecycleLastError(
  ctx: LifecycleContext,
  status: 'starting' | 'running' | 'ready' | 'interrupted' | 'stopped' | 'error'
): string | null {
  if (ctx.event.type === 'session.state.changed' && ctx.event.payload.state === 'error') {
    return ctx.event.payload.reason ?? ctx.thread.session?.lastError ?? 'Provider session error'
  }
  if (
    ctx.event.type === 'turn.completed' &&
    normalizeRuntimeTurnState(ctx.event.payload.state) === 'failed'
  ) {
    return ctx.event.payload.errorMessage ?? ctx.thread.session?.lastError ?? 'Turn failed'
  }
  if (status === 'ready') {
    return null
  }
  return ctx.thread.session?.lastError ?? null
}

const handleLifecycleEvent = (deps: ProcessRuntimeEventDeps) => {
  const markPlan = markSourceProposedPlanImplemented(deps)
  return Effect.fn('handleLifecycleEvent')(function* (
    ctx: LifecycleContext,
    acceptedTurnStartedSourcePlan: {
      readonly sourceThreadId: ThreadId
      readonly sourcePlanId: OrchestrationProposedPlanId
    } | null
  ) {
    const nextActiveTurnId = computeNextActiveTurnId(ctx)
    const status = computeLifecycleStatus(ctx)
    const lastError = computeLifecycleLastError(ctx, status)

    if (ctx.event.type === 'turn.started' && acceptedTurnStartedSourcePlan !== null) {
      yield* markPlan(
        acceptedTurnStartedSourcePlan.sourceThreadId,
        acceptedTurnStartedSourcePlan.sourcePlanId,
        ctx.thread.id,
        ctx.now
      ).pipe(
        Effect.catchCause(cause =>
          Effect.logWarning('provider runtime ingestion failed to mark source proposed plan', {
            eventId: ctx.event.eventId,
            eventType: ctx.event.type,
            cause: Cause.pretty(cause),
          })
        )
      )
    }

    yield* deps.orchestrationEngine.dispatch({
      type: 'thread.session.set',
      commandId: providerCommandId(ctx.event, 'thread-session-set'),
      threadId: ctx.thread.id,
      session: {
        threadId: ctx.thread.id,
        status,
        providerName: ctx.event.provider,
        providerSessionId: ctx.thread.session?.providerSessionId ?? null,
        providerThreadId: ctx.thread.session?.providerThreadId ?? null,
        runtimeMode: ctx.thread.session?.runtimeMode ?? 'full-access',
        activeTurnId: nextActiveTurnId,
        lastError,
        updatedAt: ctx.now,
      },
      createdAt: ctx.now,
    })
  })
}

const handleAssistantDelta = (deps: ProcessRuntimeEventDeps) =>
  Effect.fn('handleAssistantDelta')(function* (
    event: ProviderRuntimeEvent,
    thread: ReadModelThread,
    now: string,
    assistantDelta: string
  ) {
    const assistantMessageId = MessageId.makeUnsafe(
      `assistant:${event.itemId ?? event.turnId ?? event.eventId}`
    )
    const turnId = toTurnId(event.turnId)
    if (turnId) {
      yield* deps.stateOps.rememberAssistantMessageId(thread.id, turnId, assistantMessageId)
    }

    const assistantDeliveryMode: AssistantDeliveryMode = yield* Effect.map(
      deps.serverSettingsService.getSettings,
      settings => (settings.enableAssistantStreaming ? 'streaming' : 'buffered')
    )
    if (assistantDeliveryMode === 'buffered') {
      const spillChunk = yield* deps.stateOps.appendBufferedAssistantText(
        assistantMessageId,
        assistantDelta
      )
      if (spillChunk.length > 0) {
        yield* deps.orchestrationEngine.dispatch({
          type: 'thread.message.assistant.delta',
          commandId: providerCommandId(event, 'assistant-delta-buffer-spill'),
          threadId: thread.id,
          messageId: assistantMessageId,
          delta: spillChunk,
          ...(turnId ? { turnId } : {}),
          createdAt: now,
        })
      }
    } else {
      yield* deps.orchestrationEngine.dispatch({
        type: 'thread.message.assistant.delta',
        commandId: providerCommandId(event, 'assistant-delta'),
        threadId: thread.id,
        messageId: assistantMessageId,
        delta: assistantDelta,
        ...(turnId ? { turnId } : {}),
        createdAt: now,
      })
    }
  })

const handleAssistantCompletion = (deps: ProcessRuntimeEventDeps) => {
  const finalize = finalizeAssistantMessage(deps)
  return Effect.fn('handleAssistantCompletion')(function* (
    event: ProviderRuntimeEvent,
    thread: ReadModelThread,
    now: string,
    assistantCompletion: { messageId: MessageId; fallbackText: string | undefined }
  ) {
    const assistantMessageId = assistantCompletion.messageId
    const turnId = toTurnId(event.turnId)
    const existingAssistantMessage = thread.messages.find(entry => entry.id === assistantMessageId)
    const shouldApplyFallbackCompletionText =
      !existingAssistantMessage || existingAssistantMessage.text.length === 0
    if (turnId) {
      yield* deps.stateOps.rememberAssistantMessageId(thread.id, turnId, assistantMessageId)
    }

    yield* finalize({
      event,
      threadId: thread.id,
      messageId: assistantMessageId,
      ...(turnId ? { turnId } : {}),
      createdAt: now,
      commandTag: 'assistant-complete',
      finalDeltaCommandTag: 'assistant-delta-finalize',
      ...(assistantCompletion.fallbackText !== undefined && shouldApplyFallbackCompletionText
        ? { fallbackText: assistantCompletion.fallbackText }
        : {}),
    })

    if (turnId) {
      yield* deps.stateOps.forgetAssistantMessageId(thread.id, turnId, assistantMessageId)
    }
  })
}

const handleTurnCompletedFinalization = (deps: ProcessRuntimeEventDeps) => {
  const finalize = finalizeAssistantMessage(deps)
  const finalizePlan = finalizeBufferedProposedPlan(deps)
  return Effect.fn('handleTurnCompletedFinalization')(function* (
    event: ProviderRuntimeEvent,
    thread: ReadModelThread,
    now: string
  ) {
    const turnId = toTurnId(event.turnId)
    if (!turnId) {
      return
    }
    const assistantMessageIds = yield* deps.stateOps.getAssistantMessageIdsForTurn(
      thread.id,
      turnId
    )
    yield* Effect.forEach(
      assistantMessageIds,
      assistantMessageId =>
        finalize({
          event,
          threadId: thread.id,
          messageId: assistantMessageId,
          turnId,
          createdAt: now,
          commandTag: 'assistant-complete-finalize',
          finalDeltaCommandTag: 'assistant-delta-finalize-fallback',
        }),
      { concurrency: 1 }
    ).pipe(Effect.asVoid)
    yield* deps.stateOps.clearAssistantMessageIdsForTurn(thread.id, turnId)

    yield* finalizePlan({
      event,
      threadId: thread.id,
      threadProposedPlans: thread.proposedPlans,
      planId: proposedPlanIdForTurn(thread.id, turnId),
      turnId,
      updatedAt: now,
    })
  })
}

const handleRuntimeError = (deps: ProcessRuntimeEventDeps) =>
  Effect.fn('handleRuntimeError')(function* (
    event: Extract<ProviderRuntimeEvent, { type: 'runtime.error' }>,
    thread: ReadModelThread,
    now: string,
    activeTurnId: TurnId | null,
    eventTurnId: TurnId | undefined
  ) {
    const runtimeErrorMessage = event.payload.message

    const shouldApplyRuntimeError = !STRICT_PROVIDER_LIFECYCLE_GUARD
      ? true
      : activeTurnId === null || eventTurnId === undefined || sameId(activeTurnId, eventTurnId)

    if (!shouldApplyRuntimeError) {
      return
    }

    yield* deps.orchestrationEngine.dispatch({
      type: 'thread.session.set',
      commandId: providerCommandId(event, 'runtime-error-session-set'),
      threadId: thread.id,
      session: {
        threadId: thread.id,
        status: 'error',
        providerName: event.provider,
        providerSessionId: thread.session?.providerSessionId ?? null,
        providerThreadId: thread.session?.providerThreadId ?? null,
        runtimeMode: thread.session?.runtimeMode ?? 'full-access',
        activeTurnId: eventTurnId ?? null,
        lastError: runtimeErrorMessage,
        updatedAt: now,
      },
      createdAt: now,
    })
  })

const handleTurnDiffUpdated = (deps: ProcessRuntimeEventDeps) => {
  const isGitRepo = isGitRepoForThread(deps)
  return Effect.fn('handleTurnDiffUpdated')(function* (
    event: ProviderRuntimeEvent,
    thread: ReadModelThread,
    now: string
  ) {
    const turnId = toTurnId(event.turnId)
    if (!turnId || !(yield* isGitRepo(thread.id))) {
      return
    }
    if (thread.checkpoints.some(c => c.turnId === turnId)) {
      return
    }
    const assistantMessageId = MessageId.makeUnsafe(
      `assistant:${event.itemId ?? event.turnId ?? event.eventId}`
    )
    const maxTurnCount = thread.checkpoints.reduce(
      (max, c) => Math.max(max, c.checkpointTurnCount),
      0
    )
    yield* deps.orchestrationEngine.dispatch({
      type: 'thread.turn.diff.complete',
      commandId: providerCommandId(event, 'thread-turn-diff-complete'),
      threadId: thread.id,
      turnId,
      completedAt: now,
      checkpointRef: CheckpointRef.makeUnsafe(`provider-diff:${event.eventId}`),
      status: 'missing',
      files: [],
      assistantMessageId,
      checkpointTurnCount: maxTurnCount + 1,
      createdAt: now,
    })
  })
}

const dispatchActivities = (deps: ProcessRuntimeEventDeps) =>
  Effect.fn('dispatchActivities')(function* (event: ProviderRuntimeEvent, thread: ReadModelThread) {
    const activities = runtimeEventToActivities(event)
    yield* Effect.forEach(activities, activity =>
      deps.orchestrationEngine.dispatch({
        type: 'thread.activity.append',
        commandId: providerCommandId(event, 'thread-activity-append'),
        threadId: thread.id,
        activity,
        createdAt: activity.createdAt,
      })
    ).pipe(Effect.asVoid)
  })

export interface RuntimeEventDispatchers {
  readonly handleLifecycle: ReturnType<typeof handleLifecycleEvent>
  readonly handleDelta: ReturnType<typeof handleAssistantDelta>
  readonly handleAssistantCompleted: ReturnType<typeof handleAssistantCompletion>
  readonly finalizePlan: ReturnType<typeof finalizeBufferedProposedPlan>
  readonly handleTurnCompleted: ReturnType<typeof handleTurnCompletedFinalization>
  readonly handleErrorEvent: ReturnType<typeof handleRuntimeError>
  readonly handleDiffUpdated: ReturnType<typeof handleTurnDiffUpdated>
  readonly dispatchActivitiesEffect: ReturnType<typeof dispatchActivities>
  readonly resolveAcceptedSourcePlan: ReturnType<
    typeof getSourceProposedPlanReferenceForAcceptedTurnStart
  >
}

export function makeRuntimeEventDispatchers(
  deps: ProcessRuntimeEventDeps
): RuntimeEventDispatchers {
  return {
    handleLifecycle: handleLifecycleEvent(deps),
    handleDelta: handleAssistantDelta(deps),
    handleAssistantCompleted: handleAssistantCompletion(deps),
    finalizePlan: finalizeBufferedProposedPlan(deps),
    handleTurnCompleted: handleTurnCompletedFinalization(deps),
    handleErrorEvent: handleRuntimeError(deps),
    handleDiffUpdated: handleTurnDiffUpdated(deps),
    dispatchActivitiesEffect: dispatchActivities(deps),
    resolveAcceptedSourcePlan: getSourceProposedPlanReferenceForAcceptedTurnStart(deps),
  }
}
