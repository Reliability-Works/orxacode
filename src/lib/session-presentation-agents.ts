import type { SessionMessageBundle, CodexThread } from '@shared/ipc'
import type { TodoItem } from '../components/chat/TodoDock'
import type { ClaudeChatSubagentState } from '../hooks/useClaudeChatSession'
import type { CodexMessageItem } from '../hooks/codex-session-types'
import type { SubagentInfo } from '../hooks/useCodexSession'
import { compactText, extractStringByKeys, toRecord } from './text-utils'
import type { UnifiedBackgroundAgentSummary } from './session-presentation'

function normalizeTaskStatus(status: string | undefined): TodoItem['status'] {
  const normalized = status?.trim().toLowerCase()
  if (
    normalized === 'in_progress' ||
    normalized === 'in-progress' ||
    normalized === 'active' ||
    normalized === 'running'
  ) {
    return 'in_progress'
  }
  if (
    normalized === 'completed' ||
    normalized === 'complete' ||
    normalized === 'done' ||
    normalized === 'finished' ||
    normalized === 'success' ||
    normalized === 'succeeded'
  ) {
    return 'completed'
  }
  if (normalized === 'cancelled' || normalized === 'canceled' || normalized === 'skipped') {
    return 'cancelled'
  }
  return 'pending'
}

function parseTodoItemsFromValue(value: unknown): TodoItem[] {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return parseTodoItemsFromValue(parsed)
    } catch {
      return []
    }
  }

  if (Array.isArray(value)) {
    const items: TodoItem[] = []
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index]
      if (!item || typeof item !== 'object') {
        continue
      }
      const candidate = item as { content?: unknown; status?: unknown; id?: unknown }
      const content = typeof candidate.content === 'string' ? candidate.content.trim() : ''
      if (!content) {
        continue
      }
      const id =
        typeof candidate.id === 'string' && candidate.id.trim().length > 0
          ? candidate.id
          : `${content}:${index}`
      items.push({
        id,
        content,
        status: normalizeTaskStatus(
          typeof candidate.status === 'string' ? candidate.status : undefined
        ),
      })
    }
    return items
  }

  if (value && typeof value === 'object') {
    const candidate = value as { todos?: unknown; items?: unknown }
    if (candidate.todos) {
      return parseTodoItemsFromValue(candidate.todos)
    }
    if (candidate.items) {
      return parseTodoItemsFromValue(candidate.items)
    }
  }

  return []
}

function extractModelLabel(input: unknown) {
  const record = toRecord(input)
  if (!record) {
    return undefined
  }
  const providerID = typeof record.providerID === 'string' ? record.providerID : undefined
  const modelID = typeof record.modelID === 'string' ? record.modelID : undefined
  if (!providerID || !modelID) {
    return undefined
  }
  return `${providerID}/${modelID}`
}

function isTaskToolName(toolName: string) {
  const normalized = toolName.trim().toLowerCase()
  return normalized === 'task' || normalized.endsWith('/task')
}

function deriveOpencodeAgentStatus(
  statusType: string | undefined
): Pick<UnifiedBackgroundAgentSummary, 'status' | 'statusText'> {
  const normalized =
    statusType
      ?.trim()
      .toLowerCase()
      .replace(/[\s_-]/g, '') ?? ''
  if (
    normalized.includes('await') ||
    normalized.includes('question') ||
    normalized.includes('permission') ||
    normalized.includes('input')
  ) {
    return { status: 'awaiting_instruction', statusText: 'awaiting instruction' }
  }
  if (
    normalized.includes('busy') ||
    normalized.includes('running') ||
    normalized.includes('retry') ||
    normalized.includes('working')
  ) {
    return { status: 'thinking', statusText: 'is running' }
  }
  if (
    normalized.includes('done') ||
    normalized.includes('complete') ||
    normalized.includes('finish') ||
    normalized.includes('success')
  ) {
    return { status: 'completed', statusText: 'completed' }
  }
  return { status: 'idle', statusText: 'idle' }
}

function findMatchingBackgroundAgent(
  agents: UnifiedBackgroundAgentSummary[],
  candidate: Pick<
    UnifiedBackgroundAgentSummary,
    'id' | 'provider' | 'name' | 'role' | 'prompt' | 'command' | 'sessionID'
  >
) {
  return agents.find(agent => {
    const sameId = candidate.id && candidate.id === agent.id
    const sameSession =
      candidate.sessionID && agent.sessionID && candidate.sessionID === agent.sessionID
    const sameOpencodePrompt =
      candidate.provider === 'opencode' &&
      agent.provider === 'opencode' &&
      candidate.prompt &&
      agent.prompt &&
      candidate.prompt === agent.prompt &&
      candidate.name === agent.name &&
      (candidate.command ?? '') === (agent.command ?? '')
    const sameCodexIdentity =
      candidate.provider === 'codex' &&
      agent.provider === 'codex' &&
      candidate.name === agent.name &&
      (candidate.role ?? '') === (agent.role ?? '')
    return Boolean(sameId || sameSession || sameOpencodePrompt || sameCodexIdentity)
  })
}

function upsertBackgroundAgent(
  agents: UnifiedBackgroundAgentSummary[],
  candidate: UnifiedBackgroundAgentSummary
) {
  const existing = findMatchingBackgroundAgent(agents, candidate)
  if (!existing) {
    agents.push(candidate)
    return
  }
  existing.role = candidate.role ?? existing.role
  existing.status = candidate.status
  existing.statusText = candidate.statusText
  existing.prompt = candidate.prompt ?? existing.prompt
  existing.modelLabel = candidate.modelLabel ?? existing.modelLabel
  existing.command = candidate.command ?? existing.command
  existing.sessionID = candidate.sessionID ?? existing.sessionID
}

function extractTaskDelegationInfo(input: unknown, metadata?: unknown) {
  const record = toRecord(input)
  if (!record) {
    return null
  }
  const agent =
    extractStringByKeys(record, ['subagent_type', 'subagentType', 'agent', 'subagent']) ??
    'subagent'
  const description = extractStringByKeys(record, ['description']) ?? 'Delegated task'
  const prompt = extractStringByKeys(record, ['prompt']) ?? ''
  const command = extractStringByKeys(record, ['command']) ?? undefined
  const metadataRecord = toRecord(metadata)
  const sessionID = metadataRecord
    ? (extractStringByKeys(metadataRecord, ['sessionId', 'sessionID']) ?? undefined)
    : undefined
  return {
    agent,
    description,
    prompt,
    command,
    modelLabel: extractModelLabel(metadataRecord?.model),
    sessionID,
  }
}

function extractTaskSessionIDFromOutput(output: unknown) {
  const record = toRecord(output)
  const fromRecord = record
    ? extractStringByKeys(record, ['sessionId', 'sessionID', 'task_id', 'taskId', 'session_id'])
    : null
  if (fromRecord) {
    return fromRecord
  }
  if (typeof output !== 'string') {
    return undefined
  }
  const trimmed = output.trim()
  if (!trimmed) {
    return undefined
  }
  const fromTag = trimmed.match(/<task_id>\s*([A-Za-z0-9._:-]+)\s*<\/task_id>/i)?.[1]
  if (fromTag) {
    return fromTag.trim()
  }
  return trimmed
    .match(/\b(?:task[_-]?id|session[_-]?id|taskId|sessionId)\b\s*[:=]\s*([A-Za-z0-9._:-]+)/i)?.[1]
    ?.trim()
}

function collabStatusToAgentStatus(
  status: string | undefined
): Pick<UnifiedBackgroundAgentSummary, 'status' | 'statusText'> {
  const normalized = status?.trim().toLowerCase() ?? ''
  if (!normalized) {
    return { status: 'thinking', statusText: 'is thinking' }
  }
  if (normalized.includes('await')) {
    return { status: 'awaiting_instruction', statusText: status ?? 'awaiting instruction' }
  }
  if (
    normalized.includes('done') ||
    normalized.includes('complete') ||
    normalized.includes('finish')
  ) {
    return { status: 'completed', statusText: status ?? 'completed' }
  }
  if (normalized.includes('idle')) {
    return { status: 'idle', statusText: status ?? 'idle' }
  }
  return { status: 'thinking', statusText: status ?? 'is thinking' }
}

export function extractOpencodeTodoItems(messages: SessionMessageBundle[]): TodoItem[] {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const bundle = messages[messageIndex]
    for (let partIndex = bundle.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = bundle.parts[partIndex]
      if (part.type !== 'tool' || !part.tool.toLowerCase().includes('todo')) {
        continue
      }
      const state = part.state as { output?: unknown; input?: unknown }
      const fromOutput = parseTodoItemsFromValue(state.output)
      if (fromOutput.length > 0) {
        return fromOutput
      }
      const fromInput = parseTodoItemsFromValue(state.input)
      if (fromInput.length > 0) {
        return fromInput
      }
    }
  }
  return []
}

export function buildCodexBackgroundAgents(
  subagents: SubagentInfo[]
): UnifiedBackgroundAgentSummary[] {
  return subagents.map(agent => ({
    id: agent.threadId,
    sessionID: agent.threadId,
    provider: 'codex',
    name: agent.nickname,
    role: agent.role,
    status: agent.status,
    statusText: agent.statusText,
  }))
}

export function buildClaudeChatBackgroundAgents(
  subagents: ClaudeChatSubagentState[]
): UnifiedBackgroundAgentSummary[] {
  return subagents.map(agent => ({
    id: agent.id,
    sessionID: agent.sessionID,
    provider: 'claude-chat',
    name: agent.name,
    role: agent.role,
    status: agent.status,
    statusText: agent.statusText,
    prompt: agent.prompt ? compactText(agent.prompt, 800) : undefined,
  }))
}

export function buildCodexBackgroundAgentsFromChildThreads(
  childThreads: CodexThread[]
): UnifiedBackgroundAgentSummary[] {
  const agents: UnifiedBackgroundAgentSummary[] = []
  childThreads.forEach((thread, index) => {
    const threadId = thread.id?.trim()
    if (!threadId) {
      return
    }
    const preview = thread.preview?.trim()
    if (!preview) {
      return
    }
    const normalized = collabStatusToAgentStatus(thread.status?.type)
    agents.push({
      id: threadId,
      sessionID: threadId,
      provider: 'codex',
      name: preview || `Agent-${index + 1}`,
      status: normalized.status,
      statusText: normalized.statusText,
    })
  })
  return agents
}

export function buildCodexBackgroundAgentsFromMessages(
  messages: CodexMessageItem[]
): UnifiedBackgroundAgentSummary[] {
  const agents: UnifiedBackgroundAgentSummary[] = []
  const upsert = (candidate: UnifiedBackgroundAgentSummary) =>
    upsertBackgroundAgent(agents, candidate)

  for (const item of messages) {
    if (
      item.kind !== 'tool' ||
      (!(item.collabReceivers?.length || item.collabStatuses?.length) && item.toolType !== 'task')
    ) {
      continue
    }
    for (const receiver of item.collabReceivers ?? []) {
      upsert({
        id: receiver.threadId,
        sessionID: receiver.threadId,
        provider: 'codex',
        name: receiver.nickname ?? receiver.threadId,
        role: receiver.role,
        status: 'thinking',
        statusText: 'is thinking',
      })
    }
    for (const status of item.collabStatuses ?? []) {
      const normalized = collabStatusToAgentStatus(status.status)
      upsert({
        id: status.threadId,
        sessionID: status.threadId,
        provider: 'codex',
        name: status.nickname ?? status.threadId,
        role: status.role,
        status: normalized.status,
        statusText: normalized.statusText,
      })
    }
  }

  return agents
}

export function filterOutCurrentCodexThreadAgent(
  agents: UnifiedBackgroundAgentSummary[],
  currentThreadId: string | null | undefined
) {
  if (!currentThreadId) {
    return agents
  }
  return agents.filter(agent => agent.sessionID !== currentThreadId && agent.id !== currentThreadId)
}

export function extractCodexTodoItemsFromMessages(messages: CodexMessageItem[]): TodoItem[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index]
    if (item.kind !== 'message' || item.role !== 'assistant') {
      continue
    }
    if (!/\b(task list|plan|phases?)\b/i.test(item.content)) {
      continue
    }
    const lines = item.content
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
    const numberedItems = lines
      .map(line => line.match(/^(\d+)\.\s+(.+)$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match, itemIndex) => ({
        id: `fallback-plan:${item.id}:${itemIndex}`,
        content: match[2].trim(),
        status: 'pending' as const,
      }))
    if (numberedItems.length >= 2) {
      return numberedItems
    }
  }
  return []
}

export function buildOpencodeBackgroundAgents(
  messages: SessionMessageBundle[],
  sessionStatusByID?: Record<string, { type?: string }>
): UnifiedBackgroundAgentSummary[] {
  const agents: UnifiedBackgroundAgentSummary[] = []
  for (const bundle of messages) {
    if (bundle.info.role !== 'assistant') {
      continue
    }
    for (const part of bundle.parts) {
      const candidate =
        part.type === 'subtask'
          ? buildOpencodeSubtaskAgent(bundle.info.id, part, sessionStatusByID)
          : part.type === 'tool' && isTaskToolName(part.tool)
            ? buildOpencodeToolAgent(bundle.info.id, part, sessionStatusByID)
            : null
      if (candidate) {
        upsertBackgroundAgent(agents, candidate)
      }
    }
  }
  return agents.map(agent => ({
    ...agent,
    prompt: agent.prompt ? compactText(agent.prompt, 800) : undefined,
  }))
}

function buildOpencodeSubtaskAgent(
  bundleID: string,
  part: Extract<SessionMessageBundle['parts'][number], { type: 'subtask' }>,
  sessionStatusByID?: Record<string, { type?: string }>
): UnifiedBackgroundAgentSummary {
  const sessionID = part.sessionID?.trim() || undefined
  const resolvedSessionID = sessionID ?? `opencode-provisional:${bundleID}:${part.id}`
  const status = deriveOpencodeAgentStatus(sessionID ? sessionStatusByID?.[sessionID]?.type : 'busy')
  return {
    id: resolvedSessionID,
    provider: 'opencode',
    name: part.agent,
    role: undefined,
    status: status.status,
    statusText: status.statusText,
    prompt: part.prompt,
    modelLabel: extractModelLabel(part.model),
    command: part.command,
    sessionID,
  }
}

function buildOpencodeToolAgent(
  bundleID: string,
  part: Extract<SessionMessageBundle['parts'][number], { type: 'tool' }>,
  sessionStatusByID?: Record<string, { type?: string }>
): UnifiedBackgroundAgentSummary | null {
  const metadata = (part.state as Record<string, unknown>).metadata
  const output = (part.state as Record<string, unknown>).output
  const taskDelegation = extractTaskDelegationInfo(part.state.input, metadata)
  if (!taskDelegation) {
    return null
  }
  const sessionID = taskDelegation.sessionID ?? extractTaskSessionIDFromOutput(output) ?? undefined
  const status = deriveOpencodeAgentStatus(sessionID ? sessionStatusByID?.[sessionID]?.type : 'busy')
  return {
    id: sessionID ?? `opencode-provisional:${bundleID}:${part.id}`,
    provider: 'opencode',
    name: taskDelegation.agent,
    role: undefined,
    status: status.status,
    statusText: status.statusText,
    prompt: taskDelegation.prompt,
    modelLabel: taskDelegation.modelLabel,
    command: taskDelegation.command,
    sessionID,
  }
}
