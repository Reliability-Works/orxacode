import { Effect } from 'effect'

import { OrchestrationCommandInvariantError } from './Errors.ts'
import { requireThread } from './commandInvariants.ts'
import { createThreadEvent, type ThreadCommandInput } from './deciderThreadShared.ts'

function resolveSourcePlan(input: ThreadCommandInput<'thread.turn.start'>) {
  return Effect.gen(function* () {
    const { command, readModel } = input
    const targetThread = yield* requireThread({
      readModel,
      command,
      threadId: command.threadId,
    })
    const sourceProposedPlan = command.sourceProposedPlan
    const sourceThread = sourceProposedPlan
      ? yield* requireThread({
          readModel,
          command,
          threadId: sourceProposedPlan.threadId,
        })
      : null
    const sourcePlan =
      sourceProposedPlan && sourceThread
        ? sourceThread.proposedPlans.find(entry => entry.id === sourceProposedPlan.planId)
        : null

    if (sourceProposedPlan && !sourcePlan) {
      return yield* new OrchestrationCommandInvariantError({
        commandType: command.type,
        detail: `Proposed plan '${sourceProposedPlan.planId}' does not exist on thread '${sourceProposedPlan.threadId}'.`,
      })
    }

    if (sourceThread && sourceThread.projectId !== targetThread.projectId) {
      return yield* new OrchestrationCommandInvariantError({
        commandType: command.type,
        detail: `Proposed plan '${sourceProposedPlan?.planId}' belongs to thread '${sourceThread.id}' in a different project.`,
      })
    }

    return {
      runtimeMode: targetThread.runtimeMode,
      interactionMode: targetThread.interactionMode,
      sourceProposedPlan,
    }
  })
}

export function decideThreadTurnStartCommand(input: ThreadCommandInput<'thread.turn.start'>) {
  return Effect.gen(function* () {
    const { command } = input
    const source = yield* resolveSourcePlan(input)
    const userMessageEvent = createThreadEvent(command, {
      type: 'thread.message-sent',
      occurredAt: command.createdAt,
      payload: {
        threadId: command.threadId,
        messageId: command.message.messageId,
        role: 'user',
        text: command.message.text,
        attachments: command.message.attachments,
        turnId: null,
        streaming: false,
        createdAt: command.createdAt,
        updatedAt: command.createdAt,
      },
    })
    const turnStartRequestedEvent = createThreadEvent(command, {
      type: 'thread.turn-start-requested',
      occurredAt: command.createdAt,
      causationEventId: userMessageEvent.eventId,
      payload: {
        threadId: command.threadId,
        messageId: command.message.messageId,
        ...(command.modelSelection !== undefined ? { modelSelection: command.modelSelection } : {}),
        ...(command.titleSeed !== undefined ? { titleSeed: command.titleSeed } : {}),
        runtimeMode: source.runtimeMode,
        interactionMode: source.interactionMode,
        ...(source.sourceProposedPlan !== undefined
          ? { sourceProposedPlan: source.sourceProposedPlan }
          : {}),
        createdAt: command.createdAt,
      },
    })
    return [userMessageEvent, turnStartRequestedEvent]
  })
}

export function decideThreadTurnInterruptCommand({
  command,
  readModel,
}: ThreadCommandInput<'thread.turn.interrupt'>) {
  return Effect.gen(function* () {
    yield* requireThread({ readModel, command, threadId: command.threadId })
    return createThreadEvent(command, {
      type: 'thread.turn-interrupt-requested',
      occurredAt: command.createdAt,
      payload: {
        threadId: command.threadId,
        ...(command.turnId !== undefined ? { turnId: command.turnId } : {}),
        createdAt: command.createdAt,
      },
    })
  })
}

export function decideThreadApprovalRespondCommand({
  command,
  readModel,
}: ThreadCommandInput<'thread.approval.respond'>) {
  return Effect.gen(function* () {
    yield* requireThread({ readModel, command, threadId: command.threadId })
    return createThreadEvent(command, {
      type: 'thread.approval-response-requested',
      occurredAt: command.createdAt,
      metadata: {
        requestId: command.requestId,
      },
      payload: {
        threadId: command.threadId,
        requestId: command.requestId,
        decision: command.decision,
        createdAt: command.createdAt,
      },
    })
  })
}

export function decideThreadUserInputRespondCommand({
  command,
  readModel,
}: ThreadCommandInput<'thread.user-input.respond'>) {
  return Effect.gen(function* () {
    yield* requireThread({ readModel, command, threadId: command.threadId })
    return createThreadEvent(command, {
      type: 'thread.user-input-response-requested',
      occurredAt: command.createdAt,
      metadata: {
        requestId: command.requestId,
      },
      payload: {
        threadId: command.threadId,
        requestId: command.requestId,
        answers: command.answers,
        createdAt: command.createdAt,
      },
    })
  })
}

export function decideThreadCheckpointRevertCommand({
  command,
  readModel,
}: ThreadCommandInput<'thread.checkpoint.revert'>) {
  return Effect.gen(function* () {
    yield* requireThread({ readModel, command, threadId: command.threadId })
    return createThreadEvent(command, {
      type: 'thread.checkpoint-revert-requested',
      occurredAt: command.createdAt,
      payload: {
        threadId: command.threadId,
        turnCount: command.turnCount,
        createdAt: command.createdAt,
      },
    })
  })
}
