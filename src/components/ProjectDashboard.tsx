import type { AgentsDocument } from "@shared/ipc";

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
};

function timeAgo(updatedAt: number) {
  const deltaMs = Date.now() - updatedAt;
  if (deltaMs < 60_000) {
    return "just now";
  }
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function compact(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function money(value: number) {
  if (value === 0) {
    return "$0";
  }
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function trimProviderPrefix(model: string) {
  const slashIndex = model.indexOf("/");
  if (slashIndex < 0) {
    return model;
  }
  return model.slice(slashIndex + 1);
}

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
}: Props) {
  const agentsMissing = !agentsLoading && agentsDocument !== null && agentsDocument.exists === false;

  return (
    <section className="dashboard project-dashboard">
      <section className={`dashboard-section project-agents-section ${agentsMissing ? "project-agents-empty" : ""}`.trim()}>
        <div className="dashboard-section-title">
          <h2>AGENTS.md</h2>
          <div className="project-agents-actions">
            <button type="button" onClick={onRefreshAgents} disabled={agentsLoading}>
              {agentsLoading ? "Refreshing..." : "Refresh"}
            </button>
            {agentsDocument?.exists ? (
              <button type="button" onClick={onSaveAgents} disabled={agentsSaving || agentsLoading}>
                {agentsSaving ? "Saving..." : "Save"}
              </button>
            ) : null}
          </div>
        </div>
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
      </section>

      <section className="dashboard-section project-usage-section">
        <div className="dashboard-section-title">
          <h2>Workspace Usage</h2>
          <div className="project-usage-actions">
            <small>{updatedAt ? `Updated ${timeAgo(updatedAt)}` : "Not updated yet"}</small>
            <button type="button" onClick={onRefresh} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
        <div className="dashboard-metric-grid">
          <article>
            <span>Total Sessions</span>
            <strong>{sessionCount}</strong>
          </article>
          <article>
            <span>Sessions (7d)</span>
            <strong>{sessions7d}</strong>
          </article>
          <article>
            <span>Sessions (30d)</span>
            <strong>{sessions30d}</strong>
          </article>
          <article>
            <span>Input Tokens (30d)</span>
            <strong>{compact(tokenInput30d)}</strong>
          </article>
          <article>
            <span>Output Tokens (30d)</span>
            <strong>{compact(tokenOutput30d)}</strong>
          </article>
          <article>
            <span>Cache Read (30d)</span>
            <strong>{compact(tokenCacheRead30d)}</strong>
          </article>
          <article>
            <span>Cost (30d)</span>
            <strong>{money(totalCost30d)}</strong>
          </article>
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
