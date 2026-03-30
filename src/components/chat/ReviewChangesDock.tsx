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

interface ReviewChangesDockProps {
  files: ReviewChangeItem[]
  open: boolean
  onToggle: () => void
  onOpenPath?: (path: string) => void
}

export function ReviewChangesDock({ files, open, onToggle, onOpenPath }: ReviewChangesDockProps) {
  const count = files.length
  const label = `${count} file${count !== 1 ? 's' : ''}`

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
            {files.map(file => (
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
        ) : null}
      </div>
    </DockSurface>
  )
}
