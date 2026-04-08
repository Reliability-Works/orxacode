import { type ChildProcessWithoutNullStreams, spawnSync } from 'node:child_process'

import {
  ProviderItemId,
  ProviderRequestKind,
  type ProviderInteractionMode,
  type ProviderUserInputAnswers,
  RuntimeMode,
  ThreadId,
  TurnId,
} from '@orxa-code/contracts'
import { normalizeModelSlug } from '@orxa-code/shared/model'

import {
  formatCodexCliUpgradeMessage,
  isCodexCliVersionSupported,
  parseCodexCliVersion,
} from './provider/codexCliVersion'
import { killCodexChildProcess } from './provider/codexAppServer'

import {
  CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
  CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
} from './codexAppServerManager.developerInstructions'

export type PendingRequestKey = string

export interface PendingRequest {
  method: string
  timeout: ReturnType<typeof setTimeout>
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export interface PendingApprovalRequest {
  requestId: import('@orxa-code/contracts').ApprovalRequestId
  jsonRpcId: string | number
  method:
    | 'item/commandExecution/requestApproval'
    | 'item/fileChange/requestApproval'
    | 'item/fileRead/requestApproval'
  requestKind: ProviderRequestKind
  threadId: ThreadId
  turnId?: TurnId
  itemId?: ProviderItemId
}

export interface PendingUserInputRequest {
  requestId: import('@orxa-code/contracts').ApprovalRequestId
  jsonRpcId: string | number
  threadId: ThreadId
  turnId?: TurnId
  itemId?: ProviderItemId
}

export interface CodexUserInputAnswer {
  answers: string[]
}

export interface JsonRpcError {
  code?: number
  message?: string
}

export interface JsonRpcRequest {
  id: string | number
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  id: string | number
  result?: unknown
  error?: JsonRpcError
}

export interface JsonRpcNotification {
  method: string
  params?: unknown
}

export type CodexTurnInputItem =
  | { type: 'text'; text: string; text_elements: [] }
  | { type: 'image'; url: string }

export type CodexTurnStartParams = {
  threadId: string
  input: CodexTurnInputItem[]
  model?: string
  serviceTier?: string | null
  effort?: string
  collaborationMode?: {
    mode: 'default' | 'plan'
    settings: {
      model: string
      reasoning_effort: string
      developer_instructions: string
    }
  }
}

const CODEX_VERSION_CHECK_TIMEOUT_MS = 4_000

const ANSI_ESCAPE_CHAR = String.fromCharCode(27)
const ANSI_ESCAPE_REGEX = new RegExp(`${ANSI_ESCAPE_CHAR}\\[[0-9;]*m`, 'g')
const CODEX_STDERR_LOG_REGEX =
  /^\d{4}-\d{2}-\d{2}T\S+\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+\S+:\s+(.*)$/
const BENIGN_ERROR_LOG_SNIPPETS = [
  'state db missing rollout path for thread',
  'state db record_discrepancy: find_thread_path_by_id_str_in_subdir, falling_back',
]
const RECOVERABLE_THREAD_RESUME_ERROR_SNIPPETS = [
  'not found',
  'missing thread',
  'no such thread',
  'unknown thread',
  'does not exist',
]

export function mapCodexRuntimeMode(runtimeMode: RuntimeMode): {
  readonly approvalPolicy: 'on-request' | 'never'
  readonly sandbox: 'workspace-write' | 'danger-full-access'
} {
  if (runtimeMode === 'approval-required') {
    return {
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
    }
  }

  return {
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
  }
}

/**
 * On Windows with `shell: true`, `child.kill()` only terminates the `cmd.exe`
 * wrapper, leaving the actual command running. Use `taskkill /T` to kill the
 * entire process tree instead.
 */
export function killChildTree(child: ChildProcessWithoutNullStreams): void {
  killCodexChildProcess(child)
}

export function normalizeCodexModelSlug(
  model: string | undefined | null,
  preferredId?: string
): string | undefined {
  const normalized = normalizeModelSlug(model)
  if (!normalized) {
    return undefined
  }

  if (preferredId?.endsWith('-codex') && preferredId !== normalized) {
    return preferredId
  }

  return normalized
}

export function buildCodexCollaborationMode(input: {
  readonly interactionMode?: ProviderInteractionMode
  readonly model?: string
  readonly effort?: string
}):
  | {
      mode: 'default' | 'plan'
      settings: {
        model: string
        reasoning_effort: string
        developer_instructions: string
      }
    }
  | undefined {
  if (input.interactionMode === undefined) {
    return undefined
  }
  const model = normalizeCodexModelSlug(input.model) ?? 'gpt-5.3-codex'
  return {
    mode: input.interactionMode,
    settings: {
      model,
      reasoning_effort: input.effort ?? 'medium',
      developer_instructions:
        input.interactionMode === 'plan'
          ? CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS
          : CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
    },
  }
}

export function toCodexUserInputAnswer(value: unknown): CodexUserInputAnswer {
  if (typeof value === 'string') {
    return { answers: [value] }
  }

  if (Array.isArray(value)) {
    const answers = value.filter((entry): entry is string => typeof entry === 'string')
    return { answers }
  }

  if (value && typeof value === 'object') {
    const maybeAnswers = (value as { answers?: unknown }).answers
    if (Array.isArray(maybeAnswers)) {
      const answers = maybeAnswers.filter((entry): entry is string => typeof entry === 'string')
      return { answers }
    }
  }

  throw new Error('User input answers must be strings or arrays of strings.')
}

export function toCodexUserInputAnswers(
  answers: ProviderUserInputAnswers
): Record<string, CodexUserInputAnswer> {
  return Object.fromEntries(
    Object.entries(answers).map(([questionId, value]) => [
      questionId,
      toCodexUserInputAnswer(value),
    ])
  )
}

export function classifyCodexStderrLine(rawLine: string): { message: string } | null {
  const line = rawLine.replaceAll(ANSI_ESCAPE_REGEX, '').trim()
  if (!line) {
    return null
  }

  const match = line.match(CODEX_STDERR_LOG_REGEX)
  if (match) {
    const level = match[1]
    if (level && level !== 'ERROR') {
      return null
    }

    const isBenignError = BENIGN_ERROR_LOG_SNIPPETS.some(snippet => line.includes(snippet))
    if (isBenignError) {
      return null
    }
  }

  return { message: line }
}

export function isRecoverableThreadResumeError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  if (!message.includes('thread/resume')) {
    return false
  }

  return RECOVERABLE_THREAD_RESUME_ERROR_SNIPPETS.some(snippet => message.includes(snippet))
}

export function brandIfNonEmpty<T extends string>(
  value: string | undefined,
  maker: (value: string) => T
): T | undefined {
  const normalized = value?.trim()
  return normalized?.length ? maker(normalized) : undefined
}

export function normalizeProviderThreadId(value: string | undefined): string | undefined {
  return brandIfNonEmpty(value, normalized => normalized)
}

export function assertSupportedCodexCliVersion(input: {
  readonly binaryPath: string
  readonly cwd: string
  readonly homePath?: string
}): void {
  const result = spawnSync(input.binaryPath, ['--version'], {
    cwd: input.cwd,
    env: {
      ...process.env,
      ...(input.homePath ? { CODEX_HOME: input.homePath } : {}),
    },
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: CODEX_VERSION_CHECK_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  })

  if (result.error) {
    const lower = result.error.message.toLowerCase()
    if (
      lower.includes('enoent') ||
      lower.includes('command not found') ||
      lower.includes('not found')
    ) {
      throw new Error(`Codex CLI (${input.binaryPath}) is not installed or not executable.`)
    }
    throw new Error(
      `Failed to execute Codex CLI version check: ${result.error.message || String(result.error)}`
    )
  }

  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  if (result.status !== 0) {
    const detail = stderr.trim() || stdout.trim() || `Command exited with code ${result.status}.`
    throw new Error(`Codex CLI version check failed. ${detail}`)
  }

  const parsedVersion = parseCodexCliVersion(`${stdout}\n${stderr}`)
  if (parsedVersion && !isCodexCliVersionSupported(parsedVersion)) {
    throw new Error(formatCodexCliUpgradeMessage(parsedVersion))
  }
}

export function readResumeCursorThreadId(resumeCursor: unknown): string | undefined {
  if (!resumeCursor || typeof resumeCursor !== 'object' || Array.isArray(resumeCursor)) {
    return undefined
  }
  const rawThreadId = (resumeCursor as Record<string, unknown>).threadId
  return typeof rawThreadId === 'string' ? normalizeProviderThreadId(rawThreadId) : undefined
}

export function readResumeThreadId(input: {
  readonly resumeCursor?: unknown
  readonly threadId?: ThreadId
  readonly runtimeMode?: RuntimeMode
}): string | undefined {
  return readResumeCursorThreadId(input.resumeCursor)
}

export function toTurnId(value: string | undefined): TurnId | undefined {
  return brandIfNonEmpty(value, TurnId.makeUnsafe)
}

export function toProviderItemId(value: string | undefined): ProviderItemId | undefined {
  return brandIfNonEmpty(value, ProviderItemId.makeUnsafe)
}

export function readObjectField(value: unknown, key?: string): Record<string, unknown> | undefined {
  const target =
    key === undefined
      ? value
      : value && typeof value === 'object'
        ? (value as Record<string, unknown>)[key]
        : undefined

  if (!target || typeof target !== 'object') {
    return undefined
  }

  return target as Record<string, unknown>
}

export function readArrayField(value: unknown, key?: string): unknown[] | undefined {
  const target =
    key === undefined
      ? value
      : value && typeof value === 'object'
        ? (value as Record<string, unknown>)[key]
        : undefined
  return Array.isArray(target) ? target : undefined
}

export function readStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === 'string' ? candidate : undefined
}

export function readBooleanField(value: unknown, key: string): boolean | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === 'boolean' ? candidate : undefined
}

export function isServerRequestMessage(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.method === 'string' &&
    (typeof candidate.id === 'string' || typeof candidate.id === 'number')
  )
}

export function isServerNotificationMessage(value: unknown): value is JsonRpcNotification {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return typeof candidate.method === 'string' && !('id' in candidate)
}

export function isResponseMessage(value: unknown): value is JsonRpcResponse {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  const hasId = typeof candidate.id === 'string' || typeof candidate.id === 'number'
  const hasMethod = typeof candidate.method === 'string'
  return hasId && !hasMethod
}

export function readRouteFields(params: unknown): {
  turnId?: TurnId
  itemId?: ProviderItemId
} {
  const route: {
    turnId?: TurnId
    itemId?: ProviderItemId
  } = {}

  const turnId = toTurnId(
    readStringField(params, 'turnId') ?? readStringField(readObjectField(params, 'turn'), 'id')
  )
  const itemId = toProviderItemId(
    readStringField(params, 'itemId') ?? readStringField(readObjectField(params, 'item'), 'id')
  )

  if (turnId) {
    route.turnId = turnId
  }

  if (itemId) {
    route.itemId = itemId
  }

  return route
}

export function readProviderConversationId(params: unknown): string | undefined {
  return (
    readStringField(params, 'threadId') ??
    readStringField(readObjectField(params, 'thread'), 'id') ??
    readStringField(params, 'conversationId')
  )
}

export function shouldSuppressChildConversationNotification(method: string): boolean {
  return (
    method === 'thread/started' ||
    method === 'thread/status/changed' ||
    method === 'thread/archived' ||
    method === 'thread/unarchived' ||
    method === 'thread/closed' ||
    method === 'thread/compacted' ||
    method === 'thread/name/updated' ||
    method === 'thread/tokenUsage/updated' ||
    method === 'turn/started' ||
    method === 'turn/completed' ||
    method === 'turn/aborted' ||
    method === 'turn/plan/updated' ||
    method === 'item/plan/delta'
  )
}

export function requestKindForMethod(method: string): ProviderRequestKind | undefined {
  if (method === 'item/commandExecution/requestApproval') {
    return 'command'
  }

  if (method === 'item/fileRead/requestApproval') {
    return 'file-read'
  }

  if (method === 'item/fileChange/requestApproval') {
    return 'file-change'
  }

  return undefined
}
