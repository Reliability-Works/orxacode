import { Schema } from 'effect'
import { ClaudeModelOptions, CodexModelOptions } from './model'
import {
  CheckpointRef,
  CommandId,
  EventId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from './baseSchemas'

export const ORCHESTRATION_WS_METHODS = {
  getSnapshot: 'orchestration.getSnapshot',
  dispatchCommand: 'orchestration.dispatchCommand',
  getTurnDiff: 'orchestration.getTurnDiff',
  getFullThreadDiff: 'orchestration.getFullThreadDiff',
  replayEvents: 'orchestration.replayEvents',
} as const

export const ProviderKind = Schema.Literals(['codex', 'claudeAgent'])
export type ProviderKind = typeof ProviderKind.Type
export const ProviderApprovalPolicy = Schema.Literals([
  'untrusted',
  'on-failure',
  'on-request',
  'never',
])
export type ProviderApprovalPolicy = typeof ProviderApprovalPolicy.Type
export const ProviderSandboxMode = Schema.Literals([
  'read-only',
  'workspace-write',
  'danger-full-access',
])
export type ProviderSandboxMode = typeof ProviderSandboxMode.Type

export const DEFAULT_PROVIDER_KIND: ProviderKind = 'codex'

export const CodexModelSelection = Schema.Struct({
  provider: Schema.Literal('codex'),
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(CodexModelOptions),
})
export type CodexModelSelection = typeof CodexModelSelection.Type

export const ClaudeModelSelection = Schema.Struct({
  provider: Schema.Literal('claudeAgent'),
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(ClaudeModelOptions),
})
export type ClaudeModelSelection = typeof ClaudeModelSelection.Type

export const ModelSelection = Schema.Union([CodexModelSelection, ClaudeModelSelection])
export type ModelSelection = typeof ModelSelection.Type

export const RuntimeMode = Schema.Literals(['approval-required', 'full-access'])
export type RuntimeMode = typeof RuntimeMode.Type
export const DEFAULT_RUNTIME_MODE: RuntimeMode = 'full-access'
export const ProviderInteractionMode = Schema.Literals(['default', 'plan'])
export type ProviderInteractionMode = typeof ProviderInteractionMode.Type
export const DEFAULT_PROVIDER_INTERACTION_MODE: ProviderInteractionMode = 'default'
export const ProviderRequestKind = Schema.Literals(['command', 'file-read', 'file-change'])
export type ProviderRequestKind = typeof ProviderRequestKind.Type
export const AssistantDeliveryMode = Schema.Literals(['buffered', 'streaming'])
export type AssistantDeliveryMode = typeof AssistantDeliveryMode.Type
export const ProviderApprovalDecision = Schema.Literals([
  'accept',
  'acceptForSession',
  'decline',
  'cancel',
])
export type ProviderApprovalDecision = typeof ProviderApprovalDecision.Type
export const ProviderUserInputAnswers = Schema.Record(Schema.String, Schema.Unknown)
export type ProviderUserInputAnswers = typeof ProviderUserInputAnswers.Type

export const PROVIDER_SEND_TURN_MAX_INPUT_CHARS = 120_000
export const PROVIDER_SEND_TURN_MAX_ATTACHMENTS = 8
export const PROVIDER_SEND_TURN_MAX_IMAGE_BYTES = 10 * 1024 * 1024
const PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS = 14_000_000
const CHAT_ATTACHMENT_ID_MAX_CHARS = 128

export const CorrelationId = CommandId
export type CorrelationId = typeof CorrelationId.Type

const ChatAttachmentId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CHAT_ATTACHMENT_ID_MAX_CHARS),
  Schema.isPattern(/^[a-z0-9_-]+$/i)
)
export type ChatAttachmentId = typeof ChatAttachmentId.Type

export const ChatImageAttachment = Schema.Struct({
  type: Schema.Literal('image'),
  id: ChatAttachmentId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
})
export type ChatImageAttachment = typeof ChatImageAttachment.Type

export const UploadChatImageAttachment = Schema.Struct({
  type: Schema.Literal('image'),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS)
  ),
})
export type UploadChatImageAttachment = typeof UploadChatImageAttachment.Type

export const ChatAttachment = Schema.Union([ChatImageAttachment])
export type ChatAttachment = typeof ChatAttachment.Type
export const UploadChatAttachment = Schema.Union([UploadChatImageAttachment])
export type UploadChatAttachment = typeof UploadChatAttachment.Type

export const ProjectScriptIcon = Schema.Literals([
  'play',
  'test',
  'lint',
  'configure',
  'build',
  'debug',
])
export type ProjectScriptIcon = typeof ProjectScriptIcon.Type

export const ProjectScript = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  icon: ProjectScriptIcon,
  runOnWorktreeCreate: Schema.Boolean,
})
export type ProjectScript = typeof ProjectScript.Type

export const OrchestrationProject = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
})
export type OrchestrationProject = typeof OrchestrationProject.Type

export const OrchestrationMessageRole = Schema.Literals(['user', 'assistant', 'system'])
export type OrchestrationMessageRole = typeof OrchestrationMessageRole.Type

export const OrchestrationMessage = Schema.Struct({
  id: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
})
export type OrchestrationMessage = typeof OrchestrationMessage.Type

export const OrchestrationProposedPlanId = TrimmedNonEmptyString
export type OrchestrationProposedPlanId = typeof OrchestrationProposedPlanId.Type

export const OrchestrationProposedPlan = Schema.Struct({
  id: OrchestrationProposedPlanId,
  turnId: Schema.NullOr(TurnId),
  planMarkdown: TrimmedNonEmptyString,
  implementedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  implementationThreadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(() => null)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
})
export type OrchestrationProposedPlan = typeof OrchestrationProposedPlan.Type

export const SourceProposedPlanReference = Schema.Struct({
  threadId: ThreadId,
  planId: OrchestrationProposedPlanId,
})
export type SourceProposedPlanReference = typeof SourceProposedPlanReference.Type

export const OrchestrationSessionStatus = Schema.Literals([
  'idle',
  'starting',
  'running',
  'ready',
  'interrupted',
  'stopped',
  'error',
])
export type OrchestrationSessionStatus = typeof OrchestrationSessionStatus.Type

export const OrchestrationSession = Schema.Struct({
  threadId: ThreadId,
  status: OrchestrationSessionStatus,
  providerName: Schema.NullOr(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  activeTurnId: Schema.NullOr(TurnId),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
})
export type OrchestrationSession = typeof OrchestrationSession.Type

export const OrchestrationCheckpointFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: TrimmedNonEmptyString,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
})
export type OrchestrationCheckpointFile = typeof OrchestrationCheckpointFile.Type

export const OrchestrationCheckpointStatus = Schema.Literals(['ready', 'missing', 'error'])
export type OrchestrationCheckpointStatus = typeof OrchestrationCheckpointStatus.Type

export const OrchestrationCheckpointSummary = Schema.Struct({
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
})
export type OrchestrationCheckpointSummary = typeof OrchestrationCheckpointSummary.Type

export const OrchestrationThreadActivityTone = Schema.Literals([
  'info',
  'tool',
  'approval',
  'error',
])
export type OrchestrationThreadActivityTone = typeof OrchestrationThreadActivityTone.Type

export const OrchestrationThreadActivity = Schema.Struct({
  id: EventId,
  tone: OrchestrationThreadActivityTone,
  kind: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  payload: Schema.Unknown,
  turnId: Schema.NullOr(TurnId),
  sequence: Schema.optional(NonNegativeInt),
  createdAt: IsoDateTime,
})
export type OrchestrationThreadActivity = typeof OrchestrationThreadActivity.Type

const OrchestrationLatestTurnState = Schema.Literals([
  'running',
  'interrupted',
  'completed',
  'error',
])
export type OrchestrationLatestTurnState = typeof OrchestrationLatestTurnState.Type

export const OrchestrationLatestTurn = Schema.Struct({
  turnId: TurnId,
  state: OrchestrationLatestTurnState,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
})
export type OrchestrationLatestTurn = typeof OrchestrationLatestTurn.Type

export const threadCoreFields = {
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE)
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
} as const

export const OrchestrationThread = Schema.Struct({
  id: ThreadId,
  ...threadCoreFields,
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  deletedAt: Schema.NullOr(IsoDateTime),
  messages: Schema.Array(OrchestrationMessage),
  proposedPlans: Schema.Array(OrchestrationProposedPlan).pipe(Schema.withDecodingDefault(() => [])),
  activities: Schema.Array(OrchestrationThreadActivity),
  checkpoints: Schema.Array(OrchestrationCheckpointSummary),
  session: Schema.NullOr(OrchestrationSession),
})
export type OrchestrationThread = typeof OrchestrationThread.Type

export const OrchestrationReadModel = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProject),
  threads: Schema.Array(OrchestrationThread),
  updatedAt: IsoDateTime,
})
export type OrchestrationReadModel = typeof OrchestrationReadModel.Type
