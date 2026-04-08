import type { OrchestrationCommand, OrchestrationEvent } from '@orxa-code/contracts'

export type OrchestrationDecision = Omit<OrchestrationEvent, 'sequence'>
export type OrchestrationDecisionOutput =
  | OrchestrationDecision
  | ReadonlyArray<OrchestrationDecision>

const defaultMetadata: Omit<OrchestrationEvent, 'sequence' | 'type' | 'payload'> = {
  eventId: crypto.randomUUID() as OrchestrationEvent['eventId'],
  aggregateKind: 'thread',
  aggregateId: '' as OrchestrationEvent['aggregateId'],
  occurredAt: new Date().toISOString(),
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
}

export const nowIso = () => new Date().toISOString()

export function withEventBase(
  input: Pick<OrchestrationCommand, 'commandId'> & {
    readonly aggregateKind: OrchestrationEvent['aggregateKind']
    readonly aggregateId: OrchestrationEvent['aggregateId']
    readonly occurredAt: string
    readonly metadata?: OrchestrationEvent['metadata']
  }
): Omit<OrchestrationEvent, 'sequence' | 'type' | 'payload'> {
  return {
    ...defaultMetadata,
    eventId: crypto.randomUUID() as OrchestrationEvent['eventId'],
    aggregateKind: input.aggregateKind,
    aggregateId: input.aggregateId,
    occurredAt: input.occurredAt,
    commandId: input.commandId,
    correlationId: input.commandId,
    metadata: input.metadata ?? {},
  }
}
