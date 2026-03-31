import type { CodexMessageItem } from '../hooks/codex-session-types'
import type { ExploreEntry } from './explore-utils'
import {
  commandToExploreEntry,
  fileReadToExploreEntry,
  mcpToolCallToExploreEntry,
  webSearchToExploreEntry,
} from './explore-utils'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : value ? String(value) : ''
}

function asNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function stringifyCommand(value: unknown) {
  if (Array.isArray(value)) {
    const tokens = value.map(part => asString(part)).filter(Boolean)
    const [first = '', second = '', third = ''] = tokens
    if (/(?:^|\/)(?:zsh|bash|sh)$/.test(first) && (second === '-lc' || second === '-c') && third) {
      return third
    }
    return tokens.join(' ').trim()
  }
  return asString(value).trim()
}

function parseUserContent(content: unknown) {
  const inputs = Array.isArray(content) ? content : []
  const textParts: string[] = []
  inputs.forEach(entry => {
    const record = asRecord(entry)
    if (!record) {
      return
    }
    if (asString(record.type) === 'text') {
      const text = asString(record.text).trim()
      if (text) {
        textParts.push(text)
      }
    }
  })
  return textParts.join(' ').trim()
}

function buildCommandExecutionToolMessage(
  item: Record<string, unknown>,
  id: string,
  timestamp: number
): CodexMessageItem {
  const command = Array.isArray(item.command)
    ? stringifyCommand(item.command)
    : asString(item.command)
  return {
    id,
    kind: 'tool',
    toolType: 'commandExecution',
    title: command ? `$ ${command}` : 'Command',
    command: command || undefined,
    output: asString(item.aggregatedOutput).trim() || undefined,
    status:
      getItemStatus(item),
    exitCode: asNumber(item.exitCode ?? item.exit_code),
    durationMs: asNumber(item.durationMs ?? item.duration_ms),
    timestamp,
  }
}

function buildFileChangeToolMessage(
  item: Record<string, unknown>,
  id: string,
  timestamp: number
): CodexMessageItem {
  const changes = Array.isArray(item.changes) ? item.changes : []
  const firstChange = asRecord(changes[0])
  const path = asString(firstChange?.path ?? item.path).trim()
  return {
    id,
    kind: 'diff',
    path,
    type: asString(firstChange?.kind ?? item.changeType ?? 'modified').trim() || 'modified',
    status:
      getItemStatus(item),
    diff:
      changes
        .map(change => asString(asRecord(change)?.diff).trim())
        .filter(Boolean)
        .join('\n\n') || undefined,
    insertions: asNumber(item.insertions),
    deletions: asNumber(item.deletions),
    timestamp,
  }
}

function getItemStatus(item: Record<string, unknown>): 'completed' | 'error' {
  const normalized = asString(item.status).trim().toLowerCase()
  return normalized.includes('error') || normalized.includes('fail') ? 'error' : 'completed'
}

function buildCollabToolMessage(
  item: Record<string, unknown>,
  id: string,
  timestamp: number
): CodexMessageItem {
  const tool = asString(item.tool).trim()
  return {
    id,
    kind: 'tool',
    toolType: 'collabToolCall',
    title: tool ? `Collab: ${tool}` : 'Collab tool call',
    output: asString(item.prompt).trim() || undefined,
    status: 'completed',
    timestamp,
  }
}

function buildPlanToolMessage(
  item: Record<string, unknown>,
  id: string,
  timestamp: number
): CodexMessageItem {
  return {
    id,
    kind: 'tool',
    toolType: 'plan',
    title: 'Plan',
    output: asString(item.text).trim() || undefined,
    status: 'completed',
    timestamp,
  }
}

function buildContextCompactionMessage(id: string, timestamp: number): CodexMessageItem {
  return { id, kind: 'compaction', timestamp }
}

function buildToolMessage(item: Record<string, unknown>, timestamp: number): CodexMessageItem | null {
  const id = asString(item.id).trim()
  const type = asString(item.type).trim()
  if (!id || !type) {
    return null
  }
  if (type === 'commandExecution') {
    return buildCommandExecutionToolMessage(item, id, timestamp)
  }
  if (type === 'fileChange') {
    return buildFileChangeToolMessage(item, id, timestamp)
  }
  if (type === 'collabToolCall' || type === 'collabAgentToolCall') {
    return buildCollabToolMessage(item, id, timestamp)
  }
  if (type === 'plan') {
    return buildPlanToolMessage(item, id, timestamp)
  }
  if (type === 'contextCompaction') {
    return buildContextCompactionMessage(id, timestamp)
  }
  return null
}

function buildExploreEntry(item: Record<string, unknown>) {
  const id = asString(item.id).trim()
  const type = asString(item.type).trim()
  if (!id || !type) {
    return null
  }
  const status = getItemStatus(item)
  if (type === 'fileRead') {
    return fileReadToExploreEntry(id, asString(item.path).trim() || 'file', status)
  }
  if (type === 'webSearch') {
    return webSearchToExploreEntry(id, asString(item.query).trim() || 'search', status)
  }
  if (type === 'mcpToolCall') {
    return mcpToolCallToExploreEntry(
      id,
      asString(item.toolName ?? item.tool ?? item.name).trim() || 'mcp tool',
      status
    )
  }
  if (type === 'commandExecution') {
    const command = stringifyCommand(item.command)
    return commandToExploreEntry(id, command, status)
  }
  return null
}

function buildThreadItemMessage(
  item: Record<string, unknown>,
  timestamp: number
): CodexMessageItem | null {
  const id = asString(item.id).trim()
  const type = asString(item.type).trim()
  if (!id || !type) {
    return null
  }
  if (type === 'userMessage') {
    const content = parseUserContent(item.content)
    return {
      id,
      kind: 'message',
      role: 'user',
      content,
      timestamp,
    }
  }
  if (type === 'agentMessage') {
    return {
      id,
      kind: 'message',
      role: 'assistant',
      content: asString(item.text),
      timestamp,
    }
  }
  if (type === 'reasoning') {
    return {
      id,
      kind: 'reasoning',
      summary: Array.isArray(item.summary)
        ? item.summary.map(entry => asString(entry)).join('\n')
        : asString(item.summary),
      content: Array.isArray(item.content)
        ? item.content.map(entry => asString(entry)).join('\n')
        : asString(item.content),
      timestamp,
    }
  }
  return buildToolMessage(item, timestamp)
}

export function extractThreadFromResumeResponse(
  response: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!response) {
    return null
  }
  const result = asRecord(response.result)
  return asRecord(result?.thread ?? response.thread)
}

export function buildCodexMessagesFromThread(thread: Record<string, unknown>): CodexMessageItem[] {
  const turns = Array.isArray(thread.turns) ? thread.turns : []
  const messages: CodexMessageItem[] = []
  let pendingExploreEntries: Array<ReturnType<typeof buildExploreEntry>> = []
  let pendingExploreTimestamp = 0

  const flushExploreEntries = () => {
    const entries = pendingExploreEntries.filter(
      (entry): entry is ExploreEntry => entry !== null
    )
    if (entries.length === 0) {
      pendingExploreEntries = []
      return
    }
    messages.push({
      id: `resume-explore:${messages.length}:${pendingExploreTimestamp}`,
      kind: 'explore',
      status: 'explored',
      entries,
      timestamp: pendingExploreTimestamp,
    })
    pendingExploreEntries = []
  }

  turns.forEach((turn, turnIndex) => {
    const turnRecord = asRecord(turn)
    const turnItems = Array.isArray(turnRecord?.items) ? turnRecord?.items : []
    const timestamp =
      asNumber(
        turnRecord?.createdAt ??
          turnRecord?.created_at ??
          turnRecord?.startedAt ??
          turnRecord?.started_at
      ) ?? turnIndex
    turnItems.forEach((item, itemIndex) => {
      const itemRecord = asRecord(item) ?? {}
      const itemTimestamp = timestamp + itemIndex
      const exploreEntry = buildExploreEntry(itemRecord)
      if (exploreEntry) {
        if (pendingExploreEntries.length === 0) {
          pendingExploreTimestamp = itemTimestamp
        }
        pendingExploreEntries.push(exploreEntry)
        return
      }
      flushExploreEntries()
      const converted = buildThreadItemMessage(itemRecord, itemTimestamp)
      if (converted) {
        messages.push(converted)
      }
    })
    flushExploreEntries()
  })
  flushExploreEntries()
  return messages
}
