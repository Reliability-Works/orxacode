import { ChevronDown, ChevronRight } from "lucide-react";
import type { ServerDiagnostics } from "@shared/ipc";

type ServerSectionProps = {
  serverDiagnostics: ServerDiagnostics | null;
  onGetServerDiagnostics: () => Promise<ServerDiagnostics>;
  onRepairRuntime: () => Promise<ServerDiagnostics>;
  setServerDiagnostics: (diagnostics: ServerDiagnostics) => void;
  setFeedback: (message: string) => void;
};

export function ServerSection({
  serverDiagnostics,
  onGetServerDiagnostics,
  onRepairRuntime,
  setServerDiagnostics,
  setFeedback,
}: ServerSectionProps) {
  const statusValue = serverDiagnostics?.runtime.status ?? "unknown";
  const healthValue = serverDiagnostics?.health ?? "unknown";
  const isRunning = String(statusValue) === "running";
  const isHealthy = String(healthValue) === "ok";
  return (
    <section className="settings-section-card settings-pad settings-server-grid">
      <p className="settings-server-title">server</p>
      <p className="settings-server-subtitle">// server diagnostics</p>
      <div className="settings-server-status-card">
        <div className="settings-server-status-row">
          <span className="settings-server-status-key">status</span>
          <span className={`settings-server-status-value${isRunning ? " settings-server-status-value--green" : ""}`}>
            {statusValue}
          </span>
        </div>
        <div className="settings-server-status-row">
          <span className="settings-server-status-key">health</span>
          <span className={`settings-server-status-value${isHealthy ? " settings-server-status-value--green" : ""}`}>
            {healthValue}
          </span>
        </div>
        <div className="settings-server-status-row">
          <span className="settings-server-status-key">active profile</span>
          <span className="settings-server-status-value">{serverDiagnostics?.activeProfile?.name ?? "default"}</span>
        </div>
      </div>
      <div className="settings-server-buttons">
        <button
          type="button"
          className="settings-server-btn"
          onClick={() =>
            void onGetServerDiagnostics()
              .then((next) => {
                setServerDiagnostics(next);
                setFeedback("Diagnostics refreshed");
              })
              .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
          }
        >
          <ChevronDown size={12} />
          refresh diagnostics
        </button>
        <button
          type="button"
          className="settings-server-btn"
          onClick={() =>
            void onRepairRuntime()
              .then((next) => {
                setServerDiagnostics(next);
                setFeedback("Runtime repaired");
              })
              .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
          }
        >
          <ChevronRight size={12} />
          repair runtime
        </button>
      </div>
    </section>
  );
}
