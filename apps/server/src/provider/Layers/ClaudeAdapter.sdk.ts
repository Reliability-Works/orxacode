/**
 * Claude SDK helper utilities — part two of the stateless helper split.
 *
 * Contains SDK message parsers, tool-result extractors, session-config
 * derivation, approval-result shaping, and turn-completion payload helpers.
 * Split from `ClaudeAdapter.pure.ts` to keep each module under the
 * maintainability budget.
 *
 * @module ClaudeAdapter.sdk
 */
import type {
  CanUseTool,
  Options as ClaudeQueryOptions,
  PermissionResult,
  SDKMessage,
  SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk'
import {
  type CanonicalItemType,
  ProviderItemId,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ThreadTokenUsageSnapshot,
  ThreadId,
  type UserInputQuestion,
  type ClaudeCodeEffort,
} from '@orxa-code/contracts'
import { resolveApiModelId, resolveEffort } from '@orxa-code/shared/model'

import {
  type ProviderAdapterError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
} from '../Errors.ts'
import { makeRequestError } from './ProviderAdapter.shared.ts'
import { getClaudeModelCapabilities } from './ClaudeProvider.ts'
import {
  CLAUDE_SETTING_SOURCES,
  getEffectiveClaudeCodeEffort,
  isInterruptedResult,
  maxClaudeContextWindowFromModelUsage,
  normalizeClaudeTokenUsage,
  resultErrorsText,
  toMessage,
} from './ClaudeAdapter.pure.ts'
import {
  type ClaudeModelSelection,
  type ClaudeSessionContext,
  type ClaudeSessionModelRuntimeConfig,
  type ClaudeTextStreamKind,
  type ClaudeToolResultStreamKind,
  type PendingApproval,
  type ProviderRuntimeTurnStatus,
  type ProviderSession,
  PROVIDER,
} from './ClaudeAdapter.types.ts'

export function turnStatusFromResult(result: SDKResultMessage): ProviderRuntimeTurnStatus {
  if (result.subtype === 'success') {
    return 'completed'
  }

  const errors = resultErrorsText(result)
  if (isInterruptedResult(result)) {
    return 'interrupted'
  }
  if (errors.includes('cancel')) {
    return 'cancelled'
  }
  return 'failed'
}

export function streamKindFromDeltaType(deltaType: string): ClaudeTextStreamKind {
  return deltaType.includes('thinking') ? 'reasoning_text' : 'assistant_text'
}

export function nativeProviderRefs(
  _context: ClaudeSessionContext,
  options?: {
    readonly providerItemId?: string | undefined
  }
): NonNullable<ProviderRuntimeEvent['providerRefs']> {
  if (options?.providerItemId) {
    return {
      providerItemId: ProviderItemId.makeUnsafe(options.providerItemId),
    }
  }
  return {}
}

export function extractAssistantTextBlocks(message: SDKMessage): Array<string> {
  if (message.type !== 'assistant') {
    return []
  }

  const content = (message.message as { content?: unknown } | undefined)?.content
  if (!Array.isArray(content)) {
    return []
  }

  const fragments: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') {
      continue
    }
    const candidate = block as { type?: unknown; text?: unknown }
    if (
      candidate.type === 'text' &&
      typeof candidate.text === 'string' &&
      candidate.text.length > 0
    ) {
      fragments.push(candidate.text)
    }
  }

  return fragments
}

export function extractContentBlockText(block: unknown): string {
  if (!block || typeof block !== 'object') {
    return ''
  }

  const candidate = block as { type?: unknown; text?: unknown }
  return candidate.type === 'text' && typeof candidate.text === 'string' ? candidate.text : ''
}

export function extractTextContent(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(entry => extractTextContent(entry)).join('')
  }

  if (!value || typeof value !== 'object') {
    return ''
  }

  const record = value as {
    text?: unknown
    content?: unknown
  }

  if (typeof record.text === 'string') {
    return record.text
  }

  return extractTextContent(record.content)
}

export function extractExitPlanModePlan(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const record = value as {
    plan?: unknown
  }
  return typeof record.plan === 'string' && record.plan.trim().length > 0
    ? record.plan.trim()
    : undefined
}

export function exitPlanCaptureKey(input: {
  readonly toolUseId?: string | undefined
  readonly planMarkdown: string
}): string {
  return input.toolUseId && input.toolUseId.length > 0
    ? `tool:${input.toolUseId}`
    : `plan:${input.planMarkdown}`
}

export function tryParseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

export function toolInputFingerprint(input: Record<string, unknown>): string | undefined {
  try {
    return JSON.stringify(input)
  } catch {
    return undefined
  }
}

export function toolResultStreamKind(
  itemType: CanonicalItemType
): ClaudeToolResultStreamKind | undefined {
  switch (itemType) {
    case 'command_execution':
      return 'command_output'
    case 'file_change':
      return 'file_change_output'
    default:
      return undefined
  }
}

export function toolResultBlocksFromUserMessage(message: SDKMessage): Array<{
  readonly toolUseId: string
  readonly block: Record<string, unknown>
  readonly text: string
  readonly isError: boolean
}> {
  if (message.type !== 'user') {
    return []
  }

  const content = (message.message as { content?: unknown } | undefined)?.content
  if (!Array.isArray(content)) {
    return []
  }

  const blocks: Array<{
    readonly toolUseId: string
    readonly block: Record<string, unknown>
    readonly text: string
    readonly isError: boolean
  }> = []

  for (const entry of content) {
    if (!entry || typeof entry !== 'object') {
      continue
    }

    const block = entry as Record<string, unknown>
    if (block.type !== 'tool_result') {
      continue
    }

    const toolUseId = typeof block.tool_use_id === 'string' ? block.tool_use_id : undefined
    if (!toolUseId) {
      continue
    }

    blocks.push({
      toolUseId,
      block,
      text: extractTextContent(block.content),
      isError: block.is_error === true,
    })
  }

  return blocks
}

export function toSessionError(
  threadId: ThreadId,
  cause: unknown
): ProviderAdapterSessionNotFoundError | ProviderAdapterSessionClosedError | undefined {
  const normalized = toMessage(cause, '').toLowerCase()
  if (normalized.includes('unknown session') || normalized.includes('not found')) {
    return new ProviderAdapterSessionNotFoundError({
      provider: PROVIDER,
      threadId,
      cause,
    })
  }
  if (normalized.includes('closed')) {
    return new ProviderAdapterSessionClosedError({
      provider: PROVIDER,
      threadId,
      cause,
    })
  }
  return undefined
}

export function toRequestError(
  threadId: ThreadId,
  method: string,
  cause: unknown
): ProviderAdapterError {
  return makeRequestError({
    provider: PROVIDER,
    threadId,
    method,
    cause,
    toMessage,
    toSessionError,
  })
}

export function sdkMessageType(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const record = value as { type?: unknown }
  return typeof record.type === 'string' ? record.type : undefined
}

export function sdkMessageSubtype(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const record = value as { subtype?: unknown }
  return typeof record.subtype === 'string' ? record.subtype : undefined
}

export function sdkNativeMethod(message: SDKMessage): string {
  const subtype = sdkMessageSubtype(message)
  if (subtype) {
    return `claude/${message.type}/${subtype}`
  }

  if (message.type === 'stream_event') {
    const streamType = sdkMessageType(message.event)
    if (streamType) {
      const deltaType =
        streamType === 'content_block_delta'
          ? sdkMessageType((message.event as { delta?: unknown }).delta)
          : undefined
      if (deltaType) {
        return `claude/${message.type}/${streamType}/${deltaType}`
      }
      return `claude/${message.type}/${streamType}`
    }
  }

  return `claude/${message.type}`
}

export function sdkNativeItemId(message: SDKMessage): string | undefined {
  if (message.type === 'assistant') {
    const maybeId = (message.message as { id?: unknown }).id
    if (typeof maybeId === 'string') {
      return maybeId
    }
    return undefined
  }

  if (message.type === 'user') {
    return toolResultBlocksFromUserMessage(message)[0]?.toolUseId
  }

  if (message.type === 'stream_event') {
    const event = message.event as {
      type?: unknown
      content_block?: { id?: unknown }
    }
    if (event.type === 'content_block_start' && typeof event.content_block?.id === 'string') {
      return event.content_block.id
    }
  }

  return undefined
}

export function deriveSessionModelRuntimeConfig(input: {
  readonly runtimeMode: ProviderSession['runtimeMode']
  readonly modelSelection: ClaudeModelSelection | undefined
}): ClaudeSessionModelRuntimeConfig {
  const caps = getClaudeModelCapabilities(input.modelSelection?.model)
  const apiModelId = input.modelSelection ? resolveApiModelId(input.modelSelection) : undefined
  const effort = (resolveEffort(caps, input.modelSelection?.options?.effort) ??
    null) as ClaudeCodeEffort | null
  const fastMode = input.modelSelection?.options?.fastMode === true && caps.supportsFastMode
  const thinking =
    typeof input.modelSelection?.options?.thinking === 'boolean' && caps.supportsThinkingToggle
      ? input.modelSelection.options.thinking
      : undefined
  return {
    apiModelId,
    effectiveEffort: getEffectiveClaudeCodeEffort(effort),
    fastMode,
    permissionMode: input.runtimeMode === 'full-access' ? 'bypassPermissions' : undefined,
    settings: {
      ...(typeof thinking === 'boolean' ? { alwaysThinkingEnabled: thinking } : {}),
      ...(fastMode ? { fastMode: true } : {}),
    },
  }
}

export function buildSessionQueryOptions(input: {
  readonly cwd: string | undefined
  readonly canUseTool: CanUseTool
  readonly claudeBinaryPath: string
  readonly existingResumeSessionId: string | undefined
  readonly newSessionId: string | undefined
  readonly runtime: ClaudeSessionModelRuntimeConfig
}): ClaudeQueryOptions {
  return {
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.runtime.apiModelId ? { model: input.runtime.apiModelId } : {}),
    pathToClaudeCodeExecutable: input.claudeBinaryPath,
    settingSources: [...CLAUDE_SETTING_SOURCES],
    ...(input.runtime.effectiveEffort ? { effort: input.runtime.effectiveEffort } : {}),
    ...(input.runtime.permissionMode ? { permissionMode: input.runtime.permissionMode } : {}),
    ...(input.runtime.permissionMode === 'bypassPermissions'
      ? { allowDangerouslySkipPermissions: true }
      : {}),
    ...(Object.keys(input.runtime.settings).length > 0 ? { settings: input.runtime.settings } : {}),
    ...(input.existingResumeSessionId ? { resume: input.existingResumeSessionId } : {}),
    ...(input.newSessionId ? { sessionId: input.newSessionId } : {}),
    includePartialMessages: true,
    canUseTool: input.canUseTool,
    env: process.env,
    ...(input.cwd ? { additionalDirectories: [input.cwd] } : {}),
  }
}

export function parseAskUserQuestions(
  toolInput: Record<string, unknown>
): Array<UserInputQuestion> {
  return (Array.isArray(toolInput.questions) ? toolInput.questions : []).map(
    (q: Record<string, unknown>, idx: number) => ({
      id: typeof q.header === 'string' ? q.header : `q-${idx}`,
      header: typeof q.header === 'string' ? q.header : `Question ${idx + 1}`,
      question: typeof q.question === 'string' ? q.question : '',
      options: Array.isArray(q.options)
        ? q.options.map((opt: Record<string, unknown>) => ({
            label: typeof opt.label === 'string' ? opt.label : '',
            description: typeof opt.description === 'string' ? opt.description : '',
          }))
        : [],
      multiSelect: typeof q.multiSelect === 'boolean' ? q.multiSelect : false,
    })
  )
}

export function resolveApprovalDecision(
  decision: ProviderApprovalDecision,
  pendingApproval: PendingApproval,
  toolInput: Parameters<CanUseTool>[1]
): PermissionResult {
  return decision === 'accept' || decision === 'acceptForSession'
    ? {
        behavior: 'allow',
        updatedInput: toolInput,
        ...(decision === 'acceptForSession' && pendingApproval.suggestions
          ? { updatedPermissions: [...pendingApproval.suggestions] }
          : {}),
      }
    : {
        behavior: 'deny',
        message:
          decision === 'cancel'
            ? 'User cancelled tool execution.'
            : 'User declined tool execution.',
      }
}

export function buildTurnCompletionPayload(
  status: ProviderRuntimeTurnStatus,
  errorMessage?: string,
  result?: SDKResultMessage
) {
  return {
    state: status,
    ...(result?.stop_reason !== undefined ? { stopReason: result.stop_reason } : {}),
    ...(result?.usage ? { usage: result.usage } : {}),
    ...(result?.modelUsage ? { modelUsage: result.modelUsage } : {}),
    ...(typeof result?.total_cost_usd === 'number' ? { totalCostUsd: result.total_cost_usd } : {}),
    ...(errorMessage ? { errorMessage } : {}),
  }
}

export function applyResultUsageSnapshot(
  context: ClaudeSessionContext,
  result?: SDKResultMessage
): ThreadTokenUsageSnapshot | undefined {
  const resultUsage =
    result?.usage && typeof result.usage === 'object' ? { ...result.usage } : undefined
  const resultContextWindow = maxClaudeContextWindowFromModelUsage(result?.modelUsage)
  if (resultContextWindow !== undefined) {
    context.lastKnownContextWindow = resultContextWindow
  }

  const accumulatedSnapshot = normalizeClaudeTokenUsage(
    resultUsage,
    resultContextWindow ?? context.lastKnownContextWindow
  )
  const lastGoodUsage = context.lastKnownTokenUsage
  const maxTokens = resultContextWindow ?? context.lastKnownContextWindow
  return lastGoodUsage
    ? {
        ...lastGoodUsage,
        ...(typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0
          ? { maxTokens }
          : {}),
        ...(accumulatedSnapshot && accumulatedSnapshot.usedTokens > lastGoodUsage.usedTokens
          ? { totalProcessedTokens: accumulatedSnapshot.usedTokens }
          : {}),
      }
    : accumulatedSnapshot
}
