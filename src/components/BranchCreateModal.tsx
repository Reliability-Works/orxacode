import type { GlobalModalsHostProps } from './GlobalModalsHost'

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
            <span>Branch name</span>
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
