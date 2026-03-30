import type { TodoItem } from '../components/chat/TodoDock'
import type { UnifiedProvider, UnifiedSessionStatus } from '../state/unified-runtime'
import type { UnifiedTimelineRenderRow } from '../components/chat/unified-timeline-model'
import type {
  UnifiedPendingActionSurface,
  UnifiedPermissionDockData,
  UnifiedPlanDockData,
  UnifiedQuestionDockData,
  UnifiedQuestionDockQuestion,
  UnifiedSidebarSessionState,
  UnifiedTaskListPresentation,
} from './session-presentation'

export function buildSidebarSessionPresentation(input: {
  sessionKey: string
  status: UnifiedSessionStatus
  updatedAt: number
  isActive: boolean
}): UnifiedSidebarSessionState {
  const { isActive, sessionKey, status, updatedAt } = input
  const activityAt = Math.max(updatedAt, status.activityAt)
  if (isActive) {
    return {
      sessionKey,
      indicator: 'none',
      statusType: status.busy ? 'busy' : status.awaiting || status.planReady ? 'awaiting' : 'idle',
      activityAt,
      unread: false,
    }
  }
  if (status.awaiting || status.planReady) {
    return {
      sessionKey,
      indicator: 'awaiting',
      statusType: 'awaiting',
      activityAt,
      unread: status.unread,
    }
  }
  if (status.busy) {
    return {
      sessionKey,
      indicator: 'busy',
      statusType: 'busy',
      activityAt,
      unread: status.unread,
    }
  }
  if (!isActive && status.unread && activityAt > 0) {
    return {
      sessionKey,
      indicator: 'unread',
      statusType: 'idle',
      activityAt,
      unread: true,
    }
  }
  return {
    sessionKey,
    indicator: 'none',
    statusType: 'idle',
    activityAt,
    unread: status.unread,
  }
}

export function buildComposerPresentation(input: {
  status: UnifiedSessionStatus | null
  sending: boolean
  pending: UnifiedPendingActionSurface | null
}) {
  return {
    busy: Boolean(input.status?.busy) || input.sending,
    awaiting: Boolean(input.status?.awaiting || input.status?.planReady),
    sending: input.sending,
    blockedBy: input.pending?.kind ?? null,
  }
}

export function buildPermissionDockData(input: {
  provider: UnifiedProvider
  requestId: string | number
  description: string
  filePattern?: string
  command?: string[]
}): UnifiedPermissionDockData {
  return input
}

export function buildQuestionDockData(input: {
  provider: UnifiedProvider
  requestId: string | number
  questions: UnifiedQuestionDockQuestion[]
}): UnifiedQuestionDockData {
  return input
}

export function buildPlanDockData(input: { label?: string }): UnifiedPlanDockData {
  return {
    provider: 'codex',
    label: input.label ?? 'Plan ready for review',
  }
}

export function buildTaskListPresentation(
  provider: UnifiedProvider,
  items: TodoItem[]
): UnifiedTaskListPresentation | null {
  if (items.length === 0) {
    return null
  }
  return {
    provider,
    items,
    label: provider === 'codex' ? 'Task list' : 'Todo list',
  }
}

export function groupChangedFileRows(
  rows: UnifiedTimelineRenderRow[],
  options?: { enabled?: boolean }
): UnifiedTimelineRenderRow[] {
  if (options?.enabled === false) {
    return rows
  }
  const nextRows: UnifiedTimelineRenderRow[] = []
  let pendingAssistantMessage: UnifiedTimelineRenderRow | null = null
  let pendingRows: UnifiedTimelineRenderRow[] = []
  let pendingDiffs: Extract<UnifiedTimelineRenderRow, { kind: 'diff' }>[] = []

  const flush = () => {
    if (pendingAssistantMessage) {
      nextRows.push(pendingAssistantMessage)
      nextRows.push(...pendingRows)
      if (pendingDiffs.length > 0) {
        nextRows.push({
          id: `${pendingAssistantMessage.id}:changed-files`,
          kind: 'diff-group',
          title: 'Changed files',
          files: pendingDiffs.map(diff => ({
            id: diff.id,
            path: diff.path,
            type: diff.type,
            diff: diff.diff,
            insertions: diff.insertions,
            deletions: diff.deletions,
          })),
        } satisfies Extract<UnifiedTimelineRenderRow, { kind: 'diff-group' }>)
      }
      pendingAssistantMessage = null
      pendingRows = []
      pendingDiffs = []
      return
    }

    if (pendingRows.length > 0) {
      nextRows.push(...pendingRows)
      pendingRows = []
    }

    if (pendingDiffs.length > 0) {
      nextRows.push({
        id: `${pendingDiffs[0]?.id ?? 'diff-group'}:changed-files`,
        kind: 'diff-group',
        title: 'Changed files',
        files: pendingDiffs.map(diff => ({
          id: diff.id,
          path: diff.path,
          type: diff.type,
          diff: diff.diff,
          insertions: diff.insertions,
          deletions: diff.deletions,
        })),
      } satisfies Extract<UnifiedTimelineRenderRow, { kind: 'diff-group' }>)
      pendingDiffs = []
    }
  }

  const pushRow = (row: UnifiedTimelineRenderRow) => {
    if (pendingAssistantMessage) {
      pendingRows.push(row)
      return
    }
    nextRows.push(row)
  }

  for (const row of rows) {
    if (row.kind === 'message') {
      flush()
      if (row.role === 'assistant') {
        pendingAssistantMessage = row
      } else {
        nextRows.push(row)
      }
      continue
    }

    if (row.kind === 'diff') {
      pendingDiffs.push(row)
      continue
    }

    pushRow(row)
  }

  flush()
  return nextRows
}
