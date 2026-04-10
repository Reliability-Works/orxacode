import { ThreadId, type ProviderRuntimeEvent } from '@orxa-code/contracts'
import { asPlainRecord, asTrimmedString } from '@orxa-code/shared/records'

export interface ClaudeChildThreadDescriptor {
  readonly providerChildThreadId: string
  readonly childThreadId: ThreadId
  readonly agentLabel: string | null
  readonly prompt: string | null
  readonly description: string | null
  readonly model: string | null
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
  const payloadRecord = asPlainRecord(event.payload.data)
  const input =
    asPlainRecord(payloadRecord?.input) ?? asPlainRecord(payloadRecord?.item) ?? payloadRecord
  if (!input) {
    return null
  }
  return {
    providerChildThreadId,
    childThreadId: toChildThreadId(parentThreadId, providerChildThreadId),
    agentLabel:
      asTrimmedString(input.subagent_type) ??
      asTrimmedString(input.subagentType) ??
      asTrimmedString(input.agent_type) ??
      asTrimmedString(input.agentType) ??
      asTrimmedString(input.agent_label) ??
      asTrimmedString(input.agentLabel) ??
      asTrimmedString(input.name),
    prompt: asTrimmedString(input.prompt),
    description: asTrimmedString(input.description),
    model: asTrimmedString(input.model),
  }
}

function rawPayload(event: ProviderRuntimeEvent): Record<string, unknown> | null {
  return event.raw?.source === 'claude.sdk.message' || event.raw?.source === 'claude.sdk.permission'
    ? asPlainRecord(event.raw.payload)
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
    return asTrimmedString(payload.tool_use_id) ?? asTrimmedString(payload.parent_tool_use_id)
  }

  return asTrimmedString(payload.parent_tool_use_id)
}
