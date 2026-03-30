import { ShieldAlert } from 'lucide-react'
import { DockSurface } from './DockSurface'

export interface PermissionDockProps {
  description: string
  filePattern?: string
  command?: string[]
  onDecide: (decision: 'allow_once' | 'allow_always' | 'reject') => void
}

export function PermissionDock({
  description,
  filePattern,
  command,
  onDecide,
}: PermissionDockProps) {
  return (
    <DockSurface title="Permission Request" icon={<ShieldAlert size={13} />}>
      <div className="permission-dock">
        <p className="permission-dock-description">{description}</p>

        {filePattern ? (
          <div className="permission-preview permission-preview--file">
            <code className="permission-preview-code">{filePattern}</code>
          </div>
        ) : null}

        {command && command.length > 0 ? (
          <div className="permission-preview permission-preview--command">
            <pre className="permission-preview-code">
              <span className="permission-preview-prompt" aria-hidden="true">
                ${' '}
              </span>
              {command.join(' ')}
            </pre>
          </div>
        ) : null}

        <div className="permission-actions">
          <button
            type="button"
            className="permission-btn permission-btn--allow-once"
            onClick={() => onDecide('allow_once')}
          >
            Allow once
          </button>
          <button
            type="button"
            className="permission-btn permission-btn--allow-always"
            onClick={() => onDecide('allow_always')}
          >
            Always allow
          </button>
          <button
            type="button"
            className="permission-btn permission-btn--reject"
            onClick={() => onDecide('reject')}
          >
            Reject
          </button>
        </div>
      </div>
    </DockSurface>
  )
}
