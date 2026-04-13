import { Schema } from 'effect'

import {
  CheckpointRef,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from './baseSchemas'
import {
  ChatAttachment,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  ModelSelection,
  OrchestrationCheckpointFile,
  OrchestrationCheckpointStatus,
  OrchestrationMessageRole,
  ProjectScript,
  ProviderInteractionMode,
  RuntimeMode,
  SourceProposedPlanReference,
} from './orchestration.models'

export { threadCoreFields } from './orchestration.models'

/**
 * Shared schema field bags reused across orchestration command, payload, event, model
 * structs. Each export is an object literal of `Schema` fields and is intended to be
 * spread into `Schema.Struct({ ...fields, extra })` so duplicate field declarations
 * collapse to a single source.
 */

export const orchestrationMessageContentFields = {
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
} as const

export const projectMetaUpdatableFields = {
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
} as const

export const projectCreatedCoreFields = {
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
} as const

export const projectCreateCommandFields = {
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  createdAt: IsoDateTime,
} as const

export const threadMetaUpdatableFields = {
  title: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  gitRoot: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
} as const

export const threadTurnStartOptionsFields = {
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE)
  ),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
} as const

export const turnStartUserMessageStruct = <T, E = T, RD = never, RE = never>(
  attachmentSchema: Schema.Codec<T, E, RD, RE>
) =>
  Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal('user'),
    text: Schema.String,
    attachments: Schema.Array(attachmentSchema),
  })

export const checkpointRowFields = {
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
} as const
