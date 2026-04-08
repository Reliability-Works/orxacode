import { Option, Schema, SchemaIssue, Struct } from 'effect'
import {
  CommandId,
  EventId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from './baseSchemas'
import { ClientOrchestrationCommand } from './orchestration.commands'
import { OrchestrationReadModel, ProviderApprovalDecision } from './orchestration.models'
import { checkpointRowFields } from './orchestration.shared'
import {
  OrchestrationEventMetadata,
  ProjectCreatedPayload,
  ProjectDeletedPayload,
  ProjectMetaUpdatedPayload,
  ThreadActivityAppendedPayload,
  ThreadApprovalResponseRequestedPayload,
  ThreadArchivedPayload,
  ThreadCheckpointRevertRequestedPayload,
  ThreadCreatedPayload,
  ThreadDeletedPayload,
  ThreadInteractionModeSetPayload,
  ThreadMessageSentPayload,
  ThreadMetaUpdatedPayload,
  ThreadProposedPlanUpsertedPayload,
  ThreadRevertedPayload,
  ThreadRuntimeModeSetPayload,
  ThreadSessionSetPayload,
  ThreadSessionStopRequestedPayload,
  ThreadTurnDiffCompletedPayload,
  ThreadTurnInterruptRequestedPayload,
  ThreadTurnStartRequestedPayload,
  ThreadUnarchivedPayload,
  ThreadUserInputResponseRequestedPayload,
} from './orchestration.payloads'

export const OrchestrationEventType = Schema.Literals([
  'project.created',
  'project.meta-updated',
  'project.deleted',
  'thread.created',
  'thread.deleted',
  'thread.archived',
  'thread.unarchived',
  'thread.meta-updated',
  'thread.runtime-mode-set',
  'thread.interaction-mode-set',
  'thread.message-sent',
  'thread.turn-start-requested',
  'thread.turn-interrupt-requested',
  'thread.approval-response-requested',
  'thread.user-input-response-requested',
  'thread.checkpoint-revert-requested',
  'thread.reverted',
  'thread.session-stop-requested',
  'thread.session-set',
  'thread.proposed-plan-upserted',
  'thread.turn-diff-completed',
  'thread.activity-appended',
])
export type OrchestrationEventType = typeof OrchestrationEventType.Type

export const OrchestrationAggregateKind = Schema.Literals(['project', 'thread'])
export type OrchestrationAggregateKind = typeof OrchestrationAggregateKind.Type
export const OrchestrationActorKind = Schema.Literals(['client', 'server', 'provider'])
export type OrchestrationActorKind = typeof OrchestrationActorKind.Type

const EventBaseFields = {
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: OrchestrationAggregateKind,
  aggregateId: Schema.Union([ProjectId, ThreadId]),
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: OrchestrationEventMetadata,
} as const

export const OrchestrationEvent = Schema.Union([
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal('project.created'),
    payload: ProjectCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal('project.meta-updated'),
    payload: ProjectMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal('project.deleted'),
    payload: ProjectDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal('thread.created'),
    payload: ThreadCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal('thread.deleted'),
    payload: ThreadDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal('thread.archived'),
    payload: ThreadArchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal('thread.unarchived'),
    payload: ThreadUnarchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal('thread.meta-updated'),
    payload: ThreadMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal('thread.runtime-mode-set'),
    payload: ThreadRuntimeModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal('thread.interaction-mode-set'),
    payload: ThreadInteractionModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal('thread.message-sent'),
    payload: ThreadMessageSentPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal('thread.turn-start-requested'),
    payload: ThreadTurnStartRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal('thread.turn-interrupt-requested'),
    payload: ThreadTurnInterruptRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal('thread.approval-response-requested'),
    payload: ThreadApprovalResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal('thread.user-input-response-requested'),
    payload: ThreadUserInputResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal('thread.checkpoint-revert-requested'),
    payload: ThreadCheckpointRevertRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal('thread.reverted'),
    payload: ThreadRevertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal('thread.session-stop-requested'),
    payload: ThreadSessionStopRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal('thread.session-set'),
    payload: ThreadSessionSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal('thread.proposed-plan-upserted'),
    payload: ThreadProposedPlanUpsertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal('thread.turn-diff-completed'),
    payload: ThreadTurnDiffCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal('thread.activity-appended'),
    payload: ThreadActivityAppendedPayload,
  }),
])
export type OrchestrationEvent = typeof OrchestrationEvent.Type

export const OrchestrationCommandReceiptStatus = Schema.Literals(['accepted', 'rejected'])
export type OrchestrationCommandReceiptStatus = typeof OrchestrationCommandReceiptStatus.Type

export const TurnCountRange = Schema.Struct({
  fromTurnCount: NonNegativeInt,
  toTurnCount: NonNegativeInt,
}).check(
  Schema.makeFilter(
    input =>
      input.fromTurnCount <= input.toTurnCount ||
      new SchemaIssue.InvalidValue(Option.some(input.fromTurnCount), {
        message: 'fromTurnCount must be less than or equal to toTurnCount',
      }),
    { identifier: 'OrchestrationTurnDiffRange' }
  )
)

export const ThreadTurnDiff = TurnCountRange.mapFields(
  Struct.assign({ threadId: ThreadId, diff: Schema.String }),
  { unsafePreserveChecks: true }
)
export type ThreadTurnDiff = typeof ThreadTurnDiff.Type

export const ProviderSessionRuntimeStatus = Schema.Literals([
  'starting',
  'running',
  'stopped',
  'error',
])
export type ProviderSessionRuntimeStatus = typeof ProviderSessionRuntimeStatus.Type

export const ProjectionThreadTurnStatus = Schema.Literals([
  'running',
  'completed',
  'interrupted',
  'error',
])
export type ProjectionThreadTurnStatus = typeof ProjectionThreadTurnStatus.Type

export const ProjectionCheckpointRow = Schema.Struct({
  ...checkpointRowFields,
})
export type ProjectionCheckpointRow = typeof ProjectionCheckpointRow.Type

export const ProjectionPendingApprovalStatus = Schema.Literals(['pending', 'resolved'])
export type ProjectionPendingApprovalStatus = typeof ProjectionPendingApprovalStatus.Type

export const ProjectionPendingApprovalDecision = Schema.NullOr(ProviderApprovalDecision)
export type ProjectionPendingApprovalDecision = typeof ProjectionPendingApprovalDecision.Type

export const DispatchResult = Schema.Struct({
  sequence: NonNegativeInt,
})
export type DispatchResult = typeof DispatchResult.Type

export const OrchestrationGetSnapshotInput = Schema.Struct({})
export type OrchestrationGetSnapshotInput = typeof OrchestrationGetSnapshotInput.Type
const OrchestrationGetSnapshotResult = OrchestrationReadModel
export type OrchestrationGetSnapshotResult = typeof OrchestrationGetSnapshotResult.Type

export const OrchestrationGetTurnDiffInput = TurnCountRange.mapFields(
  Struct.assign({ threadId: ThreadId }),
  { unsafePreserveChecks: true }
)
export type OrchestrationGetTurnDiffInput = typeof OrchestrationGetTurnDiffInput.Type

export const OrchestrationGetTurnDiffResult = ThreadTurnDiff
export type OrchestrationGetTurnDiffResult = typeof OrchestrationGetTurnDiffResult.Type

export const OrchestrationGetFullThreadDiffInput = Schema.Struct({
  threadId: ThreadId,
  toTurnCount: NonNegativeInt,
})
export type OrchestrationGetFullThreadDiffInput = typeof OrchestrationGetFullThreadDiffInput.Type

export const OrchestrationGetFullThreadDiffResult = ThreadTurnDiff
export type OrchestrationGetFullThreadDiffResult = typeof OrchestrationGetFullThreadDiffResult.Type

export const OrchestrationReplayEventsInput = Schema.Struct({
  fromSequenceExclusive: NonNegativeInt,
})
export type OrchestrationReplayEventsInput = typeof OrchestrationReplayEventsInput.Type

const OrchestrationReplayEventsResult = Schema.Array(OrchestrationEvent)
export type OrchestrationReplayEventsResult = typeof OrchestrationReplayEventsResult.Type

export const OrchestrationRpcSchemas = {
  getSnapshot: {
    input: OrchestrationGetSnapshotInput,
    output: OrchestrationGetSnapshotResult,
  },
  dispatchCommand: {
    input: ClientOrchestrationCommand,
    output: DispatchResult,
  },
  getTurnDiff: {
    input: OrchestrationGetTurnDiffInput,
    output: OrchestrationGetTurnDiffResult,
  },
  getFullThreadDiff: {
    input: OrchestrationGetFullThreadDiffInput,
    output: OrchestrationGetFullThreadDiffResult,
  },
  replayEvents: {
    input: OrchestrationReplayEventsInput,
    output: OrchestrationReplayEventsResult,
  },
} as const

export class OrchestrationGetSnapshotError extends Schema.TaggedErrorClass<OrchestrationGetSnapshotError>()(
  'OrchestrationGetSnapshotError',
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  }
) {}

export class OrchestrationDispatchCommandError extends Schema.TaggedErrorClass<OrchestrationDispatchCommandError>()(
  'OrchestrationDispatchCommandError',
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  }
) {}

export class OrchestrationGetTurnDiffError extends Schema.TaggedErrorClass<OrchestrationGetTurnDiffError>()(
  'OrchestrationGetTurnDiffError',
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  }
) {}

export class OrchestrationGetFullThreadDiffError extends Schema.TaggedErrorClass<OrchestrationGetFullThreadDiffError>()(
  'OrchestrationGetFullThreadDiffError',
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  }
) {}

export class OrchestrationReplayEventsError extends Schema.TaggedErrorClass<OrchestrationReplayEventsError>()(
  'OrchestrationReplayEventsError',
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  }
) {}
