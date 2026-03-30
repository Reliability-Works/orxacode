import { GitBranch } from 'lucide-react'
import type { KanbanTask } from '@shared/ipc'
import { providerLabel, statusLabel } from './kanban-utils'
import type { DetailTab } from './kanban-task-detail-modal.types'

type DetailModalHeaderProps = {
  task: KanbanTask
  shipLabel: string | null
  onClose: () => void
}

export function DetailModalHeader({ task, shipLabel, onClose }: DetailModalHeaderProps) {
  return (
    <header className="modal-header">
      <div className="kanban-detail-header-left">
        <h2>{task.title}</h2>
        <div className="kanban-task-detail-meta">
          <span className="kanban-task-pill kanban-task-pill--provider">
            {providerLabel(task.provider)}
          </span>
          <span
            className={`kanban-task-pill kanban-task-pill--status${task.blocked ? ' is-blocked' : ''}`.trim()}
          >
            {statusLabel(task)}
          </span>
          {task.taskBranch ? (
            <span className="kanban-task-pill kanban-task-pill--branch">
              <GitBranch size={10} />
              {task.taskBranch}
            </span>
          ) : null}
          {shipLabel ? <span className="kanban-task-pill kanban-task-pill--ship">{shipLabel}</span> : null}
        </div>
      </div>
      <button type="button" className="modal-close-btn" onClick={onClose}>
        X
      </button>
    </header>
  )
}

type DetailTabNavProps = {
  activeTab: DetailTab
  onChange: (tab: DetailTab) => void
}

export function DetailTabNav({ activeTab, onChange }: DetailTabNavProps) {
  return (
    <nav className="kanban-detail-tabs">
      {(['overview', 'diff', 'review', 'checkpoints', 'transcript'] as const).map(tab => (
        <button
          key={tab}
          type="button"
          className={`kanban-tab${activeTab === tab ? ' active' : ''}`}
          onClick={() => onChange(tab)}
        >
          {tab.charAt(0).toUpperCase() + tab.slice(1)}
        </button>
      ))}
    </nav>
  )
}
