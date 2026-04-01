import type { GlobalModalsHostProps } from './GlobalModalsHost'

type WorkspaceDetailRecoverCodexThreadsProps = {
  sessions: GlobalModalsHostProps['sessions']
  workspaceCodexThreads: GlobalModalsHostProps['workspaceCodexThreads']
  openWorkspaceCodexThread: GlobalModalsHostProps['openWorkspaceCodexThread']
  closeModal: () => void
}

export function WorkspaceDetailRecoverCodexThreads({
  sessions,
  workspaceCodexThreads,
  openWorkspaceCodexThread,
  closeModal,
}: WorkspaceDetailRecoverCodexThreadsProps) {
  const recoverableCodexThreads = workspaceCodexThreads.filter(
    thread =>
      !sessions.some(session => session.id === thread.id && session.directory === thread.directory)
  )

  if (recoverableCodexThreads.length === 0) {
    return null
  }

  return (
    <div className="workspace-detail-recovery">
      <h4>Recover Codex threads</h4>
      {recoverableCodexThreads.map(thread => (
        <button
          key={`recover:${thread.directory}:${thread.id}`}
          type="button"
          className="session-modal-row"
          onClick={() => {
            void openWorkspaceCodexThread(thread.directory, thread.id, thread.preview || undefined)
            closeModal()
          }}
          title={thread.preview || thread.id}
        >
          <span className="session-status-indicator idle" aria-hidden="true" />
          <div className="session-modal-row-info">
            <span className="session-modal-row-title">{thread.preview || thread.id}</span>
            <span className="session-modal-row-workspace">{thread.directory}</span>
          </div>
          <div className="session-modal-row-right">
            <span className="session-modal-row-time">
              {new Date(thread.createdAt).toLocaleString()}
            </span>
            <span className="session-status-label session-status-label--idle">recover</span>
          </div>
        </button>
      ))}
    </div>
  )
}
