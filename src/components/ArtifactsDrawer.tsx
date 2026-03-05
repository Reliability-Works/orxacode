import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, RotateCcw, Scissors, Trash2, X } from "lucide-react";
import type {
  ArtifactKind,
  ArtifactRecord,
  ArtifactRetentionPolicy,
  ArtifactSessionSummary,
  ContextSelectionTrace,
  WorkspaceArtifactSummary,
} from "@shared/ipc";
import { timeAgo } from "~/lib/format";

export type ArtifactKindFilter = "all" | ArtifactKind;
export type ArtifactScopeTab = "session" | "workspace" | "app";

type Props = {
  open: boolean;
  tab: ArtifactScopeTab;
  onTabChange: (tab: ArtifactScopeTab) => void;
  sessionArtifacts: ArtifactRecord[];
  workspaceArtifacts: ArtifactRecord[];
  appArtifacts: ArtifactRecord[];
  sessionSummaries?: ArtifactSessionSummary[];
  workspaceSummary?: WorkspaceArtifactSummary | null;
  retentionPolicy?: ArtifactRetentionPolicy | null;
  retentionBusy?: boolean;
  exportBusy?: boolean;
  contextTrace?: ContextSelectionTrace | null;
  activeSessionID?: string | null;
  loading?: boolean;
  error?: string;
  activeKind?: ArtifactKindFilter;
  onClose: () => void;
  onRefresh?: () => void;
  onDeleteArtifact?: (artifactID: string) => void;
  onKindFilterChange?: (next: ArtifactKindFilter) => void;
  onApplyRetentionCap?: (maxBytes: number) => void;
  onPruneNow?: () => void;
  onExportBundle?: () => void;
};

function formatBytes(value: number | undefined) {
  if (!value || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 100 ? Math.round(size) : size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function artifactKindLabel(kind: ArtifactKind) {
  if (kind === "browser.screenshot") {
    return "Screenshot";
  }
  return "Context selection";
}

function compactSessionID(value: string, maxLength = 34) {
  if (value.length <= maxLength) {
    return value;
  }
  const head = Math.max(8, Math.floor((maxLength - 1) / 2));
  const tail = Math.max(6, maxLength - head - 1);
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function ArtifactsDrawer({
  open,
  tab,
  onTabChange,
  sessionArtifacts,
  workspaceArtifacts,
  appArtifacts,
  sessionSummaries = [],
  workspaceSummary,
  retentionPolicy,
  retentionBusy = false,
  exportBusy = false,
  contextTrace,
  activeSessionID,
  loading = false,
  error,
  activeKind = "all",
  onClose,
  onRefresh,
  onDeleteArtifact,
  onKindFilterChange,
  onApplyRetentionCap,
  onPruneNow,
  onExportBundle,
}: Props) {
  const title = "Artifacts";
  const latestSessionTimestamp = sessionSummaries[0]?.lastCreatedAt;
  const artifacts = tab === "session" ? sessionArtifacts : tab === "workspace" ? workspaceArtifacts : appArtifacts;
  const visibleArtifacts = activeKind === "all" ? artifacts : artifacts.filter((item) => item.kind === activeKind);
  const appPrivateWorkspaceCount = useMemo(() => new Set(appArtifacts.map((artifact) => artifact.workspace)).size, [appArtifacts]);
  const selectedTotal = tab === "workspace" ? workspaceSummary?.artifacts ?? artifacts.length : artifacts.length;
  const selectedScreenshots = tab === "workspace"
    ? workspaceSummary?.screenshots ?? artifacts.filter((item) => item.kind === "browser.screenshot").length
    : artifacts.filter((item) => item.kind === "browser.screenshot").length;
  const selectedSelections = tab === "workspace"
    ? workspaceSummary?.contextSelections ?? artifacts.filter((item) => item.kind === "context.selection").length
    : artifacts.filter((item) => item.kind === "context.selection").length;
  const selectedBytes = tab === "workspace"
    ? workspaceSummary?.bytes
    : artifacts.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);
  const capStepMB = 64;
  const capMinMB = 64;
  const capMaxMB = 4096;
  const policyCapMB = retentionPolicy
    ? Math.max(capMinMB, Math.min(capMaxMB, Math.round(retentionPolicy.maxBytes / (1024 * 1024))))
    : 512;
  const [retentionCapMB, setRetentionCapMB] = useState(policyCapMB);
  useEffect(() => {
    setRetentionCapMB(policyCapMB);
  }, [policyCapMB]);
  const usagePercent = useMemo(() => {
    if (!retentionPolicy || retentionPolicy.maxBytes <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round((retentionPolicy.totalBytes / retentionPolicy.maxBytes) * 100)));
  }, [retentionPolicy]);

  if (!open) {
    return null;
  }

  return (
    <div className="overlay" onClick={onClose}>
      <section
        className="modal artifacts-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            <small className="artifacts-subtitle">
              {tab === "session"
                ? activeSessionID
                  ? `${sessionArtifacts.length} artifacts in this session`
                  : "Select a session to view session artifacts"
                : tab === "workspace"
                  ? workspaceSummary
                    ? `${workspaceSummary.artifacts} artifacts across ${workspaceSummary.sessions} sessions`
                    : "Workspace artifact timeline and snapshots"
                  : appArtifacts.length > 0
                    ? `${appArtifacts.length} app-private artifacts not bound to workspace/session`
                    : "App-private artifacts not bound to workspace/session"}
            </small>
          </div>
          <div className="artifacts-header-actions">
            <button type="button" className="dashboard-icon-btn" onClick={onRefresh} disabled={!onRefresh || loading} title="Refresh artifacts">
              <RotateCcw size={14} className={loading ? "spin" : ""} />
            </button>
            <button type="button" className="dashboard-icon-btn" onClick={onClose} title="Close artifacts">
              <X size={14} />
            </button>
          </div>
        </header>

        <div className="artifacts-drawer-body">
          <div className="artifacts-tab-strip" role="tablist" aria-label="Artifacts scope">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "session"}
              className={tab === "session" ? "active" : ""}
              onClick={() => onTabChange("session")}
            >
              Session
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "workspace"}
              className={tab === "workspace" ? "active" : ""}
              onClick={() => onTabChange("workspace")}
            >
              Workspace
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "app"}
              className={tab === "app" ? "active" : ""}
              onClick={() => onTabChange("app")}
            >
              App
            </button>
          </div>

          <section className="artifacts-summary-grid" aria-label="Artifact summary">
            <article>
              <span>Total</span>
              <strong>{selectedTotal}</strong>
            </article>
            <article>
              <span>Screenshots</span>
              <strong>{selectedScreenshots}</strong>
            </article>
            <article>
              <span>Selections</span>
              <strong>{selectedSelections}</strong>
            </article>
            <article>
              <span>Storage</span>
              <strong>{formatBytes(selectedBytes)}</strong>
            </article>
          </section>

          <section className="artifacts-retention-controls" aria-label="Artifact retention controls">
            <div className="artifacts-retention-header">
              <strong>Retention</strong>
              <small>
                {retentionPolicy
                  ? `${formatBytes(retentionPolicy.totalBytes)} / ${formatBytes(retentionPolicy.maxBytes)} (${usagePercent}%)`
                  : "Loading retention settings..."}
              </small>
            </div>
            <div className="artifacts-retention-row">
              <label htmlFor="artifact-cap-range">Cap</label>
              <input
                id="artifact-cap-range"
                type="range"
                min={capMinMB}
                max={capMaxMB}
                step={capStepMB}
                value={retentionCapMB}
                onChange={(event) => setRetentionCapMB(Number(event.target.value))}
                disabled={retentionBusy || !onApplyRetentionCap}
              />
              <span>{retentionCapMB} MB</span>
              <button
                type="button"
                onClick={() => onApplyRetentionCap?.(retentionCapMB * 1024 * 1024)}
                disabled={retentionBusy || !onApplyRetentionCap || retentionCapMB === policyCapMB}
              >
                Apply
              </button>
            </div>
            <div className="artifacts-retention-actions">
              <button type="button" onClick={() => onPruneNow?.()} disabled={retentionBusy || !onPruneNow}>
                <Scissors size={14} />
                <span>{retentionBusy ? "Pruning..." : "Prune now"}</span>
              </button>
              <button type="button" onClick={() => onExportBundle?.()} disabled={exportBusy || !onExportBundle}>
                <Download size={14} />
                <span>{exportBusy ? "Exporting..." : "Export bundle"}</span>
              </button>
            </div>
          </section>

          <div className="artifacts-toolbar">
            <div className="artifacts-kind-filters" role="tablist" aria-label="Artifact kind filters">
              <button
                type="button"
                role="tab"
                aria-selected={activeKind === "all"}
                className={activeKind === "all" ? "active" : ""}
                onClick={() => onKindFilterChange?.("all")}
              >
                All
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeKind === "browser.screenshot"}
                className={activeKind === "browser.screenshot" ? "active" : ""}
                onClick={() => onKindFilterChange?.("browser.screenshot")}
              >
                Screenshots
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeKind === "context.selection"}
                className={activeKind === "context.selection" ? "active" : ""}
                onClick={() => onKindFilterChange?.("context.selection")}
              >
                Context selections
              </button>
            </div>
            <small>
              {tab === "workspace" && sessionSummaries.length > 0 && latestSessionTimestamp
                ? `${sessionSummaries.length} sessions, latest ${timeAgo(latestSessionTimestamp)}`
                : tab === "session"
                  ? activeSessionID
                    ? `Session ${compactSessionID(activeSessionID)}`
                    : "No active session"
                  : appPrivateWorkspaceCount > 0
                    ? `${appPrivateWorkspaceCount} workspace scopes in app-private view`
                    : "No app-private artifacts yet"}
            </small>
          </div>

          <section className="artifacts-list" aria-label="Workspace artifacts list">
            {visibleArtifacts.map((artifact) => {
              const titleText = artifact.title?.trim().length ? artifact.title : artifactKindLabel(artifact.kind);
              return (
                <article key={artifact.id} className="artifact-row">
                  <div className="artifact-row-main">
                    <strong>{titleText}</strong>
                    <small>
                      {artifactKindLabel(artifact.kind)} · {timeAgo(artifact.createdAt)} · {artifact.sizeBytes ? formatBytes(artifact.sizeBytes) : "No size"}
                    </small>
                    <p>
                      Session: <code>{compactSessionID(artifact.sessionID, 34)}</code>
                    </p>
                    {tab === "app" ? (
                      <p>
                        Workspace: <code>{artifact.workspace}</code>
                      </p>
                    ) : null}
                  </div>
                  <div className="artifact-row-actions">
                    <button
                      type="button"
                      onClick={() => {
                        if (artifact.fileUrl) {
                          void window.orxa.app.openExternal(artifact.fileUrl).catch(() => undefined);
                        }
                      }}
                      disabled={!artifact.fileUrl}
                    >
                      <ExternalLink size={14} />
                      <span>Open</span>
                    </button>
                    <button
                      type="button"
                      className="artifact-delete-btn"
                      onClick={() => onDeleteArtifact?.(artifact.id)}
                      disabled={!onDeleteArtifact}
                    >
                      <Trash2 size={14} />
                      <span>Delete</span>
                    </button>
                  </div>
                </article>
              );
            })}
            {!loading && visibleArtifacts.length === 0 ? (
              <p className="dashboard-empty">
                {tab === "app" ? "No app-private artifacts captured yet." : "No artifacts captured for this workspace yet."}
              </p>
            ) : null}
            {loading ? <p className="dashboard-empty">Loading artifacts...</p> : null}
          </section>

          {tab !== "app" && contextTrace ? (
            <section className="artifacts-context-trace" aria-label="Context selection trace">
              <div className="project-subsection-title">
                <h3>Context Trace</h3>
                <small>{timeAgo(contextTrace.createdAt)}</small>
              </div>
              {contextTrace.selected.length === 0 ? (
                <p className="dashboard-empty">No context snippets selected for the latest trace.</p>
              ) : (
                <div className="artifacts-trace-chip-grid">
                  {contextTrace.selected.slice(0, 10).map((entry) => (
                    <article key={`${entry.contextID}:${entry.heading}`} className="artifacts-trace-chip">
                      <strong>{entry.filename}</strong>
                      <small>{entry.heading || "Top match"}</small>
                      <small>Score {entry.score.toFixed(2)}</small>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {error ? <p className="dashboard-error">{error}</p> : null}
        </div>
      </section>
    </div>
  );
}
