import { ChevronDown } from 'lucide-react'
import { DockSurface } from './DockSurface'
import { DiffBlock } from './DiffBlock'

export interface ReviewChangeItem {
  id: string
  path: string
  type: string
  diff?: string
  insertions?: number
  deletions?: number
}

export interface SessionChangeTarget {
  id: string
  label: string
  timestamp: number
  files: ReviewChangeItem[]
  canRevert: boolean
  disabledReason?: string
}

interface ReviewChangesDockProps {
  targets: SessionChangeTarget[]
  open: boolean
  onToggle: () => void
  onOpenPath?: (path: string) => void
  onRevertTarget?: (targetId: string) => void | Promise<void>
}

function formatTargetTime(timestamp: number) {
  if (!timestamp) {
    return ''
  }
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ReviewChangesDock({
  targets,
  open,
  onToggle,
  onOpenPath,
  onRevertTarget,
}: ReviewChangesDockProps) {
  const count = targets.length
  const label = `${count} turn${count !== 1 ? 's' : ''}`

  return (
    <DockSurface
      className={`dock-surface--compact-width${open ? '' : ' dock-surface--collapsed-inline'}`.trim()}
    >
      <div className="todo-dock review-changes-dock">
        <button
          type="button"
          className="todo-dock-header"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? 'Collapse review changes' : 'Expand review changes'}
        >
          <span className="review-changes-label">Review changes</span>
          <span className="review-changes-count">{label}</span>
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={`todo-dock-chevron ${open ? 'is-open' : ''}`.trim()}
          />
        </button>

        {open ? (
          <div className="review-changes-list">
            {targets.map(target => (
              <section key={target.id} className="review-changes-target">
                <div className="review-changes-target-header">
                  <div className="review-changes-target-meta">
                    <strong>{target.label}</strong>
                    <span className="review-changes-target-time">{formatTargetTime(target.timestamp)}</span>
                    {target.disabledReason ? (
                      <span className="review-changes-target-reason">{target.disabledReason}</span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="git-file-action-btn"
                    disabled={!target.canRevert}
                    onClick={() => void onRevertTarget?.(target.id)}
                    title={target.canRevert ? 'Revert this turn' : target.disabledReason ?? 'Revert unavailable'}
                  >
                    Revert turn
                  </button>
                </div>
                <div className="review-changes-target-files">
                  {target.files.map(file => (
                    <DiffBlock
                      key={file.id}
                      path={file.path}
                      type={file.type}
                      diff={file.diff}
                      insertions={file.insertions}
                      deletions={file.deletions}
                      onOpenPath={onOpenPath}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </DockSurface>
  )
}
