import type { MouseEvent as ReactMouseEvent, RefObject } from 'react'
import type { ProjectFileDocument } from '@shared/ipc'
import { Check, ClipboardCopy, FileText, RotateCcw, Save, X } from 'lucide-react'
import type { EditablePreviewState, LineSelection } from './useProjectFilePreview'

function PreviewHeader({
  preview,
  canEdit,
  editorState,
  copiedField,
  onCopyPath,
  onUndo,
  onSave,
  onClose,
}: {
  preview: ProjectFileDocument
  canEdit: boolean
  editorState: EditablePreviewState | null
  copiedField: 'path' | 'selection' | null
  onCopyPath: () => void
  onUndo: () => void
  onSave: () => void
  onClose: () => void
}) {
  return (
    <header className="file-preview-header">
      <div className="file-preview-title-row">
        <strong title={preview.relativePath}>{preview.relativePath}</strong>
        <div className="file-preview-actions">
          <button
            type="button"
            className={`file-preview-icon-action ${copiedField === 'path' ? 'file-preview-icon-action--copied' : ''}`.trim()}
            onClick={onCopyPath}
            aria-label="Copy file path"
            title="Copy file path to clipboard"
          >
            {copiedField === 'path' ? <Check size={14} aria-hidden="true" /> : <ClipboardCopy size={14} aria-hidden="true" />}
          </button>
          {canEdit && editorState ? (
            <>
              <button
                type="button"
                className="file-preview-icon-action"
                onClick={onUndo}
                disabled={!editorState.dirty || editorState.saving}
                aria-label="Undo changes"
                title="Undo changes"
              >
                <RotateCcw size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="file-preview-icon-action"
                onClick={onSave}
                disabled={!editorState.dirty || editorState.saving}
                aria-label={editorState.saving ? 'Saving...' : 'Save file'}
                title={editorState.saving ? 'Saving...' : 'Save file'}
              >
                <Save size={14} aria-hidden="true" />
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="file-preview-icon-action"
            onClick={onClose}
            aria-label="Close preview"
            title="Close preview"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      {preview.truncated ? <small>Preview truncated</small> : null}
    </header>
  )
}

function PreviewEditor({
  content,
  editorRef,
  onContentChange,
  onSelectionChange,
}: {
  content: string
  editorRef: RefObject<HTMLTextAreaElement | null>
  onContentChange: (content: string, dirty: boolean) => void
  onSelectionChange: (selection: LineSelection | null) => void
}) {
  return (
    <textarea
      ref={editorRef}
      className="file-preview-editor"
      value={content}
      onChange={event => {
        const nextContent = event.target.value
        onContentChange(nextContent, nextContent !== content)
      }}
      onSelect={() => {
        const textarea = editorRef.current
        if (!textarea) return
        const { selectionStart, selectionEnd } = textarea
        if (selectionStart === selectionEnd) {
          onSelectionChange(null)
          return
        }
        const startLine = content.substring(0, selectionStart).split('\n').length
        const endLine = content.substring(0, selectionEnd).split('\n').length
        onSelectionChange({
          startLine,
          endLine,
          top: 0,
          left: 0,
          anchorTop: 0,
          anchorBottom: 0,
          clamped: false,
        })
      }}
      spellCheck={false}
    />
  )
}

function SelectionPopover({
  selection,
  isEditing,
  copiedField,
  popoverRef,
  onCopy,
  onClose,
}: {
  selection: LineSelection
  isEditing: boolean
  copiedField: 'path' | 'selection' | null
  popoverRef: RefObject<HTMLDivElement | null>
  onCopy: () => void
  onClose: () => void
}) {
  const style = isEditing ? undefined : { top: `${selection.top}px`, left: `${selection.left}px` }

  return (
    <div
      ref={popoverRef}
      className={`file-preview-selection-popover ${isEditing ? 'file-preview-selection-popover--fixed' : ''}`.trim()}
      style={style}
      onMouseDown={event => event.stopPropagation()}
      onMouseUp={event => event.stopPropagation()}
    >
      <small className="file-preview-selection-label">
        {selection.startLine === selection.endLine ? `Line ${selection.startLine}` : `Lines ${selection.startLine}-${selection.endLine}`}
      </small>
      <div className="file-preview-selection-actions">
        <button
          type="button"
          className={`file-preview-selection-add ${copiedField === 'selection' ? 'file-preview-selection-add--copied' : ''}`.trim()}
          onClick={onCopy}
        >
          {copiedField === 'selection' ? <Check size={12} aria-hidden="true" /> : <ClipboardCopy size={12} aria-hidden="true" />}
          {copiedField === 'selection' ? 'Copied!' : 'Copy reference'}
        </button>
        <button
          type="button"
          className="file-preview-selection-close"
          onClick={onClose}
          aria-label="Close selection actions"
        >
          <X size={12} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

function HighlightedPreview({ lines, relativePath }: { lines: string[]; relativePath: string }) {
  return (
    <>
      {lines.map((line, index) => (
        <div
          key={`${relativePath}-line-${index + 1}`}
          className="file-preview-line"
          data-line-number={index + 1}
        >
          <span className="file-preview-line-number">{index + 1}</span>
          <span
            className="file-preview-line-code"
            data-line-number={index + 1}
            dangerouslySetInnerHTML={{ __html: line.length > 0 ? line : ' ' }}
          />
        </div>
      ))}
    </>
  )
}

export function PreviewModal({
  canEditPreview,
  copiedField,
  editorRef,
  editorState,
  isEditing,
  onCaptureSelection,
  onClosePreview,
  onCopyPath,
  onCopySelection,
  onEditorContentChange,
  onSavePreview,
  onSelectionChange,
  onUndoPreviewChanges,
  preview,
  previewHtmlLines,
  previewLanguage,
  previewScrollerRef,
  selection,
  selectionPopoverRef,
  setSelection,
}: {
  canEditPreview: boolean
  copiedField: 'path' | 'selection' | null
  editorRef: RefObject<HTMLTextAreaElement | null>
  editorState: EditablePreviewState | null
  isEditing: boolean
  onCaptureSelection: (event?: ReactMouseEvent<HTMLDivElement>) => void
  onClosePreview: () => void
  onCopyPath: () => void
  onCopySelection: () => void
  onEditorContentChange: (nextContent: string, dirty: boolean) => void
  onSavePreview: () => void
  onSelectionChange: (selection: LineSelection | null) => void
  onUndoPreviewChanges: () => void
  preview: ProjectFileDocument
  previewHtmlLines: string[]
  previewLanguage: string
  previewScrollerRef: RefObject<HTMLDivElement | null>
  selection: LineSelection | null
  selectionPopoverRef: RefObject<HTMLDivElement | null>
  setSelection: (selection: LineSelection | null) => void
}) {
  return (
    <div className="overlay file-preview-overlay" onMouseDown={() => setSelection(null)}>
      <div className="modal file-preview-modal" onMouseDown={event => event.stopPropagation()}>
        <PreviewHeader
          preview={preview}
          canEdit={canEditPreview}
          editorState={editorState}
          copiedField={copiedField}
          onCopyPath={onCopyPath}
          onUndo={onUndoPreviewChanges}
          onSave={onSavePreview}
          onClose={onClosePreview}
        />
        <div
          ref={previewScrollerRef}
          className={`file-preview-content language-${previewLanguage}`}
          onMouseUp={onCaptureSelection}
          onScroll={() => setSelection(null)}
        >
          {isEditing && editorState ? (
            <PreviewEditor
              content={editorState.content}
              editorRef={editorRef}
              onContentChange={onEditorContentChange}
              onSelectionChange={onSelectionChange}
            />
          ) : preview.binary ? (
            <div className="file-preview-line" data-line-number={1}>
              <span className="file-preview-line-number">1</span>
              <span className="file-preview-line-code">{preview.content ?? ''}</span>
            </div>
          ) : (
            <HighlightedPreview lines={previewHtmlLines} relativePath={preview.relativePath} />
          )}

          {selection ? (
            <SelectionPopover
              selection={selection}
              isEditing={isEditing}
              copiedField={copiedField}
              popoverRef={selectionPopoverRef}
              onCopy={onCopySelection}
              onClose={() => setSelection(null)}
            />
          ) : null}
        </div>
        <footer className="file-preview-footer">
          <FileText size={13} aria-hidden="true" />
          <span>Select text to copy file path and line numbers. Edits auto-save with Cmd/Ctrl+S.</span>
        </footer>
      </div>
    </div>
  )
}
