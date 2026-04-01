import type { MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react'
import type { ProjectFileDocument, ProjectFileEntry } from '@shared/ipc'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
} from 'lucide-react'
import { getFileIcon } from '../lib/file-icons'
import type { EditablePreviewState, LineSelection } from './useProjectFilePreview'
import type { ProjectFilesTreeState } from './useProjectFilesTree'
import { PreviewModal } from './ProjectFilesPanel.preview'

type ProjectFilesPanelViewProps = {
  canEditPreview: boolean
  collapseAll: () => void
  copiedField: 'path' | 'selection' | null
  editorRef: RefObject<HTMLTextAreaElement | null>
  editorState: EditablePreviewState | null
  entries: ProjectFileEntry[]
  expanded: Record<string, boolean>
  expandAll: () => Promise<void>
  fileCountLabel: string
  isEditing: boolean
  loading: Record<string, boolean>
  onCaptureSelection: (event?: ReactMouseEvent<HTMLDivElement>) => void
  onClosePreview: () => void
  onCopyPath: () => void
  onCopySelection: () => void
  onEditorContentChange: (nextContent: string, dirty: boolean) => void
  onOpenFile: (entry: ProjectFileEntry) => void
  onSavePreview: () => void
  onSearchChange: (value: string) => void
  onSelectionChange: (selection: LineSelection | null) => void
  onUndoPreviewChanges: () => void
  preview: ProjectFileDocument | null
  previewHtmlLines: string[]
  previewLanguage: string
  previewScrollerRef: RefObject<HTMLDivElement | null>
  renderLabel: (value: string) => ReactNode
  searchActive: boolean
  searchLoading: boolean
  searchQuery: string
  selection: LineSelection | null
  selectionPopoverRef: RefObject<HTMLDivElement | null>
  setSelection: (selection: LineSelection | null) => void
  toggleDirectory: (entry: ProjectFileEntry) => void
  tree: ProjectFilesTreeState
}

function FileEntryIcon({ name }: { name: string }) {
  const { icon, color } = getFileIcon(name)
  return <span style={{ color, display: 'inline-flex', flexShrink: 0 }}>{icon}</span>
}

function FileTreeRenderer({
  entries,
  depth,
  tree,
  searchActive,
  expanded,
  loading,
  renderLabel,
  onToggle,
  onOpen,
}: {
  entries: ProjectFileEntry[]
  depth: number
  tree: ProjectFilesTreeState
  searchActive: boolean
  expanded: Record<string, boolean>
  loading: Record<string, boolean>
  renderLabel: (value: string) => ReactNode
  onToggle: (entry: ProjectFileEntry) => void
  onOpen: (entry: ProjectFileEntry) => void
}) {
  return (
    <>
      {entries.map(entry => {
        const isDir = entry.type === 'directory'
        const isOpen = searchActive || !!expanded[entry.relativePath]
        const isLoading = !!loading[entry.relativePath]
        const childEntries = tree[entry.relativePath] ?? []

        return (
          <div key={entry.relativePath} className="file-tree-row-wrap">
            <button
              type="button"
              className={`file-tree-row file-tree-${entry.type}`}
              style={{ paddingLeft: `${10 + depth * 14}px` }}
              onClick={() => {
                if (isDir) {
                  if (!searchActive) {
                    onToggle(entry)
                  }
                  return
                }
                onOpen(entry)
              }}
              title={entry.path}
            >
              <span className="file-tree-caret" aria-hidden="true">
                {isDir ? (isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span className="file-tree-caret-dot" />}
              </span>
              <span className="file-tree-icon" aria-hidden="true">
                {isDir ? (isOpen ? <FolderOpen size={14} /> : <Folder size={14} />) : <FileEntryIcon name={entry.name} />}
              </span>
              <span className="file-tree-label">{renderLabel(entry.name)}</span>
            </button>
            {isDir && isOpen ? (
              <div className="file-tree-children">
                {isLoading ? <p className="file-tree-loading">Loading...</p> : null}
                {!isLoading ? (
                  <FileTreeRenderer
                    entries={childEntries}
                    depth={depth + 1}
                    tree={tree}
                    searchActive={searchActive}
                    expanded={expanded}
                    loading={loading}
                    renderLabel={renderLabel}
                    onToggle={onToggle}
                    onOpen={onOpen}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        )
      })}
    </>
  )
}

function ProjectFilesToolbar({
  collapseAll,
  expandAll,
  fileCountLabel,
  onSearchChange,
  searchQuery,
}: {
  collapseAll: () => void
  expandAll: () => Promise<void>
  fileCountLabel: string
  onSearchChange: (value: string) => void
  searchQuery: string
}) {
  return (
    <div className="files-panel-header">
      <div className="files-panel-search-row">
        <input
          type="search"
          className="files-panel-search"
          placeholder="Search files"
          value={searchQuery}
          onChange={event => onSearchChange(event.target.value)}
          aria-label="Search project files"
        />
      </div>
      <div className="files-panel-actions-row">
        <span className="files-panel-count">{fileCountLabel}</span>
        <div className="files-panel-actions">
          <button
            type="button"
            className="files-panel-icon-action"
            onClick={() => void expandAll()}
            title="Expand all"
            aria-label="Expand all folders"
          >
            <FolderOpen size={14} />
          </button>
          <button
            type="button"
            className="files-panel-icon-action"
            onClick={collapseAll}
            title="Collapse all"
            aria-label="Collapse all folders"
          >
            <Folder size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

export function ProjectFilesPanelView({
  canEditPreview,
  collapseAll,
  copiedField,
  editorRef,
  editorState,
  entries,
  expanded,
  expandAll,
  fileCountLabel,
  isEditing,
  loading,
  onCaptureSelection,
  onClosePreview,
  onCopyPath,
  onCopySelection,
  onEditorContentChange,
  onOpenFile,
  onSavePreview,
  onSearchChange,
  onSelectionChange,
  onUndoPreviewChanges,
  preview,
  previewHtmlLines,
  previewLanguage,
  previewScrollerRef,
  renderLabel,
  searchActive,
  searchLoading,
  searchQuery,
  selection,
  selectionPopoverRef,
  setSelection,
  toggleDirectory,
  tree,
}: ProjectFilesPanelViewProps) {
  return (
    <section className="ops-section ops-section-fill files-panel">
      <ProjectFilesToolbar
        collapseAll={collapseAll}
        expandAll={expandAll}
        fileCountLabel={fileCountLabel}
        onSearchChange={onSearchChange}
        searchQuery={searchQuery}
      />
      <div className="file-tree-scroll">
        {searchActive && searchLoading ? <p className="file-tree-loading">Searching files...</p> : null}
        {entries.length === 0 ? (
          <p className="file-tree-loading">{searchActive ? 'No matching files.' : 'No files found.'}</p>
        ) : (
          <FileTreeRenderer
            entries={entries}
            depth={0}
            tree={tree}
            searchActive={searchActive}
            expanded={expanded}
            loading={loading}
            renderLabel={renderLabel}
            onToggle={toggleDirectory}
            onOpen={onOpenFile}
          />
        )}
      </div>

      {preview ? (
        <PreviewModal
          canEditPreview={canEditPreview}
          copiedField={copiedField}
          editorRef={editorRef}
          editorState={editorState}
          isEditing={isEditing}
          onCaptureSelection={onCaptureSelection}
          onClosePreview={onClosePreview}
          onCopyPath={onCopyPath}
          onCopySelection={onCopySelection}
          onEditorContentChange={onEditorContentChange}
          onSavePreview={onSavePreview}
          onSelectionChange={onSelectionChange}
          onUndoPreviewChanges={onUndoPreviewChanges}
          preview={preview}
          previewHtmlLines={previewHtmlLines}
          previewLanguage={previewLanguage}
          previewScrollerRef={previewScrollerRef}
          selection={selection}
          selectionPopoverRef={selectionPopoverRef}
          setSelection={setSelection}
        />
      ) : null}
    </section>
  )
}
