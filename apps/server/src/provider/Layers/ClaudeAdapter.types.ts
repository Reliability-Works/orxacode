/**
 * Shared types for the Claude adapter helper modules.
 *
 * Pure type aliases and interfaces extracted from `ClaudeAdapter.ts` so the
 * helper modules (streaming, approvals, session, turn) can share them
 * without importing the layer wiring shell.
 *
 * @module ClaudeAdapter.types
 */
import type {
  CanUseTool,
  Options as ClaudeQueryOptions,
  PermissionMode,
  PermissionUpdate,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type {
  ApprovalRequestId,
  CanonicalItemType,
  CanonicalRequestType,
  ClaudeCodeEffort,
  ProviderApprovalDecision,
  ProviderRuntimeEvent,
  ProviderRuntimeTurnStatus,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderUserInputAnswers,
  RuntimeContentStreamKind,
  ThreadId,
  ThreadTokenUsageSnapshot,
  TurnId,
  UserInputQuestion,
} from '@orxa-code/contracts'
import type { Deferred, Fiber, Queue } from 'effect'

export const PROVIDER = 'claudeAgent' as const

export type ClaudeTextStreamKind = Extract<
  RuntimeContentStreamKind,
  'assistant_text' | 'reasoning_text'
>

export type ClaudeToolResultStreamKind = Extract<
  RuntimeContentStreamKind,
  'command_output' | 'file_change_output'
>

export type ClaudeModelSelection = Extract<
  NonNullable<ProviderSendTurnInput['modelSelection']>,
  { provider: 'claudeAgent' }
>

export type PromptQueueItem =
  | {
      readonly type: 'message'
      readonly message: SDKUserMessage
    }
  | {
      readonly type: 'terminate'
    }

export interface ClaudeResumeState {
  readonly threadId?: ThreadId
  readonly resume?: string
  readonly resumeSessionAt?: string
  readonly turnCount?: number
}

export interface ClaudeTurnState {
  readonly turnId: TurnId
  readonly startedAt: string
  readonly items: Array<unknown>
  readonly assistantTextBlocks: Map<number, AssistantTextBlockState>
  readonly assistantTextBlockOrder: Array<AssistantTextBlockState>
  readonly capturedProposedPlanKeys: Set<string>
  nextSyntheticAssistantBlockIndex: number
}

export interface AssistantTextBlockState {
  readonly itemId: string
  readonly blockIndex: number
  emittedTextDelta: boolean
  fallbackText: string
  streamClosed: boolean
  completionEmitted: boolean
}

export interface PendingApproval {
  readonly requestType: CanonicalRequestType
  readonly detail?: string
  readonly suggestions?: ReadonlyArray<PermissionUpdate>
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>
}

export interface PendingUserInput {
  readonly questions: ReadonlyArray<UserInputQuestion>
  readonly answers: Deferred.Deferred<ProviderUserInputAnswers>
}

export interface ToolInFlight {
  readonly itemId: string
  readonly itemType: CanonicalItemType
  readonly toolName: string
  readonly title: string
  readonly detail?: string
  readonly input: Record<string, unknown>
  readonly partialInputJson: string
  readonly lastEmittedInputFingerprint?: string
}

export interface ClaudeQueryRuntime extends AsyncIterable<SDKMessage> {
  readonly interrupt: () => Promise<void>
  readonly setModel: (model?: string) => Promise<void>
  readonly setPermissionMode: (mode: PermissionMode) => Promise<void>
  readonly setMaxThinkingTokens: (maxThinkingTokens: number | null) => Promise<void>
  readonly close: () => void
}

export interface ClaudeSessionContext {
  session: ProviderSession
  readonly promptQueue: Queue.Queue<PromptQueueItem>
  readonly query: ClaudeQueryRuntime
  streamFiber: Fiber.Fiber<void, Error> | undefined
  readonly startedAt: string
  readonly basePermissionMode: PermissionMode | undefined
  currentApiModelId: string | undefined
  resumeSessionId: string | undefined
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>
  readonly turns: Array<{
    id: TurnId
    items: Array<unknown>
  }>
  readonly inFlightTools: Map<number, ToolInFlight>
  turnState: ClaudeTurnState | undefined
  lastKnownContextWindow: number | undefined
  lastKnownTokenUsage: ThreadTokenUsageSnapshot | undefined
  lastAssistantUuid: string | undefined
  lastThreadStartedId: string | undefined
  stopped: boolean
}

export interface ClaudeSystemRuntimeEventBase {
  readonly eventId: import('@orxa-code/contracts').EventId
  readonly provider: typeof PROVIDER
  readonly createdAt: string
  readonly threadId: ThreadId
  readonly turnId?: TurnId
  readonly providerRefs: Record<string, unknown>
  readonly raw: {
    readonly source: 'claude.sdk.message'
    readonly method: string
    readonly messageType: string
    readonly payload: SDKMessage
  }
}

export interface AssistantTextBlockCompletionOptions {
  readonly force?: boolean
  readonly rawMethod?: string
  readonly rawPayload?: unknown
}

export interface ClaudeSessionRuntimeConfig {
  readonly claudeBinaryPath: string
  readonly modelSelection: ClaudeModelSelection | undefined
  readonly apiModelId: string | undefined
  readonly effectiveEffort: Exclude<ClaudeCodeEffort, 'ultrathink'> | null
  readonly permissionMode: PermissionMode | undefined
  readonly fastMode: boolean
  readonly queryOptions: ClaudeQueryOptions
}

export type EffectForkRunner = <A, E>(
  effect: import('effect').Effect.Effect<A, E, never>
) => Fiber.Fiber<A, E>

export interface ClaudeSessionModelRuntimeConfig {
  readonly apiModelId: string | undefined
  readonly effectiveEffort: Exclude<ClaudeCodeEffort, 'ultrathink'> | null
  readonly fastMode: boolean
  readonly permissionMode: PermissionMode | undefined
  readonly settings: {
    readonly alwaysThinkingEnabled?: boolean
    readonly fastMode?: true
  }
}

export interface ClaudeAdapterLiveOptions {
  readonly createQuery?: (input: {
    readonly prompt: AsyncIterable<SDKUserMessage>
    readonly options: ClaudeQueryOptions
  }) => ClaudeQueryRuntime
  readonly nativeEventLogPath?: string
  readonly nativeEventLogger?: import('./EventNdjsonLogger.ts').EventNdjsonLogger
}

export type {
  CanUseTool,
  ClaudeQueryOptions,
  PermissionMode,
  PermissionUpdate,
  ProviderRuntimeEvent,
  ProviderRuntimeTurnStatus,
  ProviderSession,
  ProviderSendTurnInput,
  ProviderApprovalDecision,
  ProviderUserInputAnswers,
  SDKMessage,
  SDKUserMessage,
  ThreadId,
  ThreadTokenUsageSnapshot,
  TurnId,
  ApprovalRequestId,
  CanonicalItemType,
  CanonicalRequestType,
  ClaudeCodeEffort,
  UserInputQuestion,
}
