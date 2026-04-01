import type { KanbanColumnId, KanbanTask, KanbanTaskStatusSummary } from '@shared/ipc'

export const KANBAN_COLUMNS: Array<{ id: KanbanColumnId; label: string }> = [
  { id: 'backlog', label: 'backlog' },
  { id: 'ready', label: 'ready' },
  { id: 'in_progress', label: 'in progress' },
  { id: 'review', label: 'review' },
  { id: 'done', label: 'done' },
]

export function providerLabel(provider: string) {
  return provider === 'opencode' ? 'OpenCode' : provider === 'codex' ? 'Codex' : 'Claude'
}

export function statusLabel(task: KanbanTask) {
  if (task.blocked) {
    return 'blocked'
  }
  return task.statusSummary.replace(/_/g, ' ')
}

export function scheduleSummary(schedule: {
  type: string
  time?: string
  days?: number[]
  intervalMinutes?: number
}) {
  if (schedule.type === 'interval') {
    return `Every ${schedule.intervalMinutes} min`
  }
  const labels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
  const days =
    (schedule.days?.length ?? 0) === 7
      ? 'Daily'
      : (schedule.days ?? []).map(day => labels[day]).join(' ')
  return `${days} at ${schedule.time}`
}

export function statusDotClass(status: KanbanTaskStatusSummary | undefined): string {
  switch (status) {
    case 'running':
    case 'starting':
      return 'kanban-status-dot is-running'
    case 'failed':
      return 'kanban-status-dot is-failed'
    case 'awaiting_review':
    case 'awaiting_input':
      return 'kanban-status-dot is-review'
    case 'completed':
      return 'kanban-status-dot is-completed'
    default:
      return ''
  }
}

export function shipStatusLabel(shipStatus: KanbanTask['shipStatus']) {
  switch (shipStatus) {
    case 'committed':
      return 'Committed'
    case 'pr_opened':
      return 'PR opened'
    case 'merged':
      return 'Merged'
    case 'trashed_after_merge':
      return 'Trashed after merge'
    default:
      return null
  }
}
