/**
 * Shared types for the Opencode adapter helper modules.
 *
 * Pure type aliases and interfaces used by the opencode adapter's stateless
 * halves (`OpencodeAdapter.sdk.ts`, `OpencodeAdapter.pure.ts`, and later the
 * `OpencodeAdapter.runtime.*.ts` split introduced in f04/f05). Mirrors
 * `ClaudeAdapter.types.ts` in shape; owns only plain TypeScript types so the
 * helper modules can stay decoupled from Effect wiring.
 *
 * @module OpencodeAdapter.types
 */
import type {
  Event as OpencodeEvent,
  Message as OpencodeMessage,
  OpencodeClient,
  Part as OpencodePart,
  Session as OpencodeSession,
} from '@opencode-ai/sdk/v2/client'
import type {
  EventId,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSession,
  RuntimeTaskId,
  ThreadId,
  ThreadTokenUsageSnapshot,
  ToolLifecycleItemType,
  TurnId,
} from '@orxa-code/contracts'
import type { Fiber } from 'effect'

import type { StartedOpencodeServer } from '../opencodeAppServer.ts'

export const PROVIDER = 'opencode' as const

export type OpencodeModelSelection = Extract<
  NonNullable<ProviderSendTurnInput['modelSelection']>,
  { provider: 'opencode' }
>

export interface OpencodeClientRuntime {
  readonly client: OpencodeClient
  readonly port: number
  readonly pid?: number | undefined
  readonly shutdown: () => Promise<void>
}

export interface OpencodeTurnState {
  readonly turnId: TurnId
  readonly startedAt: string
  readonly providerMessageIds: Set<string>
  readonly startupTrace: OpencodeTurnStartupTrace
  // Insertion-ordered map of tool-call parts that opened (pending/running)
  // but haven't yet transitioned to completed/error. On turn abort we
  // synthesize terminal `item.completed{status:'declined'}` events for each
  // so the UI doesn't leave tool spinners running.
  readonly inFlightToolParts: Map<string, ToolLifecycleItemType>
}

export interface OpencodeTurnStartupTrace {
  readonly taskId: RuntimeTaskId
  readonly promptDispatchedAtMs: number
  promptAcceptedAtMs: number | undefined
  firstEventAtMs: number | undefined
  firstContentDeltaAtMs: number | undefined
  firstToolAtMs: number | undefined
}

export interface OpencodeChildDelegation {
  readonly parentProviderSessionId: string
  readonly agentLabel: string | null
  readonly prompt: string | null
  readonly description: string | null
  readonly modelSelection: OpencodeModelSelection | null
  readonly command: string | null
}

/**
 * Snapshot of a `permission.asked` event we've forwarded upstream. Kept only
 * so `respondToRequest` can look up the opencode `permission` string (for
 * logging) after the UI decision arrives — the actual request identifier used
 * to reply to the SDK is opencode's own `requestID`, which we pass through
 * as the runtime `ApprovalRequestId`.
 */
export interface OpencodePendingPermission {
  readonly requestID: string
  readonly permission: string
}

/**
 * Snapshot of a `question.asked` event with the original question ids in
 * order. `respondToUserInput` receives answers keyed by question id (from the
 * renderer) but opencode's reply endpoint takes a positional
 * `Array<Array<string>>`, so we need the original ordering to translate.
 */
export interface OpencodePendingQuestion {
  readonly requestID: string
  readonly questionIds: ReadonlyArray<string>
}

export interface OpencodeSessionContext {
  session: ProviderSession
  readonly runtime: OpencodeClientRuntime
  readonly providerSessionId: string
  currentModelId: string | undefined
  currentProviderId: string | undefined
  readonly startedAt: string
  eventStreamFiber: Fiber.Fiber<void, Error> | undefined
  turnState: OpencodeTurnState | undefined
  lastKnownTokenUsage: ThreadTokenUsageSnapshot | undefined
  readonly relatedSessionIds: Set<string>
  readonly childDelegationsBySessionId: Map<string, OpencodeChildDelegation>
  readonly pendingChildDelegations: Array<OpencodeChildDelegation>
  readonly pendingPermissions: Map<string, OpencodePendingPermission>
  readonly pendingQuestions: Map<string, OpencodePendingQuestion>
  stopped: boolean
}

export interface OpencodeAdapterLiveOptions {
  readonly createRuntime?: (input: {
    readonly binaryPath: string
    readonly env?: NodeJS.ProcessEnv | undefined
    readonly signal?: AbortSignal | undefined
  }) => Promise<OpencodeClientRuntime>
  readonly nativeEventLogPath?: string
}

export interface OpencodeSystemRuntimeEventBase {
  readonly eventId: EventId
  readonly provider: typeof PROVIDER
  readonly createdAt: string
  readonly threadId: ThreadId
  readonly turnId?: TurnId
  readonly providerRefs: Record<string, unknown>
}

export type StartedOpencodeRuntime = StartedOpencodeServer

export type {
  OpencodeClient,
  OpencodeEvent,
  OpencodeMessage,
  OpencodePart,
  OpencodeSession,
  ProviderRuntimeEvent,
  ProviderSession,
  ProviderSendTurnInput,
  ThreadId,
  ThreadTokenUsageSnapshot,
  TurnId,
}
