import { ThreadId, TurnId } from '@orxa-code/contracts'

type JsonRecord = Record<string, unknown>

export interface CodexChildRoute {
  readonly parentTurnId: TurnId
  readonly childThreadId: ThreadId
}

export interface CodexChildThreadDescriptor {
  readonly providerChildThreadId: string
  readonly childThreadId: ThreadId
  readonly agentLabel: string | null
  readonly prompt: string | null
}

function asObject(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' ? (value as JsonRecord) : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

function readCollabItem(value: unknown): JsonRecord | undefined {
  const payload = asObject(value)
  const item = asObject(payload?.item)
  const source = item ?? payload
  if (!source) {
    return undefined
  }
  const itemType = asString(source.type) ?? asString(source.kind)
  return itemType === 'collabAgentToolCall' ? source : undefined
}

function firstNonEmptyString(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    const trimmed = asString(candidate)?.trim()
    if (trimmed) {
      return trimmed
    }
  }
  return null
}

function toChildThreadId(parentThreadId: ThreadId, providerChildThreadId: string): ThreadId {
  return ThreadId.makeUnsafe(`codex-child:${parentThreadId}:${providerChildThreadId}`)
}

export function codexChildThreadId(
  parentThreadId: ThreadId,
  providerChildThreadId: string
): ThreadId {
  return toChildThreadId(parentThreadId, providerChildThreadId)
}

export function readCodexChildThreadDescriptors(
  parentThreadId: ThreadId,
  payload: unknown
): ReadonlyArray<CodexChildThreadDescriptor> {
  const item = readCollabItem(payload)
  if (!item) {
    return []
  }

  const receiverThreadIds =
    asArray(item.receiverThreadIds)
      ?.map(value => asString(value)?.trim() ?? null)
      .filter((value): value is string => value !== null && value.length > 0) ?? []

  if (receiverThreadIds.length === 0) {
    return []
  }

  const prompt = firstNonEmptyString(
    item.prompt,
    item.input,
    item.description,
    item.summary,
    item.text,
    asObject(payload)?.prompt,
    asObject(payload)?.description,
    asObject(payload)?.summary,
    asObject(payload)?.text
  )
  const agentLabel = firstNonEmptyString(
    item.subagent_type,
    item.subagentType,
    item.agent_label,
    item.agentLabel,
    item.agent,
    item.title
  )

  return receiverThreadIds.map(providerChildThreadId => ({
    providerChildThreadId,
    childThreadId: toChildThreadId(parentThreadId, providerChildThreadId),
    agentLabel,
    prompt,
  }))
}
