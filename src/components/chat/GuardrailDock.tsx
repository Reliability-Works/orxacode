import { DockSurface } from './DockSurface'
import type { SessionGuardrailPrompt } from '../../lib/session-controls'

type GuardrailDockProps = {
  prompt: SessionGuardrailPrompt
  onDismissWarning?: () => void
  onContinueOnce?: () => void
  onDisableForSession?: () => void
  onOpenSettings?: () => void
}

export function GuardrailDock({
  prompt,
  onDismissWarning,
  onContinueOnce,
  onDisableForSession,
  onOpenSettings,
}: GuardrailDockProps) {
  return (
    <DockSurface className="dock-surface--compact-width">
      <div className={`todo-dock guardrail-dock guardrail-dock--${prompt.level}`.trim()}>
        <div className="todo-dock-header">
          <span className="review-changes-label">{prompt.title}</span>
        </div>
        <div className="review-changes-list">
          <p className="guardrail-dock-detail">{prompt.detail}</p>
          <div className="guardrail-dock-actions">
            {prompt.level === 'warning' ? (
              <button type="button" className="git-file-action-btn" onClick={onDismissWarning}>
                Dismiss
              </button>
            ) : (
              <>
                <button type="button" className="git-file-action-btn" onClick={onContinueOnce}>
                  Continue once
                </button>
                <button type="button" className="git-file-action-btn" onClick={onDisableForSession}>
                  Disable for session
                </button>
              </>
            )}
            <button type="button" className="git-file-action-btn" onClick={onOpenSettings}>
              Open settings
            </button>
          </div>
        </div>
      </div>
    </DockSurface>
  )
}
