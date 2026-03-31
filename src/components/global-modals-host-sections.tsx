import { useState } from 'react'
import type { GlobalModalsHostProps } from './GlobalModalsHost'
import type { RuntimeDependencyReport } from '@shared/ipc'
import type { SessionType } from '../types/canvas'
import { WorkspaceDetailRecoverCodexThreads } from './workspace-detail-recover-codex-threads'

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
const WORKSPACE_DETAIL_SESSION_TYPES: Array<{ type: SessionType; label: string }> = [
  { type: 'opencode', label: 'New OpenCode' },
  { type: 'claude-chat', label: 'New Claude Chat' },
  { type: 'codex', label: 'New Codex' },
]
function WorkspaceDetailSessionsSection({
  currentActiveProjectDir,
  sessions,
  workspaceCodexThreads,
  getSessionStatusType,
  activeSessionID,
  openSession,
  openWorkspaceCodexThread,
  closeModal,
}: {
  currentActiveProjectDir: string | undefined
  sessions: GlobalModalsHostProps['sessions']
  workspaceCodexThreads: GlobalModalsHostProps['workspaceCodexThreads']
  getSessionStatusType: GlobalModalsHostProps['getSessionStatusType']
  activeSessionID: GlobalModalsHostProps['activeSessionID']
  openSession: GlobalModalsHostProps['openSession']
  openWorkspaceCodexThread: GlobalModalsHostProps['openWorkspaceCodexThread']
  closeModal: () => void
}) {
  return (
    <section className="workspace-detail-section">
      <div className="workspace-detail-section-header">
        <h3>Sessions</h3>
      </div>
      {sessions.map(session => {
        const status = getSessionStatusType(session.id, session.directory)
        const busy = status === 'busy' || status === 'retry'
        const awaitingPermission = status === 'permission'
        const isActive =
          session.id === activeSessionID && session.directory === currentActiveProjectDir
        const statusLabelClass = awaitingPermission
          ? 'session-status-label--busy'
          : busy
            ? 'session-status-label--busy'
            : isActive
              ? 'session-status-label--active'
              : 'session-status-label--idle'
        return (
          <button
            key={`${session.directory}::${session.id}`}
            type="button"
            className={`session-modal-row ${isActive ? 'active' : ''}`.trim()}
            onClick={() => {
              void openSession(session.directory, session.id)
              closeModal()
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
              <span className="session-modal-row-workspace">{session.directory}</span>
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
      {sessions.length === 0 ? <p className="workspace-detail-empty">No sessions yet</p> : null}
      <WorkspaceDetailRecoverCodexThreads
        sessions={sessions}
        workspaceCodexThreads={workspaceCodexThreads}
        openWorkspaceCodexThread={openWorkspaceCodexThread}
        closeModal={closeModal}
      />
    </section>
  )
}
function WorkspaceDetailWorktreesSection({
  activeProjectDir,
  workspaceWorktrees,
  workspaceWorktreesLoading,
  selectedWorktree,
  setSelectedWorktreeDirectory,
  createWorkspaceWorktree,
  openWorkspaceWorktree,
  deleteWorkspaceWorktree,
  launchSessionInWorktree,
}: {
  activeProjectDir: string
  workspaceWorktrees: GlobalModalsHostProps['workspaceWorktrees']
  workspaceWorktreesLoading: boolean
  selectedWorktree: GlobalModalsHostProps['workspaceWorktrees'][number] | null
  setSelectedWorktreeDirectory: GlobalModalsHostProps['setSelectedWorktreeDirectory']
  createWorkspaceWorktree: GlobalModalsHostProps['createWorkspaceWorktree']
  openWorkspaceWorktree: GlobalModalsHostProps['openWorkspaceWorktree']
  deleteWorkspaceWorktree: GlobalModalsHostProps['deleteWorkspaceWorktree']
  launchSessionInWorktree: GlobalModalsHostProps['launchSessionInWorktree']
}) {
  const [newWorktreeName, setNewWorktreeName] = useState('')
  return (
    <section className="workspace-detail-section">
      <div className="workspace-detail-section-header">
        <h3>Worktrees</h3>
        <button type="button" onClick={() => void openWorkspaceWorktree(activeProjectDir)}>
          Open main
        </button>
      </div>
      <div className="workspace-detail-create">
        <input
          type="text"
          value={newWorktreeName}
          placeholder="feature/my-worktree"
          onChange={event => setNewWorktreeName(event.target.value)}
        />
        <button
          type="button"
          onClick={() => {
            const name = newWorktreeName.trim()
            if (!name) {
              return
            }
            void createWorkspaceWorktree(name)
            setNewWorktreeName('')
          }}
        >
          Create
        </button>
      </div>
      <div className="workspace-detail-worktrees">
        {workspaceWorktreesLoading ? <p className="workspace-detail-empty">Loading worktrees…</p> : null}
        {!workspaceWorktreesLoading && workspaceWorktrees.length === 0 ? (
          <p className="workspace-detail-empty">No worktrees found</p>
        ) : null}
        {workspaceWorktrees.map(worktree => (
          <button
            key={worktree.id}
            type="button"
            className={`workspace-worktree-row ${selectedWorktree?.directory === worktree.directory ? 'active' : ''}`.trim()}
            onClick={() => setSelectedWorktreeDirectory(worktree.directory)}
          >
            <div className="workspace-worktree-row-info">
              <strong>{worktree.name}</strong>
              <span>{worktree.directory}</span>
            </div>
            <div className="workspace-worktree-row-meta">
              <span>{worktree.branch ?? 'detached'}</span>
              <span>{worktree.isMain ? 'main' : 'worktree'}</span>
            </div>
          </button>
        ))}
      </div>
      <WorkspaceDetailWorktreeActions
        selectedWorktree={selectedWorktree}
        openWorkspaceWorktree={openWorkspaceWorktree}
        deleteWorkspaceWorktree={deleteWorkspaceWorktree}
        launchSessionInWorktree={launchSessionInWorktree}
      />
    </section>
  )
}

function WorkspaceDetailWorktreeActions({
  selectedWorktree,
  openWorkspaceWorktree,
  deleteWorkspaceWorktree,
  launchSessionInWorktree,
}: {
  selectedWorktree: GlobalModalsHostProps['workspaceWorktrees'][number] | null
  openWorkspaceWorktree: GlobalModalsHostProps['openWorkspaceWorktree']
  deleteWorkspaceWorktree: GlobalModalsHostProps['deleteWorkspaceWorktree']
  launchSessionInWorktree: GlobalModalsHostProps['launchSessionInWorktree']
}) {
  if (!selectedWorktree) {
    return null
  }

  return (
    <div className="workspace-detail-actions">
      <div className="workspace-detail-launch-actions">
        {WORKSPACE_DETAIL_SESSION_TYPES.map(option => (
          <button
            key={option.type}
            type="button"
            onClick={() => void launchSessionInWorktree(selectedWorktree.directory, option.type)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="workspace-detail-maintenance-actions">
        <button type="button" onClick={() => void openWorkspaceWorktree(selectedWorktree.directory)}>
          Open in Zed
        </button>
        {!selectedWorktree.isMain ? (
          <button
            type="button"
            className="danger"
            onClick={() => void deleteWorkspaceWorktree(selectedWorktree.directory)}
          >
            Delete worktree
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function WorkspaceDetailModal({
  allSessionsModalOpen,
  setAllSessionsModalOpen,
  activeProjectDir,
  workspaceDetailDirectory,
  sessions,
  workspaceWorktrees,
  workspaceWorktreesLoading,
  workspaceCodexThreads,
  selectedWorktreeDirectory,
  setSelectedWorktreeDirectory,
  createWorkspaceWorktree,
  openWorkspaceWorktree,
  deleteWorkspaceWorktree,
  launchSessionInWorktree,
  openWorkspaceCodexThread,
  getSessionStatusType,
  activeSessionID,
  openSession,
}: Pick<
  GlobalModalsHostProps,
  | 'allSessionsModalOpen'
  | 'setAllSessionsModalOpen'
  | 'activeProjectDir'
  | 'workspaceDetailDirectory'
  | 'sessions'
  | 'workspaceWorktrees'
  | 'workspaceWorktreesLoading'
  | 'workspaceCodexThreads'
  | 'selectedWorktreeDirectory'
  | 'setSelectedWorktreeDirectory'
  | 'createWorkspaceWorktree'
  | 'openWorkspaceWorktree'
  | 'deleteWorkspaceWorktree'
  | 'launchSessionInWorktree'
  | 'openWorkspaceCodexThread'
  | 'getSessionStatusType'
  | 'activeSessionID'
  | 'openSession'
>) {
  if (!allSessionsModalOpen || !workspaceDetailDirectory) {
    return null
  }

  const selectedWorktree =
    workspaceWorktrees.find(entry => entry.directory === selectedWorktreeDirectory) ??
    workspaceWorktrees[0] ??
    null

  return (
    <div
      className="overlay overlay--session-list"
      onClick={() => setAllSessionsModalOpen(false)}
    >
      <div className="modal workspace-detail-modal" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>workspace details</h2>
            <small>{workspaceDetailDirectory}</small>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={() => setAllSessionsModalOpen(false)}
          >
            X
          </button>
        </div>
        <div className="workspace-detail-modal-body">
          <WorkspaceDetailSessionsSection
            currentActiveProjectDir={activeProjectDir}
            sessions={sessions}
            workspaceCodexThreads={workspaceCodexThreads}
            getSessionStatusType={getSessionStatusType}
            activeSessionID={activeSessionID}
            openSession={openSession}
            openWorkspaceCodexThread={openWorkspaceCodexThread}
            closeModal={() => setAllSessionsModalOpen(false)}
          />
          <WorkspaceDetailWorktreesSection
            activeProjectDir={workspaceDetailDirectory}
            workspaceWorktrees={workspaceWorktrees}
            workspaceWorktreesLoading={workspaceWorktreesLoading}
            selectedWorktree={selectedWorktree}
            setSelectedWorktreeDirectory={setSelectedWorktreeDirectory}
            createWorkspaceWorktree={createWorkspaceWorktree}
            openWorkspaceWorktree={openWorkspaceWorktree}
            deleteWorkspaceWorktree={deleteWorkspaceWorktree}
            launchSessionInWorktree={launchSessionInWorktree}
          />
        </div>
      </div>
    </div>
  )
}
