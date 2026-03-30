import { useState } from 'react'
import { DockSurface } from './DockSurface'
import { CheckCircle, Edit3 } from 'lucide-react'

export interface PlanReadyDockProps {
  onAccept: () => void
  onSubmitChanges: (changes: string) => void
}

export function PlanReadyDock({ onAccept, onSubmitChanges }: PlanReadyDockProps) {
  const [changes, setChanges] = useState('')
  const [showTextarea, setShowTextarea] = useState(false)

  const footer = (
    <div className="plan-ready-dock-footer">
      {showTextarea ? (
        <>
          <button
            type="button"
            className="plan-ready-dock-cancel"
            onClick={() => {
              setShowTextarea(false)
              setChanges('')
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="plan-ready-dock-send"
            disabled={!changes.trim()}
            onClick={() => {
              if (changes.trim()) {
                onSubmitChanges(changes.trim())
                setChanges('')
                setShowTextarea(false)
              }
            }}
          >
            Send changes
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="plan-ready-dock-modify"
            onClick={() => setShowTextarea(true)}
          >
            <Edit3 size={13} aria-hidden="true" />
            Modify plan
          </button>
          <button type="button" className="plan-ready-dock-accept" onClick={onAccept}>
            <CheckCircle size={13} aria-hidden="true" />
            Implement this plan
          </button>
        </>
      )}
    </div>
  )

  return (
    <DockSurface title="Plan ready" footer={footer}>
      <div className="plan-ready-dock">
        {showTextarea ? (
          <>
            <p className="plan-ready-dock-label">Describe what you want to change:</p>
            <textarea
              className="plan-ready-dock-textarea"
              value={changes}
              onChange={e => setChanges(e.target.value)}
              placeholder="e.g. add authentication, remove the caching step..."
              rows={3}
              autoFocus
            />
          </>
        ) : (
          <p className="plan-ready-dock-message">
            The agent has finished planning. You can implement it now or request changes.
          </p>
        )}
      </div>
    </DockSurface>
  )
}
