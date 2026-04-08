import { MessageId, type ProviderRuntimeEvent, ThreadId, TurnId } from '@orxa-code/contracts'
import { Effect } from 'effect'

import {
  proposedPlanIdFromEvent,
  providerCommandId,
  sameId,
  toTurnId,
} from './ProviderRuntimeIngestion.helpers.ts'
import {
  type LifecycleContext,
  type ProcessRuntimeEventDeps,
  type ReadModelThread,
  type RuntimeEventDispatchers,
  isLifecycleEvent,
  makeRuntimeEventDispatchers,
  shouldApplyThreadLifecycle,
} from './ProviderRuntimeIngestion.processEvent.handlers.ts'

export type { ProcessRuntimeEventDeps } from './ProviderRuntimeIngestion.processEvent.handlers.ts'

function buildLifecycleContext(
  event: ProviderRuntimeEvent,
  thread: ReadModelThread
): LifecycleContext {
  const eventTurnId = toTurnId(event.turnId)
  const activeTurnId = thread.session?.activeTurnId ?? null
  const conflictsWithActiveTurn =
    activeTurnId !== null && eventTurnId !== undefined && !sameId(activeTurnId, eventTurnId)
  const missingTurnForActiveTurn = activeTurnId !== null && eventTurnId === undefined
  return {
    event,
    thread,
    now: event.createdAt,
    eventTurnId,
    activeTurnId,
    conflictsWithActiveTurn,
    missingTurnForActiveTurn,
  }
}

function extractAssistantDelta(event: ProviderRuntimeEvent): string | undefined {
  return event.type === 'content.delta' && event.payload.streamKind === 'assistant_text'
    ? event.payload.delta
    : undefined
}

function extractProposedPlanDelta(event: ProviderRuntimeEvent): string | undefined {
  return event.type === 'turn.proposed.delta' ? event.payload.delta : undefined
}

function extractAssistantCompletion(
  event: ProviderRuntimeEvent
): { messageId: MessageId; fallbackText: string | undefined } | undefined {
  if (event.type === 'item.completed' && event.payload.itemType === 'assistant_message') {
    return {
      messageId: MessageId.makeUnsafe(`assistant:${event.itemId ?? event.turnId ?? event.eventId}`),
      fallbackText: event.payload.detail,
    }
  }
  return undefined
}

function extractProposedPlanCompletion(
  event: ProviderRuntimeEvent,
  threadId: ThreadId
): { planId: string; turnId: TurnId | undefined; planMarkdown: string | undefined } | undefined {
  if (event.type !== 'turn.proposed.completed') {
    return undefined
  }
  return {
    planId: proposedPlanIdFromEvent(event, threadId),
    turnId: toTurnId(event.turnId),
    planMarkdown: event.payload.planMarkdown,
  }
}

const runLifecycleStep = (dispatchers: RuntimeEventDispatchers) =>
  Effect.fn('runLifecycleStep')(function* (ctx: LifecycleContext) {
    const apply = shouldApplyThreadLifecycle(ctx)
    const acceptedTurnStartedSourcePlan =
      ctx.event.type === 'turn.started' && apply
        ? yield* dispatchers.resolveAcceptedSourcePlan(ctx.thread.id, ctx.eventTurnId)
        : null

    if (isLifecycleEvent(ctx.event) && apply) {
      yield* dispatchers.handleLifecycle(ctx, acceptedTurnStartedSourcePlan)
    }
  })

const runAssistantCompletionSteps = (dispatchers: RuntimeEventDispatchers) =>
  Effect.fn('runAssistantCompletionSteps')(function* (
    event: ProviderRuntimeEvent,
    thread: ReadModelThread,
    now: string
  ) {
    const assistantCompletion = extractAssistantCompletion(event)
    if (assistantCompletion) {
      yield* dispatchers.handleAssistantCompleted(event, thread, now, assistantCompletion)
    }

    const proposedPlanCompletion = extractProposedPlanCompletion(event, thread.id)
    if (proposedPlanCompletion) {
      yield* dispatchers.finalizePlan({
        event,
        threadId: thread.id,
        threadProposedPlans: thread.proposedPlans,
        planId: proposedPlanCompletion.planId,
        ...(proposedPlanCompletion.turnId ? { turnId: proposedPlanCompletion.turnId } : {}),
        ...(proposedPlanCompletion.planMarkdown !== undefined
          ? { fallbackMarkdown: proposedPlanCompletion.planMarkdown }
          : {}),
        updatedAt: now,
      })
    }
  })

const runTerminalSteps = (deps: ProcessRuntimeEventDeps, dispatchers: RuntimeEventDispatchers) =>
  Effect.fn('runTerminalSteps')(function* (
    event: ProviderRuntimeEvent,
    thread: ReadModelThread,
    now: string,
    activeTurnId: TurnId | null,
    eventTurnId: TurnId | undefined
  ) {
    if (event.type === 'turn.completed') {
      yield* dispatchers.handleTurnCompleted(event, thread, now)
    }

    if (event.type === 'session.exited') {
      yield* deps.stateOps.clearTurnStateForSession(thread.id)
    }

    if (event.type === 'runtime.error') {
      yield* dispatchers.handleErrorEvent(event, thread, now, activeTurnId, eventTurnId)
    }

    if (event.type === 'thread.metadata.updated' && event.payload.name) {
      yield* deps.orchestrationEngine.dispatch({
        type: 'thread.meta.update',
        commandId: providerCommandId(event, 'thread-meta-update'),
        threadId: thread.id,
        title: event.payload.name,
      })
    }

    if (event.type === 'turn.diff.updated') {
      yield* dispatchers.handleDiffUpdated(event, thread, now)
    }

    yield* dispatchers.dispatchActivitiesEffect(event, thread)
  })

export const createProcessRuntimeEvent = (deps: ProcessRuntimeEventDeps) => {
  const dispatchers = makeRuntimeEventDispatchers(deps)
  const lifecycleStep = runLifecycleStep(dispatchers)
  const assistantCompletionSteps = runAssistantCompletionSteps(dispatchers)
  const terminalSteps = runTerminalSteps(deps, dispatchers)

  return Effect.fn('processRuntimeEvent')(function* (event: ProviderRuntimeEvent) {
    const readModel = yield* deps.orchestrationEngine.getReadModel()
    const thread = readModel.threads.find(entry => entry.id === event.threadId)
    if (!thread) return

    const ctx = buildLifecycleContext(event, thread)

    yield* lifecycleStep(ctx)

    const assistantDelta = extractAssistantDelta(event)
    if (assistantDelta && assistantDelta.length > 0) {
      yield* dispatchers.handleDelta(event, thread, ctx.now, assistantDelta)
    }

    const proposedPlanDelta = extractProposedPlanDelta(event)
    if (proposedPlanDelta && proposedPlanDelta.length > 0) {
      const planId = proposedPlanIdFromEvent(event, thread.id)
      yield* deps.stateOps.appendBufferedProposedPlan(planId, proposedPlanDelta, ctx.now)
    }

    yield* assistantCompletionSteps(event, thread, ctx.now)
    yield* terminalSteps(event, thread, ctx.now, ctx.activeTurnId, ctx.eventTurnId)
  })
}
