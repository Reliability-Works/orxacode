import type { FormEvent } from 'react'
import type { RawConfigDocument } from '@shared/ipc'
import type { OcAgentFilenameDialog } from './opencode-agents-section'

export function OcAgentFilenameModal({
  dialog,
  value,
  error,
  onClose,
  onChange,
  onSubmit,
}: {
  dialog: OcAgentFilenameDialog
  value: string
  error: string | null
  onClose: () => void
  onChange: (value: string) => void
  onSubmit: () => Promise<void>
}) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void onSubmit()
  }

  return (
    <div className="overlay settings-modal-overlay">
      <div className="modal oc-agent-filename-modal">
        <div className="modal-header">
          <h2>{dialog.title}</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <form className="oc-agent-filename-body" onSubmit={handleSubmit}>
          <p className="raw-path">
            Enter a filename. If `.md` is omitted, it will be added automatically.
          </p>
          <input
            autoFocus
            type="text"
            value={value}
            onChange={event => onChange(event.target.value)}
            placeholder="agent-name"
          />
          {error ? <p className="raw-path">{error}</p> : null}
          <div className="settings-actions">
            <button type="submit">Save</button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function RawConfigEditorModal({
  open,
  rawDoc,
  editorText,
  onClose,
  onChange,
  onSave,
  onReload,
}: {
  open: boolean
  rawDoc: RawConfigDocument | null
  editorText: string
  onClose: () => void
  onChange: (value: string) => void
  onSave: () => void
  onReload: () => void
}) {
  if (!open) {
    return null
  }

  return (
    <div className="overlay settings-modal-overlay">
      <div className="modal raw-editor-modal">
        <div className="modal-header">
          <h2>Edit opencode.json</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="raw-editor-body">
          <p className="raw-path">{rawDoc?.path}</p>
          <textarea value={editorText} onChange={event => onChange(event.target.value)} />
          <div className="settings-actions">
            <button type="button" onClick={onSave}>
              Save
            </button>
            <button type="button" onClick={onReload}>
              Reload
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
