import type { OrchestrationEvent, OrchestrationReadModel, ThreadId } from '@orxa-code/contracts'
import { OrchestrationMessage, OrchestrationThread } from '@orxa-code/contracts'
import {
  compareActivitiesBySequenceThenCreatedAt,
  retainThreadMessageIdsAfterRevert,
} from '@orxa-code/shared/projectionRevert'
import { Effect, Schema } from 'effect'

import { toProjectorDecodeError, type OrchestrationProjectorDecodeError } from './Errors.ts'

export type ThreadPatch = Partial<Omit<OrchestrationThread, 'id' | 'projectId'>>
export const MAX_THREAD_MESSAGES = 2_000
export const MAX_THREAD_CHECKPOINTS = 500

export function checkpointStatusToLatestTurnState(status: 'ready' | 'missing' | 'error') {
  if (status === 'error') return 'error' as const
  if (status === 'missing') return 'interrupted' as const
  return 'completed' as const
}

export function updateThread(
  threads: ReadonlyArray<OrchestrationThread>,
  threadId: ThreadId,
  patch: ThreadPatch
): OrchestrationThread[] {
  return threads.map(thread => (thread.id === threadId ? { ...thread, ...patch } : thread))
}

export function decodeForEvent<A>(
  schema: Schema.Schema<A>,
  value: unknown,
  eventType: OrchestrationEvent['type'],
  field: string
): Effect.Effect<A, OrchestrationProjectorDecodeError> {
  const decode = Schema.decodeUnknownSync(schema as never) as (input: unknown) => A
  return Effect.try({
    try: () => decode(value),
    catch: error => toProjectorDecodeError(`${eventType}:${field}`)(error as Schema.SchemaError),
  })
}

export function retainThreadMessagesAfterRevert(
  messages: ReadonlyArray<OrchestrationMessage>,
  retainedTurnIds: ReadonlySet<string>,
  turnCount: number
): ReadonlyArray<OrchestrationMessage> {
  const retainedMessageIds = retainThreadMessageIdsAfterRevert(messages, retainedTurnIds, turnCount)
  return messages.filter(message => retainedMessageIds.has(message.id))
}

export function retainThreadActivitiesAfterRevert(
  activities: ReadonlyArray<OrchestrationThread['activities'][number]>,
  retainedTurnIds: ReadonlySet<string>
): ReadonlyArray<OrchestrationThread['activities'][number]> {
  return activities.filter(
    activity => activity.turnId === null || retainedTurnIds.has(activity.turnId)
  )
}

export function retainThreadProposedPlansAfterRevert(
  proposedPlans: ReadonlyArray<OrchestrationThread['proposedPlans'][number]>,
  retainedTurnIds: ReadonlySet<string>
): ReadonlyArray<OrchestrationThread['proposedPlans'][number]> {
  return proposedPlans.filter(
    proposedPlan => proposedPlan.turnId === null || retainedTurnIds.has(proposedPlan.turnId)
  )
}

export function compareThreadActivities(
  left: OrchestrationThread['activities'][number],
  right: OrchestrationThread['activities'][number]
): number {
  return compareActivitiesBySequenceThenCreatedAt(left, right)
}

export function findThread(
  model: OrchestrationReadModel,
  threadId: ThreadId
): OrchestrationThread | undefined {
  return model.threads.find(entry => entry.id === threadId)
}
