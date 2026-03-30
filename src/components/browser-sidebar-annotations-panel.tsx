import { Check, ClipboardCopy, Trash2, X } from 'lucide-react'
import type { BrowserAnnotation } from './browser-sidebar-state'

type BrowserSidebarAnnotationsPanelProps = {
  annotations: BrowserAnnotation[]
  clearAnnotations: () => void
  copied: boolean
  copyAnnotationsPrompt: () => void
  removeAnnotation: (id: string) => void
  updateAnnotationComment: (id: string, comment: string) => void
}

export function BrowserSidebarAnnotationsPanel({
  annotations,
  clearAnnotations,
  copied,
  copyAnnotationsPrompt,
  removeAnnotation,
  updateAnnotationComment,
}: BrowserSidebarAnnotationsPanelProps) {
  if (annotations.length === 0) {
    return null
  }

  return (
    <div className="browser-annotations-panel">
      <div className="browser-annotations-header">
        <span className="browser-annotations-title">Annotations ({annotations.length})</span>
      </div>
      <div className="browser-annotations-list">
        {annotations.map(annotation => (
          <div key={annotation.id} className="browser-annotation-row">
            <div className="browser-annotation-info">
              <span className="browser-annotation-element" title={annotation.element}>
                {annotation.element}
              </span>
              <span className="browser-annotation-selector" title={annotation.selector}>
                {annotation.selector}
              </span>
            </div>
            <button
              type="button"
              className="browser-annotation-delete"
              onClick={() => removeAnnotation(annotation.id)}
              aria-label={`Remove annotation for ${annotation.element}`}
              title="Remove annotation"
            >
              <X size={11} />
            </button>
            <input
              type="text"
              className="browser-annotation-comment"
              value={annotation.comment}
              onChange={event => updateAnnotationComment(annotation.id, event.target.value)}
              placeholder="Add a note..."
              aria-label={`Note for ${annotation.element}`}
            />
          </div>
        ))}
      </div>
      <div className="browser-annotations-actions">
        <button
          type="button"
          className="browser-control-btn"
          onClick={copyAnnotationsPrompt}
          disabled={annotations.length === 0}
          title="Copy annotations as a prompt to clipboard"
        >
          {copied ? <Check size={11} /> : <ClipboardCopy size={11} />}
          {copied ? 'Copied!' : 'Copy prompt'}
        </button>
        <button
          type="button"
          className="browser-control-btn danger"
          onClick={clearAnnotations}
          title="Clear all annotations"
        >
          <Trash2 size={11} />
          Clear all
        </button>
      </div>
    </div>
  )
}
