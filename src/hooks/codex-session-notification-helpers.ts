import type { MutableRefObject } from 'react'
import type { SubagentInfo } from './codex-subagent-helpers'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : value ? String(value) : ''
}

function normalizeThreadId(value: unknown) {
  return asString(value).trim()
}

function normalizeThreadIds(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map(entry => {
      const record = asRecord(entry)
      const nestedThread = asRecord(record?.thread)
      return normalizeThreadId(
        record?.threadId ??
          record?.thread_id ??
          record?.id ??
          nestedThread?.id ??
          nestedThread?.threadId ??
          nestedThread?.thread_id
      )
    })
    .filter(Boolean)
}

export function readTurnId(params: Record<string, unknown>) {
  return (
    asString(params.turnId ?? params.turn_id).trim() ||
    asString(asRecord(params.turn)?.id).trim() ||
    null
  )
}

export function readThreadId(params: Record<string, unknown>) {
  return (
    asString(params.threadId ?? params.thread_id).trim() ||
    asString(asRecord(params.thread)?.id).trim() ||
    null
  )
}

export function normalizeThreadIdsFromAgentRefs(value: unknown) {
  return normalizeThreadIds(value)
}

export function normalizeThreadIdsFromAgentStatuses(value: unknown) {
  return normalizeThreadIds(value)
}

export function normalizeThreadIdsFromStatusMap(value: unknown) {
  const record = asRecord(value)
  if (!record) {
    return []
  }
  return Object.keys(record)
    .map(key => normalizeThreadId(key))
    .filter(Boolean)
}

export function getParentThreadIdFromSource(source: unknown): string | null {
  const sourceRecord = asRecord(source)
  if (!sourceRecord) {
    return null
  }
  const subAgent = asRecord(
    sourceRecord.subAgent ?? sourceRecord.sub_agent ?? sourceRecord.subagent
  )
  if (!subAgent) {
    return null
  }
  const threadSpawn = asRecord(subAgent.thread_spawn ?? subAgent.threadSpawn)
  if (!threadSpawn) {
    return null
  }
  return asString(threadSpawn.parent_thread_id ?? threadSpawn.parentThreadId).trim() || null
}

export function getParentThreadIdFromThread(thread: Record<string, unknown>): string | null {
  return (
    getParentThreadIdFromSource(thread.source) ||
    asString(
      thread.parentThreadId ??
        thread.parent_thread_id ??
        thread.parentId ??
        thread.parent_id ??
        thread.senderThreadId ??
        thread.sender_thread_id
    ).trim() ||
    null
  )
}

export function getNotificationThreadId(
  method: string,
  params: Record<string, unknown>,
  itemThreadIds: Map<string, string>,
  turnThreadIds: Map<string, string>
): string | null {
  const itemRecord = asRecord(params.item)
  const turnRecord = asRecord(params.turn)
  const threadRecord = asRecord(params.thread)
  const itemId = asString(params.itemId ?? itemRecord?.id).trim()
  const turnId = asString(params.turnId ?? turnRecord?.id).trim()
  return (
    resolveDirectNotificationThreadId(params) ||
    resolveNotificationRecordThreadId(itemRecord, turnRecord, threadRecord) ||
    resolveMappedNotificationThreadId(itemId, itemThreadIds) ||
    resolveMappedNotificationThreadId(turnId, turnThreadIds) ||
    resolveUpdatedNotificationThreadId(method, params, threadRecord)
  )
}

export type CollabSubagentHints = {
  explicitThreadIds: string[]
  receiverById: Map<string, Record<string, unknown>>
}

export function collectCollabSubagentHints(rawItem: unknown): CollabSubagentHints | null {
  const item = asRecord(rawItem)
  if (!item) {
    return null
  }

  const receiverRecords = [
    ...((Array.isArray(item.collabReceivers) ? item.collabReceivers : []) as unknown[]),
    ...((Array.isArray(item.collabStatuses) ? item.collabStatuses : []) as unknown[]),
    ...((Array.isArray(item.receiverAgents) ? item.receiverAgents : []) as unknown[]),
    ...((Array.isArray(item.receiver_agents) ? item.receiver_agents : []) as unknown[]),
    ...((Array.isArray(item.agentStatuses) ? item.agentStatuses : []) as unknown[]),
    ...((Array.isArray(item.agent_statuses) ? item.agent_statuses : []) as unknown[]),
    ...((item.collabReceiver ? [item.collabReceiver] : []) as unknown[]),
    ...((item.receiverAgent ? [item.receiverAgent] : []) as unknown[]),
    ...((item.receiver_agent ? [item.receiver_agent] : []) as unknown[]),
  ]

  const explicitThreadIds = Array.from(
    new Set([
      ...normalizeThreadIdsFromAgentRefs(receiverRecords),
      ...normalizeThreadIdsFromAgentStatuses(receiverRecords),
      ...normalizeThreadIdsFromStatusMap(item.statuses),
      ...normalizeThreadIdsFromStatusMap(item.agentStatus ?? item.agentsStates ?? item.agents_states),
      ...[
        item.receiverThreadId,
        item.receiver_thread_id,
        item.newThreadId,
        item.new_thread_id,
        ...(Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : []),
        ...(Array.isArray(item.receiver_thread_ids) ? item.receiver_thread_ids : []),
      ]
        .map(value => normalizeThreadId(value))
        .filter(Boolean),
    ])
  )

  if (explicitThreadIds.length === 0) {
    return null
  }

  const receiverById = new Map<string, Record<string, unknown>>()
  receiverRecords.forEach(entry => {
    const record = asRecord(entry)
    if (!record) {
      return
    }
    const threadId = normalizeThreadId(
      record.threadId ?? record.thread_id ?? record.id ?? asRecord(record.thread)?.id
    )
    if (threadId && !receiverById.has(threadId)) {
      receiverById.set(threadId, record)
    }
  })

  return { explicitThreadIds, receiverById }
}

export function applyCollabSubagentHints(
  previous: SubagentInfo[],
  explicitThreadIds: string[],
  receiverById: Map<string, Record<string, unknown>>,
  seenThreadIds: MutableRefObject<Set<string>>
) {
  const next = [...previous]
  explicitThreadIds.forEach((threadId, index) => {
    upsertCollabSubagentHint(next, previous.length, threadId, receiverById.get(threadId), index)
    seenThreadIds.current.add(threadId)
  })
  return next
}

function resolveDirectNotificationThreadId(params: Record<string, unknown>) {
  return asString(params.threadId ?? params.thread_id).trim() || null
}

function resolveNotificationRecordThreadId(
  itemRecord: Record<string, unknown> | null,
  turnRecord: Record<string, unknown> | null,
  threadRecord: Record<string, unknown> | null
) {
  return (
    asString(threadRecord?.id).trim() ||
    asString(turnRecord?.threadId ?? turnRecord?.thread_id).trim() ||
    asString(itemRecord?.threadId ?? itemRecord?.thread_id).trim() ||
    null
  )
}

function resolveMappedNotificationThreadId(
  id: string,
  threadMap: Map<string, string>
) {
  if (!id || !threadMap.has(id)) {
    return null
  }
  return threadMap.get(id) ?? null
}

function resolveUpdatedNotificationThreadId(
  method: string,
  params: Record<string, unknown>,
  threadRecord: Record<string, unknown> | null
) {
  if (method !== 'thread/name/updated') {
    return null
  }
  return asString(params.threadId ?? params.thread_id ?? threadRecord?.id).trim() || null
}

function upsertCollabSubagentHint(
  next: SubagentInfo[],
  previousLength: number,
  threadId: string,
  receiver: Record<string, unknown> | undefined,
  index: number
) {
  if (updateExistingCollabSubagentHint(next, threadId, receiver)) {
    return
  }
  appendNewCollabSubagentHint(next, previousLength, threadId, receiver, index)
}

function updateExistingCollabSubagentHint(
  next: SubagentInfo[],
  threadId: string,
  receiver: Record<string, unknown> | undefined
) {
  const existingIndex = next.findIndex(agent => agent.threadId === threadId)
  if (existingIndex < 0) {
    return false
  }
  const { nickname, role, statusText } = resolveCollabReceiverFields(receiver)
  next[existingIndex] = {
    ...next[existingIndex],
    nickname: nickname || next[existingIndex].nickname,
    role: role || next[existingIndex].role,
    status: statusText.includes('await')
      ? 'awaiting_instruction'
      : next[existingIndex].status,
    statusText: statusText || next[existingIndex].statusText,
  }
  return true
}

function appendNewCollabSubagentHint(
  next: SubagentInfo[],
  previousLength: number,
  threadId: string,
  receiver: Record<string, unknown> | undefined,
  index: number
) {
  const { nickname, role, statusText } = resolveCollabReceiverFields(receiver)
  next.push({
    threadId,
    nickname: nickname || `Agent-${previousLength + index + 1}`,
    role: role || 'worker',
    status: statusText.includes('await') ? 'awaiting_instruction' : 'thinking',
    statusText: statusText || 'is thinking',
    spawnedAt: Date.now(),
  })
}

function resolveCollabReceiverFields(receiver: Record<string, unknown> | undefined) {
  return {
    nickname: asString(
      receiver?.nickname ?? receiver?.agentNickname ?? receiver?.agent_nickname ?? receiver?.name
    ).trim(),
    role: asString(
      receiver?.role ??
        receiver?.agentRole ??
        receiver?.agent_role ??
        receiver?.agentType ??
        receiver?.agent_type
    ).trim(),
    statusText: asString(receiver?.status).trim(),
  }
}
