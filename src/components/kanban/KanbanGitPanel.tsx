import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, GitBranch, RefreshCw } from "lucide-react";
import type { KanbanGitState } from "@shared/ipc";

type Props = {
  workspaceDir: string;
};

export function KanbanGitPanel({ workspaceDir }: Props) {
  const [gitState, setGitState] = useState<KanbanGitState | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [checkoutBranch, setCheckoutBranch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await window.orxa.kanban.gitState(workspaceDir);
      setGitState(next);
    } catch { /* ignore */ }
    setLoading(false);
  }, [workspaceDir]);

  useEffect(() => { void load(); }, [load]);

  const runAction = useCallback(async (action: string, fn: () => Promise<KanbanGitState>) => {
    setActionPending(action);
    try {
      const next = await fn();
      setGitState(next);
    } catch { /* ignore */ }
    setActionPending(null);
  }, []);

  if (loading || !gitState) {
    return <div className="kanban-empty-state" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>Loading git state…</div>;
  }

  const branch = gitState.branchState;

  return (
    <section className="kanban-git">
      <div className="kanban-git-branch-bar">
        <GitBranch size={14} aria-hidden="true" />
        <strong>{branch.current}</strong>
        {branch.branches.length > 1 ? <span className="kanban-detail-mono">{branch.branches.length} branches</span> : null}
      </div>

      <div className="kanban-git-actions">
        <button type="button" className="kanban-filter-toggle" disabled={actionPending !== null} onClick={() => void runAction("fetch", () => window.orxa.kanban.gitFetch(workspaceDir))}>
          <RefreshCw size={12} /> {actionPending === "fetch" ? "Fetching…" : "Fetch"}
        </button>
        <button type="button" className="kanban-filter-toggle" disabled={actionPending !== null} onClick={() => void runAction("pull", () => window.orxa.kanban.gitPull(workspaceDir))}>
          <ArrowDown size={12} /> {actionPending === "pull" ? "Pulling…" : "Pull"}
        </button>
        <button type="button" className="kanban-filter-toggle" disabled={actionPending !== null} onClick={() => void runAction("push", () => window.orxa.kanban.gitPush(workspaceDir))}>
          <ArrowUp size={12} /> {actionPending === "push" ? "Pushing…" : "Push"}
        </button>
      </div>

      <div className="kanban-git-checkout">
        <input
          value={checkoutBranch}
          onChange={(e) => setCheckoutBranch(e.target.value)}
          placeholder="Branch name…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && checkoutBranch.trim()) {
              void runAction("checkout", () => window.orxa.kanban.gitCheckout(workspaceDir, checkoutBranch.trim()));
              setCheckoutBranch("");
            }
          }}
        />
        <button
          type="button"
          className="kanban-filter-toggle"
          disabled={!checkoutBranch.trim() || actionPending !== null}
          onClick={() => {
            if (checkoutBranch.trim()) {
              void runAction("checkout", () => window.orxa.kanban.gitCheckout(workspaceDir, checkoutBranch.trim()));
              setCheckoutBranch("");
            }
          }}
        >
          Checkout
        </button>
      </div>

      {gitState.statusText ? (
        <section className="kanban-task-detail-section">
          <h3>Status</h3>
          <pre className="kanban-diff-preview">{gitState.statusText}</pre>
        </section>
      ) : null}

      {gitState.commits.length > 0 ? (
        <section className="kanban-task-detail-section">
          <h3>Recent commits</h3>
          <div className="kanban-git-commits">
            {gitState.commits.map((commit) => (
              <div key={commit.hash} className="kanban-git-commit">
                <span className="kanban-detail-mono kanban-git-commit-hash">{commit.shortHash}</span>
                <span className="kanban-git-commit-subject">{commit.subject}</span>
                <span className="kanban-git-commit-meta">{commit.author} · {commit.relativeTime}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {gitState.graphText ? (
        <section className="kanban-task-detail-section">
          <h3>Graph</h3>
          <pre className="kanban-diff-preview">{gitState.graphText}</pre>
        </section>
      ) : null}
    </section>
  );
}
