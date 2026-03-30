import { useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { DockSurface } from './DockSurface'

export interface PlanDockProps {
  onAccept: () => void
  onSubmitChanges: (changes: string) => void
  onDismiss: () => void
}

export function PlanDock({ onAccept, onSubmitChanges, onDismiss }: PlanDockProps) {
  const [changes, setChanges] = useState('')

  const footer = (
    <div className="plan-dock-footer">
      <button type="button" className="plan-dock-btn plan-dock-btn--accept" onClick={onAccept}>
        Implement this plan
      </button>
      {changes.trim() ? (
        <button
          type="button"
          className="plan-dock-btn plan-dock-btn--send"
          onClick={() => {
            onSubmitChanges(changes.trim())
            setChanges('')
          }}
        >
          Send changes
        </button>
      ) : null}
    </div>
  )

  return (
    <DockSurface
      title="Plan ready"
      icon={<ClipboardList size={13} />}
      onClose={onDismiss}
      footer={footer}
    >
      <input
        type="text"
        className="plan-dock-input"
        value={changes}
        onChange={e => setChanges(e.target.value)}
        placeholder="No, tell Codex what to do differently..."
        onKeyDown={e => {
          if (e.key === 'Enter' && changes.trim()) {
            onSubmitChanges(changes.trim())
            setChanges('')
          }
        }}
      />
    </DockSurface>
  )
}
