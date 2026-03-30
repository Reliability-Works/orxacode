function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : value ? String(value) : ''
}

function normalizeSubagentKind(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[\s-]/g, '_')
  if (normalized.startsWith('subagent_')) {
    return normalized.slice('subagent_'.length)
  }
  if (normalized.startsWith('sub_agent_')) {
    return normalized.slice('sub_agent_'.length)
  }
  return normalized
}

function normalizeSubagentDisplayRole(value: string | null | undefined) {
  const normalized = normalizeSubagentKind(value ?? '')
  if (!normalized || normalized === 'vscode' || normalized === 'editor' || normalized === 'codex') {
    return undefined
  }
  return normalized.replace(/_/g, ' ')
}

function normalizeThreadStatusType(status: unknown) {
  if (!status || typeof status !== 'object' || Array.isArray(status)) {
    return ''
  }
  const record = status as Record<string, unknown>
  const typeRaw = record.type ?? record.statusType ?? record.status_type
  if (typeof typeRaw !== 'string') {
    return ''
  }
  return typeRaw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '')
}

const RESUMABLE_THREAD_STATUS_TYPES = new Set([
  'inprogress',
  'running',
  'processing',
  'pending',
  'started',
  'queued',
  'waiting',
  'blocked',
  'needsinput',
  'requiresaction',
  'awaitinginput',
  'waitingforinput',
])

function getResumedActiveTurnId(thread: Record<string, unknown>): string | null {
  const explicitTurnId =
    asString(thread.activeTurnId ?? thread.active_turn_id).trim() ||
    asString(
      asRecord(thread.activeTurn ?? thread.active_turn ?? thread.currentTurn ?? thread.current_turn)
        ?.id
    ).trim()
  if (explicitTurnId) {
    return explicitTurnId
  }
  const turns = Array.isArray(thread.turns) ? thread.turns : []
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = asRecord(turns[index])
    if (!turn) {
      continue
    }
    const status = asString(turn.status ?? turn.turnStatus ?? turn.turn_status)
      .trim()
      .toLowerCase()
      .replace(/[\s_-]/g, '')
    if (RESUMABLE_THREAD_STATUS_TYPES.has(status)) {
      return asString(turn.id ?? turn.turnId ?? turn.turn_id).trim() || null
    }
  }
  return null
}

function isNonMetadataSubagentKey(key: string) {
  return (
    key !== 'thread_spawn' &&
    key !== 'threadSpawn' &&
    key !== 'nickname' &&
    key !== 'agentNickname' &&
    key !== 'agent_nickname' &&
    key !== 'role' &&
    key !== 'agentRole' &&
    key !== 'agent_role' &&
    key !== 'parentThreadId' &&
    key !== 'parent_thread_id' &&
    key !== 'depth'
  )
}

function resolveSubagentNickname(record: Record<string, unknown>) {
  return (
    asString(record.nickname ?? record.agentNickname ?? record.agent_nickname).trim() || undefined
  )
}

function resolveSubagentRole(
  record: Record<string, unknown>,
  kind: string | null | undefined
) {
  const explicitRole = normalizeSubagentDisplayRole(
    asString(record.role ?? record.agentRole ?? record.agent_role).trim() || null
  )
  return explicitRole ?? (kind ? normalizeSubagentDisplayRole(kind) : undefined) ?? 'worker'
}

export interface SubagentInfo {
  threadId: string
  nickname: string
  role: string
  status: 'thinking' | 'awaiting_instruction' | 'completed' | 'idle'
  statusText: string
  spawnedAt: number
}

const HIDDEN_SUBAGENT_KINDS = new Set(['memory_consolidation'])
const AGENT_COLORS = ['#22C55E', '#F97316', '#3B82F6', '#A855F7', '#06B6D4', '#EC4899'] as const

export function agentColor(index: number): string {
  return AGENT_COLORS[index % AGENT_COLORS.length]
}

export function agentColorForId(threadId: string): string {
  let hash = 0
  for (let i = 0; i < threadId.length; i++) {
    hash = ((hash << 5) - hash + threadId.charCodeAt(i)) | 0
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length]
}

export function getSubagentKind(source: unknown): string | null {
  if (typeof source === 'string') {
    const normalized = normalizeSubagentKind(source)
    return normalized || null
  }

  const record = asRecord(source)
  if (!record) {
    return null
  }

  const subAgentRaw = record.subAgent ?? record.sub_agent ?? record.subagent
  if (typeof subAgentRaw === 'string') {
    const normalized = normalizeSubagentKind(subAgentRaw)
    return normalized || null
  }

  const subAgentRecord = asRecord(subAgentRaw)
  if (!subAgentRecord) {
    return null
  }

  const explicitKind = asString(
    subAgentRecord.kind ?? subAgentRecord.type ?? subAgentRecord.name ?? subAgentRecord.id
  )
  if (explicitKind) {
    const normalized = normalizeSubagentKind(explicitKind)
    return normalized || null
  }

  const candidateKeys = Object.keys(subAgentRecord).filter(
    key => isNonMetadataSubagentKey(key)
  )
  if (candidateKeys.length !== 1) {
    return null
  }
  const normalized = normalizeSubagentKind(candidateKeys[0] ?? '')
  return normalized || null
}

export function extractSubagentMeta(source: unknown) {
  const sourceRecord = asRecord(source)
  const subAgentRecord = asRecord(
    sourceRecord?.subAgent ?? sourceRecord?.sub_agent ?? sourceRecord?.subagent
  )
  if (!subAgentRecord) {
    const kind = getSubagentKind(source)
    if (!kind) {
      return null
    }
    return {
      kind,
      nickname: undefined,
      role: normalizeSubagentDisplayRole(kind) ?? 'worker',
    }
  }
  const kind = getSubagentKind(source)
  const nickname = resolveSubagentNickname(subAgentRecord)
  const role = resolveSubagentRole(subAgentRecord, kind)

  return { kind, nickname, role }
}

export function isHiddenSubagentSource(source: unknown) {
  const kind = getSubagentKind(source)
  if (!kind) {
    return false
  }
  return HIDDEN_SUBAGENT_KINDS.has(kind)
}

export { getResumedActiveTurnId, normalizeThreadStatusType }

function toSubagentStatus(
  thread: Record<string, unknown>
): Pick<SubagentInfo, 'status' | 'statusText'> {
  const statusType = normalizeThreadStatusType(thread.status)
  const activeTurnId = getResumedActiveTurnId(thread)
  if (
    statusType.includes('await') ||
    statusType.includes('input') ||
    statusType.includes('question') ||
    statusType.includes('response')
  ) {
    return { status: 'awaiting_instruction', statusText: 'awaiting input' }
  }
  if (activeTurnId) {
    return { status: 'thinking', statusText: 'is thinking' }
  }
  if (statusType === 'completed' || statusType === 'done' || statusType === 'finished') {
    return { status: 'completed', statusText: 'completed' }
  }
  return { status: 'idle', statusText: 'idle' }
}

export function subagentInfoFromThread(
  thread: Record<string, unknown>,
  index: number,
  existing?: SubagentInfo
): SubagentInfo | null {
  const threadId = asString(thread.id).trim()
  if (!threadId) {
    return null
  }
  const meta = extractSubagentMeta(thread.source)
  const status = toSubagentStatus(thread)
  const preview = asString(thread.preview ?? thread.name).trim()
  if (!existing && !meta && !preview) {
    return null
  }
  const fallbackName = preview || `Agent-${index + 1}`
  return {
    threadId,
    nickname: existing?.nickname ?? meta?.nickname ?? fallbackName,
    role: existing?.role ?? meta?.role ?? 'worker',
    status: status.status,
    statusText: status.statusText,
    spawnedAt: existing?.spawnedAt ?? Date.now(),
  }
}
