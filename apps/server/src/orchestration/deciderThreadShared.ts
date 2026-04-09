import type {
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationReadModel,
} from '@orxa-code/contracts'

import type { OrchestrationDecision } from './deciderShared.ts'
import { withEventBase } from './deciderShared.ts'

export type ThreadCommand = Extract<
  OrchestrationCommand,
  {
    type:
      | 'thread.create'
      | 'thread.delete'
      | 'thread.archive'
      | 'thread.unarchive'
      | 'thread.meta.update'
      | 'thread.runtime-mode.set'
      | 'thread.interaction-mode.set'
      | 'thread.message.seed'
      | 'thread.turn.start'
      | 'thread.turn.interrupt'
      | 'thread.approval.respond'
      | 'thread.user-input.respond'
      | 'thread.checkpoint.revert'
      | 'thread.session.stop'
      | 'thread.session.set'
      | 'thread.message.assistant.delta'
      | 'thread.message.assistant.complete'
      | 'thread.proposed-plan.upsert'
      | 'thread.turn.diff.complete'
      | 'thread.revert.complete'
      | 'thread.activity.append'
  }
>

export type ThreadCommandType = ThreadCommand['type']

export type ThreadCommandInput<TType extends ThreadCommandType = ThreadCommandType> = {
  readonly command: Extract<ThreadCommand, { type: TType }>
  readonly readModel: OrchestrationReadModel
}

export function createThreadEvent(
  command: Pick<ThreadCommand, 'threadId' | 'commandId'>,
  input: {
    readonly type: OrchestrationDecision['type']
    readonly occurredAt: string
    readonly payload: OrchestrationEvent['payload']
    readonly metadata?: OrchestrationEvent['metadata']
    readonly causationEventId?: OrchestrationEvent['causationEventId']
  }
): OrchestrationDecision {
  return {
    ...withEventBase({
      aggregateKind: 'thread',
      aggregateId: command.threadId,
      occurredAt: input.occurredAt,
      commandId: command.commandId,
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    }),
    ...(input.causationEventId !== undefined ? { causationEventId: input.causationEventId } : {}),
    type: input.type,
    payload: input.payload,
  }
}
