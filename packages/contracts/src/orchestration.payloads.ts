import { Schema } from 'effect'
import {
  ApprovalRequestId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProjectId,
  ProviderItemId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from './baseSchemas'
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  OrchestrationProposedPlan,
  OrchestrationSession,
  OrchestrationThreadActivity,
  ProviderApprovalDecision,
  ProviderInteractionMode,
  ProviderUserInputAnswers,
  RuntimeMode,
  threadCreatedPayloadFields,
} from './orchestration.models'
import {
  checkpointRowFields,
  orchestrationMessageContentFields,
  projectCreatedCoreFields,
  projectMetaUpdatableFields,
  threadMetaUpdatableFields,
  threadTurnStartOptionsFields,
} from './orchestration.shared'

export const ProjectCreatedPayload = Schema.Struct({
  projectId: ProjectId,
  ...projectCreatedCoreFields,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
})
export type ProjectCreatedPayload = typeof ProjectCreatedPayload.Type

export const ProjectMetaUpdatedPayload = Schema.Struct({
  projectId: ProjectId,
  ...projectMetaUpdatableFields,
  updatedAt: IsoDateTime,
})
export type ProjectMetaUpdatedPayload = typeof ProjectMetaUpdatedPayload.Type

export const ProjectDeletedPayload = Schema.Struct({
  projectId: ProjectId,
  deletedAt: IsoDateTime,
})
export type ProjectDeletedPayload = typeof ProjectDeletedPayload.Type

export const ThreadCreatedPayload = Schema.Struct({
  threadId: ThreadId,
  ...threadCreatedPayloadFields,
})
export type ThreadCreatedPayload = typeof ThreadCreatedPayload.Type

export const ThreadDeletedPayload = Schema.Struct({
  threadId: ThreadId,
  deletedAt: IsoDateTime,
})
export type ThreadDeletedPayload = typeof ThreadDeletedPayload.Type

export const ThreadArchivedPayload = Schema.Struct({
  threadId: ThreadId,
  archivedAt: IsoDateTime,
  updatedAt: IsoDateTime,
})
export type ThreadArchivedPayload = typeof ThreadArchivedPayload.Type

export const ThreadUnarchivedPayload = Schema.Struct({
  threadId: ThreadId,
  updatedAt: IsoDateTime,
})
export type ThreadUnarchivedPayload = typeof ThreadUnarchivedPayload.Type

export const ThreadMetaUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  ...threadMetaUpdatableFields,
  updatedAt: IsoDateTime,
})
export type ThreadMetaUpdatedPayload = typeof ThreadMetaUpdatedPayload.Type

export const ThreadRuntimeModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  updatedAt: IsoDateTime,
})
export type ThreadRuntimeModeSetPayload = typeof ThreadRuntimeModeSetPayload.Type

export const ThreadInteractionModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE)
  ),
  updatedAt: IsoDateTime,
})
export type ThreadInteractionModeSetPayload = typeof ThreadInteractionModeSetPayload.Type

export const ThreadMessageSentPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  ...orchestrationMessageContentFields,
})
export type ThreadMessageSentPayload = typeof ThreadMessageSentPayload.Type

export const ThreadTurnStartRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  ...threadTurnStartOptionsFields,
  createdAt: IsoDateTime,
})
export type ThreadTurnStartRequestedPayload = typeof ThreadTurnStartRequestedPayload.Type

export const ThreadTurnInterruptRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
})
export type ThreadTurnInterruptRequestedPayload = typeof ThreadTurnInterruptRequestedPayload.Type

export const ThreadApprovalResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
})
export type ThreadApprovalResponseRequestedPayload =
  typeof ThreadApprovalResponseRequestedPayload.Type

export const ThreadUserInputResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
})
export type ThreadUserInputResponseRequestedPayload =
  typeof ThreadUserInputResponseRequestedPayload.Type

export const ThreadCheckpointRevertRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
})
export type ThreadCheckpointRevertRequestedPayload =
  typeof ThreadCheckpointRevertRequestedPayload.Type

export const ThreadRevertedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
})
export type ThreadRevertedPayload = typeof ThreadRevertedPayload.Type

export const ThreadSessionStopRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  createdAt: IsoDateTime,
})
export type ThreadSessionStopRequestedPayload = typeof ThreadSessionStopRequestedPayload.Type

export const ThreadSessionSetPayload = Schema.Struct({
  threadId: ThreadId,
  session: OrchestrationSession,
})
export type ThreadSessionSetPayload = typeof ThreadSessionSetPayload.Type

export const ThreadProposedPlanUpsertedPayload = Schema.Struct({
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
})
export type ThreadProposedPlanUpsertedPayload = typeof ThreadProposedPlanUpsertedPayload.Type

export const ThreadTurnDiffCompletedPayload = Schema.Struct({
  ...checkpointRowFields,
})
export type ThreadTurnDiffCompletedPayload = typeof ThreadTurnDiffCompletedPayload.Type

export const ThreadActivityAppendedPayload = Schema.Struct({
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
})
export type ThreadActivityAppendedPayload = typeof ThreadActivityAppendedPayload.Type

export const OrchestrationEventMetadata = Schema.Struct({
  providerTurnId: Schema.optional(TrimmedNonEmptyString),
  providerItemId: Schema.optional(ProviderItemId),
  adapterKey: Schema.optional(TrimmedNonEmptyString),
  requestId: Schema.optional(ApprovalRequestId),
  ingestedAt: Schema.optional(IsoDateTime),
})
export type OrchestrationEventMetadata = typeof OrchestrationEventMetadata.Type
