import { ThreadId, TurnId, type OpencodeModelSelection } from '@orxa-code/contracts'

type JsonRecord = Record<string, unknown>

export interface OpencodeChildDelegationMetadata {
  readonly parentProviderSessionId: string
  readonly agentLabel: string | null
  readonly prompt: string | null
  readonly description: string | null
  readonly modelSelection: OpencodeModelSelection | null
  readonly command: string | null
}

export interface OpencodeChildThreadDescriptor {
  readonly providerParentSessionId: string
  readonly providerChildThreadId: string
  readonly childThreadId: ThreadId
  readonly title: string | null
  readonly agentLabel: string | null
  readonly prompt: string | null
  readonly description: string | null
  readonly modelSelection: OpencodeModelSelection | null
}

export interface OpencodeDelegationFields {
  readonly agentLabel: string | null
  readonly prompt: string | null
  readonly description: string | null
  readonly modelSelection: OpencodeModelSelection | null
  readonly command: string | null
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toChildThreadId(parentThreadId: ThreadId, providerChildThreadId: string): ThreadId {
  return ThreadId.makeUnsafe(`opencode-child:${parentThreadId}:${providerChildThreadId}`)
}

export function opencodeChildTurnId(providerChildThreadId: string): TurnId {
  return TurnId.makeUnsafe(`opencode-child-turn:${providerChildThreadId}`)
}

function toModelSelection(
  value: unknown,
  agentLabel: string | null
): OpencodeModelSelection | null {
  const model = asRecord(value)
  const providerID = asString(model?.providerID)
  const modelID = asString(model?.modelID)
  if (!providerID || !modelID) {
    return null
  }
  return {
    provider: 'opencode',
    model: `${providerID}/${modelID}`,
    ...(agentLabel ? { agentId: agentLabel } : {}),
  }
}

function readOpencodeDelegationFields(value: unknown): OpencodeDelegationFields | null {
  const record = asRecord(value)
  if (!record) return null
  const agentLabel =
    asString(record.agentLabel) ?? asString(record.agent_label) ?? asString(record.agent)
  const modelSelection =
    (record.modelSelection as OpencodeModelSelection | null | undefined) ??
    toModelSelection(record.model, agentLabel)
  return {
    agentLabel: agentLabel ?? modelSelection?.agentId ?? null,
    prompt: asString(record.prompt),
    description: asString(record.description),
    modelSelection,
    command: asString(record.command),
  }
}

export function readOpencodeSubtaskDelegation(
  rawPayload: unknown
): OpencodeChildDelegationMetadata | null {
  const payload = asRecord(rawPayload)
  if (!payload) return null
  const part = asRecord(payload.part)
  if (!part) {
    return null
  }
  const parentProviderSessionId = asString(payload.sessionID) ?? asString(part.sessionID)
  if (!parentProviderSessionId) {
    return null
  }
  const fields = readOpencodeDelegationFields(readDelegationSourceFromPart(part))
  if (!fields) {
    return null
  }
  return {
    parentProviderSessionId,
    agentLabel: fields.agentLabel,
    prompt: fields.prompt,
    description: fields.description,
    modelSelection: fields.modelSelection,
    command: fields.command,
  }
}

export function readOpencodeChildThreadDescriptor(
  parentThreadId: ThreadId,
  rawPayload: unknown
): OpencodeChildThreadDescriptor | null {
  const payload = asRecord(rawPayload)
  if (!payload) return null
  const info = asRecord(payload.info)
  const delegation = asRecord(payload.delegation)
  const providerChildThreadId = asString(payload.sessionID) ?? asString(info?.id)
  const providerParentSessionId = asString(info?.parentID)
  if (!providerChildThreadId || !providerParentSessionId) {
    return null
  }
  const fields = readOpencodeDelegationFields(delegation)
  return {
    providerParentSessionId,
    providerChildThreadId,
    childThreadId: toChildThreadId(parentThreadId, providerChildThreadId),
    title: asString(info?.title),
    agentLabel: fields?.agentLabel ?? null,
    prompt: fields?.prompt ?? null,
    description: fields?.description ?? null,
    modelSelection: fields?.modelSelection ?? null,
  }
}

export function readOpencodeDelegationFieldsFromActivityData(
  rawPayload: unknown
): OpencodeDelegationFields | null {
  return readOpencodeDelegationFields(rawPayload)
}

function readDelegationSourceFromPart(part: JsonRecord): unknown {
  if (part.type === 'subtask') {
    return part
  }
  if (part.type !== 'tool') {
    return null
  }
  if (asString(part.tool) !== 'task') {
    return null
  }
  const state = asRecord(part.state)
  const input = asRecord(state?.input)
  if (!input) {
    return null
  }
  return {
    agentLabel:
      asString(input.agent) ??
      asString(input.subagent_type) ??
      asString(input.subagentType) ??
      asString(input.agent_label),
    prompt: asString(input.prompt),
    description: asString(input.description),
    model: input.model,
    command: asString(input.command),
  }
}
