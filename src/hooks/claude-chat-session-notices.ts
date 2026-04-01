import type { ClaudeChatSessionEventContext } from './claude-chat-session-events'
import { nextClaudeMessageId } from './claude-chat-session-utils'

function readString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function readNumber(value: unknown) {
  return typeof value === 'number' ? value : undefined
}

export function appendClaudeNotice(
  context: ClaudeChatSessionEventContext,
  input: {
    label: string
    detail?: string
    tone?: 'info' | 'error'
    timestamp?: number
  }
) {
  context.updateClaudeChatMessages(context.sessionKey, messages => [
    ...messages,
    {
      id: nextClaudeMessageId(context.sessionKey),
      kind: 'notice',
      label: input.label,
      detail: input.detail,
      tone: input.tone,
      timestamp: input.timestamp ?? Date.now(),
    },
  ])
}

export function appendClaudeRetryNotice(
  context: ClaudeChatSessionEventContext,
  params: Record<string, unknown>
) {
  const attempt = readNumber(params.attempt)
  const maxRetries = readNumber(params.maxRetries)
  const retryDelayMs = readNumber(params.retryDelayMs)
  const error = readString(params.error)
  const detail = [
    attempt && maxRetries ? `Attempt ${attempt} of ${maxRetries}` : null,
    typeof retryDelayMs === 'number' ? `Retrying in ${retryDelayMs}ms` : null,
    error ?? null,
  ]
    .filter(Boolean)
    .join(' · ')
  appendClaudeNotice(context, {
    label: 'Claude retrying',
    detail: detail || undefined,
    tone: 'info',
    timestamp: readNumber(params.timestamp),
  })
}

export function appendClaudeResultNotice(
  context: ClaudeChatSessionEventContext,
  params: Record<string, unknown>
) {
  const errors = Array.isArray(params.errors)
    ? params.errors.filter(
        (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
      )
    : []
  const result = readString(params.result)
  const subtype = readString(params.subtype)
  const isError = params.isError === true
  if (!isError && errors.length === 0) {
    return
  }
  const detail = [...errors, result].filter(Boolean).join(' · ')
  const label = /blocked|denied|not[_ -]?allowed/i.test(`${subtype ?? ''} ${detail}`)
    ? 'Claude blocked'
    : 'Claude result error'
  appendClaudeNotice(context, {
    label,
    detail: detail || subtype,
    tone: 'error',
    timestamp: readNumber(params.timestamp),
  })
}

export function appendClaudeTaskStartedNotice(
  context: ClaudeChatSessionEventContext,
  params: Record<string, unknown>
) {
  appendClaudeNotice(context, {
    label: 'Subagent started',
    detail: readString(params.description),
    tone: 'info',
    timestamp: readNumber(params.timestamp),
  })
}

export function appendClaudeTaskProgressNotice(
  context: ClaudeChatSessionEventContext,
  params: Record<string, unknown>
) {
  const summary = readString(params.summary)
  if (!summary?.trim()) {
    return
  }
  appendClaudeNotice(context, {
    label: 'Subagent progress',
    detail: summary,
    tone: 'info',
    timestamp: readNumber(params.timestamp),
  })
}

export function appendClaudeTaskCompletedNotice(
  context: ClaudeChatSessionEventContext,
  params: Record<string, unknown>
) {
  appendClaudeNotice(context, {
    label:
      typeof params.status === 'string' && params.status !== 'completed'
        ? 'Subagent failed'
        : 'Subagent completed',
    detail: readString(params.summary) || readString(params.outputFile),
    tone:
      typeof params.status === 'string' && params.status !== 'completed'
        ? 'error'
        : 'info',
    timestamp: readNumber(params.timestamp),
  })
}

export function appendClaudeApprovalNotice(
  context: ClaudeChatSessionEventContext,
  payload: { reason?: string; toolName: string }
) {
  appendClaudeNotice(context, {
    label: 'Claude needs permission',
    detail: payload.reason || payload.toolName,
    tone: 'info',
  })
}

export function appendClaudeUserInputNotice(
  context: ClaudeChatSessionEventContext,
  payload: { message: string }
) {
  appendClaudeNotice(context, {
    label: 'Claude needs input',
    detail: payload.message,
    tone: 'info',
  })
}
