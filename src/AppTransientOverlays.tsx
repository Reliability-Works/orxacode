import type { Dispatch, SetStateAction } from 'react'
import { getSessionContextActions } from './lib/session-context-menu'
import type { ContextMenuState } from './hooks/useWorkspaceState-shared'
import type { AppShellUpdateProgressState } from './hooks/useAppShellUpdateFlow'
import type { DebugLogLevel } from './app-core-debug'
import type { SessionType } from '~/types/canvas'

type DebugLogEntry = {
  id: string
  time: number
  level: DebugLogLevel
  eventType: string
  summary: string
  details?: string
}

type AppTransientOverlaysProps = {
  contextMenu: ContextMenuState
  setContextMenu: Dispatch<SetStateAction<ContextMenuState>>
  changeProjectDirectory: (directory: string, label: string) => Promise<void>
  removeProjectDirectory: (directory: string, label: string) => Promise<void>
  getSessionType: (sessionID: string, directory?: string) => SessionType | undefined
  archiveSession: (directory: string, sessionID: string) => Promise<void>
  copySessionID: (directory: string, sessionID: string) => Promise<void>
  renameSession: (directory: string, sessionID: string, currentTitle: string) => void
  debugModalOpen: boolean
  setDebugModalOpen: Dispatch<SetStateAction<boolean>>
  statusLine: string
  debugLogLevelFilter: 'all' | DebugLogLevel
  setDebugLogLevelFilter: Dispatch<SetStateAction<'all' | DebugLogLevel>>
  filteredDebugLogs: DebugLogEntry[]
  copyDebugLogsAsJson: () => Promise<void>
  updateProgressState: AppShellUpdateProgressState | null
  setUpdateProgressState: Dispatch<SetStateAction<AppShellUpdateProgressState | null>>
}

function renderContextMenu(props: AppTransientOverlaysProps) {
  const {
    archiveSession,
    changeProjectDirectory,
    contextMenu,
    copySessionID,
    getSessionType,
    removeProjectDirectory,
    renameSession,
    setContextMenu,
  } = props

  if (!contextMenu) {
    return null
  }

  return (
    <div
      className="context-menu-overlay"
      onClick={() => setContextMenu(null)}
      onContextMenu={event => event.preventDefault()}
    >
      <div
        className="context-menu"
        style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
        onClick={event => event.stopPropagation()}
      >
        {contextMenu.kind === 'project' ? (
          renderProjectContextMenu(contextMenu, setContextMenu, changeProjectDirectory, removeProjectDirectory)
        ) : (
          renderSessionContextMenu(
            contextMenu,
            setContextMenu,
            getSessionType,
            archiveSession,
            copySessionID,
            renameSession
          )
        )}
      </div>
    </div>
  )
}

function renderProjectContextMenu(
  contextMenu: Extract<NonNullable<ContextMenuState>, { kind: 'project' }>,
  setContextMenu: AppTransientOverlaysProps['setContextMenu'],
  changeProjectDirectory: AppTransientOverlaysProps['changeProjectDirectory'],
  removeProjectDirectory: AppTransientOverlaysProps['removeProjectDirectory']
) {
  return (
    <>
      <button
        type="button"
        onClick={() => {
          const { directory, label } = contextMenu
          setContextMenu(null)
          void changeProjectDirectory(directory, label)
        }}
      >
        Change Working Directory...
      </button>
      <button
        type="button"
        className="danger"
        onClick={() => {
          const { directory, label } = contextMenu
          setContextMenu(null)
          void removeProjectDirectory(directory, label)
        }}
      >
        Delete
      </button>
    </>
  )
}

function renderSessionContextMenu(
  contextMenu: Extract<NonNullable<ContextMenuState>, { kind: 'session' }>,
  setContextMenu: AppTransientOverlaysProps['setContextMenu'],
  getSessionType: AppTransientOverlaysProps['getSessionType'],
  archiveSession: AppTransientOverlaysProps['archiveSession'],
  copySessionID: AppTransientOverlaysProps['copySessionID'],
  renameSession: AppTransientOverlaysProps['renameSession']
) {
  const sessionType = getSessionType(contextMenu.sessionID, contextMenu.directory) ?? 'opencode'
  const actions = getSessionContextActions(sessionType)
  return (
    <>
      {actions.includes('archive') ? (
        <button
          type="button"
          onClick={() => {
            const { directory, sessionID } = contextMenu
            setContextMenu(null)
            void archiveSession(directory, sessionID)
          }}
        >
          Archive Session
        </button>
      ) : null}
      {actions.includes('copy_id') ? (
        <button
          type="button"
          onClick={() => {
            const { directory, sessionID } = contextMenu
            setContextMenu(null)
            void copySessionID(directory, sessionID)
          }}
        >
          {sessionType === 'codex'
            ? 'Copy Codex Thread ID'
            : sessionType === 'claude-chat'
              ? 'Copy Claude Thread ID'
              : 'Copy Session ID'}
        </button>
      ) : null}
      {actions.includes('rename') ? (
        <button
          type="button"
          onClick={() => {
            const { directory, sessionID, title } = contextMenu
            setContextMenu(null)
            void renameSession(directory, sessionID, title)
          }}
        >
          Rename Session
        </button>
      ) : null}
    </>
  )
}

function renderDebugOverlay(props: AppTransientOverlaysProps) {
  const {
    copyDebugLogsAsJson,
    debugLogLevelFilter,
    debugModalOpen,
    filteredDebugLogs,
    setDebugLogLevelFilter,
    setDebugModalOpen,
    statusLine,
  } = props

  if (!debugModalOpen) {
    return null
  }

  return (
    <div className="overlay debug-log-overlay" onClick={() => setDebugModalOpen(false)}>
      <section
        className="modal debug-log-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Session debug logs"
        onClick={event => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2>Session Debug Logs</h2>
            <small className="debug-log-subtitle">Current status: {statusLine}</small>
          </div>
          <button type="button" onClick={() => setDebugModalOpen(false)}>
            Close
          </button>
        </header>
        <div className="debug-log-toolbar">
          <span className="debug-log-filter-label">Filter level</span>
          {(['all', 'info', 'warn', 'error'] as const).map(level => (
            <button
              key={level}
              type="button"
              className={debugLogLevelFilter === level ? 'active' : ''}
              onClick={() => setDebugLogLevelFilter(level)}
            >
              {level === 'all' ? 'All' : level.toUpperCase()}
            </button>
          ))}
          <button type="button" className="debug-log-copy-btn" onClick={() => void copyDebugLogsAsJson()}>
            Copy logs as JSON
          </button>
        </div>
        <div className="debug-log-list" role="log" aria-live="polite">
          {filteredDebugLogs.length === 0 ? (
            <p className="dashboard-empty">No debug logs yet.</p>
          ) : (
            filteredDebugLogs
              .slice()
              .reverse()
              .map(entry => (
                <article key={entry.id} className={`debug-log-item ${entry.level}`.trim()}>
                  <div className="debug-log-item-meta">
                    <span>{new Date(entry.time).toLocaleTimeString()}</span>
                    <span>{entry.eventType}</span>
                  </div>
                  <p>{entry.summary}</p>
                  {entry.details ? (
                    <details>
                      <summary>Details</summary>
                      <pre>{entry.details}</pre>
                    </details>
                  ) : null}
                </article>
              ))
          )}
        </div>
      </section>
    </div>
  )
}

function renderUpdateOverlay(props: AppTransientOverlaysProps) {
  const { setUpdateProgressState, updateProgressState } = props
  if (!updateProgressState) {
    return null
  }

  return (
    <div
      className="overlay"
      onClick={updateProgressState.phase === 'error' ? () => setUpdateProgressState(null) : undefined}
    >
      <section className="modal update-progress-modal" onClick={event => event.stopPropagation()}>
        <div className="update-progress-body">
          {updateProgressState.phase === 'error' ? (
            <>
              <h2>Update failed</h2>
              <p>{updateProgressState.message}</p>
              <button type="button" onClick={() => setUpdateProgressState(null)}>
                Dismiss
              </button>
            </>
          ) : (
            <>
              <span className="session-status-indicator busy commit-progress-spinner" aria-hidden="true" />
              <h2>
                {updateProgressState.phase === 'installing' ? 'Installing update' : 'Downloading update'}
                {updateProgressState.version ? ` ${updateProgressState.version}` : ''}
              </h2>
              <p>{updateProgressState.message}</p>
              {updateProgressState.phase === 'downloading' ? (
                <div className="update-progress-meter" aria-label="Update download progress">
                  <div
                    className="update-progress-meter-fill"
                    style={{
                      width: `${Math.max(0, Math.min(100, updateProgressState.percent ?? 0))}%`,
                    }}
                  />
                </div>
              ) : null}
              {updateProgressState.phase === 'downloading' ? (
                <small>
                  {typeof updateProgressState.percent === 'number'
                    ? `${Math.round(updateProgressState.percent)}%`
                    : 'Starting...'}
                </small>
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  )
}

export function AppTransientOverlays(props: AppTransientOverlaysProps) {
  return (
    <>
      {renderContextMenu(props)}
      {renderDebugOverlay(props)}
      {renderUpdateOverlay(props)}
    </>
  )
}
