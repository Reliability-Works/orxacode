import type { GlobalModalsHostProps } from './GlobalModalsHost'
import type { RuntimeDependencyReport } from '@shared/ipc'

function DependencyCard({
  dependency,
  copiedDependencyKey,
  copyDependencyCommand,
}: {
  dependency: RuntimeDependencyReport['dependencies'][number]
  copiedDependencyKey: string | null
  copyDependencyCommand: (installCommand: string, key: string) => Promise<void>
}) {
  return (
    <article
      className={`dependency-card ${dependency.installed ? 'ok' : 'missing'}`.trim()}
    >
      <header>
        <strong>{dependency.label}</strong>
        <div className="dependency-badges">
          <span
            className={`dependency-badge ${dependency.required ? 'required' : 'optional'}`.trim()}
          >
            {dependency.required ? 'Required' : 'Optional'}
          </span>
          <span
            className={`dependency-badge ${dependency.installed ? 'installed' : 'missing'}`.trim()}
          >
            {dependency.installed ? 'Installed' : 'Missing'}
          </span>
        </div>
      </header>
      <p>{dependency.description}</p>
      <small>{dependency.reason}</small>
      <div className="dependency-install">
        <code>{dependency.installCommand}</code>
        <button
          type="button"
          className="dependency-copy-btn"
          onClick={() => void copyDependencyCommand(dependency.installCommand, dependency.key)}
        >
          {copiedDependencyKey === dependency.key ? 'Copied' : 'Copy'}
        </button>
      </div>
      <a
        href={dependency.sourceUrl}
        target="_blank"
        rel="noreferrer"
        onClick={event => {
          event.preventDefault()
          void window.orxa.app.openExternal(dependency.sourceUrl).catch(() => undefined)
        }}
      >
        Source repository
      </a>
    </article>
  )
}

export function DependencyModal({
  dependencyModalOpen,
  dependencyReport,
  copiedDependencyKey,
  copyDependencyCommand,
  dependencyRequiredMissing,
  closeDependencyModal,
  onCheckDependencies,
}: {
  dependencyModalOpen: boolean
  dependencyReport: RuntimeDependencyReport | null
  copiedDependencyKey: string | null
  copyDependencyCommand: (installCommand: string, key: string) => Promise<void>
  dependencyRequiredMissing: boolean
  closeDependencyModal: () => void
  onCheckDependencies: () => void | Promise<void>
}) {
  if (!dependencyModalOpen || !dependencyReport?.missingAny) {
    return null
  }

  return (
    <div className="overlay dependency-overlay" onClick={closeDependencyModal}>
      <section className="modal dependency-modal" onClick={event => event.stopPropagation()}>
        <header className="modal-header">
          <h2>Runtime Dependencies</h2>
          {!dependencyRequiredMissing ? (
            <button type="button" onClick={closeDependencyModal}>
              Close
            </button>
          ) : null}
        </header>
        <div className="dependency-modal-body">
          <p className="dependency-intro">
            OpenCode is required to run sessions. The Orxa package is optional and only needed
            for Orxa mode workflows.
          </p>
          {dependencyRequiredMissing ? (
            <p className="dependency-warning">
              OpenCode is missing. Install it and use <strong>Check again</strong> to continue.
            </p>
          ) : null}
          <div className="dependency-list">
            {dependencyReport.dependencies.map(dependency => (
              <DependencyCard
                key={dependency.key}
                dependency={dependency}
                copiedDependencyKey={copiedDependencyKey}
                copyDependencyCommand={copyDependencyCommand}
              />
            ))}
          </div>
          <div className="dependency-actions">
            <button type="button" className="primary" onClick={() => void onCheckDependencies()}>
              Check again
            </button>
            {!dependencyRequiredMissing ? (
              <button type="button" onClick={closeDependencyModal}>
                Continue
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}

export function SessionListModal({
  allSessionsModalOpen,
  setAllSessionsModalOpen,
  activeProjectDir,
  sessions,
  getSessionStatusType,
  activeSessionID,
  openSession,
}: Pick<
  GlobalModalsHostProps,
  | 'allSessionsModalOpen'
  | 'setAllSessionsModalOpen'
  | 'activeProjectDir'
  | 'sessions'
  | 'getSessionStatusType'
  | 'activeSessionID'
  | 'openSession'
>) {
  if (!allSessionsModalOpen || !activeProjectDir) {
    return null
  }

  return (
    <div className="overlay" onClick={() => setAllSessionsModalOpen(false)}>
      <div className="modal session-list-modal" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <h2>all sessions</h2>
          <button
            type="button"
            className="modal-close-btn"
            onClick={() => setAllSessionsModalOpen(false)}
          >
            X
          </button>
        </div>
        <div className="session-list-search">
          <input type="text" placeholder="search sessions..." />
        </div>
        <div className="session-list-modal-body">
          {sessions.map(session => {
            const status = getSessionStatusType(session.id, activeProjectDir)
            const busy = status === 'busy' || status === 'retry'
            const awaitingPermission = status === 'permission'
            const isActive = session.id === activeSessionID
            const statusLabelClass = awaitingPermission
              ? 'session-status-label--busy'
              : busy
                ? 'session-status-label--busy'
                : isActive
                  ? 'session-status-label--active'
                  : 'session-status-label--idle'
            return (
              <button
                key={session.id}
                type="button"
                className={`session-modal-row ${isActive ? 'active' : ''}`.trim()}
                onClick={() => {
                  void openSession(activeProjectDir, session.id)
                  setAllSessionsModalOpen(false)
                }}
                title={session.title || session.slug}
              >
                <span
                  className={`session-status-indicator ${awaitingPermission ? 'attention' : busy ? 'busy' : 'idle'}`}
                  aria-hidden="true"
                >
                  {awaitingPermission ? '!' : null}
                </span>
                <div className="session-modal-row-info">
                  <span className="session-modal-row-title">{session.title || session.slug}</span>
                  <span className="session-modal-row-workspace">{activeProjectDir}</span>
                </div>
                <div className="session-modal-row-right">
                  <span className="session-modal-row-time">
                    {new Date(session.time.updated).toLocaleString()}
                  </span>
                  <span className={`session-status-label ${statusLabelClass}`}>
                    {isActive ? 'active' : status}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function BranchCreateModal({
  branchCreateModalOpen,
  setBranchCreateModalOpen,
  branchCreateName,
  setBranchCreateName,
  branchCreateError,
  setBranchCreateError,
  submitBranchCreate,
  branchSwitching,
}: Pick<
  GlobalModalsHostProps,
  | 'branchCreateModalOpen'
  | 'setBranchCreateModalOpen'
  | 'branchCreateName'
  | 'setBranchCreateName'
  | 'branchCreateError'
  | 'setBranchCreateError'
  | 'submitBranchCreate'
  | 'branchSwitching'
>) {
  if (!branchCreateModalOpen) {
    return null
  }

  return (
    <div className="overlay" onClick={() => setBranchCreateModalOpen(false)}>
      <section className="modal branch-create-modal" onClick={event => event.stopPropagation()}>
        <header className="modal-header">
          <h2>create branch</h2>
          <button
            type="button"
            className="modal-close-btn"
            onClick={() => setBranchCreateModalOpen(false)}
          >
            X
          </button>
        </header>
        <div className="branch-create-modal-body">
          <label className="branch-create-field">
            <input
              type="text"
              value={branchCreateName}
              onChange={event => {
                setBranchCreateName(event.target.value)
                setBranchCreateError(null)
              }}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void submitBranchCreate()
                }
                if (event.key === 'Escape') {
                  setBranchCreateModalOpen(false)
                }
              }}
              placeholder="feature/..."
              autoFocus
            />
          </label>
          <p className="branch-create-from-hint">from main</p>
          {branchCreateError ? <p className="branch-create-error">{branchCreateError}</p> : null}
        </div>
        <div className="modal-action-bar">
          <button type="button" onClick={() => setBranchCreateModalOpen(false)}>
            cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!branchCreateName.trim() || branchSwitching}
            onClick={() => void submitBranchCreate()}
          >
            {branchSwitching ? 'creating...' : 'create'}
          </button>
        </div>
      </section>
    </div>
  )
}
