import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen, GitMerge, RotateCcw, Trash2, WandSparkles } from "lucide-react";
import type { KanbanTask, KanbanWorktree, KanbanWorktreeStatusDetail } from "@shared/ipc";

type Props = {
  workspaceDir: string;
  worktrees: KanbanWorktree[];
  trashedTasks: KanbanTask[];
  onRefresh: () => void;
};

export function KanbanWorktreesPanel({ workspaceDir, worktrees, trashedTasks, onRefresh }: Props) {
  const [label, setLabel] = useState("");
  const [baseRef, setBaseRef] = useState("");
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(null);
  const [detail, setDetail] = useState<KanbanWorktreeStatusDetail | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const activeWorktrees = useMemo(() => worktrees.filter((entry) => !entry.trashedAt), [worktrees]);

  const loadDetail = useCallback(async (worktreeId: string) => {
    setPendingAction(`load:${worktreeId}`);
    try {
      const next = await window.orxa.kanban.getWorktreeStatus(workspaceDir, worktreeId);
      setDetail(next);
    } finally {
      setPendingAction(null);
    }
  }, [workspaceDir]);

  useEffect(() => {
    if (!selectedWorktreeId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedWorktreeId);
  }, [loadDetail, selectedWorktreeId]);

  const runAction = useCallback(async (actionKey: string, action: () => Promise<unknown>) => {
    setPendingAction(actionKey);
    try {
      await action();
      onRefresh();
      if (selectedWorktreeId) {
        await loadDetail(selectedWorktreeId).catch(() => undefined);
      }
    } finally {
      setPendingAction(null);
    }
  }, [loadDetail, onRefresh, selectedWorktreeId]);

  return (
    <section className="kanban-worktrees">
      <div className="kanban-section-header">
        <h2>Worktrees</h2>
        <button
          type="button"
          className="kanban-filter-toggle"
          onClick={() => void runAction("generate-include", () => window.orxa.kanban.createWorktreeIncludeFromGitignore(workspaceDir))}
        >
          <WandSparkles size={12} /> Create `.worktreeinclude` from `.gitignore`
        </button>
      </div>

      <section className="kanban-settings-section">
        <h3>Create worktree</h3>
        <div className="kanban-inline-row">
          <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Worktree label" />
          <input value={baseRef} onChange={(event) => setBaseRef(event.target.value)} placeholder="Base ref (optional)" />
          <button
            type="button"
            className="kanban-primary-btn"
            disabled={!label.trim() || pendingAction === "create"}
            onClick={() => void runAction("create", async () => {
              await window.orxa.kanban.createWorktree({ workspaceDir, label: label.trim(), baseRef: baseRef.trim() || undefined });
              setLabel("");
              setBaseRef("");
            })}
          >
            Create
          </button>
        </div>
      </section>

      <div className="kanban-list-grid">
        {activeWorktrees.map((worktree) => (
          <article key={worktree.id} className={`kanban-list-card${selectedWorktreeId === worktree.id ? " active" : ""}`}>
            <header className="kanban-list-card-header">
              <strong>{worktree.label}</strong>
              <div className="kanban-list-card-badges">
                <span className="kanban-task-pill">{worktree.status}</span>
                <span className={`kanban-task-pill${worktree.mergeStatus === "conflicted" ? " kanban-task-pill--status is-error" : ""}`}>{worktree.mergeStatus}</span>
              </div>
            </header>
            <p className="kanban-list-card-desc">{worktree.latestPreview || worktree.directory}</p>
            <footer className="kanban-list-card-footer">
              <span>{worktree.branch}</span>
              <span>{worktree.baseRef}</span>
            </footer>
            <div className="kanban-list-card-actions">
              <button type="button" className="kanban-filter-toggle" onClick={() => setSelectedWorktreeId(worktree.id)}>Inspect</button>
              <button type="button" className="kanban-filter-toggle" onClick={() => void runAction(`open:${worktree.id}`, () => window.orxa.kanban.openWorktree(workspaceDir, worktree.id))}>
                <FolderOpen size={12} /> Open
              </button>
              <button type="button" className="kanban-filter-toggle" onClick={() => void runAction(`merge:${worktree.id}`, () => window.orxa.kanban.mergeWorktree(workspaceDir, worktree.id))}>
                <GitMerge size={12} /> Merge
              </button>
              <button type="button" className="kanban-filter-toggle" onClick={() => void runAction(`resolve:${worktree.id}`, () => window.orxa.kanban.resolveMergeWithAgent(workspaceDir, worktree.id))}>
                Resolve
              </button>
              <button type="button" className="kanban-filter-toggle" onClick={() => void runAction(`delete:${worktree.id}`, () => window.orxa.kanban.deleteWorktree(workspaceDir, worktree.id))}>
                <Trash2 size={12} /> Delete
              </button>
            </div>
          </article>
        ))}
        {activeWorktrees.length === 0 ? <div className="kanban-empty-state">No worktrees yet</div> : null}
      </div>

      {detail ? (
        <section className="kanban-settings-section">
          <h3>Selected worktree</h3>
          <div className="kanban-task-detail-runtime-grid">
            <span>Directory</span><span className="kanban-detail-mono">{detail.worktree.directory}</span>
            <span>Status</span><span>{detail.worktree.status}</span>
            <span>Merge</span><span>{detail.worktree.mergeStatus}</span>
            <span>Conflicts</span><span>{detail.conflicts.length > 0 ? detail.conflicts.join(", ") : "None"}</span>
          </div>
        </section>
      ) : null}

      <section className="kanban-settings-section">
        <h3>Trash</h3>
        <div className="kanban-list-grid">
          {trashedTasks.map((task) => (
            <article key={task.id} className="kanban-list-card">
              <header className="kanban-list-card-header">
                <strong>{task.title}</strong>
                <span className="kanban-task-pill">trashed</span>
              </header>
              <p className="kanban-list-card-desc">{task.latestPreview || task.prompt}</p>
              <div className="kanban-list-card-actions">
                <button type="button" className="kanban-filter-toggle" onClick={() => void runAction(`restore:${task.id}`, () => window.orxa.kanban.restoreTask(workspaceDir, task.id))}>
                  <RotateCcw size={12} /> Restore
                </button>
                <button type="button" className="kanban-filter-toggle" onClick={() => void runAction(`delete-task:${task.id}`, () => window.orxa.kanban.deleteTask(workspaceDir, task.id))}>
                  <Trash2 size={12} /> Delete permanently
                </button>
              </div>
            </article>
          ))}
          {trashedTasks.length === 0 ? <div className="kanban-empty-state">Trash is empty</div> : null}
        </div>
      </section>
    </section>
  );
}
