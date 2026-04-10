import { ThreadId, TurnId, type OpencodeModelSelection } from '@orxa-code/contracts'
import { asPlainRecord, asTrimmedString } from '@orxa-code/shared/records'

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
  const model = asPlainRecord(value)
  const providerID = asTrimmedString(model?.providerID)
  const modelID = asTrimmedString(model?.modelID)
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
  const record = asPlainRecord(value)
  if (!record) return null
  const agentLabel =
    asTrimmedString(record.agentLabel) ??
    asTrimmedString(record.agent_label) ??
    asTrimmedString(record.agent)
  const modelSelection =
    (record.modelSelection as OpencodeModelSelection | null | undefined) ??
    toModelSelection(record.model, agentLabel)
  return {
    agentLabel: agentLabel ?? modelSelection?.agentId ?? null,
    prompt: asTrimmedString(record.prompt),
    description: asTrimmedString(record.description),
    modelSelection,
    command: asTrimmedString(record.command),
  }
}

export function readOpencodeSubtaskDelegation(
  rawPayload: unknown
): OpencodeChildDelegationMetadata | null {
  const payload = asPlainRecord(rawPayload)
  if (!payload) return null
  const part = asPlainRecord(payload.part)
  if (!part) {
    return null
  }
  const parentProviderSessionId =
    asTrimmedString(payload.sessionID) ?? asTrimmedString(part.sessionID)
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
  const payload = asPlainRecord(rawPayload)
  if (!payload) return null
  const info = asPlainRecord(payload.info)
  const delegation = asPlainRecord(payload.delegation)
  const providerChildThreadId = asTrimmedString(payload.sessionID) ?? asTrimmedString(info?.id)
  const providerParentSessionId = asTrimmedString(info?.parentID)
  if (!providerChildThreadId || !providerParentSessionId) {
    return null
  }
  const fields = readOpencodeDelegationFields(delegation)
  return {
    providerParentSessionId,
    providerChildThreadId,
    childThreadId: toChildThreadId(parentThreadId, providerChildThreadId),
    title: asTrimmedString(info?.title),
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

function readDelegationSourceFromPart(part: Record<string, unknown>): unknown {
  if (part.type === 'subtask') {
    return part
  }
  if (part.type !== 'tool') {
    return null
  }
  if (asTrimmedString(part.tool) !== 'task') {
    return null
  }
  const state = asPlainRecord(part.state)
  const input = asPlainRecord(state?.input)
  if (!input) {
    return null
  }
  return {
    agentLabel:
      asTrimmedString(input.agent) ??
      asTrimmedString(input.subagent_type) ??
      asTrimmedString(input.subagentType) ??
      asTrimmedString(input.agent_label),
    prompt: asTrimmedString(input.prompt),
    description: asTrimmedString(input.description),
    model: input.model,
    command: asTrimmedString(input.command),
  }
}
