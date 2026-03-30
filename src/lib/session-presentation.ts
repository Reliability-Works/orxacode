import type { UnifiedProvider } from '../state/unified-runtime'
import type { CodexMessageItem } from '../hooks/codex-session-types'
import type { UnifiedTimelineRenderRow } from '../components/chat/unified-timeline-model'
import type { TodoItem } from '../components/chat/TodoDock'
import {
  groupAdjacentExploreRows,
  groupAdjacentTimelineExplorationRows,
  groupAdjacentToolCallRows,
} from './timeline-row-grouping'
import { groupChangedFileRows } from './session-presentation-helpers'
export {
  extractReviewChangesFiles,
  groupAdjacentExploreRows,
  groupAdjacentTimelineExplorationRows,
  groupAdjacentToolCallRows,
} from './timeline-row-grouping'
export {
  buildComposerPresentation,
  buildPermissionDockData,
  buildPlanDockData,
  buildQuestionDockData,
  buildSidebarSessionPresentation,
  groupChangedFileRows,
} from './session-presentation-helpers'
export {
  buildClaudeChatBackgroundAgents,
  buildCodexBackgroundAgents,
  buildCodexBackgroundAgentsFromChildThreads,
  buildCodexBackgroundAgentsFromMessages,
  buildOpencodeBackgroundAgents,
  extractCodexTodoItemsFromMessages,
  extractOpencodeTodoItems,
  filterOutCurrentCodexThreadAgent,
} from './session-presentation-agents'
export { buildTaskListPresentation } from './session-presentation-helpers'
export type UnifiedChangedFilesGroup = {
  title: string
  files: Array<{
    id: string
    path: string
    type: string
    diff?: string
    insertions?: number
    deletions?: number
  }>
}
export type UnifiedBackgroundAgentSummary = {
  id: string
  provider: UnifiedProvider
  name: string
  role?: string
  status: 'thinking' | 'awaiting_instruction' | 'completed' | 'idle'
  statusText: string
  prompt?: string
  modelLabel?: string
  command?: string
  sessionID?: string
}
export type UnifiedSessionActivity = {
  id: string
  label: string
}
export type UnifiedPendingActionSurface =
  | {
      kind: 'permission'
      provider: UnifiedProvider
      awaiting: true
      label: string
    }
  | {
      kind: 'question'
      provider: UnifiedProvider
      awaiting: true
      label: string
    }
  | {
      kind: 'plan'
      provider: UnifiedProvider
      awaiting: true
      label: string
    }

export type UnifiedComposerState = {
  busy: boolean
  awaiting: boolean
  sending: boolean
  blockedBy: UnifiedPendingActionSurface['kind'] | null
}

export type UnifiedTaskListPresentation = {
  provider: UnifiedProvider
  items: TodoItem[]
  label: string
}

export type UnifiedSidebarSessionState = {
  sessionKey: string
  indicator: 'busy' | 'awaiting' | 'unread' | 'none'
  statusType: 'busy' | 'awaiting' | 'idle'
  activityAt: number
  unread: boolean
}

export type UnifiedSessionPresentation = {
  provider: UnifiedProvider
  rows: UnifiedTimelineRenderRow[]
}

export type UnifiedProjectedSessionPresentation = UnifiedSessionPresentation & {
  latestActivity: UnifiedSessionActivity | null
  latestActivityContent?: string | null
  placeholderTimestamp: number
}

export type UnifiedPermissionDockData = {
  provider: UnifiedProvider
  requestId: string | number
  description: string
  filePattern?: string
  command?: string[]
}

export type UnifiedQuestionDockOption = {
  label: string
  value: string
}

export type UnifiedQuestionDockQuestion = {
  id: string
  header?: string
  text: string
  options?: UnifiedQuestionDockOption[]
  multiSelect?: boolean
}

export type UnifiedQuestionDockData = {
  provider: UnifiedProvider
  requestId: string | number
  questions: UnifiedQuestionDockQuestion[]
}

export type UnifiedPlanDockData = {
  provider: 'codex'
  label: string
}

function buildCodexMessageRow(
  item: Extract<CodexMessageItem, { kind: 'message' }>,
  previousWasAssistantContent: boolean,
  isStreaming: boolean
) {
  const role = item.role === 'user' ? 'user' : 'assistant'
  return {
    row: {
      id: item.id,
      kind: 'message',
      role,
      label: role === 'user' ? 'User' : 'Codex',
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

function buildCodexAuxiliaryRow(
  item: Exclude<CodexMessageItem, { kind: 'message' | 'tool'; toolType?: 'task' }>
): UnifiedTimelineRenderRow | null {
  if (item.kind === 'thinking') {
    return { id: item.id, kind: 'thinking', summary: '', content: '' }
  }
  if (item.kind === 'status') {
    return { id: item.id, kind: 'status', label: item.label }
  }
  if (item.kind === 'reasoning') {
    return { id: item.id, kind: 'thinking', summary: item.summary, content: item.content }
  }
  if (item.kind === 'diff') {
    return {
      id: item.id,
      kind: 'diff',
      path: item.path,
      type: item.type,
      diff: item.diff,
      insertions: item.insertions,
      deletions: item.deletions,
    }
  }
  if (item.kind === 'context') {
    return {
      id: item.id,
      kind: 'context',
      items: [
        {
          toolName: item.toolType,
          title: item.title,
          status: item.status,
          detail: item.detail,
        },
      ],
    }
  }
  if (item.kind === 'explore') {
    return { id: item.id, kind: 'explore', item }
  }
  if (item.kind === 'compaction') {
    return { id: item.id, kind: 'compaction' }
  }
  return null
}

function buildCodexToolRow(item: Extract<CodexMessageItem, { kind: 'tool' }>): UnifiedTimelineRenderRow {
  if (item.toolType === 'plan' && item.output) {
    return {
      id: item.id,
      kind: 'plan-card',
      content: item.output,
      timestamp: item.timestamp,
    }
  }
  return {
    id: item.id,
    kind: 'tool',
    title: item.title,
    status: item.status,
    command: item.command,
    output: item.output,
    defaultExpanded: false,
  }
}

export function projectCodexSessionPresentation(
  messages: CodexMessageItem[],
  isStreaming: boolean
): UnifiedSessionPresentation {
  const rawRows: UnifiedTimelineRenderRow[] = []
  let previousWasAssistantContent = false

  for (const item of messages) {
    if (item.kind === 'tool' && item.toolType === 'task') {
      continue
    }

    if (item.kind === 'message') {
      const message = buildCodexMessageRow(item, previousWasAssistantContent, isStreaming)
      previousWasAssistantContent = message.previousWasAssistantContent
      rawRows.push(message.row)
      continue
    }

    previousWasAssistantContent = true

    if (item.kind === 'reasoning') {
      if (!isStreaming) {
        continue
      }
    }
    if (item.kind === 'tool') {
      rawRows.push(buildCodexToolRow(item))
      continue
    }
    const row = buildCodexAuxiliaryRow(item)
    if (row) {
      rawRows.push(row)
    }
  }

  return {
    provider: 'codex',
    rows: groupAdjacentExploreRows(
      groupAdjacentTimelineExplorationRows(
        groupAdjacentToolCallRows(groupChangedFileRows(rawRows, { enabled: !isStreaming }), {
          enabled: isStreaming,
        })
      )
    ),
  }
}
