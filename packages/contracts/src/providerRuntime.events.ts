import { Schema } from 'effect'
import {
  AccountRateLimitsUpdatedType,
  AccountUpdatedType,
  AuthStatusType,
  ConfigWarningType,
  ContentDeltaType,
  DeprecationNoticeType,
  FilesPersistedType,
  HookCompletedType,
  HookProgressType,
  HookStartedType,
  ItemCompletedType,
  ItemStartedType,
  ItemUpdatedType,
  McpOauthCompletedType,
  McpStatusUpdatedType,
  ModelReroutedType,
  ProviderRuntimeEventBase,
  RequestOpenedType,
  RequestResolvedType,
  RuntimeErrorType,
  RuntimeTurnState,
  RuntimeWarningType,
  SessionConfiguredType,
  SessionExitedType,
  SessionStartedType,
  SessionStateChangedType,
  TaskCompletedType,
  TaskProgressType,
  TaskStartedType,
  ThreadMetadataUpdatedType,
  ThreadRealtimeAudioDeltaType,
  ThreadRealtimeClosedType,
  ThreadRealtimeErrorType,
  ThreadRealtimeItemAddedType,
  ThreadRealtimeStartedType,
  ThreadStartedType,
  ThreadStateChangedType,
  ThreadTokenUsageUpdatedType,
  ToolProgressType,
  ToolSummaryType,
  TurnAbortedType,
  TurnCompletedType,
  TurnDiffUpdatedType,
  TurnPlanUpdatedType,
  TurnProposedCompletedType,
  TurnProposedDeltaType,
  TurnStartedType,
  UserInputRequestedType,
  UserInputResolvedType,
} from './providerRuntime.shared'
import {
  AccountRateLimitsUpdatedPayload,
  AccountUpdatedPayload,
  AuthStatusPayload,
  ConfigWarningPayload,
  ContentDeltaPayload,
  DeprecationNoticePayload,
  FilesPersistedPayload,
  HookCompletedPayload,
  HookProgressPayload,
  HookStartedPayload,
  ItemLifecyclePayload,
  McpOauthCompletedPayload,
  McpStatusUpdatedPayload,
  ModelReroutedPayload,
  RequestOpenedPayload,
  RequestResolvedPayload,
  RuntimeErrorPayload,
  RuntimeWarningPayload,
  SessionConfiguredPayload,
  SessionExitedPayload,
  SessionStartedPayload,
  SessionStateChangedPayload,
  TaskCompletedPayload,
  TaskProgressPayload,
  TaskStartedPayload,
  ThreadMetadataUpdatedPayload,
  ThreadRealtimeAudioDeltaPayload,
  ThreadRealtimeClosedPayload,
  ThreadRealtimeErrorPayload,
  ThreadRealtimeItemAddedPayload,
  ThreadRealtimeStartedPayload,
  ThreadStartedPayload,
  ThreadStateChangedPayload,
  ThreadTokenUsageUpdatedPayload,
  ToolProgressPayload,
  ToolSummaryPayload,
  TurnAbortedPayload,
  TurnCompletedPayload,
  TurnDiffUpdatedPayload,
  TurnPlanUpdatedPayload,
  TurnProposedCompletedPayload,
  TurnProposedDeltaPayload,
  TurnStartedPayload,
  UserInputRequestedPayload,
  UserInputResolvedPayload,
} from './providerRuntime.payloads'

const ProviderRuntimeSessionStartedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: SessionStartedType,
  payload: SessionStartedPayload,
})
export type ProviderRuntimeSessionStartedEvent = typeof ProviderRuntimeSessionStartedEvent.Type

const ProviderRuntimeSessionConfiguredEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: SessionConfiguredType,
  payload: SessionConfiguredPayload,
})
export type ProviderRuntimeSessionConfiguredEvent =
  typeof ProviderRuntimeSessionConfiguredEvent.Type

const ProviderRuntimeSessionStateChangedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: SessionStateChangedType,
  payload: SessionStateChangedPayload,
})
export type ProviderRuntimeSessionStateChangedEvent =
  typeof ProviderRuntimeSessionStateChangedEvent.Type

const ProviderRuntimeSessionExitedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: SessionExitedType,
  payload: SessionExitedPayload,
})
export type ProviderRuntimeSessionExitedEvent = typeof ProviderRuntimeSessionExitedEvent.Type

const ProviderRuntimeThreadStartedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: ThreadStartedType,
  payload: ThreadStartedPayload,
})
export type ProviderRuntimeThreadStartedEvent = typeof ProviderRuntimeThreadStartedEvent.Type

const ProviderRuntimeThreadStateChangedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: ThreadStateChangedType,
  payload: ThreadStateChangedPayload,
})
export type ProviderRuntimeThreadStateChangedEvent =
  typeof ProviderRuntimeThreadStateChangedEvent.Type

const ProviderRuntimeThreadMetadataUpdatedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: ThreadMetadataUpdatedType,
  payload: ThreadMetadataUpdatedPayload,
})
export type ProviderRuntimeThreadMetadataUpdatedEvent =
  typeof ProviderRuntimeThreadMetadataUpdatedEvent.Type

const ProviderRuntimeThreadTokenUsageUpdatedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: ThreadTokenUsageUpdatedType,
  payload: ThreadTokenUsageUpdatedPayload,
})
export type ProviderRuntimeThreadTokenUsageUpdatedEvent =
  typeof ProviderRuntimeThreadTokenUsageUpdatedEvent.Type

const ProviderRuntimeThreadRealtimeStartedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: ThreadRealtimeStartedType,
  payload: ThreadRealtimeStartedPayload,
})
export type ProviderRuntimeThreadRealtimeStartedEvent =
  typeof ProviderRuntimeThreadRealtimeStartedEvent.Type

const ProviderRuntimeThreadRealtimeItemAddedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: ThreadRealtimeItemAddedType,
  payload: ThreadRealtimeItemAddedPayload,
})
export type ProviderRuntimeThreadRealtimeItemAddedEvent =
  typeof ProviderRuntimeThreadRealtimeItemAddedEvent.Type

const ProviderRuntimeThreadRealtimeAudioDeltaEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: ThreadRealtimeAudioDeltaType,
  payload: ThreadRealtimeAudioDeltaPayload,
})
export type ProviderRuntimeThreadRealtimeAudioDeltaEvent =
  typeof ProviderRuntimeThreadRealtimeAudioDeltaEvent.Type

const ProviderRuntimeThreadRealtimeErrorEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: ThreadRealtimeErrorType,
  payload: ThreadRealtimeErrorPayload,
})
export type ProviderRuntimeThreadRealtimeErrorEvent =
  typeof ProviderRuntimeThreadRealtimeErrorEvent.Type

const ProviderRuntimeThreadRealtimeClosedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: ThreadRealtimeClosedType,
  payload: ThreadRealtimeClosedPayload,
})
export type ProviderRuntimeThreadRealtimeClosedEvent =
  typeof ProviderRuntimeThreadRealtimeClosedEvent.Type

const ProviderRuntimeTurnStartedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: TurnStartedType,
  payload: TurnStartedPayload,
})
export type ProviderRuntimeTurnStartedEvent = typeof ProviderRuntimeTurnStartedEvent.Type

const ProviderRuntimeTurnCompletedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: TurnCompletedType,
  payload: TurnCompletedPayload,
})
export type ProviderRuntimeTurnCompletedEvent = typeof ProviderRuntimeTurnCompletedEvent.Type

const ProviderRuntimeTurnAbortedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: TurnAbortedType,
  payload: TurnAbortedPayload,
})
export type ProviderRuntimeTurnAbortedEvent = typeof ProviderRuntimeTurnAbortedEvent.Type

const ProviderRuntimeTurnPlanUpdatedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: TurnPlanUpdatedType,
  payload: TurnPlanUpdatedPayload,
})
export type ProviderRuntimeTurnPlanUpdatedEvent = typeof ProviderRuntimeTurnPlanUpdatedEvent.Type

const ProviderRuntimeTurnProposedDeltaEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: TurnProposedDeltaType,
  payload: TurnProposedDeltaPayload,
})
export type ProviderRuntimeTurnProposedDeltaEvent =
  typeof ProviderRuntimeTurnProposedDeltaEvent.Type

const ProviderRuntimeTurnProposedCompletedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: TurnProposedCompletedType,
  payload: TurnProposedCompletedPayload,
})
export type ProviderRuntimeTurnProposedCompletedEvent =
  typeof ProviderRuntimeTurnProposedCompletedEvent.Type

const ProviderRuntimeTurnDiffUpdatedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: TurnDiffUpdatedType,
  payload: TurnDiffUpdatedPayload,
})
export type ProviderRuntimeTurnDiffUpdatedEvent = typeof ProviderRuntimeTurnDiffUpdatedEvent.Type

const ProviderRuntimeItemStartedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: ItemStartedType,
  payload: ItemLifecyclePayload,
})
export type ProviderRuntimeItemStartedEvent = typeof ProviderRuntimeItemStartedEvent.Type

const ProviderRuntimeItemUpdatedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: ItemUpdatedType,
  payload: ItemLifecyclePayload,
})
export type ProviderRuntimeItemUpdatedEvent = typeof ProviderRuntimeItemUpdatedEvent.Type

const ProviderRuntimeItemCompletedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: ItemCompletedType,
  payload: ItemLifecyclePayload,
})
export type ProviderRuntimeItemCompletedEvent = typeof ProviderRuntimeItemCompletedEvent.Type

const ProviderRuntimeContentDeltaEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: ContentDeltaType,
  payload: ContentDeltaPayload,
})
export type ProviderRuntimeContentDeltaEvent = typeof ProviderRuntimeContentDeltaEvent.Type

const ProviderRuntimeRequestOpenedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: RequestOpenedType,
  payload: RequestOpenedPayload,
})
export type ProviderRuntimeRequestOpenedEvent = typeof ProviderRuntimeRequestOpenedEvent.Type

const ProviderRuntimeRequestResolvedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: RequestResolvedType,
  payload: RequestResolvedPayload,
})
export type ProviderRuntimeRequestResolvedEvent = typeof ProviderRuntimeRequestResolvedEvent.Type

const ProviderRuntimeUserInputRequestedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: UserInputRequestedType,
  payload: UserInputRequestedPayload,
})
export type ProviderRuntimeUserInputRequestedEvent =
  typeof ProviderRuntimeUserInputRequestedEvent.Type

const ProviderRuntimeUserInputResolvedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: UserInputResolvedType,
  payload: UserInputResolvedPayload,
})
export type ProviderRuntimeUserInputResolvedEvent =
  typeof ProviderRuntimeUserInputResolvedEvent.Type

const ProviderRuntimeTaskStartedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: TaskStartedType,
  payload: TaskStartedPayload,
})
export type ProviderRuntimeTaskStartedEvent = typeof ProviderRuntimeTaskStartedEvent.Type

const ProviderRuntimeTaskProgressEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: TaskProgressType,
  payload: TaskProgressPayload,
})
export type ProviderRuntimeTaskProgressEvent = typeof ProviderRuntimeTaskProgressEvent.Type

const ProviderRuntimeTaskCompletedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: TaskCompletedType,
  payload: TaskCompletedPayload,
})
export type ProviderRuntimeTaskCompletedEvent = typeof ProviderRuntimeTaskCompletedEvent.Type

const ProviderRuntimeHookStartedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: HookStartedType,
  payload: HookStartedPayload,
})
export type ProviderRuntimeHookStartedEvent = typeof ProviderRuntimeHookStartedEvent.Type

const ProviderRuntimeHookProgressEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: HookProgressType,
  payload: HookProgressPayload,
})
export type ProviderRuntimeHookProgressEvent = typeof ProviderRuntimeHookProgressEvent.Type

const ProviderRuntimeHookCompletedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: HookCompletedType,
  payload: HookCompletedPayload,
})
export type ProviderRuntimeHookCompletedEvent = typeof ProviderRuntimeHookCompletedEvent.Type

const ProviderRuntimeToolProgressEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: ToolProgressType,
  payload: ToolProgressPayload,
})
export type ProviderRuntimeToolProgressEvent = typeof ProviderRuntimeToolProgressEvent.Type

const ProviderRuntimeToolSummaryEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: ToolSummaryType,
  payload: ToolSummaryPayload,
})
export type ProviderRuntimeToolSummaryEvent = typeof ProviderRuntimeToolSummaryEvent.Type

const ProviderRuntimeAuthStatusEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: AuthStatusType,
  payload: AuthStatusPayload,
})
export type ProviderRuntimeAuthStatusEvent = typeof ProviderRuntimeAuthStatusEvent.Type

const ProviderRuntimeAccountUpdatedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: AccountUpdatedType,
  payload: AccountUpdatedPayload,
})
export type ProviderRuntimeAccountUpdatedEvent = typeof ProviderRuntimeAccountUpdatedEvent.Type

const ProviderRuntimeAccountRateLimitsUpdatedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: AccountRateLimitsUpdatedType,
  payload: AccountRateLimitsUpdatedPayload,
})
export type ProviderRuntimeAccountRateLimitsUpdatedEvent =
  typeof ProviderRuntimeAccountRateLimitsUpdatedEvent.Type

const ProviderRuntimeMcpStatusUpdatedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: McpStatusUpdatedType,
  payload: McpStatusUpdatedPayload,
})
export type ProviderRuntimeMcpStatusUpdatedEvent = typeof ProviderRuntimeMcpStatusUpdatedEvent.Type

const ProviderRuntimeMcpOauthCompletedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: McpOauthCompletedType,
  payload: McpOauthCompletedPayload,
})
export type ProviderRuntimeMcpOauthCompletedEvent =
  typeof ProviderRuntimeMcpOauthCompletedEvent.Type

const ProviderRuntimeModelReroutedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: ModelReroutedType,
  payload: ModelReroutedPayload,
})
export type ProviderRuntimeModelReroutedEvent = typeof ProviderRuntimeModelReroutedEvent.Type

const ProviderRuntimeConfigWarningEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: ConfigWarningType,
  payload: ConfigWarningPayload,
})
export type ProviderRuntimeConfigWarningEvent = typeof ProviderRuntimeConfigWarningEvent.Type

const ProviderRuntimeDeprecationNoticeEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: DeprecationNoticeType,
  payload: DeprecationNoticePayload,
})
export type ProviderRuntimeDeprecationNoticeEvent =
  typeof ProviderRuntimeDeprecationNoticeEvent.Type

const ProviderRuntimeFilesPersistedEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: FilesPersistedType,
  payload: FilesPersistedPayload,
})
export type ProviderRuntimeFilesPersistedEvent = typeof ProviderRuntimeFilesPersistedEvent.Type

const ProviderRuntimeWarningEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: RuntimeWarningType,
  payload: RuntimeWarningPayload,
})
export type ProviderRuntimeWarningEvent = typeof ProviderRuntimeWarningEvent.Type

const ProviderRuntimeErrorEvent = Schema.Struct({
  ...ProviderRuntimeEventBase.fields,
  type: RuntimeErrorType,
  payload: RuntimeErrorPayload,
})
export type ProviderRuntimeErrorEvent = typeof ProviderRuntimeErrorEvent.Type

export const ProviderRuntimeEventV2 = Schema.Union([
  ProviderRuntimeSessionStartedEvent,
  ProviderRuntimeSessionConfiguredEvent,
  ProviderRuntimeSessionStateChangedEvent,
  ProviderRuntimeSessionExitedEvent,
  ProviderRuntimeThreadStartedEvent,
  ProviderRuntimeThreadStateChangedEvent,
  ProviderRuntimeThreadMetadataUpdatedEvent,
  ProviderRuntimeThreadTokenUsageUpdatedEvent,
  ProviderRuntimeThreadRealtimeStartedEvent,
  ProviderRuntimeThreadRealtimeItemAddedEvent,
  ProviderRuntimeThreadRealtimeAudioDeltaEvent,
  ProviderRuntimeThreadRealtimeErrorEvent,
  ProviderRuntimeThreadRealtimeClosedEvent,
  ProviderRuntimeTurnStartedEvent,
  ProviderRuntimeTurnCompletedEvent,
  ProviderRuntimeTurnAbortedEvent,
  ProviderRuntimeTurnPlanUpdatedEvent,
  ProviderRuntimeTurnProposedDeltaEvent,
  ProviderRuntimeTurnProposedCompletedEvent,
  ProviderRuntimeTurnDiffUpdatedEvent,
  ProviderRuntimeItemStartedEvent,
  ProviderRuntimeItemUpdatedEvent,
  ProviderRuntimeItemCompletedEvent,
  ProviderRuntimeContentDeltaEvent,
  ProviderRuntimeRequestOpenedEvent,
  ProviderRuntimeRequestResolvedEvent,
  ProviderRuntimeUserInputRequestedEvent,
  ProviderRuntimeUserInputResolvedEvent,
  ProviderRuntimeTaskStartedEvent,
  ProviderRuntimeTaskProgressEvent,
  ProviderRuntimeTaskCompletedEvent,
  ProviderRuntimeHookStartedEvent,
  ProviderRuntimeHookProgressEvent,
  ProviderRuntimeHookCompletedEvent,
  ProviderRuntimeToolProgressEvent,
  ProviderRuntimeToolSummaryEvent,
  ProviderRuntimeAuthStatusEvent,
  ProviderRuntimeAccountUpdatedEvent,
  ProviderRuntimeAccountRateLimitsUpdatedEvent,
  ProviderRuntimeMcpStatusUpdatedEvent,
  ProviderRuntimeMcpOauthCompletedEvent,
  ProviderRuntimeModelReroutedEvent,
  ProviderRuntimeConfigWarningEvent,
  ProviderRuntimeDeprecationNoticeEvent,
  ProviderRuntimeFilesPersistedEvent,
  ProviderRuntimeWarningEvent,
  ProviderRuntimeErrorEvent,
])
export type ProviderRuntimeEventV2 = typeof ProviderRuntimeEventV2.Type

export const ProviderRuntimeEvent = ProviderRuntimeEventV2
export type ProviderRuntimeEvent = ProviderRuntimeEventV2

const ProviderRuntimeMessageDeltaEvent = ProviderRuntimeContentDeltaEvent
export type ProviderRuntimeMessageDeltaEvent = ProviderRuntimeContentDeltaEvent
const ProviderRuntimeMessageCompletedEvent = ProviderRuntimeItemCompletedEvent
export type ProviderRuntimeMessageCompletedEvent = ProviderRuntimeItemCompletedEvent
const ProviderRuntimeToolStartedEvent = ProviderRuntimeItemStartedEvent
export type ProviderRuntimeToolStartedEvent = ProviderRuntimeItemStartedEvent
const ProviderRuntimeToolCompletedEvent = ProviderRuntimeItemCompletedEvent
export type ProviderRuntimeToolCompletedEvent = ProviderRuntimeItemCompletedEvent
const ProviderRuntimeApprovalRequestedEvent = ProviderRuntimeRequestOpenedEvent
export type ProviderRuntimeApprovalRequestedEvent = ProviderRuntimeRequestOpenedEvent
const ProviderRuntimeApprovalResolvedEvent = ProviderRuntimeRequestResolvedEvent
export type ProviderRuntimeApprovalResolvedEvent = ProviderRuntimeRequestResolvedEvent

const ProviderRuntimeToolKind = Schema.Literals(['command', 'file-read', 'file-change', 'other'])
export type ProviderRuntimeToolKind = typeof ProviderRuntimeToolKind.Type

export const ProviderRuntimeTurnStatus = RuntimeTurnState
export type ProviderRuntimeTurnStatus = RuntimeTurnState
