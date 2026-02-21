type DashboardSession = {
  id: string;
  title: string;
  project: string;
  updatedAt: number;
};

type DashboardModel = {
  model: string;
  count: number;
};

type DashboardDay = {
  label: string;
  count: number;
};

type Props = {
  loading: boolean;
  projects: number;
  sessions7d: number;
  sessions30d: number;
  providersConnected: number;
  topModels: DashboardModel[];
  tokenInput30d: number;
  tokenOutput30d: number;
  tokenCacheRead30d: number;
  totalCost30d: number;
  recentSessions: DashboardSession[];
  daySeries: DashboardDay[];
  updatedAt?: number;
  error?: string;
  onRefresh: () => void;
  onAddWorkspace: () => void;
  onOpenSettings: () => void;
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
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
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

export function HomeDashboard({
  loading,
  projects,
  sessions7d,
  sessions30d,
  providersConnected,
  topModels,
  tokenInput30d,
  tokenOutput30d,
  tokenCacheRead30d,
  totalCost30d,
  recentSessions,
  daySeries,
  updatedAt,
  error,
  onRefresh,
  onAddWorkspace,
  onOpenSettings,
}: Props) {
  const highestCount = daySeries.reduce(
    (max, day) => Math.max(max, day.count),
    1,
  );

  return (
    <section className="dashboard">
      <header className="dashboard-header">
        <h1>Workspace Dashboard</h1>
        <p>Monitor workspaces and jump into sessions quickly.</p>
      </header>

      <section className="dashboard-section">
        <div className="dashboard-section-title">
          <h2>Latest Sessions</h2>
          <button type="button" onClick={onRefresh} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <div className="dashboard-session-grid">
          {recentSessions.slice(0, 3).map((session) => (
            <article key={session.id} className="dashboard-session-card">
              <strong>{session.project}</strong>
              <small>{timeAgo(session.updatedAt)}</small>
              <p>{session.title}</p>
            </article>
          ))}
          {recentSessions.length === 0 ? (
            <p className="dashboard-empty">
               No sessions yet. Create one from a workspace.
            </p>
          ) : null}
        </div>
        <div className="dashboard-actions">
          <button type="button" onClick={onAddWorkspace}>
            + Add Workspace
          </button>
          <button type="button" onClick={onOpenSettings}>
            Settings
          </button>
        </div>
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-title">
          <h2>Usage Snapshot</h2>
          <small>
            {updatedAt ? `Updated ${timeAgo(updatedAt)}` : "Not updated yet"}
          </small>
        </div>
        <div className="dashboard-metric-grid">
          <article>
            <span>Workspaces</span>
            <strong>{projects}</strong>
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
            <span>Providers</span>
            <strong>{providersConnected}</strong>
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

        <small>Daily token volume</small>
        <div className="dashboard-chart" aria-label="Token usage by day">
          {daySeries.map((day) => (
            <div key={day.label} className="dashboard-chart-day">
              <div className="dashboard-chart-bar-wrap">
                <div
                  className="dashboard-chart-bar"
                  style={{
                    height: `${Math.max(8, Math.round((day.count / highestCount) * 120))}px`,
                    opacity: day.count === 0 ? 0.4 : 1,
                  }}
                />
                <span className="dashboard-chart-tooltip">
                  {day.label}: {compact(day.count)} tokens
                </span>
              </div>
              <small>{day.label}</small>
            </div>
          ))}
        </div>

        <div className="dashboard-models">
          {topModels.map((item) => (
            <span key={item.model}>
              {item.model} <small>{item.count}</small>
            </span>
          ))}
          {topModels.length === 0 ? (
            <p className="dashboard-empty">No model data available yet.</p>
          ) : null}
        </div>

        {error ? <p className="dashboard-error">{error}</p> : null}
      </section>
    </section>
  );
}
