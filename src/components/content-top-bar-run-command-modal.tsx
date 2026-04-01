import { createPortal } from 'react-dom'
import { Play, X } from 'lucide-react'
import type { RefObject } from 'react'

type RunCommandModalProps = {
  open: boolean
  title: string
  commands: string
  error: string | null
  saving: boolean
  onClose: () => void
  onTitleChange: (value: string) => void
  onCommandsChange: (value: string) => void
  onSave: (runAfterSave: boolean) => Promise<void>
  titleInputRef: RefObject<HTMLInputElement | null>
}

export function RunCommandModal({
  open,
  title,
  commands,
  error,
  saving,
  onClose,
  onTitleChange,
  onCommandsChange,
  onSave,
  titleInputRef,
}: RunCommandModalProps) {
  if (!open) return null

  return createPortal(
    <div
      className="run-command-modal-overlay"
      onClick={event => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section className="run-command-modal" role="dialog" aria-modal="true" aria-labelledby="custom-run-command-title">
        <header className="run-command-modal-header">
          <span className="run-command-modal-icon" aria-hidden="true">
            <Play size={14} />
          </span>
          <button type="button" className="run-command-modal-close" aria-label="Close custom run command modal" onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </button>
        </header>
        <h3 id="custom-run-command-title">Run</h3>
        <p>Save a reusable command set. Enter one command per line.</p>
        <label className="run-command-modal-field">
          <span>Name</span>
          <input
            ref={titleInputRef}
            type="text"
            value={title}
            onChange={event => onTitleChange(event.target.value)}
            placeholder="Install and start"
          />
        </label>
        <label className="run-command-modal-field">
          <span>Command to run</span>
          <textarea
            value={commands}
            onChange={event => onCommandsChange(event.target.value)}
            rows={8}
            placeholder={'eg:\nnpm install\nnpm run dev'}
          />
        </label>
        {error ? <p className="run-command-modal-error">{error}</p> : null}
        <footer className="run-command-modal-actions">
          <button type="button" className="ghost" onClick={() => void onSave(false)} disabled={saving}>
            Save
          </button>
          <button type="button" onClick={() => void onSave(true)} disabled={saving}>
            Save and run
          </button>
        </footer>
      </section>
    </div>,
    document.body
  )
}
