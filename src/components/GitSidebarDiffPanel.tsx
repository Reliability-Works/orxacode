import { AlignJustify, ChevronDown, ChevronRight, Columns2, Eye, List, Minus, PanelRightClose, PanelRightOpen, Plus, RotateCcw } from 'lucide-react'
import type { ChangeProvenanceRecord } from '@shared/ipc'
import type { GitDiffViewMode } from '../hooks/useGitPanel'
import type { GitDiffFile } from '../lib/git-diff'
import { inferStatusTag } from '../lib/git-diff'
import { GitSidebarHunkRows } from './GitSidebarDiffHunks'
import { GitSidebarTreeView } from './GitSidebarFileTree'
import { GitSidebarTabDropdown } from './GitSidebarTabDropdown'
import type { GitSidebarPanelModel } from './useGitSidebarPanelModel'

function GitSidebarFileActionButtons({
  file,
  pendingAction,
  onRestoreFile,
  onStageFile,
  onUnstageFile,
  onRunFileAction,
}: {
  file: GitDiffFile
  pendingAction: string | null
  onRestoreFile?: (filePath: string) => Promise<void>
  onStageFile?: (filePath: string) => Promise<void>
  onUnstageFile?: (filePath: string) => Promise<void>
  onRunFileAction: (actionKey: string, action: () => Promise<void>, successMessage: string) => void
}) {
  return (
    <span className="git-list-actions" onClick={event => event.stopPropagation()}>
      {file.hasUnstaged && onRestoreFile ? (
        <button
          type="button"
          className="git-file-action-btn"
          onClick={() =>
            onRunFileAction(`restore:${file.key}`, () => onRestoreFile(file.path), `Restored ${file.path}`)
          }
          disabled={pendingAction === `restore:${file.key}`}
          title="Restore"
        >
          <RotateCcw size={14} />
        </button>
      ) : null}
      {file.hasUnstaged && onStageFile ? (
        <button
          type="button"
          className="git-file-action-btn"
          onClick={() =>
            onRunFileAction(`stage:${file.key}`, () => onStageFile(file.path), `Staged ${file.path}`)
          }
          disabled={pendingAction === `stage:${file.key}`}
          title="Stage"
        >
          <Plus size={14} />
        </button>
      ) : null}
      {file.hasStaged && onUnstageFile ? (
        <button
          type="button"
          className="git-file-action-btn"
          onClick={() =>
            onRunFileAction(`unstage:${file.key}`, () => onUnstageFile(file.path), `Unstaged ${file.path}`)
          }
          disabled={pendingAction === `unstage:${file.key}`}
          title="Unstage"
        >
          <Minus size={14} />
        </button>
      ) : null}
    </span>
  )
}

function GitSidebarListView({
  files,
  selectedKey,
  pendingAction,
  onRestoreFile,
  onStageFile,
  onUnstageFile,
  onRunFileAction,
  resolveProvenance,
  formatProvenanceLabel,
  onSelect,
}: {
  files: GitDiffFile[]
  selectedKey: string | null
  pendingAction: string | null
  onRestoreFile?: (filePath: string) => Promise<void>
  onStageFile?: (filePath: string) => Promise<void>
  onUnstageFile?: (filePath: string) => Promise<void>
  onRunFileAction: (actionKey: string, action: () => Promise<void>, successMessage: string) => void
  resolveProvenance: (file: Pick<GitDiffFile, 'path' | 'oldPath'>) => ChangeProvenanceRecord | null
  formatProvenanceLabel: (record: ChangeProvenanceRecord | null) => string
  onSelect: (key: string) => void
}) {
  return (
    <div className="git-list-view">
      <div className="git-list-files">
        {files.map(file => {
          const provenanceLabel = formatProvenanceLabel(resolveProvenance(file))
          const fileName = file.path.split('/').pop() ?? file.path
          const dirPath = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''

          return (
            <div
              key={file.key}
              className={`git-list-card${selectedKey === file.key ? ' active' : ''}`}
              onClick={() => onSelect(selectedKey === file.key ? '' : file.key)}
              role="button"
              tabIndex={0}
            >
              <span className={`git-list-status git-file-status-${file.status}`}>{inferStatusTag(file.status)}</span>
              <span className="git-list-info">
                <span className="git-list-filename">{fileName}</span>
                {dirPath ? <span className="git-list-dir">{dirPath}</span> : null}
                <span className={`git-list-provenance ${provenanceLabel === 'Unknown provenance' ? 'unknown' : ''}`.trim()}>
                  {provenanceLabel}
                </span>
              </span>
              <span className="git-list-meta">
                <span className="git-list-stats">
                  <span className="added">+{file.added}</span>
                  <span className="git-list-stats-sep">/</span>
                  <span className="removed">-{file.removed}</span>
                </span>
                <GitSidebarFileActionButtons
                  file={file}
                  pendingAction={pendingAction}
                  onRestoreFile={onRestoreFile}
                  onStageFile={onStageFile}
                  onUnstageFile={onUnstageFile}
                  onRunFileAction={onRunFileAction}
                />
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function GitSidebarDiffViewModes({
  gitDiffViewMode,
  setGitDiffViewMode,
}: {
  gitDiffViewMode: GitDiffViewMode
  setGitDiffViewMode: (mode: GitDiffViewMode) => void
}) {
  return (
    <div className="ops-git-view-modes">
      <button
        type="button"
        className={`git-action-icon-btn ${gitDiffViewMode === 'list' ? 'active' : ''}`.trim()}
        aria-label="List view"
        title="List view"
        onClick={() => setGitDiffViewMode('list')}
      >
        <List size={13} />
      </button>
      <button
        type="button"
        className={`git-action-icon-btn ${gitDiffViewMode === 'unified' ? 'active' : ''}`.trim()}
        aria-label="Unified view"
        title="Unified view"
        onClick={() => setGitDiffViewMode('unified')}
      >
        <AlignJustify size={13} />
      </button>
      <button
        type="button"
        className={`git-action-icon-btn ${gitDiffViewMode === 'split' ? 'active' : ''}`.trim()}
        aria-label="Split view"
        title="Split view"
        onClick={() => setGitDiffViewMode('split')}
      >
        <Columns2 size={13} />
      </button>
    </div>
  )
}

function GitSidebarBulkActionButtons({
  model,
  gitDiffViewMode,
  setGitDiffViewMode,
  firstFile,
}: {
  model: GitSidebarPanelModel
  gitDiffViewMode: GitDiffViewMode
  setGitDiffViewMode: (mode: GitDiffViewMode) => void
  firstFile: GitDiffFile | undefined
}) {
  const {
    pendingAction,
    hasUnstagedFiles,
    runFileAction,
    onStageAllChanges,
    onDiscardAllChanges,
    parsedDiff,
    setSelectedDiffKey,
  } = model

  return (
    <>
      <button
        type="button"
        className="git-action-icon-btn"
        onClick={() => {
          if (onStageAllChanges) {
            void runFileAction('stage-all', onStageAllChanges, 'Staged all local changes.')
          }
        }}
        disabled={pendingAction === 'stage-all' || !onStageAllChanges || parsedDiff.files.length === 0}
        aria-label="Stage all changes"
        title="Stage all changes"
      >
        <Plus size={16} />
      </button>
      <button
        type="button"
        className="git-action-icon-btn"
        onClick={() => {
          if (onDiscardAllChanges) {
            void runFileAction('discard-all', onDiscardAllChanges, 'Discarded all unstaged changes.')
          }
        }}
        disabled={pendingAction === 'discard-all' || !onDiscardAllChanges || !hasUnstagedFiles}
        aria-label="Discard changes"
        title="Discard changes"
      >
        <RotateCcw size={16} />
      </button>
      <button
        type="button"
        className="git-action-icon-btn"
        onClick={() => {
          if (!firstFile) {
            return
          }
          setSelectedDiffKey(firstFile.key)
          if (gitDiffViewMode !== 'list') {
            setGitDiffViewMode('unified')
          }
          document.getElementById('diff-file-0')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }}
        disabled={parsedDiff.files.length === 0}
        aria-label="Review changes"
        title="Review changes"
      >
        <Eye size={16} />
      </button>
    </>
  )
}

function GitSidebarDiffActions({
  gitDiffViewMode,
  setGitDiffViewMode,
  model,
  firstFile,
}: {
  gitDiffViewMode: GitDiffViewMode
  setGitDiffViewMode: (mode: GitDiffViewMode) => void
  model: GitSidebarPanelModel
  firstFile: GitDiffFile | undefined
}) {
  const {
    gitTabLabels,
    gitTabMenuOpen,
    gitTabMenuRef,
    setGitTabMenuOpen,
    selectGitTab,
  } = model

  return (
    <div className="git-files-actions">
      <GitSidebarTabDropdown
        gitTabMenuRef={gitTabMenuRef}
        gitTabMenuOpen={gitTabMenuOpen}
        gitTabLabels={gitTabLabels}
        setGitTabMenuOpen={setGitTabMenuOpen}
        selectGitTab={selectGitTab}
        currentTab="diff"
      />
      <GitSidebarDiffViewModes
        gitDiffViewMode={gitDiffViewMode}
        setGitDiffViewMode={setGitDiffViewMode}
      />
      <GitSidebarBulkActionButtons
        model={model}
        gitDiffViewMode={gitDiffViewMode}
        setGitDiffViewMode={setGitDiffViewMode}
        firstFile={firstFile}
      />
    </div>
  )
}

function GitSidebarDiffBody({
  model,
  gitDiffViewMode,
}: {
  model: GitSidebarPanelModel
  gitDiffViewMode: GitDiffViewMode
}) {
  if (model.parsedDiff.message === 'Loading diff...') {
    return <p className="git-files-empty">Loading changes...</p>
  }

  if (model.parsedDiff.files.length === 0) {
    return <p className="git-files-empty">{model.parsedDiff.message ?? 'No local changes.'}</p>
  }

  return (
    <div className={`git-diff-layout git-diff-layout-${gitDiffViewMode}${gitDiffViewMode !== 'list' && !model.showFileTree ? ' tree-hidden' : ''}`.trim()}>
      <div className="git-files-heading">
        <p className="git-files-count">Files ({model.parsedDiff.files.length})</p>
        {gitDiffViewMode !== 'list' ? (
          <button
            type="button"
            className="git-action-icon-btn"
            aria-label={model.showFileTree ? 'Hide file tree' : 'Show file tree'}
            title={model.showFileTree ? 'Hide file tree' : 'Show file tree'}
            onClick={() => model.setShowFileTree(value => !value)}
          >
            {model.showFileTree ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
          </button>
        ) : null}
      </div>
      {gitDiffViewMode === 'list' ? (
        <div className="git-list-view-pane">
          <GitSidebarListView
            files={model.parsedDiff.files}
            selectedKey={model.listViewFocusKey}
            pendingAction={model.pendingAction}
            onRestoreFile={model.onRestoreFile}
            onStageFile={model.onStageFile}
            onUnstageFile={model.onUnstageFile}
            onRunFileAction={model.runFileAction}
            resolveProvenance={model.resolveProvenance}
            formatProvenanceLabel={model.formatProvenanceLabel}
            onSelect={key => model.setListViewFocusKey(key || null)}
          />
        </div>
      ) : (
        <GitSidebarSplitLayout model={model} gitDiffViewMode={gitDiffViewMode} />
      )}
    </div>
  )
}

function GitSidebarSplitLayout({
  model,
  gitDiffViewMode,
}: {
  model: GitSidebarPanelModel
  gitDiffViewMode: GitDiffViewMode
}) {
  return (
    <>
      <div className="git-diff-multi-pane">
        {model.allFileSections.map(({ file, sections }, index) => (
          <div key={file.key} id={`diff-file-${index}`} className="git-diff-file-section">
            <div className="git-diff-file-header">
              <button
                type="button"
                className="git-diff-file-toggle"
                onClick={() =>
                  model.setCollapsedFileSections(current => ({
                    ...current,
                    [file.key]: !model.collapsedFileSections[file.key],
                  }))
                }
              >
                {model.collapsedFileSections[file.key] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </button>
              <span className="git-diff-file-path" title={file.path}>
                {file.path}
              </span>
              <span className="git-diff-file-stats">
                <span className="added">+{file.added}</span>
                <span className="removed">-{file.removed}</span>
              </span>
              <span className={`git-diff-provenance-chip ${model.resolveProvenance(file) ? '' : 'unknown'}`.trim()}>
                Why this changed: {model.formatProvenanceLabel(model.resolveProvenance(file))}
              </span>
              <GitSidebarFileActionButtons
                file={file}
                pendingAction={model.pendingAction}
                onRestoreFile={model.onRestoreFile}
                onStageFile={model.onStageFile}
                onUnstageFile={model.onUnstageFile}
                onRunFileAction={model.runFileAction}
              />
            </div>
            {!model.collapsedFileSections[file.key] ? (
              <div className="git-diff-file-body">
                {sections.map(({ section, hunks }) => (
                  <div key={section.key} className="git-diff-section">
                    {sections.length > 1 ? <div className="git-diff-section-label">{section.label}</div> : null}
                    <div className={`git-diff-hunk-body${gitDiffViewMode === 'split' ? ' split' : ''}`.trim()}>
                      <GitSidebarHunkRows
                        hunks={hunks}
                        sectionKey={section.key}
                        gitDiffViewMode={gitDiffViewMode}
                        expandedUnchangedRows={model.expandedUnchangedRows}
                        setExpandedUnchangedRows={model.setExpandedUnchangedRows}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {model.showFileTree ? (
        <div className="git-file-tree-pane">
          <GitSidebarTreeView
            nodes={model.filteredTree}
            treeFilter={model.treeFilter}
            setTreeFilter={model.setTreeFilter}
            expandedFolders={model.expandedFolders}
            setExpandedFolders={model.setExpandedFolders}
            selectedDiffKey={model.selectedDiffKey}
            fileIndexByKey={model.fileIndexByKey}
            onSelectFile={key => model.setSelectedDiffKey(key)}
          />
        </div>
      ) : null}
    </>
  )
}

function GitSidebarDiffContent({
  model,
  gitDiffViewMode,
  setGitDiffViewMode,
}: {
  model: GitSidebarPanelModel
  gitDiffViewMode: GitDiffViewMode
  setGitDiffViewMode: (mode: GitDiffViewMode) => void
}) {
  const firstFile = model.parsedDiff.files[0]

  return (
    <>
      <GitSidebarDiffActions
        gitDiffViewMode={gitDiffViewMode}
        setGitDiffViewMode={setGitDiffViewMode}
        model={model}
        firstFile={firstFile}
      />
      {model.actionError ? <p className="git-files-error">{model.actionError}</p> : null}
      <GitSidebarDiffBody model={model} gitDiffViewMode={gitDiffViewMode} />
    </>
  )
}

export function GitSidebarDiffPanel({
  model,
  gitDiffViewMode,
  setGitDiffViewMode,
}: {
  model: GitSidebarPanelModel
  gitDiffViewMode: GitDiffViewMode
  setGitDiffViewMode: (mode: GitDiffViewMode) => void
}) {
  return (
    <div className="git-files-panel">
      <GitSidebarDiffContent
        model={model}
        gitDiffViewMode={gitDiffViewMode}
        setGitDiffViewMode={setGitDiffViewMode}
      />
    </div>
  )
}
