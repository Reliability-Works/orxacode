import { useEffect, useState } from "react";
import type { ProviderUsageStats } from "@shared/ipc";
import { compact, money, timeAgo } from "~/lib/format";

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

type ProviderTab = "opencode" | "codex" | "claude";

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
  codexSessionCount?: number;
  claudeSessionCount?: number;
  codexUsage?: ProviderUsageStats | null;
  claudeUsage?: ProviderUsageStats | null;
  codexUsageLoading?: boolean;
  claudeUsageLoading?: boolean;
  onRefresh: () => void;
  onAddWorkspace: () => void;
  onOpenSettings: () => void;
  onRefreshCodexUsage?: () => void;
  onRefreshClaudeUsage?: () => void;
};

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
  codexSessionCount = 0,
  claudeSessionCount = 0,
  codexUsage,
  claudeUsage,
  codexUsageLoading = false,
  claudeUsageLoading = false,
  onRefresh,
  onAddWorkspace,
  onOpenSettings,
  onRefreshCodexUsage,
  onRefreshClaudeUsage,
}: Props) {
  const [activeTab, setActiveTab] = useState<ProviderTab>("opencode");

  // Auto-refresh usage stats when switching to codex/claude tabs
  useEffect(() => {
    if (activeTab === "codex" && !codexUsage && !codexUsageLoading && onRefreshCodexUsage) {
      onRefreshCodexUsage();
    }
    if (activeTab === "claude" && !claudeUsage && !claudeUsageLoading && onRefreshClaudeUsage) {
      onRefreshClaudeUsage();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const highestCount = daySeries.reduce(
    (max, day) => Math.max(max, day.count),
    1,
  );

  return (
    <section className="dashboard">
      <header className="dashboard-header">
        <h1>orxa dashboard</h1>
        <p>// monitor workspaces and jump into sessions quickly.</p>
      </header>

      <div className="dashboard-tabs">
        <button
          type="button"
          className={`dashboard-tab${activeTab === "opencode" ? " active" : ""}`}
          onClick={() => setActiveTab("opencode")}
        >
          OpenCode
        </button>
        <button
          type="button"
          className={`dashboard-tab${activeTab === "codex" ? " active" : ""}`}
          onClick={() => setActiveTab("codex")}
        >
          Codex
        </button>
        <button
          type="button"
          className={`dashboard-tab${activeTab === "claude" ? " active" : ""}`}
          onClick={() => setActiveTab("claude")}
        >
          Claude
        </button>
      </div>

      <section className="dashboard-section">
        <div className="dashboard-section-title">
          <h2>latest sessions</h2>
          <button type="button" onClick={onRefresh} disabled={loading}>
            {loading ? "refreshing..." : "refresh"}
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
          <button type="button" className="dashboard-action-primary" onClick={onAddWorkspace}>
            + add workspace
          </button>
          <button type="button" className="dashboard-action-secondary" onClick={onOpenSettings}>
            settings
          </button>
        </div>
      </section>

      {activeTab === "opencode" ? (
        <>
          <section className="dashboard-section">
            <div className="dashboard-section-title">
              <h2>usage snapshot // 30 days</h2>
              <small>
                {updatedAt ? `updated ${timeAgo(updatedAt)}` : "not updated yet"}
              </small>
            </div>
            <div className="dashboard-metric-grid">
              <article>
                <strong>{projects}</strong>
                <span>workspaces</span>
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
                <strong>{providersConnected}</strong>
                <span>providers</span>
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

          <section className="dashboard-section">
            <div className="dashboard-section-title">
              <h2>daily tokens // 7 days</h2>
            </div>
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
          </section>

          <section className="dashboard-section">
            <div className="dashboard-section-title">
              <h2>top models</h2>
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
        </>
      ) : null}

      {activeTab === "codex" ? (
        <>
          <section className="dashboard-section">
            <div className="dashboard-section-title">
              <h2>codex usage snapshot</h2>
              <div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                <small>
                  {codexUsage?.updatedAt ? `updated ${timeAgo(codexUsage.updatedAt)}` : ""}
                </small>
                <button type="button" onClick={onRefreshCodexUsage} disabled={codexUsageLoading}>
                  {codexUsageLoading ? "loading..." : "refresh"}
                </button>
              </div>
            </div>
            {codexUsage ? (
              <div className="dashboard-metric-grid">
                <article className="dashboard-metric">
                  <strong className="dashboard-metric-value">{codexUsage.totalThreads || codexSessionCount}</strong>
                  <span className="dashboard-metric-label">total threads</span>
                </article>
                <article className="dashboard-metric">
                  <strong className="dashboard-metric-value">{codexUsage.sessions7d}</strong>
                  <span className="dashboard-metric-label">sessions, 7d</span>
                </article>
                <article className="dashboard-metric">
                  <strong className="dashboard-metric-value">{codexUsage.sessions30d}</strong>
                  <span className="dashboard-metric-label">sessions, 30d</span>
                </article>
                <article className="dashboard-metric">
                  <strong className="dashboard-metric-value">{codexUsage.modelCount}</strong>
                  <span className="dashboard-metric-label">models used</span>
                </article>
                <article className="dashboard-metric">
                  <strong className="dashboard-metric-value">{compact(codexUsage.inputTokens)}</strong>
                  <span className="dashboard-metric-label">input tokens</span>
                </article>
                <article className="dashboard-metric">
                  <strong className="dashboard-metric-value">{compact(codexUsage.outputTokens)}</strong>
                  <span className="dashboard-metric-label">output tokens</span>
                </article>
                <article className="dashboard-metric">
                  <strong className="dashboard-metric-value">{compact(codexUsage.cacheReadTokens)}</strong>
                  <span className="dashboard-metric-label">cache read</span>
                </article>
                <article className="dashboard-metric">
                  <strong className="dashboard-metric-value">{money(codexUsage.totalCost)}</strong>
                  <span className="dashboard-metric-label">est. cost</span>
                </article>
              </div>
            ) : (
              <p className="dashboard-empty">
                {codexUsageLoading ? "Loading Codex usage data..." : "No Codex usage data yet. Click refresh to load."}
              </p>
            )}
          </section>

          {codexUsage && codexUsage.topModels.length > 0 ? (
            <section className="dashboard-section">
              <div className="dashboard-section-title">
                <h2>top models</h2>
              </div>
              <div className="dashboard-models">
                {codexUsage.topModels.map((item) => (
                  <span key={item.model} className="model-badge">
                    {item.model} <small>{item.count}</small>
                  </span>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {activeTab === "claude" ? (
        <>
          <section className="dashboard-section">
            <div className="dashboard-section-title">
              <h2>claude code usage snapshot</h2>
              <div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                <small>
                  {claudeUsage?.updatedAt ? `updated ${timeAgo(claudeUsage.updatedAt)}` : ""}
                </small>
                <button type="button" onClick={onRefreshClaudeUsage} disabled={claudeUsageLoading}>
                  {claudeUsageLoading ? "loading..." : "refresh"}
                </button>
              </div>
            </div>
            {claudeUsage ? (
              <div className="dashboard-metric-grid">
                <article className="dashboard-metric">
                  <strong className="dashboard-metric-value">{claudeUsage.totalThreads || claudeSessionCount}</strong>
                  <span className="dashboard-metric-label">total sessions</span>
                </article>
                <article className="dashboard-metric">
                  <strong className="dashboard-metric-value">{claudeUsage.sessions7d}</strong>
                  <span className="dashboard-metric-label">sessions, 7d</span>
                </article>
                <article className="dashboard-metric">
                  <strong className="dashboard-metric-value">{claudeUsage.sessions30d}</strong>
                  <span className="dashboard-metric-label">sessions, 30d</span>
                </article>
                <article className="dashboard-metric">
                  <strong className="dashboard-metric-value">{claudeUsage.modelCount}</strong>
                  <span className="dashboard-metric-label">models used</span>
                </article>
                <article className="dashboard-metric">
                  <strong className="dashboard-metric-value">{compact(claudeUsage.inputTokens)}</strong>
                  <span className="dashboard-metric-label">input tokens</span>
                </article>
                <article className="dashboard-metric">
                  <strong className="dashboard-metric-value">{compact(claudeUsage.outputTokens)}</strong>
                  <span className="dashboard-metric-label">output tokens</span>
                </article>
                <article className="dashboard-metric">
                  <strong className="dashboard-metric-value">{compact(claudeUsage.cacheReadTokens)}</strong>
                  <span className="dashboard-metric-label">cache read</span>
                </article>
                <article className="dashboard-metric">
                  <strong className="dashboard-metric-value">{money(claudeUsage.totalCost)}</strong>
                  <span className="dashboard-metric-label">est. cost</span>
                </article>
              </div>
            ) : (
              <p className="dashboard-empty">
                {claudeUsageLoading ? "Loading Claude usage data..." : "No Claude usage data yet. Click refresh to load."}
              </p>
            )}
          </section>

          {claudeUsage && claudeUsage.topModels.length > 0 ? (
            <section className="dashboard-section">
              <div className="dashboard-section-title">
                <h2>top models</h2>
              </div>
              <div className="dashboard-models">
                {claudeUsage.topModels.map((item) => (
                  <span key={item.model} className="model-badge">
                    {item.model} <small>{item.count}</small>
                  </span>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
