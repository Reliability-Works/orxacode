import { useMemo, useState } from 'react'
import type { CodexBrowserThreadSummary, ProjectListItem } from '@shared/ipc'

type CodexSessionBrowserModalProps = {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  threads: CodexBrowserThreadSummary[]
  loading: boolean
  projects: ProjectListItem[]
  selectedWorkspaceDirectory: string
  setSelectedWorkspaceDirectory: (directory: string) => void
  onOpenThread: (thread: CodexBrowserThreadSummary) => Promise<void>
}

function CodexSessionBrowserRows({
  rows,
  actionLabel,
  onAction,
}: {
  rows: CodexBrowserThreadSummary[]
  actionLabel: string
  onAction: (thread: CodexBrowserThreadSummary) => void
}) {
  if (rows.length === 0) {
    return null
  }

  return (
    <div className="claude-session-browser-list">
      {rows.map(thread => (
        <button
          key={thread.threadId}
          type="button"
          className="session-modal-row claude-session-browser-row"
          onClick={() => onAction(thread)}
          title={thread.preview || thread.title}
        >
          <span className="session-status-indicator idle" aria-hidden="true" />
          <div className="session-modal-row-info">
            <span className="session-modal-row-title">{thread.title}</span>
            <span className="session-modal-row-workspace">
              {thread.cwd || thread.importedSession?.directory || 'Unknown directory'}
            </span>
            {thread.preview ? (
              <span className="claude-session-browser-preview">{thread.preview}</span>
            ) : null}
          </div>
          <div className="session-modal-row-right">
            <span className="session-modal-row-time">
              {new Date(thread.lastUpdatedAt).toLocaleString()}
            </span>
            <span className="session-status-label session-status-label--idle">
              {actionLabel}
            </span>
          </div>
        </button>
      ))}
    </div>
  )
}

export function CodexSessionBrowserModal({
  isOpen,
  setIsOpen,
  threads,
  loading,
  projects,
  selectedWorkspaceDirectory,
  setSelectedWorkspaceDirectory,
  onOpenThread,
}: CodexSessionBrowserModalProps) {
  const [search, setSearch] = useState('')

  const filteredThreads = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) {
      return threads
    }
    return threads.filter(thread =>
      [
        thread.title,
        thread.preview,
        thread.cwd,
        thread.threadId,
        thread.importedSession?.directory,
      ]
        .filter((value): value is string => Boolean(value))
        .some(value => value.toLowerCase().includes(normalized))
    )
  }, [search, threads])

  const importedThreads = filteredThreads.filter(thread => Boolean(thread.importedSession))
  const availableThreads = filteredThreads.filter(thread => !thread.importedSession)

  if (!isOpen) {
    return null
  }

  return (
    <div className="overlay overlay--session-list" onClick={() => setIsOpen(false)}>
      <div className="modal claude-session-browser-modal" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>codex threads</h2>
            <small>Browse past Codex threads and import them into a workspace</small>
          </div>
          <button type="button" className="modal-close-btn" onClick={() => setIsOpen(false)}>
            X
          </button>
        </div>
        <div className="workspace-detail-modal-body workspace-detail-modal-body--stacked">
          <section className="workspace-detail-section">
            <div className="workspace-detail-create">
              <input
                type="text"
                value={search}
                placeholder="Search Codex threads"
                onChange={event => setSearch(event.target.value)}
              />
              <select
                value={selectedWorkspaceDirectory}
                onChange={event => setSelectedWorkspaceDirectory(event.target.value)}
              >
                {projects.length === 0 ? <option value="">No workspaces</option> : null}
                {projects.map(project => (
                  <option key={project.id} value={project.worktree}>
                    {project.name?.trim() || project.worktree.split('/').pop() || project.worktree}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="workspace-detail-section">
            <div className="workspace-detail-section-header">
              <h3>Already imported in Orxa</h3>
            </div>
            {loading ? <p className="workspace-detail-empty">Loading Codex threads…</p> : null}
            {!loading && importedThreads.length === 0 ? (
              <p className="workspace-detail-empty">No imported Codex threads</p>
            ) : null}
            <CodexSessionBrowserRows
              rows={importedThreads}
              actionLabel="open"
              onAction={thread => void onOpenThread(thread)}
            />
          </section>

          <section className="workspace-detail-section">
            <div className="workspace-detail-section-header">
              <h3>Available to import/resume</h3>
            </div>
            {!loading && availableThreads.length === 0 ? (
              <p className="workspace-detail-empty">No Codex threads found</p>
            ) : null}
            <CodexSessionBrowserRows
              rows={availableThreads}
              actionLabel="import"
              onAction={thread => void onOpenThread(thread)}
            />
          </section>
        </div>
      </div>
    </div>
  )
}
