import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Play, Plug, Plus, Square, Trash2 } from "lucide-react";
import type { RuntimeProfile, RuntimeProfileInput, RuntimeState, ServerDiagnostics } from "@shared/ipc";

type ServerSectionProps = {
  serverDiagnostics: ServerDiagnostics | null;
  onGetServerDiagnostics: () => Promise<ServerDiagnostics>;
  onRepairRuntime: () => Promise<ServerDiagnostics>;
  setServerDiagnostics: (diagnostics: ServerDiagnostics) => void;
  setFeedback: (message: string) => void;
  profiles: RuntimeProfile[];
  runtime: RuntimeState;
  onSaveProfile: (profile: RuntimeProfileInput) => Promise<void>;
  onDeleteProfile: (profileID: string) => Promise<void>;
  onAttachProfile: (profileID: string) => Promise<void>;
  onStartLocalProfile: (profileID: string) => Promise<void>;
  onStopLocalProfile: () => Promise<void>;
  onRefreshProfiles: () => Promise<void>;
};

export function ServerSection({
  serverDiagnostics,
  onGetServerDiagnostics,
  onRepairRuntime,
  setServerDiagnostics,
  setFeedback,
  profiles,
  runtime,
  onSaveProfile,
  onDeleteProfile,
  onAttachProfile,
  onStartLocalProfile,
  onStopLocalProfile,
  onRefreshProfiles,
}: ServerSectionProps) {
  const statusValue = serverDiagnostics?.runtime.status ?? "unknown";
  const healthValue = serverDiagnostics?.health ?? "unknown";
  const isRunning = String(statusValue) === "running";
  const isHealthy = String(healthValue) === "ok";

  const [selectedProfileId, setSelectedProfileId] = useState<string | undefined>(profiles[0]?.id);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const selected = useMemo(
    () => (isCreatingNew ? undefined : profiles.find((p) => p.id === selectedProfileId) ?? profiles[0]),
    [profiles, selectedProfileId, isCreatingNew],
  );
  const [password, setPassword] = useState("");
  const [draft, setDraft] = useState<RuntimeProfileInput | null>(null);

  useEffect(() => {
    if (isCreatingNew) return; // Don't overwrite new-profile draft
    if (!selected) {
      setDraft(null);
      return;
    }
    setDraft({
      id: selected.id,
      name: selected.name,
      host: selected.host,
      port: selected.port,
      https: selected.https,
      username: selected.username,
      startCommand: selected.startCommand,
      startHost: selected.startHost,
      startPort: selected.startPort,
      cliPath: selected.cliPath,
      corsOrigins: selected.corsOrigins,
      password: "",
    });
    setPassword("");
  }, [selected, isCreatingNew]);

  const createNewProfile = () => {
    setIsCreatingNew(true);
    setSelectedProfileId(undefined);
    setDraft({
      name: "New Profile",
      host: "127.0.0.1",
      port: 4096,
      https: false,
      username: "opencode",
      startCommand: true,
      startHost: "127.0.0.1",
      startPort: 4096,
      cliPath: "",
      corsOrigins: [],
      password: "",
    });
    setPassword("");
  };

  const handleSave = async () => {
    if (!draft) return;
    try {
      await onSaveProfile({ ...draft, password, corsOrigins: draft.corsOrigins });
      await onRefreshProfiles();
      setIsCreatingNew(false);
      setFeedback("Profile saved");
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async () => {
    if (!draft?.id) return;
    try {
      await onDeleteProfile(draft.id);
      await onRefreshProfiles();
      setSelectedProfileId(profiles[0]?.id);
      setFeedback("Profile deleted");
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAttach = async () => {
    if (!draft?.id) return;
    try {
      await onAttachProfile(draft.id);
      setFeedback("Attached to server");
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
    }
  };

  const handleStartLocal = async () => {
    if (!draft?.id) return;
    try {
      await onStartLocalProfile(draft.id);
      setFeedback("Local server started");
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
    }
  };

  const handleStopLocal = async () => {
    try {
      await onStopLocalProfile();
      setFeedback("Local server stopped");
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="settings-section-card settings-pad settings-server-grid">
      <p className="settings-server-title">server</p>

      {/* Diagnostics */}
      <p className="settings-server-subtitle">// diagnostics</p>
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
          <span className="settings-server-status-key">connection</span>
          <span className={`settings-server-status-value${runtime.status === "connected" ? " settings-server-status-value--green" : ""}`}>
            {runtime.status}
          </span>
        </div>
        <div className="settings-server-status-row">
          <span className="settings-server-status-key">server type</span>
          <span className="settings-server-status-value">
            {runtime.managedServer ? "managed by app" : "external"}
          </span>
        </div>
        {runtime.lastError ? (
          <div className="settings-server-status-row">
            <span className="settings-server-status-key">error</span>
            <span className="settings-server-status-value" style={{ color: "var(--accent-error, #ef4444)" }}>
              {runtime.lastError}
            </span>
          </div>
        ) : null}
      </div>
      <div className="settings-server-buttons">
        <button
          type="button"
          className="settings-server-btn"
          onClick={() =>
            void onGetServerDiagnostics()
              .then((next) => { setServerDiagnostics(next); setFeedback("Diagnostics refreshed"); })
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
              .then((next) => { setServerDiagnostics(next); setFeedback("Runtime repaired"); })
              .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
          }
        >
          <ChevronRight size={12} />
          repair runtime
        </button>
      </div>

      {/* Profiles */}
      <p className="settings-server-subtitle" style={{ marginTop: 16 }}>// connection profiles</p>

      <div className="settings-profiles-layout">
        <div className="settings-profiles-list">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              className={`settings-profile-item${profile.id === selected?.id ? " active" : ""}`}
              onClick={() => { setIsCreatingNew(false); setSelectedProfileId(profile.id); }}
            >
              <span className="settings-profile-item-name">{profile.name}</span>
              <span className="settings-profile-item-addr">{profile.host}:{profile.port}</span>
              {runtime.activeProfileId === profile.id ? (
                <span className="settings-profile-item-connected" />
              ) : null}
            </button>
          ))}
          <button type="button" className="settings-profile-add" onClick={createNewProfile}>
            <Plus size={12} /> new profile
          </button>
        </div>

        {draft ? (
          <div className="settings-profile-form">
            <label>
              name
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <div className="settings-profile-row-2">
              <label>
                host
                <input value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} />
              </label>
              <label>
                port
                <input type="number" value={draft.port} onChange={(e) => setDraft({ ...draft, port: Number(e.target.value) })} />
              </label>
            </div>
            <div className="settings-profile-row-2">
              <label>
                username
                <input value={draft.username ?? ""} onChange={(e) => setDraft({ ...draft, username: e.target.value })} />
              </label>
              <label>
                password
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
            </div>
            <label className="settings-toggle-row" style={{ padding: "4px 0" }}>
              <span>start local server from app</span>
              <button
                type="button"
                role="switch"
                aria-checked={draft.startCommand}
                className={`settings-switch${draft.startCommand ? " on" : ""}`}
                onClick={() => setDraft({ ...draft, startCommand: !draft.startCommand })}
              >
                <span className="settings-switch-thumb" />
              </button>
            </label>
            {draft.startCommand ? (
              <>
                <div className="settings-profile-row-2">
                  <label>
                    start host
                    <input value={draft.startHost} onChange={(e) => setDraft({ ...draft, startHost: e.target.value })} />
                  </label>
                  <label>
                    start port
                    <input type="number" value={draft.startPort} onChange={(e) => setDraft({ ...draft, startPort: Number(e.target.value) })} />
                  </label>
                </div>
                <label>
                  binary path override
                  <input
                    value={draft.cliPath ?? ""}
                    placeholder="opencode"
                    onChange={(e) => setDraft({ ...draft, cliPath: e.target.value })}
                  />
                </label>
              </>
            ) : null}
            <div className="settings-profile-actions">
              <button type="button" className="settings-server-btn" onClick={() => void handleSave()}>
                save
              </button>
              {draft.id ? (
                <button type="button" className="settings-server-btn settings-profile-btn-green" onClick={() => void handleAttach()}>
                  <Plug size={11} /> attach
                </button>
              ) : null}
              {draft.id ? (
                <button type="button" className="settings-server-btn settings-profile-btn-green" onClick={() => void handleStartLocal()}>
                  <Play size={11} /> start local
                </button>
              ) : null}
              <button type="button" className="settings-server-btn" onClick={() => void handleStopLocal()}>
                <Square size={11} /> stop local
              </button>
              {draft.id ? (
                <button type="button" className="settings-server-btn settings-profile-btn-danger" onClick={() => void handleDelete()}>
                  <Trash2 size={11} /> delete
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
