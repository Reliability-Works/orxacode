import type { OrchestrationEvent } from '@orxa-code/contracts'
import { Effect } from 'effect'

import { requireThread } from './commandInvariants.ts'
import { createThreadEvent, type ThreadCommandInput } from './deciderThreadShared.ts'

function findActivityRequestId(
  command: ThreadCommandInput<'thread.activity.append'>['command']
): OrchestrationEvent['metadata']['requestId'] | undefined {
  const { payload } = command.activity
  return typeof payload === 'object' &&
    payload !== null &&
    'requestId' in payload &&
    typeof (payload as { requestId?: unknown }).requestId === 'string'
    ? ((payload as { requestId: string }).requestId as OrchestrationEvent['metadata']['requestId'])
    : undefined
}

type AssistantMessageCommand = ThreadCommandInput<
  'thread.message.assistant.delta' | 'thread.message.assistant.complete'
>['command']

function buildAssistantMessageSentPayload(
  command: AssistantMessageCommand,
  options: { readonly text: string; readonly streaming: boolean }
) {
  return {
    threadId: command.threadId,
    messageId: command.messageId,
    role: 'assistant' as const,
    text: options.text,
    turnId: command.turnId ?? null,
    streaming: options.streaming,
    createdAt: command.createdAt,
    updatedAt: command.createdAt,
  }
}

function decideAssistantMessageSentCommand(
  command: AssistantMessageCommand,
  readModel: ThreadCommandInput<'thread.message.assistant.delta'>['readModel'],
  options: { readonly text: string; readonly streaming: boolean }
) {
  return Effect.gen(function* () {
    yield* requireThread({ readModel, command, threadId: command.threadId })
    return createThreadEvent(command, {
      type: 'thread.message-sent',
      occurredAt: command.createdAt,
      payload: buildAssistantMessageSentPayload(command, options),
    })
  })
}

export function decideThreadAssistantDeltaCommand({
  command,
  readModel,
}: ThreadCommandInput<'thread.message.assistant.delta'>) {
  return decideAssistantMessageSentCommand(command, readModel, {
    text: command.delta,
    streaming: true,
  })
}

export function decideThreadAssistantCompleteCommand({
  command,
  readModel,
}: ThreadCommandInput<'thread.message.assistant.complete'>) {
  return decideAssistantMessageSentCommand(command, readModel, {
    text: '',
    streaming: false,
  })
}

export function decideThreadProposedPlanUpsertCommand({
  command,
  readModel,
}: ThreadCommandInput<'thread.proposed-plan.upsert'>) {
  return Effect.gen(function* () {
    yield* requireThread({ readModel, command, threadId: command.threadId })
    return createThreadEvent(command, {
      type: 'thread.proposed-plan-upserted',
      occurredAt: command.createdAt,
      payload: {
        threadId: command.threadId,
        proposedPlan: command.proposedPlan,
      },
    })
  })
}

export function decideThreadTurnDiffCompleteCommand({
  command,
  readModel,
}: ThreadCommandInput<'thread.turn.diff.complete'>) {
  return Effect.gen(function* () {
    yield* requireThread({ readModel, command, threadId: command.threadId })
    return createThreadEvent(command, {
      type: 'thread.turn-diff-completed',
      occurredAt: command.createdAt,
      payload: {
        threadId: command.threadId,
        turnId: command.turnId,
        checkpointTurnCount: command.checkpointTurnCount,
        checkpointRef: command.checkpointRef,
        status: command.status,
        files: command.files,
        assistantMessageId: command.assistantMessageId ?? null,
        completedAt: command.completedAt,
      },
    })
  })
}

export function decideThreadRevertCompleteCommand({
  command,
  readModel,
}: ThreadCommandInput<'thread.revert.complete'>) {
  return Effect.gen(function* () {
    yield* requireThread({ readModel, command, threadId: command.threadId })
    return createThreadEvent(command, {
      type: 'thread.reverted',
      occurredAt: command.createdAt,
      payload: {
        threadId: command.threadId,
        turnCount: command.turnCount,
      },
    })
  })
}

export function decideThreadActivityAppendCommand({
  command,
  readModel,
}: ThreadCommandInput<'thread.activity.append'>) {
  return Effect.gen(function* () {
    yield* requireThread({ readModel, command, threadId: command.threadId })
    const requestId = findActivityRequestId(command)
    return createThreadEvent(command, {
      type: 'thread.activity-appended',
      occurredAt: command.createdAt,
      ...(requestId !== undefined ? { metadata: { requestId } } : {}),
      payload: {
        threadId: command.threadId,
        activity: command.activity,
      },
    })
  })
}
