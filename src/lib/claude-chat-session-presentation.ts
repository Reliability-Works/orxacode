import type {
  UnifiedProjectedSessionPresentation,
  UnifiedSessionPresentation,
} from './session-presentation'
import type { UnifiedTimelineRenderRow } from '../components/chat/unified-timeline-model'
import type { ClaudeChatMessageItem, ClaudeChatSubagentState } from '../hooks/useClaudeChatSession'
import { groupChangedFileRows } from './session-presentation'
import {
  groupAdjacentTimelineExplorationRows,
  groupAdjacentToolCallRows,
} from './timeline-row-grouping'

function compactDelegationText(value: string, maxLength = 72) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return ''
  }
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3).trimEnd()}...`
    : normalized
}

function buildClaudeDelegationSummary(subagents: ClaudeChatSubagentState[]) {
  const activeSubagents = subagents.filter(
    agent => agent.status === 'thinking' || agent.status === 'awaiting_instruction'
  )
  if (activeSubagents.length === 0) {
    return null
  }
  if (activeSubagents.length === 1) {
    const taskText = compactDelegationText(activeSubagents[0]?.taskText ?? '')
    if (taskText) {
      return `Delegating: Waiting on ${taskText}`
    }
  }
  if (activeSubagents.length > 1) {
    return `Delegating: Waiting on ${activeSubagents.length} background agents`
  }
  return 'Delegating: Waiting on background agent'
}

function createClaudeMessageRow(
  item: ClaudeChatMessageItem & { kind: 'message' },
  isStreaming: boolean,
  previousWasAssistantContent: boolean
) {
  const role = item.role
  return {
    row: {
      id: item.id,
      kind: 'message',
      role,
      label: role === 'user' ? 'User' : 'Claude',
      timestamp: item.timestamp,
      showHeader: !(role === 'assistant' && previousWasAssistantContent),
      copyText: role === 'user' ? item.content : undefined,
      sections:
        item.content || (isStreaming && role === 'assistant')
          ? [{ id: `${item.id}:content`, type: 'text', content: item.content || '\u2588' }]
          : [],
    } satisfies UnifiedTimelineRenderRow,
    previousWasAssistantContent: role === 'assistant',
  }
}

function createClaudeToolRow(item: ClaudeChatMessageItem & { kind: 'tool' }) {
  return {
    id: item.id,
    kind: 'tool' as const,
    title: item.title,
    subtitle: item.source === 'delegated' ? 'Subagent' : undefined,
    status: item.status,
    command: item.command,
    output: item.output,
    error: item.error,
    defaultExpanded: false,
  } satisfies UnifiedTimelineRenderRow
}

function createClaudeExploreRow(item: ClaudeChatMessageItem & { kind: 'explore' }) {
  return {
    id: item.id,
    kind: 'explore' as const,
    item: {
      id: item.id,
      status: item.status,
      entries: item.entries,
      timestamp: item.timestamp,
    },
  } satisfies UnifiedTimelineRenderRow
}

function createClaudeNoticeRow(item: ClaudeChatMessageItem & { kind: 'notice' }) {
  return {
    id: item.id,
    kind: 'notice' as const,
    label: item.label,
    detail: item.detail,
    tone: item.tone,
    timestamp: item.timestamp,
  } satisfies UnifiedTimelineRenderRow
}

function createClaudeDiffRow(item: ClaudeChatMessageItem & { kind: 'diff' }) {
  return {
    id: item.id,
    kind: 'diff' as const,
    path: item.path,
    type: item.type,
    diff: item.diff,
    insertions: item.insertions,
    deletions: item.deletions,
  } satisfies UnifiedTimelineRenderRow
}

export function projectClaudeChatSessionPresentation(
  messages: ClaudeChatMessageItem[],
  isStreaming: boolean,
  subagents: ClaudeChatSubagentState[] = []
): UnifiedSessionPresentation {
  const rawRows: UnifiedTimelineRenderRow[] = []
  let previousWasAssistantContent = false
  let pendingThinkingRows: Extract<UnifiedTimelineRenderRow, { kind: 'thinking' }>[] = []
  const delegationSummary = buildClaudeDelegationSummary(subagents)

  const flushPendingThinkingRows = () => {
    if (pendingThinkingRows.length === 0) {
      return
    }
    if (delegationSummary) {
      const firstThinkingRow = pendingThinkingRows[0]
      if (firstThinkingRow) {
        rawRows.push({
          ...firstThinkingRow,
          summary: delegationSummary,
          content: '',
        })
      }
    } else {
      rawRows.push(...pendingThinkingRows)
    }
    pendingThinkingRows = []
  }

  for (const item of messages) {
    if (item.kind === 'message') {
      if (item.role !== 'assistant') {
        flushPendingThinkingRows()
      }
      const projected = createClaudeMessageRow(item, isStreaming, previousWasAssistantContent)
      previousWasAssistantContent = projected.previousWasAssistantContent
      rawRows.push(projected.row)
      if (item.role === 'assistant') {
        flushPendingThinkingRows()
      }
      continue
    }

    previousWasAssistantContent = true

    if (item.kind === 'thinking') {
      pendingThinkingRows.push({
        id: item.id,
        kind: 'thinking',
        summary: item.summary,
        content: item.content,
      })
      continue
    }
    flushPendingThinkingRows()
    if (item.kind === 'status') {
      rawRows.push({ id: item.id, kind: 'status', label: item.label })
      continue
    }
    if (item.kind === 'tool') {
      rawRows.push(createClaudeToolRow(item))
      continue
    }
    if (item.kind === 'diff') {
      rawRows.push(createClaudeDiffRow(item))
      continue
    }
    if (item.kind === 'explore') {
      rawRows.push(createClaudeExploreRow(item))
      continue
    }
    if (item.kind === 'notice') {
      rawRows.push(createClaudeNoticeRow(item))
    }
  }

  flushPendingThinkingRows()

  return {
    provider: 'claude-chat',
    rows: groupAdjacentTimelineExplorationRows(
      groupAdjacentToolCallRows(groupChangedFileRows(rawRows, { enabled: !isStreaming }), {
        enabled: isStreaming,
      })
    ),
  }
}

export function projectClaudeChatProjectedSessionPresentation(
  messages: ClaudeChatMessageItem[],
  isStreaming: boolean,
  subagents: ClaudeChatSubagentState[] = []
): UnifiedProjectedSessionPresentation {
  const presentation = projectClaudeChatSessionPresentation(messages, isStreaming, subagents)
  return {
    ...presentation,
    latestActivity: null,
    placeholderTimestamp: messages.at(-1)?.timestamp ?? 0,
  }
}
