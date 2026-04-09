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
  readonly shutdown: () => Promise<void>
}

export interface OpencodeTurnState {
  readonly turnId: TurnId
  readonly startedAt: string
  readonly providerMessageIds: Set<string>
  readonly startupTrace: OpencodeTurnStartupTrace
}

export interface OpencodeTurnStartupTrace {
  readonly taskId: RuntimeTaskId
  readonly promptDispatchedAtMs: number
  promptAcceptedAtMs: number | undefined
  firstEventAtMs: number | undefined
  firstContentDeltaAtMs: number | undefined
  firstToolAtMs: number | undefined
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
