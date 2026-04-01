import type { ClaudeChatModelEntry } from '@shared/ipc'
import type { ExploreEntry } from '../lib/explore-utils'
import type { ModelOption } from '../lib/models'
import {
  getPersistedClaudeChatState,
  setPersistedClaudeChatState,
} from './claude-chat-session-storage'

export interface ClaudeChatSubagentState {
  id: string
  name: string
  role?: string
  status: 'thinking' | 'awaiting_instruction' | 'completed' | 'idle'
  statusText: string
  prompt?: string
  taskText?: string
  sessionID?: string
}

export type ClaudeChatMessageItem =
  | { id: string; kind: 'message'; role: 'user' | 'assistant'; content: string; timestamp: number }
  | { id: string; kind: 'thinking'; summary?: string; content?: string; timestamp: number }
  | { id: string; kind: 'status'; label: string; timestamp: number }
  | {
      id: string
      kind: 'explore'
      source?: 'main' | 'delegated'
      status: 'exploring' | 'explored'
      entries: ExploreEntry[]
      timestamp: number
    }
  | {
      id: string
      kind: 'tool'
      source?: 'main' | 'delegated'
      title: string
      toolType: string
      status: 'running' | 'completed' | 'error'
      command?: string
      output?: string
      error?: string
      timestamp: number
    }
  | {
      id: string
      kind: 'diff'
      path: string
      type: 'modified' | 'created'
      diff?: string
      insertions?: number
      deletions?: number
      timestamp: number
    }
  | {
      id: string
      kind: 'notice'
      label: string
      detail?: string
      tone?: 'info' | 'error'
      timestamp: number
    }

const CLAUDE_READ_ONLY_TOOL_NAMES = new Set([
  'read',
  'grep',
  'glob',
  'find',
  'ls',
  'search',
  'websearch',
  'view',
  'list',
  'tree',
])

const CLAUDE_FILE_EDIT_TOOL_NAMES = new Set(['edit', 'multiedit', 'write', 'notebookedit'])

function asToolString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeClaudeToolName(toolName: string | undefined) {
  return toolName?.trim().toLowerCase() ?? ''
}

export function nextClaudeMessageId(sessionKey: string) {
  const persisted = getPersistedClaudeChatState(sessionKey)
  const nextCounter = persisted.messageIdCounter + 1
  setPersistedClaudeChatState(sessionKey, { ...persisted, messageIdCounter: nextCounter })
  return `claude-msg-${nextCounter}`
}

export function toClaudeModelOptions(models: ClaudeChatModelEntry[]): ModelOption[] {
  return models.map(model => ({
    key: `claude-chat/${model.id}`,
    providerID: 'claude-chat',
    modelID: model.id,
    providerName: 'Claude',
    modelName: model.name,
    variants: [],
  }))
}

export function ensureThinkingRow(
  messages: ClaudeChatMessageItem[],
  turnId: string,
  timestamp: number
): ClaudeChatMessageItem[] {
  const thinkingId = `thinking:${turnId}`
  if (messages.some(item => item.id === thinkingId)) {
    return messages
  }
  return [...messages, { id: thinkingId, kind: 'thinking', summary: '', content: '', timestamp }]
}

export function removeThinkingRow(
  messages: ClaudeChatMessageItem[],
  turnId: string
): ClaudeChatMessageItem[] {
  const thinkingId = `thinking:${turnId}`
  return messages.filter(item => item.id !== thinkingId)
}

export function assistantMessageIdForTurn(turnId: string, fallbackId: string) {
  return turnId.trim() ? `assistant:${turnId}` : fallbackId
}

export function createAssistantMessage(
  id: string,
  content: string,
  timestamp: number
): ClaudeChatMessageItem {
  return {
    id,
    kind: 'message',
    role: 'assistant',
    content,
    timestamp,
  }
}

export function upsertAssistantMessage(
  messages: ClaudeChatMessageItem[],
  id: string,
  content: string,
  timestamp: number
) {
  const index = messages.findIndex(
    item => item.id === id && item.kind === 'message' && item.role === 'assistant'
  )
  const next = [...messages]
  if (index >= 0) {
    next[index] = createAssistantMessage(id, content, timestamp)
    return next
  }
  return [...messages, createAssistantMessage(id, content, timestamp)]
}

export function appendAssistantDelta(
  messages: ClaudeChatMessageItem[],
  id: string,
  content: string,
  timestamp: number
) {
  const index = messages.findIndex(
    item => item.id === id && item.kind === 'message' && item.role === 'assistant'
  )
  const next = [...messages]
  if (index >= 0) {
    const current = next[index]
    if (current?.kind === 'message' && current.role === 'assistant') {
      next[index] = { ...current, content: `${current.content}${content}`, timestamp }
      return next
    }
  }
  return [...messages, createAssistantMessage(id, content, timestamp)]
}

function compactClaudeExploreLabel(value: string, fallback: string) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return fallback
  }
  return normalized.length > 96 ? `${normalized.slice(0, 93).trimEnd()}...` : normalized
}

function firstNonEmptyToolString(record: Record<string, unknown> | undefined, keys: string[]) {
  if (!record) {
    return ''
  }
  for (const key of keys) {
    const value = asToolString(record[key])
    if (value) {
      return value
    }
  }
  return ''
}

function getClaudeToolPath(toolInput: Record<string, unknown> | undefined) {
  return firstNonEmptyToolString(toolInput, ['file_path', 'path'])
}

function getClaudeToolCommand(toolInput: Record<string, unknown> | undefined) {
  if (!toolInput) {
    return ''
  }
  const command = toolInput.command ?? toolInput.cmd
  if (typeof command === 'string') {
    return command.trim()
  }
  if (Array.isArray(command)) {
    return command.map(part => asToolString(part)).filter(Boolean).join(' ').trim()
  }
  return ''
}

function buildClaudeExploreLabel(
  toolName: string | undefined,
  toolInput: Record<string, unknown> | undefined,
  fallback: string
) {
  const normalizedTool = normalizeClaudeToolName(toolName)
  const path = getClaudeToolPath(toolInput)
  const query = firstNonEmptyToolString(toolInput, ['query', 'pattern', 'url', 'prompt'])
  if (normalizedTool === 'read' || normalizedTool === 'view') {
    return path ? `Read ${path}` : fallback
  }
  if (normalizedTool === 'grep' || normalizedTool === 'search' || normalizedTool === 'websearch') {
    return query ? `Search ${query}` : fallback
  }
  if (normalizedTool === 'webfetch') {
    const url = firstNonEmptyToolString(toolInput, ['url'])
    return url ? `Read ${url}` : fallback
  }
  if (normalizedTool === 'glob' || normalizedTool === 'ls' || normalizedTool === 'list' || normalizedTool === 'tree') {
    const target = firstNonEmptyToolString(toolInput, ['pattern', 'path'])
    return target ? `List ${target}` : fallback
  }
  return fallback
}

function buildClaudeToolTitle(
  toolName: string | undefined,
  toolInput: Record<string, unknown> | undefined
) {
  const fallback = toolName?.trim() || 'Tool'
  const path = getClaudeToolPath(toolInput)
  if (path && CLAUDE_FILE_EDIT_TOOL_NAMES.has(normalizeClaudeToolName(toolName))) {
    return `${fallback} ${path}`
  }
  return fallback
}

function summarizeWrittenContent(content: string) {
  if (!content) {
    return ''
  }
  const lines = content.split('\n')
  const maxLines = 24
  const clipped = lines.slice(0, maxLines)
  return lines.length > maxLines ? [...clipped, '...'].join('\n') : clipped.join('\n')
}

function buildInlineDiff(oldText: string, newText: string) {
  const diffLines = ['@@']
  if (oldText) {
    diffLines.push(...oldText.split('\n').map(line => `-${line}`))
  }
  if (newText) {
    diffLines.push(...newText.split('\n').map(line => `+${line}`))
  }
  return diffLines.join('\n')
}

function measureDiff(diff: string | undefined) {
  if (!diff) {
    return { insertions: undefined, deletions: undefined }
  }
  let insertions = 0
  let deletions = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
      continue
    }
    if (line.startsWith('+')) {
      insertions += 1
    } else if (line.startsWith('-')) {
      deletions += 1
    }
  }
  return {
    insertions: insertions || undefined,
    deletions: deletions || undefined,
  }
}

function pickClaudeExploreKind(toolName: string | undefined, text: string) {
  const normalizedTool = toolName?.trim().toLowerCase() ?? ''
  const normalizedText = text.trim().toLowerCase()
  if (
    normalizedTool === 'grep' ||
    normalizedTool === 'glob' ||
    normalizedTool === 'find' ||
    normalizedTool === 'search' ||
    normalizedTool === 'websearch' ||
    /\b(search|grep|glob|find|look up|locate)\b/.test(normalizedText)
  ) {
    return 'search' as const
  }
  if (
    normalizedTool === 'ls' ||
    normalizedTool === 'list' ||
    normalizedTool === 'tree' ||
    /\b(list|scan|browse|enumerate|inventory)\b/.test(normalizedText)
  ) {
    return 'list' as const
  }
  if (
    normalizedTool === 'read' ||
    normalizedTool === 'view' ||
    /\b(read|inspect|investigat|review|check|trace|audit|examine|look into)\b/.test(normalizedText)
  ) {
    return 'read' as const
  }
  return 'run' as const
}

export function isClaudeExploreCandidate(input: {
  toolName?: string
  description?: string
  summary?: string
  taskType?: string
}) {
  const normalizedTool = input.toolName?.trim().toLowerCase() ?? ''
  if (normalizedTool && CLAUDE_READ_ONLY_TOOL_NAMES.has(normalizedTool)) {
    return true
  }
  const normalizedTaskType = input.taskType?.trim().toLowerCase() ?? ''
  if (normalizedTaskType.includes('research') || normalizedTaskType.includes('explor')) {
    return true
  }
  const combined = `${input.summary ?? ''} ${input.description ?? ''}`.trim().toLowerCase()
  if (!combined) {
    return false
  }
  return /\b(explor\w*|inspect\w*|investigat\w*|review\w*|search\w*|find\w*|read\w*|scan\w*|check\w*|trace\w*|audit\w*)\b|\blook into\b/.test(
    combined
  )
}

export function buildClaudeExploreEntry(input: {
  id: string
  toolName?: string
  description?: string
  summary?: string
  taskType?: string
  toolInput?: Record<string, unknown>
  source?: 'main' | 'delegated'
  status: ExploreEntry['status']
}) {
  const labelSource =
    input.summary?.trim() || input.description?.trim() || input.toolName?.trim() || 'Explore'
  const toolLabel =
    input.toolName?.trim() && input.toolName.trim() !== labelSource.trim()
      ? input.toolName.trim()
      : undefined
  const detailParts = [
    input.source === 'delegated' ? 'Subagent' : undefined,
    toolLabel,
  ].filter(Boolean)
  return {
    id: input.id,
    kind: pickClaudeExploreKind(input.toolName, labelSource),
    label: compactClaudeExploreLabel(
      buildClaudeExploreLabel(input.toolName, input.toolInput, labelSource),
      'Explore'
    ),
    detail: detailParts.length > 0 ? detailParts.join(' · ') : undefined,
    status: input.status,
  } satisfies ExploreEntry
}

export function buildClaudeToolMessageItem(input: {
  id: string
  toolName?: string
  toolInput?: Record<string, unknown>
  summary?: string
  source: 'main' | 'delegated'
  status: 'running' | 'completed' | 'error'
  timestamp: number
}): Extract<ClaudeChatMessageItem, { kind: 'tool' }> {
  return {
    id: input.id,
    kind: 'tool',
    source: input.source,
    title: buildClaudeToolTitle(input.toolName, input.toolInput),
    toolType: input.toolName?.trim() || 'Tool',
    status: input.status,
    command: getClaudeToolCommand(input.toolInput) || undefined,
    output: input.summary?.trim() || undefined,
    timestamp: input.timestamp,
  }
}

export function buildClaudeDiffMessageItem(input: {
  id: string
  toolName?: string
  toolInput?: Record<string, unknown>
  timestamp: number
}): Extract<ClaudeChatMessageItem, { kind: 'diff' }> | null {
  const normalizedTool = normalizeClaudeToolName(input.toolName)
  if (!CLAUDE_FILE_EDIT_TOOL_NAMES.has(normalizedTool)) {
    return null
  }
  const path = getClaudeToolPath(input.toolInput)
  if (!path) {
    return null
  }
  const oldText = firstNonEmptyToolString(input.toolInput, ['old_string'])
  const newText =
    normalizedTool === 'write'
      ? summarizeWrittenContent(firstNonEmptyToolString(input.toolInput, ['content']))
      : firstNonEmptyToolString(input.toolInput, ['new_string', 'newText'])
  const diff = buildInlineDiff(oldText, newText)
  const stats = measureDiff(diff)
  return {
    id: input.id,
    kind: 'diff',
    path,
    type: normalizedTool === 'write' ? 'created' : 'modified',
    diff: diff || undefined,
    insertions: stats.insertions,
    deletions: stats.deletions,
    timestamp: input.timestamp,
  }
}

export function upsertExploreRow(
  messages: ClaudeChatMessageItem[],
  rowId: string,
  entry: ExploreEntry,
  timestamp: number,
  status: 'exploring' | 'explored',
  source: 'main' | 'delegated'
) {
  const index = messages.findIndex(item => item.id === rowId && item.kind === 'explore')
  if (index >= 0) {
    const current = messages[index]
    if (current?.kind === 'explore') {
      const next = [...messages]
      next[index] = {
        ...current,
        source,
        status,
        timestamp,
        entries: current.entries.some(candidate => candidate.id === entry.id)
          ? current.entries.map(candidate => (candidate.id === entry.id ? entry : candidate))
          : [...current.entries, entry],
      }
      return next
    }
  }
  return [
    ...messages,
    { id: rowId, kind: 'explore' as const, source, status, entries: [entry], timestamp },
  ]
}

export function upsertClaudeActivityItem(
  messages: ClaudeChatMessageItem[],
  nextItem: Extract<ClaudeChatMessageItem, { kind: 'tool' | 'diff' }>
) {
  const existing = messages.findIndex(item => item.id === nextItem.id)
  if (existing >= 0) {
    const next = [...messages]
    next[existing] = nextItem
    return next
  }
  return [...messages, nextItem]
}
