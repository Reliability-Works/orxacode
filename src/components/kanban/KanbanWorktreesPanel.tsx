import { useCallback, useEffect, useMemo, useState } from 'react'
import { FolderOpen, GitMerge, RotateCcw, Trash2, WandSparkles } from 'lucide-react'
import type { KanbanTask, KanbanWorktree, KanbanWorktreeStatusDetail } from '@shared/ipc'

type Props = {
  workspaceDir: string
  worktrees: KanbanWorktree[]
  trashedTasks: KanbanTask[]
  onRefresh: () => void
}

export function KanbanWorktreesPanel({ workspaceDir, worktrees, trashedTasks, onRefresh }: Props) {
  const [label, setLabel] = useState('')
  const [baseRef, setBaseRef] = useState('')
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(null)
  const [detail, setDetail] = useState<KanbanWorktreeStatusDetail | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)

  const activeWorktrees = useMemo(() => worktrees.filter(entry => !entry.trashedAt), [worktrees])

  const loadDetail = useCallback(
    async (worktreeId: string) => {
      setPendingAction(`load:${worktreeId}`)
      try {
        const next = await window.orxa.kanban.getWorktreeStatus(workspaceDir, worktreeId)
        setDetail(next)
      } finally {
        setPendingAction(null)
      }
    },
    [workspaceDir]
  )

  useEffect(() => {
    if (!selectedWorktreeId) {
      setDetail(null)
      return
    }
    void loadDetail(selectedWorktreeId)
  }, [loadDetail, selectedWorktreeId])

  const runAction = useCallback(
    async (actionKey: string, action: () => Promise<unknown>) => {
      setPendingAction(actionKey)
      try {
        await action()
        onRefresh()
        if (selectedWorktreeId) {
          await loadDetail(selectedWorktreeId).catch(() => undefined)
        }
      } finally {
        setPendingAction(null)
      }
    },
    [loadDetail, onRefresh, selectedWorktreeId]
  )

  return (
    <section className="kanban-worktrees">
      <KanbanWorktreeHeader
        onGenerateInclude={() =>
          void runAction('generate-include', () =>
            window.orxa.kanban.createWorktreeIncludeFromGitignore(workspaceDir)
          )
        }
      />
      <KanbanCreateWorktreeSection
        baseRef={baseRef}
        label={label}
        pendingAction={pendingAction}
        setBaseRef={setBaseRef}
        setLabel={setLabel}
        onCreate={() =>
          void runAction('create', async () => {
            await window.orxa.kanban.createWorktree({
              workspaceDir,
              label: label.trim(),
              baseRef: baseRef.trim() || undefined,
            })
            setLabel('')
            setBaseRef('')
          })
        }
      />
      <KanbanWorktreeList
        activeWorktrees={activeWorktrees}
        runAction={runAction}
        selectedWorktreeId={selectedWorktreeId}
        setSelectedWorktreeId={setSelectedWorktreeId}
        workspaceDir={workspaceDir}
      />
      {detail ? <KanbanSelectedWorktreeDetail detail={detail} /> : null}
      <KanbanTrashSection
        runAction={runAction}
        trashedTasks={trashedTasks}
        workspaceDir={workspaceDir}
      />
    </section>
  )
}

function KanbanWorktreeHeader({
  onGenerateInclude,
}: {
  onGenerateInclude: () => void
}) {
  return (
    <div className="kanban-section-header">
      <h2>Worktrees</h2>
      <button type="button" className="kanban-filter-toggle" onClick={onGenerateInclude}>
        <WandSparkles size={12} /> Create `.worktreeinclude` from `.gitignore`
      </button>
    </div>
  )
}

function KanbanCreateWorktreeSection({
  baseRef,
  label,
  pendingAction,
  setBaseRef,
  setLabel,
  onCreate,
}: {
  baseRef: string
  label: string
  pendingAction: string | null
  setBaseRef: (value: string) => void
  setLabel: (value: string) => void
  onCreate: () => void
}) {
  return (
    <section className="kanban-settings-section">
      <h3>Create worktree</h3>
      <div className="kanban-inline-row">
        <input value={label} onChange={event => setLabel(event.target.value)} placeholder="Worktree label" />
        <input value={baseRef} onChange={event => setBaseRef(event.target.value)} placeholder="Base ref (optional)" />
        <button
          type="button"
          className="kanban-primary-btn"
          disabled={!label.trim() || pendingAction === 'create'}
          onClick={onCreate}
        >
          Create
        </button>
      </div>
    </section>
  )
}

function KanbanWorktreeList({
  activeWorktrees,
  runAction,
  selectedWorktreeId,
  setSelectedWorktreeId,
  workspaceDir,
}: {
  activeWorktrees: KanbanWorktree[]
  runAction: (actionKey: string, action: () => Promise<unknown>) => Promise<void>
  selectedWorktreeId: string | null
  setSelectedWorktreeId: (value: string | null) => void
  workspaceDir: string
}) {
  return (
    <div className="kanban-list-grid">
      {activeWorktrees.map(worktree => (
        <KanbanWorktreeCard
          key={worktree.id}
          runAction={runAction}
          selected={selectedWorktreeId === worktree.id}
          setSelectedWorktreeId={setSelectedWorktreeId}
          workspaceDir={workspaceDir}
          worktree={worktree}
        />
      ))}
      {activeWorktrees.length === 0 ? <div className="kanban-empty-state">No worktrees yet</div> : null}
    </div>
  )
}

function KanbanWorktreeCard({
  runAction,
  selected,
  setSelectedWorktreeId,
  workspaceDir,
  worktree,
}: {
  runAction: (actionKey: string, action: () => Promise<unknown>) => Promise<void>
  selected: boolean
  setSelectedWorktreeId: (value: string | null) => void
  workspaceDir: string
  worktree: KanbanWorktree
}) {
  return (
    <article className={`kanban-list-card${selected ? ' active' : ''}`}>
      <header className="kanban-list-card-header">
        <strong>{worktree.label}</strong>
        <div className="kanban-list-card-badges">
          <span className="kanban-task-pill">{worktree.status}</span>
          <span
            className={`kanban-task-pill${worktree.mergeStatus === 'conflicted' ? ' kanban-task-pill--status is-error' : ''}`}
          >
            {worktree.mergeStatus}
          </span>
        </div>
      </header>
      <p className="kanban-list-card-desc">{worktree.latestPreview || worktree.directory}</p>
      <footer className="kanban-list-card-footer">
        <span>{worktree.branch}</span>
        <span>{worktree.baseRef}</span>
      </footer>
      <div className="kanban-list-card-actions">
        <button type="button" className="kanban-filter-toggle" onClick={() => setSelectedWorktreeId(worktree.id)}>
          Inspect
        </button>
        <button
          type="button"
          className="kanban-filter-toggle"
          onClick={() => void runAction(`open:${worktree.id}`, () => window.orxa.kanban.openWorktree(workspaceDir, worktree.id))}
        >
          <FolderOpen size={12} /> Open
        </button>
        <button
          type="button"
          className="kanban-filter-toggle"
          onClick={() => void runAction(`merge:${worktree.id}`, () => window.orxa.kanban.mergeWorktree(workspaceDir, worktree.id))}
        >
          <GitMerge size={12} /> Merge
        </button>
        <button
          type="button"
          className="kanban-filter-toggle"
          onClick={() => void runAction(`resolve:${worktree.id}`, () => window.orxa.kanban.resolveMergeWithAgent(workspaceDir, worktree.id))}
        >
          Resolve
        </button>
        <button
          type="button"
          className="kanban-filter-toggle"
          onClick={() => void runAction(`delete:${worktree.id}`, () => window.orxa.kanban.deleteWorktree(workspaceDir, worktree.id))}
        >
          <Trash2 size={12} /> Delete
        </button>
      </div>
    </article>
  )
}

function KanbanSelectedWorktreeDetail({ detail }: { detail: KanbanWorktreeStatusDetail }) {
  return (
    <section className="kanban-settings-section">
      <h3>Selected worktree</h3>
      <div className="kanban-task-detail-runtime-grid">
        <span>Directory</span>
        <span className="kanban-detail-mono">{detail.worktree.directory}</span>
        <span>Status</span>
        <span>{detail.worktree.status}</span>
        <span>Merge</span>
        <span>{detail.worktree.mergeStatus}</span>
        <span>Conflicts</span>
        <span>{detail.conflicts.length > 0 ? detail.conflicts.join(', ') : 'None'}</span>
      </div>
    </section>
  )
}

function KanbanTrashSection({
  runAction,
  trashedTasks,
  workspaceDir,
}: {
  runAction: (actionKey: string, action: () => Promise<unknown>) => Promise<void>
  trashedTasks: KanbanTask[]
  workspaceDir: string
}) {
  return (
    <section className="kanban-settings-section">
      <h3>Trash</h3>
      <div className="kanban-list-grid">
        {trashedTasks.map(task => (
          <article key={task.id} className="kanban-list-card">
            <header className="kanban-list-card-header">
              <strong>{task.title}</strong>
              <span className="kanban-task-pill">trashed</span>
            </header>
            <p className="kanban-list-card-desc">{task.latestPreview || task.prompt}</p>
            <div className="kanban-list-card-actions">
              <button
                type="button"
                className="kanban-filter-toggle"
                onClick={() =>
                  void runAction(`restore:${task.id}`, () =>
                    window.orxa.kanban.restoreTask(workspaceDir, task.id)
                  )
                }
              >
                <RotateCcw size={12} /> Restore
              </button>
              <button
                type="button"
                className="kanban-filter-toggle"
                onClick={() =>
                  void runAction(`delete-task:${task.id}`, () =>
                    window.orxa.kanban.deleteTask(workspaceDir, task.id)
                  )
                }
              >
                <Trash2 size={12} /> Delete permanently
              </button>
            </div>
          </article>
        ))}
        {trashedTasks.length === 0 ? <div className="kanban-empty-state">Trash is empty</div> : null}
      </div>
    </section>
  )
}
