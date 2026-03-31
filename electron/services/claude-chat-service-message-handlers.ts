import { randomUUID } from 'node:crypto'
import type {
  ElicitationRequest,
  Options as ClaudeQueryOptions,
  PermissionResult,
  SDKAssistantMessage,
  SDKMessage,
  SessionMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type {
  ClaudeChatApprovalRequest,
  ClaudeChatNotification,
  ClaudeChatState,
  ClaudeChatUserInputRequest,
} from '@shared/ipc'
import type {
  ClaudeSessionRuntime,
  PendingApproval,
  PendingUserInput,
} from './claude-chat-service-types'

export type ClaudeChatHandlerContext = {
  emitState: (payload: ClaudeChatState) => void
  emitNotification: (payload: ClaudeChatNotification) => void
  emitApprovalRequest: (payload: ClaudeChatApprovalRequest) => void
  emitUserInputRequest: (payload: ClaudeChatUserInputRequest) => void
  pendingApprovals: Map<string, PendingApproval>
  pendingUserInputs: Map<string, PendingUserInput>
  readClaudeResumeCursor: (resumeCursor: unknown) => string | undefined
  upsertProviderBinding: (
    runtime: ClaudeSessionRuntime,
    input: {
      status?: 'starting' | 'running' | 'stopped' | 'error'
      resumeCursor?: unknown | null
      runtimePayload?: Record<string, unknown> | null
    }
  ) => void
}

function extractTextFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map(entry => extractTextFromUnknown(entry)).filter(Boolean).join('')
  }
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  if (typeof record.text === 'string') return record.text
  if (typeof record.content === 'string') return record.content
  if (Array.isArray(record.content)) {
    return record.content.map(entry => extractTextFromUnknown(entry)).filter(Boolean).join('')
  }
  return Object.values(record).map(entry => extractTextFromUnknown(entry)).filter(Boolean).join('')
}

function extractTextBlocks(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : []
  if (Array.isArray(value)) return value.flatMap(entry => extractTextBlocks(entry))
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const type = typeof record.type === 'string' ? record.type : null
  if (type === 'tool_use' || type === 'tool_result') return []
  if (type === 'text' && typeof record.text === 'string') {
    return record.text.trim() ? [record.text] : []
  }
  if (Array.isArray(record.content)) return record.content.flatMap(entry => extractTextBlocks(entry))
  return !type && typeof record.text === 'string' && record.text.trim() ? [record.text] : []
}

export function extractAssistantText(message: SDKAssistantMessage) {
  const content = (message.message as Record<string, unknown> | undefined)?.content
  const textBlocks = extractTextBlocks(content)
  return textBlocks.length > 0
    ? textBlocks.join('').trim()
    : extractTextBlocks(message.message).join('').trim()
}

export function extractPartialAssistantText(message: SDKMessage) {
  if (message.type !== 'stream_event') return ''
  const event = message.event as Record<string, unknown> | undefined
  if (!event || event.type !== 'content_block_delta') return ''
  const delta = event.delta as Record<string, unknown> | undefined
  return delta && typeof delta.text === 'string' ? delta.text : ''
}

export function buildHistoryMessages(messages: SessionMessage[]) {
  return messages.map((message, index) => ({
    id: message.uuid,
    role: message.type === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: extractTextFromUnknown(message.message).trim(),
    timestamp: index,
    sessionId: message.session_id,
  }))
}

export function extractQuestionOptionsFromSchema(schema: Record<string, unknown> | undefined) {
  const properties =
    schema && typeof schema === 'object' && !Array.isArray(schema)
      ? ((schema.properties as Record<string, unknown> | undefined) ?? {})
      : {}
  for (const value of Object.values(properties)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const record = value as Record<string, unknown>
    const enumValues = Array.isArray(record.enum)
      ? record.enum.filter(
          (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
        )
      : []
    if (enumValues.length > 0) {
      return enumValues.map(entry => ({ label: entry, value: entry }))
    }
    const options = (Array.isArray(record.oneOf) ? record.oneOf : [])
      .map(entry => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
        const option = entry as Record<string, unknown>
        const value =
          typeof option.const === 'string'
            ? option.const
            : typeof option.value === 'string'
              ? option.value
              : undefined
        const label = typeof option.title === 'string' ? option.title : value
        return label && value ? { label, value } : null
      })
      .filter((entry): entry is { label: string; value: string } => entry !== null)
    if (options.length > 0) {
      return options
    }
  }
  return undefined
}

export function isClaudeInterruptedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  return (
    normalized.includes('all fibers interrupted without error') ||
    normalized.includes('request was aborted') ||
    normalized.includes('interrupted by user') ||
    normalized.includes('interrupt') ||
    normalized.includes('aborted')
  )
}

export function buildElicitationHandler(
  context: ClaudeChatHandlerContext,
  sessionKey: string,
  turnId: string
) {
  return async (request: ElicitationRequest) =>
    await new Promise<{
      action: 'accept' | 'decline' | 'cancel'
      content?: Record<string, unknown>
    }>(resolve => {
      const requestId = randomUUID()
      context.pendingUserInputs.set(requestId, { sessionKey, turnId, request, resolve })
      context.emitUserInputRequest({
        id: requestId,
        sessionKey,
        threadId: sessionKey,
        turnId,
        message: request.message,
        mode: request.mode,
        server: request.serverName,
        elicitationId: request.elicitationId,
        options: extractQuestionOptionsFromSchema(request.requestedSchema),
      })
    })
}

export function buildCanUseToolHandler(
  context: ClaudeChatHandlerContext,
  sessionKey: string,
  turnId: string
): NonNullable<ClaudeQueryOptions['canUseTool']> {
  return async (
    toolName: string,
    toolInput: Record<string, unknown>,
    callbackOptions: Parameters<NonNullable<ClaudeQueryOptions['canUseTool']>>[2]
  ) =>
    await new Promise<PermissionResult>(resolve => {
      const requestId = randomUUID()
      context.pendingApprovals.set(requestId, {
        sessionKey,
        turnId,
        itemId: callbackOptions.toolUseID,
        toolName,
        resolve,
      })
      const rawCommand = toolInput.command ?? toolInput.cmd
      const command =
        typeof rawCommand === 'string'
          ? rawCommand
          : Array.isArray(rawCommand)
            ? rawCommand.map(entry => String(entry)).join(' ')
            : undefined
      context.emitApprovalRequest({
        id: requestId,
        sessionKey,
        threadId: sessionKey,
        turnId,
        itemId: callbackOptions.toolUseID,
        toolName,
        reason: command ? `${toolName}: ${command}` : toolName,
        command,
        availableDecisions: ['accept', 'acceptForSession', 'decline', 'cancel'],
      } satisfies ClaudeChatApprovalRequest)
    })
}

export function finalizeTurnSuccess(
  context: ClaudeChatHandlerContext,
  runtime: ClaudeSessionRuntime,
  turnId: string
) {
  const sessionKey = runtime.state.sessionKey
  runtime.state = { ...runtime.state, status: 'connected', activeTurnId: null }
  context.upsertProviderBinding(runtime, { status: 'running' })
  context.emitState(runtime.state)
  context.emitNotification({
    sessionKey,
    method: 'thinking/stopped',
    params: { turnId, timestamp: Date.now() },
  })
  context.emitNotification({
    sessionKey,
    method: 'turn/completed',
    params: { turnId, timestamp: Date.now() },
  })
}

export function finalizeTurnError(
  context: ClaudeChatHandlerContext,
  runtime: ClaudeSessionRuntime,
  turnId: string,
  error: unknown
) {
  const sessionKey = runtime.state.sessionKey
  if (isClaudeInterruptedError(error)) {
    runtime.state = {
      ...runtime.state,
      status: 'connected',
      activeTurnId: null,
      lastError: undefined,
    }
    context.upsertProviderBinding(runtime, { status: 'running' })
    context.emitState(runtime.state)
    context.emitNotification({
      sessionKey,
      method: 'thinking/stopped',
      params: { turnId, timestamp: Date.now() },
    })
    context.emitNotification({
      sessionKey,
      method: 'turn/completed',
      params: { turnId, interrupted: true, timestamp: Date.now() },
    })
    return
  }

  runtime.state = {
    ...runtime.state,
    status: 'error',
    activeTurnId: null,
    lastError: error instanceof Error ? error.message : String(error),
  }
  context.upsertProviderBinding(runtime, { status: 'error' })
  context.emitState(runtime.state)
  context.emitNotification({
    sessionKey,
    method: 'thinking/stopped',
    params: { turnId, timestamp: Date.now() },
  })
  context.emitNotification({
    sessionKey,
    method: 'turn/error',
    params: {
      turnId,
      message: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
    },
  })
  throw error
}
