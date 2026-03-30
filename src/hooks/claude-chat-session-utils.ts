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
  status: ExploreEntry['status']
}) {
  const labelSource =
    input.summary?.trim() || input.description?.trim() || input.toolName?.trim() || 'Explore'
  return {
    id: input.id,
    kind: pickClaudeExploreKind(input.toolName, labelSource),
    label: compactClaudeExploreLabel(labelSource, 'Explore'),
    detail:
      input.toolName?.trim() && input.toolName.trim() !== labelSource.trim()
        ? input.toolName.trim()
        : undefined,
    status: input.status,
  } satisfies ExploreEntry
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

export function upsertClaudeTool(
  messages: ClaudeChatMessageItem[],
  toolItem: Extract<ClaudeChatMessageItem, { kind: 'tool' }>
) {
  const existing = messages.findIndex(item => item.id === toolItem.id && item.kind === 'tool')
  if (existing >= 0) {
    const next = [...messages]
    next[existing] = toolItem
    return next
  }
  return [...messages, toolItem]
}
