import type { AgentsDocument, WorkspaceArtifactSummary, WorkspaceContextFile } from "@shared/ipc";
import { RotateCcw, Save } from "lucide-react";
import { compact, money, timeAgo, trimProviderPrefix } from "~/lib/format";

type ProjectModel = {
  model: string;
  count: number;
};

type Props = {
  loading: boolean;
  sessionCount: number;
  sessions7d: number;
  sessions30d: number;
  tokenInput30d: number;
  tokenOutput30d: number;
  tokenCacheRead30d: number;
  totalCost30d: number;
  topModels: ProjectModel[];
  updatedAt?: number;
  error?: string;
  agentsDocument: AgentsDocument | null;
  agentsDraft: string;
  agentsLoading: boolean;
  agentsSaving: boolean;
  onAgentsDraftChange: (value: string) => void;
  onCreateAgents: () => void;
  onSaveAgents: () => void;
  onRefresh: () => void;
  onRefreshAgents: () => void;
  workspaceContextFiles?: Array<Pick<WorkspaceContextFile, "id" | "title" | "filename" | "updatedAt">>;
  workspaceContextLoading?: boolean;
  onViewAllWorkspaceContext?: () => void;
  onAddWorkspaceContext?: () => void;
  workspaceArtifactsSummary?: Pick<WorkspaceArtifactSummary, "artifacts" | "sessions" | "screenshots" | "contextSelections" | "lastCreatedAt"> | null;
  workspaceArtifactsLoading?: boolean;
  onViewAllWorkspaceArtifacts?: () => void;
};

export function ProjectDashboard({
  loading,
  sessionCount,
  sessions7d,
  sessions30d,
  tokenInput30d,
  tokenOutput30d,
  tokenCacheRead30d,
  totalCost30d,
  topModels,
  updatedAt,
  error,
  agentsDocument,
  agentsDraft,
  agentsLoading,
  agentsSaving,
  onAgentsDraftChange,
  onCreateAgents,
  onSaveAgents,
  onRefresh,
  onRefreshAgents,
  workspaceContextFiles = [],
  workspaceContextLoading = false,
  onViewAllWorkspaceContext,
  onAddWorkspaceContext,
  workspaceArtifactsSummary,
  workspaceArtifactsLoading = false,
  onViewAllWorkspaceArtifacts,
}: Props) {
  const agentsMissing = !agentsLoading && agentsDocument !== null && agentsDocument.exists === false;

  return (
    <section className="dashboard project-dashboard">
      <section className={`dashboard-section project-agents-section ${agentsMissing ? "project-agents-empty" : ""}`.trim()}>
        {!agentsMissing ? (
          <div className="dashboard-section-title">
            <h2>agents.md</h2>
            <div className="project-agents-actions">
              <button type="button" className="dashboard-icon-btn" onClick={onRefreshAgents} disabled={agentsLoading} title="Refresh">
                <RotateCcw size={14} className={agentsLoading ? "spin" : ""} />
              </button>
              {agentsDocument?.exists ? (
                <button type="button" className="dashboard-icon-btn" onClick={onSaveAgents} disabled={agentsSaving || agentsLoading} title="Save">
                  <Save size={14} />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {agentsLoading ? <p className="dashboard-empty">Loading AGENTS.md...</p> : null}
        {agentsMissing ? (
          <div className="project-agents-missing">
            <p className="dashboard-empty">This workspace does not have an AGENTS.md file yet.</p>
            <button type="button" className="project-agents-create" onClick={onCreateAgents}>
              Create AGENTS.md
            </button>
          </div>
        ) : null}
        {!agentsLoading && agentsDocument?.exists ? (
          <textarea
            className="project-agents-editor"
            value={agentsDraft}
            onChange={(event) => onAgentsDraftChange(event.target.value)}
            spellCheck={false}
            aria-label="AGENTS.md editor"
          />
        ) : null}
        <section className="project-workspace-context-summary">
          <div className="project-subsection-title">
            <h3>workspace context</h3>
            <div className="project-subsection-actions">
              <button type="button" className="project-subsection-action" onClick={onViewAllWorkspaceContext} disabled={!onViewAllWorkspaceContext}>
                View all
              </button>
              <button type="button" className="project-subsection-action" onClick={onAddWorkspaceContext} disabled={!onAddWorkspaceContext}>
                Add
              </button>
            </div>
          </div>
          {workspaceContextLoading ? <p className="dashboard-empty">Loading workspace context...</p> : null}
          {!workspaceContextLoading && workspaceContextFiles.length === 0 ? (
            <p className="dashboard-empty">No workspace context files added yet.</p>
          ) : null}
          {!workspaceContextLoading && workspaceContextFiles.length > 0 ? (
            <div className="project-context-file-list">
              {workspaceContextFiles.slice(0, 3).map((item) => {
                const label = item.title?.trim().length ? item.title : item.filename;
                return (
                  <article key={item.id} className="project-context-file-row">
                    <strong>{label}</strong>
                    <small>{item.filename}</small>
                    <small>Updated {timeAgo(item.updatedAt)}</small>
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      </section>

      <section className="dashboard-section project-artifacts-summary-section">
        <div className="dashboard-section-title">
          <h2>workspace artifacts</h2>
          <button type="button" className="project-subsection-action" onClick={onViewAllWorkspaceArtifacts} disabled={!onViewAllWorkspaceArtifacts}>
            View all
          </button>
        </div>
        {workspaceArtifactsLoading ? <p className="dashboard-empty">Loading workspace artifacts...</p> : null}
        {!workspaceArtifactsLoading && workspaceArtifactsSummary ? (
          <>
            <div className="project-artifacts-summary-grid">
              <article>
                <strong>{workspaceArtifactsSummary.artifacts}</strong>
                <span>total artifacts</span>
              </article>
              <article>
                <strong>{workspaceArtifactsSummary.sessions}</strong>
                <span>sessions</span>
              </article>
              <article>
                <strong>{workspaceArtifactsSummary.screenshots}</strong>
                <span>screenshots</span>
              </article>
              <article>
                <strong>{workspaceArtifactsSummary.contextSelections}</strong>
                <span>context selections</span>
              </article>
            </div>
            <small className="project-artifacts-updated">
              {workspaceArtifactsSummary.lastCreatedAt ? `Last artifact ${timeAgo(workspaceArtifactsSummary.lastCreatedAt)}` : "No recent artifacts"}
            </small>
          </>
        ) : null}
        {!workspaceArtifactsLoading && !workspaceArtifactsSummary ? (
          <p className="dashboard-empty">No artifact summary available yet.</p>
        ) : null}
      </section>

      <section className="dashboard-section project-usage-section">
        <div className="dashboard-section-title">
          <h2>workspace usage // 30 days</h2>
          <div className="project-usage-actions">
            <small>{updatedAt ? `updated ${timeAgo(updatedAt)}` : "not updated yet"}</small>
            <button type="button" className="dashboard-icon-btn" onClick={onRefresh} disabled={loading} title="Refresh">
              <RotateCcw size={14} className={loading ? "spin" : ""} />
            </button>
          </div>
        </div>
        <div className="dashboard-metric-grid">
          <article>
            <strong>{sessionCount}</strong>
            <span>total sessions</span>
          </article>
          <article>
            <strong>{sessions7d}</strong>
            <span>sessions, 7d</span>
          </article>
          <article>
            <strong>{sessions30d}</strong>
            <span>sessions, 30d</span>
          </article>
          <article>
            <strong>{compact(tokenInput30d)}</strong>
            <span>input tokens</span>
          </article>
          <article>
            <strong>{compact(tokenOutput30d)}</strong>
            <span>output tokens</span>
          </article>
          <article>
            <strong>{compact(tokenCacheRead30d)}</strong>
            <span>cache read</span>
          </article>
          <article>
            <strong>{money(totalCost30d)}</strong>
            <span>cost, 30d</span>
          </article>
        </div>
      </section>

      <section className="dashboard-section project-models-section">
        <div className="dashboard-section-title">
          <h2>top models</h2>
        </div>
        <div className="dashboard-models">
          {topModels.map((item) => (
            <span key={item.model}>
              {trimProviderPrefix(item.model)} <small>{item.count}</small>
            </span>
          ))}
          {topModels.length === 0 ? <p className="dashboard-empty">No model data available yet.</p> : null}
        </div>
        {error ? <p className="dashboard-error">{error}</p> : null}
      </section>
    </section>
  );
}
