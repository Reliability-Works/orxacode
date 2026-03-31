import { useMemo, useState } from 'react'
import type { ClaudeBrowserSessionSummary, ProjectListItem } from '@shared/ipc'

type ClaudeSessionBrowserModalProps = {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  sessions: ClaudeBrowserSessionSummary[]
  loading: boolean
  projects: ProjectListItem[]
  selectedWorkspaceDirectory: string
  setSelectedWorkspaceDirectory: (directory: string) => void
  onOpenSession: (session: ClaudeBrowserSessionSummary) => Promise<void>
}

function ClaudeSessionBrowserRows({
  rows,
  actionLabel,
  onAction,
}: {
  rows: ClaudeBrowserSessionSummary[]
  actionLabel: string
  onAction: (session: ClaudeBrowserSessionSummary) => void
}) {
  if (rows.length === 0) {
    return null
  }

  return (
    <div className="claude-session-browser-list">
      {rows.map(session => (
        <button
          key={session.providerThreadId}
          type="button"
          className="session-modal-row claude-session-browser-row"
          onClick={() => onAction(session)}
          title={session.preview || session.title}
        >
          <span className="session-status-indicator idle" aria-hidden="true" />
          <div className="session-modal-row-info">
            <span className="session-modal-row-title">{session.title}</span>
            <span className="session-modal-row-workspace">
              {session.cwd || session.importedSession?.directory || 'Unknown directory'}
            </span>
            {session.preview ? (
              <span className="claude-session-browser-preview">{session.preview}</span>
            ) : null}
          </div>
          <div className="session-modal-row-right">
            <span className="session-modal-row-time">
              {new Date(session.lastUpdatedAt).toLocaleString()}
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

export function ClaudeSessionBrowserModal({
  isOpen,
  setIsOpen,
  sessions,
  loading,
  projects,
  selectedWorkspaceDirectory,
  setSelectedWorkspaceDirectory,
  onOpenSession,
}: ClaudeSessionBrowserModalProps) {
  const [search, setSearch] = useState('')

  const filteredSessions = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) {
      return sessions
    }
    return sessions.filter(session =>
      [
        session.title,
        session.preview,
        session.cwd,
        session.providerThreadId,
        session.importedSession?.directory,
      ]
        .filter((value): value is string => Boolean(value))
        .some(value => value.toLowerCase().includes(normalized))
    )
  }, [search, sessions])

  const importedSessions = filteredSessions.filter(session => Boolean(session.importedSession))
  const availableSessions = filteredSessions.filter(session => !session.importedSession)

  if (!isOpen) {
    return null
  }

  return (
    <div className="overlay overlay--session-list" onClick={() => setIsOpen(false)}>
      <div className="modal claude-session-browser-modal" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>claude sessions</h2>
            <small>Browse past Claude chats and import them into a workspace</small>
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
                placeholder="Search Claude sessions"
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
            {loading ? <p className="workspace-detail-empty">Loading Claude sessions…</p> : null}
            {!loading && importedSessions.length === 0 ? (
              <p className="workspace-detail-empty">No imported Claude sessions</p>
            ) : null}
            <ClaudeSessionBrowserRows
              rows={importedSessions}
              actionLabel="open"
              onAction={session => void onOpenSession(session)}
            />
          </section>

          <section className="workspace-detail-section">
            <div className="workspace-detail-section-header">
              <h3>Available to import/resume</h3>
            </div>
            {!loading && availableSessions.length === 0 ? (
              <p className="workspace-detail-empty">No Claude sessions found</p>
            ) : null}
            <ClaudeSessionBrowserRows
              rows={availableSessions}
              actionLabel="import"
              onAction={session => void onOpenSession(session)}
            />
          </section>
        </div>
      </div>
    </div>
  )
}
