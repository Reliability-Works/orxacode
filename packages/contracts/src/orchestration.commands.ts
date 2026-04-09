import { Schema } from 'effect'
import {
  ApprovalRequestId,
  CheckpointRef,
  CommandId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from './baseSchemas'
import {
  ChatAttachment,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ModelSelection,
  OrchestrationThreadHandoff,
  OrchestrationCheckpointFile,
  OrchestrationCheckpointStatus,
  OrchestrationProposedPlan,
  OrchestrationSession,
  OrchestrationThreadActivity,
  ProviderApprovalDecision,
  ProviderInteractionMode,
  ProviderUserInputAnswers,
  RuntimeMode,
  SourceProposedPlanReference,
  UploadChatAttachment,
} from './orchestration.models'
import {
  projectMetaUpdatableFields,
  threadMetaUpdatableFields,
  threadTurnStartOptionsFields,
  turnStartUserMessageStruct,
} from './orchestration.shared'

export const ProjectCreateCommand = Schema.Struct({
  type: Schema.Literal('project.create'),
  commandId: CommandId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  createdAt: IsoDateTime,
})
export type ProjectCreateCommand = typeof ProjectCreateCommand.Type

export const ProjectMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal('project.meta.update'),
  commandId: CommandId,
  projectId: ProjectId,
  ...projectMetaUpdatableFields,
})
export type ProjectMetaUpdateCommand = typeof ProjectMetaUpdateCommand.Type

export const ProjectDeleteCommand = Schema.Struct({
  type: Schema.Literal('project.delete'),
  commandId: CommandId,
  projectId: ProjectId,
})
export type ProjectDeleteCommand = typeof ProjectDeleteCommand.Type

export const ThreadCreateCommand = Schema.Struct({
  type: Schema.Literal('thread.create'),
  commandId: CommandId,
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE)
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  handoff: Schema.optional(Schema.NullOr(OrchestrationThreadHandoff)),
  createdAt: IsoDateTime,
})
export type ThreadCreateCommand = typeof ThreadCreateCommand.Type

export const ThreadDeleteCommand = Schema.Struct({
  type: Schema.Literal('thread.delete'),
  commandId: CommandId,
  threadId: ThreadId,
})
export type ThreadDeleteCommand = typeof ThreadDeleteCommand.Type

export const ThreadArchiveCommand = Schema.Struct({
  type: Schema.Literal('thread.archive'),
  commandId: CommandId,
  threadId: ThreadId,
})
export type ThreadArchiveCommand = typeof ThreadArchiveCommand.Type

export const ThreadUnarchiveCommand = Schema.Struct({
  type: Schema.Literal('thread.unarchive'),
  commandId: CommandId,
  threadId: ThreadId,
})
export type ThreadUnarchiveCommand = typeof ThreadUnarchiveCommand.Type

export const ThreadMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal('thread.meta.update'),
  commandId: CommandId,
  threadId: ThreadId,
  ...threadMetaUpdatableFields,
})
export type ThreadMetaUpdateCommand = typeof ThreadMetaUpdateCommand.Type

export const ThreadRuntimeModeSetCommand = Schema.Struct({
  type: Schema.Literal('thread.runtime-mode.set'),
  commandId: CommandId,
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  createdAt: IsoDateTime,
})
export type ThreadRuntimeModeSetCommand = typeof ThreadRuntimeModeSetCommand.Type

export const ThreadInteractionModeSetCommand = Schema.Struct({
  type: Schema.Literal('thread.interaction-mode.set'),
  commandId: CommandId,
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode,
  createdAt: IsoDateTime,
})
export type ThreadInteractionModeSetCommand = typeof ThreadInteractionModeSetCommand.Type

export const ThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal('thread.turn.start'),
  commandId: CommandId,
  threadId: ThreadId,
  message: turnStartUserMessageStruct(ChatAttachment),
  ...threadTurnStartOptionsFields,
  createdAt: IsoDateTime,
})
export type ThreadTurnStartCommand = typeof ThreadTurnStartCommand.Type

export const ClientThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal('thread.turn.start'),
  commandId: CommandId,
  threadId: ThreadId,
  message: turnStartUserMessageStruct(UploadChatAttachment),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
})
export type ClientThreadTurnStartCommand = typeof ClientThreadTurnStartCommand.Type

export const ThreadTurnInterruptCommand = Schema.Struct({
  type: Schema.Literal('thread.turn.interrupt'),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
})
export type ThreadTurnInterruptCommand = typeof ThreadTurnInterruptCommand.Type

export const ThreadApprovalRespondCommand = Schema.Struct({
  type: Schema.Literal('thread.approval.respond'),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
})
export type ThreadApprovalRespondCommand = typeof ThreadApprovalRespondCommand.Type

export const ThreadUserInputRespondCommand = Schema.Struct({
  type: Schema.Literal('thread.user-input.respond'),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
})
export type ThreadUserInputRespondCommand = typeof ThreadUserInputRespondCommand.Type

export const ThreadCheckpointRevertCommand = Schema.Struct({
  type: Schema.Literal('thread.checkpoint.revert'),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
})
export type ThreadCheckpointRevertCommand = typeof ThreadCheckpointRevertCommand.Type

export const ThreadSessionStopCommand = Schema.Struct({
  type: Schema.Literal('thread.session.stop'),
  commandId: CommandId,
  threadId: ThreadId,
  createdAt: IsoDateTime,
})
export type ThreadSessionStopCommand = typeof ThreadSessionStopCommand.Type

export const DispatchableClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ThreadTurnStartCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadSessionStopCommand,
])
export type DispatchableClientOrchestrationCommand =
  typeof DispatchableClientOrchestrationCommand.Type

export const ClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ClientThreadTurnStartCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadSessionStopCommand,
])
export type ClientOrchestrationCommand = typeof ClientOrchestrationCommand.Type

export const ThreadSessionSetCommand = Schema.Struct({
  type: Schema.Literal('thread.session.set'),
  commandId: CommandId,
  threadId: ThreadId,
  session: OrchestrationSession,
  createdAt: IsoDateTime,
})
export type ThreadSessionSetCommand = typeof ThreadSessionSetCommand.Type

export const ThreadMessageAssistantDeltaCommand = Schema.Struct({
  type: Schema.Literal('thread.message.assistant.delta'),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  delta: Schema.String,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
})
export type ThreadMessageAssistantDeltaCommand = typeof ThreadMessageAssistantDeltaCommand.Type

export const ThreadMessageAssistantCompleteCommand = Schema.Struct({
  type: Schema.Literal('thread.message.assistant.complete'),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
})
export type ThreadMessageAssistantCompleteCommand =
  typeof ThreadMessageAssistantCompleteCommand.Type

export const ThreadProposedPlanUpsertCommand = Schema.Struct({
  type: Schema.Literal('thread.proposed-plan.upsert'),
  commandId: CommandId,
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
  createdAt: IsoDateTime,
})
export type ThreadProposedPlanUpsertCommand = typeof ThreadProposedPlanUpsertCommand.Type

export const ThreadTurnDiffCompleteCommand = Schema.Struct({
  type: Schema.Literal('thread.turn.diff.complete'),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: TurnId,
  completedAt: IsoDateTime,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.optional(MessageId),
  checkpointTurnCount: NonNegativeInt,
  createdAt: IsoDateTime,
})
export type ThreadTurnDiffCompleteCommand = typeof ThreadTurnDiffCompleteCommand.Type

export const ThreadActivityAppendCommand = Schema.Struct({
  type: Schema.Literal('thread.activity.append'),
  commandId: CommandId,
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
  createdAt: IsoDateTime,
})
export type ThreadActivityAppendCommand = typeof ThreadActivityAppendCommand.Type

export const ThreadRevertCompleteCommand = Schema.Struct({
  type: Schema.Literal('thread.revert.complete'),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
})
export type ThreadRevertCompleteCommand = typeof ThreadRevertCompleteCommand.Type

export const InternalOrchestrationCommand = Schema.Union([
  ThreadSessionSetCommand,
  ThreadMessageAssistantDeltaCommand,
  ThreadMessageAssistantCompleteCommand,
  ThreadProposedPlanUpsertCommand,
  ThreadTurnDiffCompleteCommand,
  ThreadActivityAppendCommand,
  ThreadRevertCompleteCommand,
])
export type InternalOrchestrationCommand = typeof InternalOrchestrationCommand.Type

export const OrchestrationCommand = Schema.Union([
  DispatchableClientOrchestrationCommand,
  InternalOrchestrationCommand,
])
export type OrchestrationCommand = typeof OrchestrationCommand.Type
