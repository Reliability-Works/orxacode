import { ThreadId, type ProviderRuntimeEvent } from '@orxa-code/contracts'

type JsonRecord = Record<string, unknown>

export interface ClaudeChildThreadDescriptor {
  readonly providerChildThreadId: string
  readonly childThreadId: ThreadId
  readonly agentLabel: string | null
  readonly prompt: string | null
  readonly description: string | null
  readonly model: string | null
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toChildThreadId(parentThreadId: ThreadId, providerChildThreadId: string): ThreadId {
  return ThreadId.makeUnsafe(`claude-child:${parentThreadId}:${providerChildThreadId}`)
}

export function claudeChildThreadId(
  parentThreadId: ThreadId,
  providerChildThreadId: string
): ThreadId {
  return toChildThreadId(parentThreadId, providerChildThreadId)
}

export function readClaudeChildThreadDescriptor(
  parentThreadId: ThreadId,
  event: ProviderRuntimeEvent
): ClaudeChildThreadDescriptor | null {
  if (
    event.provider !== 'claudeAgent' ||
    (event.type !== 'item.started' &&
      event.type !== 'item.updated' &&
      event.type !== 'item.completed') ||
    event.payload.itemType !== 'collab_agent_tool_call'
  ) {
    return null
  }
  const providerChildThreadId = event.itemId ? String(event.itemId) : null
  if (!providerChildThreadId) {
    return null
  }
  const payloadRecord = asRecord(event.payload.data)
  const input = asRecord(payloadRecord?.input) ?? asRecord(payloadRecord?.item) ?? payloadRecord
  if (!input) {
    return null
  }
  return {
    providerChildThreadId,
    childThreadId: toChildThreadId(parentThreadId, providerChildThreadId),
    agentLabel:
      asString(input.subagent_type) ??
      asString(input.subagentType) ??
      asString(input.agent_type) ??
      asString(input.agentType) ??
      asString(input.agent_label) ??
      asString(input.agentLabel) ??
      asString(input.name),
    prompt: asString(input.prompt),
    description: asString(input.description),
    model: asString(input.model),
  }
}

function rawPayload(event: ProviderRuntimeEvent): JsonRecord | null {
  return event.raw?.source === 'claude.sdk.message' || event.raw?.source === 'claude.sdk.permission'
    ? asRecord(event.raw.payload)
    : null
}

export function readClaudeChildProviderThreadIdForEvent(
  event: ProviderRuntimeEvent
): string | null {
  if (event.provider !== 'claudeAgent') {
    return null
  }
  const payload = rawPayload(event)
  if (!payload) {
    return null
  }

  if (
    event.type === 'task.started' ||
    event.type === 'task.progress' ||
    event.type === 'task.completed' ||
    event.type === 'tool.progress'
  ) {
    return asString(payload.tool_use_id) ?? asString(payload.parent_tool_use_id)
  }

  return asString(payload.parent_tool_use_id)
}
