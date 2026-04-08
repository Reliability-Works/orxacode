import {
  CommandId,
  EventId,
  ProjectId,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from '@orxa-code/contracts'
import { Effect } from 'effect'

import { projectEvent } from './projector.ts'

export function makeEvent(input: {
  sequence: number
  type: OrchestrationEvent['type']
  occurredAt: string
  aggregateKind: OrchestrationEvent['aggregateKind']
  aggregateId: string
  commandId: string | null
  payload: unknown
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.makeUnsafe(`event-${input.sequence}`),
    type: input.type,
    aggregateKind: input.aggregateKind,
    aggregateId:
      input.aggregateKind === 'project'
        ? ProjectId.makeUnsafe(input.aggregateId)
        : ThreadId.makeUnsafe(input.aggregateId),
    occurredAt: input.occurredAt,
    commandId: input.commandId === null ? null : CommandId.makeUnsafe(input.commandId),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: input.payload as never,
  } as OrchestrationEvent
}

export function makeThreadCreatedEvent(input: {
  sequence?: number
  occurredAt: string
  aggregateId?: string
  commandId?: string
  threadId?: string
  projectId?: string
  title?: string
  provider?: 'codex' | 'claude'
  model?: string
  runtimeMode?: 'full-access' | 'approval-required'
  interactionMode?: 'default' | 'plan'
}) {
  return makeEvent({
    sequence: input.sequence ?? 1,
    type: 'thread.created',
    aggregateKind: 'thread',
    aggregateId: input.aggregateId ?? input.threadId ?? 'thread-1',
    occurredAt: input.occurredAt,
    commandId: input.commandId ?? 'cmd-thread-create',
    payload: {
      threadId: input.threadId ?? 'thread-1',
      projectId: input.projectId ?? 'project-1',
      title: input.title ?? 'demo',
      modelSelection: {
        provider: input.provider ?? 'codex',
        model: input.model ?? 'gpt-5.3-codex',
      },
      runtimeMode: input.runtimeMode ?? 'full-access',
      interactionMode: input.interactionMode ?? 'default',
      branch: null,
      worktreePath: null,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    },
  })
}

export async function applyEvent(
  model: OrchestrationReadModel,
  event: OrchestrationEvent
): Promise<OrchestrationReadModel> {
  return Effect.runPromise(projectEvent(model, event))
}

export async function applyEvents(
  model: OrchestrationReadModel,
  events: ReadonlyArray<OrchestrationEvent>
): Promise<OrchestrationReadModel> {
  return events.reduce<Promise<OrchestrationReadModel>>(
    (statePromise, event) => statePromise.then(state => applyEvent(state, event)),
    Promise.resolve(model)
  )
}
