import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, GitBranch, RefreshCw } from 'lucide-react'
import type { KanbanGitState } from '@shared/ipc'

type Props = {
  workspaceDir: string
}

function GitStatusSection({ statusText }: { statusText: string }) {
  return (
    <section className="kanban-task-detail-section">
      <h3>Status</h3>
      <pre className="kanban-diff-preview">{statusText}</pre>
    </section>
  )
}

function GitCommitsSection({ commits }: { commits: KanbanGitState['commits'] }) {
  if (commits.length === 0) return null
  return (
    <section className="kanban-task-detail-section">
      <h3>Recent commits</h3>
      <div className="kanban-git-commits">
        {commits.map(commit => (
          <div key={commit.hash} className="kanban-git-commit">
            <span className="kanban-detail-mono kanban-git-commit-hash">{commit.shortHash}</span>
            <span className="kanban-git-commit-subject">{commit.subject}</span>
            <span className="kanban-git-commit-meta">
              {commit.author} · {commit.relativeTime}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function GitGraphSection({ graphText }: { graphText: string }) {
  return (
    <section className="kanban-task-detail-section">
      <h3>Graph</h3>
      <pre className="kanban-diff-preview">{graphText}</pre>
    </section>
  )
}

// Sub-component: Git action buttons
function GitActionButtons({
  workspaceDir,
  actionPending,
  onRunAction,
}: {
  workspaceDir: string
  actionPending: string | null
  onRunAction: (action: string, fn: () => Promise<KanbanGitState>) => void
}) {
  return (
    <div className="kanban-git-actions">
      <button
        type="button"
        className="kanban-filter-toggle"
        disabled={actionPending !== null}
        onClick={() => void onRunAction('fetch', () => window.orxa.kanban.gitFetch(workspaceDir))}
      >
        <RefreshCw size={12} /> {actionPending === 'fetch' ? 'Fetching…' : 'Fetch'}
      </button>
      <button
        type="button"
        className="kanban-filter-toggle"
        disabled={actionPending !== null}
        onClick={() => void onRunAction('pull', () => window.orxa.kanban.gitPull(workspaceDir))}
      >
        <ArrowDown size={12} /> {actionPending === 'pull' ? 'Pulling…' : 'Pull'}
      </button>
      <button
        type="button"
        className="kanban-filter-toggle"
        disabled={actionPending !== null}
        onClick={() => void onRunAction('push', () => window.orxa.kanban.gitPush(workspaceDir))}
      >
        <ArrowUp size={12} /> {actionPending === 'push' ? 'Pushing…' : 'Push'}
      </button>
    </div>
  )
}

// Sub-component: Checkout input
function GitCheckoutInput({
  workspaceDir,
  checkoutBranch,
  actionPending,
  onBranchChange,
  onRunAction,
}: {
  workspaceDir: string
  checkoutBranch: string
  actionPending: string | null
  onBranchChange: (value: string) => void
  onRunAction: (action: string, fn: () => Promise<KanbanGitState>) => void
}) {
  const handleCheckout = () => {
    if (checkoutBranch.trim()) {
      void onRunAction('checkout', () =>
        window.orxa.kanban.gitCheckout(workspaceDir, checkoutBranch.trim())
      )
      onBranchChange('')
    }
  }

  return (
    <div className="kanban-git-checkout">
      <input
        value={checkoutBranch}
        onChange={e => onBranchChange(e.target.value)}
        placeholder="Branch name…"
        onKeyDown={e => {
          if (e.key === 'Enter' && checkoutBranch.trim()) {
            handleCheckout()
          }
        }}
      />
      <button
        type="button"
        className="kanban-filter-toggle"
        disabled={!checkoutBranch.trim() || actionPending !== null}
        onClick={handleCheckout}
      >
        Checkout
      </button>
    </div>
  )
}

export function KanbanGitPanel({ workspaceDir }: Props) {
  const [gitState, setGitState] = useState<KanbanGitState | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionPending, setActionPending] = useState<string | null>(null)
  const [checkoutBranch, setCheckoutBranch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const next = await window.orxa.kanban.gitState(workspaceDir)
      setGitState(next)
    } catch {
      /* ignore */
    }
    setLoading(false)
  }, [workspaceDir])

  useEffect(() => {
    void load()
  }, [load])

  const runAction = useCallback(async (action: string, fn: () => Promise<KanbanGitState>) => {
    setActionPending(action)
    try {
      const next = await fn()
      setGitState(next)
    } catch {
      /* ignore */
    }
    setActionPending(null)
  }, [])

  if (loading || !gitState) {
    return (
      <div
        className="kanban-empty-state"
        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        Loading git state…
      </div>
    )
  }

  const branch = gitState.branchState

  return (
    <section className="kanban-git">
      <div className="kanban-git-branch-bar">
        <GitBranch size={14} aria-hidden="true" />
        <strong>{branch.current}</strong>
        {branch.branches.length > 1 ? (
          <span className="kanban-detail-mono">{branch.branches.length} branches</span>
        ) : null}
      </div>

      <GitActionButtons
        workspaceDir={workspaceDir}
        actionPending={actionPending}
        onRunAction={runAction}
      />

      <GitCheckoutInput
        workspaceDir={workspaceDir}
        checkoutBranch={checkoutBranch}
        actionPending={actionPending}
        onBranchChange={setCheckoutBranch}
        onRunAction={runAction}
      />

      {gitState.statusText ? <GitStatusSection statusText={gitState.statusText} /> : null}
      <GitCommitsSection commits={gitState.commits} />
      {gitState.graphText ? <GitGraphSection graphText={gitState.graphText} /> : null}
    </section>
  )
}
