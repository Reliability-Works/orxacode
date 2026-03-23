import { ChevronDown, ChevronRight, Plus, Plug, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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

function formatEndpoint(baseUrl?: string) {
  if (!baseUrl) {
    return "Not connected";
  }
  try {
    const url = new URL(baseUrl);
    return `${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`;
  } catch {
    return baseUrl;
  }
}

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
  const localProfile = useMemo(
    () => profiles.find((profile) => profile.startCommand),
    [profiles],
  );
  const remoteProfiles = useMemo(
    () => profiles.filter((profile) => !localProfile || profile.id !== localProfile.id),
    [localProfile, profiles],
  );
  const [selectedProfileId, setSelectedProfileId] = useState<string | undefined>(remoteProfiles[0]?.id);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const selected = useMemo(
    () => (isCreatingNew ? undefined : remoteProfiles.find((profile) => profile.id === selectedProfileId) ?? remoteProfiles[0]),
    [isCreatingNew, remoteProfiles, selectedProfileId],
  );
  const [password, setPassword] = useState("");
  const [draft, setDraft] = useState<RuntimeProfileInput | null>(null);

  useEffect(() => {
    if (isCreatingNew) {
      return;
    }
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
      startCommand: false,
      startHost: selected.startHost,
      startPort: selected.startPort,
      cliPath: selected.cliPath,
      corsOrigins: selected.corsOrigins,
      password: "",
    });
    setPassword("");
  }, [isCreatingNew, selected]);

  useEffect(() => {
    if (!selectedProfileId && remoteProfiles[0]?.id) {
      setSelectedProfileId(remoteProfiles[0].id);
    }
  }, [remoteProfiles, selectedProfileId]);

  const createNewRemoteProfile = () => {
    setIsCreatingNew(true);
    setSelectedProfileId(undefined);
    setDraft({
      name: "Remote OpenCode",
      host: "",
      port: 443,
      https: true,
      username: "opencode",
      startCommand: false,
      startHost: "127.0.0.1",
      startPort: 4096,
      cliPath: "",
      corsOrigins: [],
      password: "",
    });
    setPassword("");
  };

  const refreshDiagnostics = async (message: string, action: () => Promise<ServerDiagnostics>) => {
    try {
      const next = await action();
      setServerDiagnostics(next);
      setFeedback(message);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    }
  };

  const handleSave = async () => {
    if (!draft) {
      return;
    }
    try {
      await onSaveProfile({ ...draft, password, corsOrigins: draft.corsOrigins });
      await onRefreshProfiles();
      setIsCreatingNew(false);
      setFeedback("Remote profile saved");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    }
  };

  const handleDelete = async () => {
    if (!draft?.id) {
      return;
    }
    try {
      await onDeleteProfile(draft.id);
      await onRefreshProfiles();
      setSelectedProfileId(remoteProfiles[0]?.id);
      setFeedback("Remote profile deleted");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    }
  };

  const handleAttach = async () => {
    if (!draft?.id) {
      return;
    }
    try {
      await onAttachProfile(draft.id);
      setFeedback("Attached to remote server");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    }
  };

  const handleRestartLocal = async () => {
    if (!localProfile) {
      return;
    }
    try {
      await onStopLocalProfile();
      await onStartLocalProfile(localProfile.id);
      setFeedback("Local runtime restarted");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    }
  };

  const statusValue = serverDiagnostics?.runtime.status ?? runtime.status ?? "unknown";
  const healthValue = serverDiagnostics?.health ?? "unknown";
  const isRunning = String(statusValue) === "running" || String(statusValue) === "connected";
  const isHealthy = String(healthValue) === "connected";

  return (
    <section className="settings-section-card settings-pad settings-server-grid">
      <p className="settings-server-title">server</p>

      <p className="settings-server-subtitle">// local runtime</p>
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
            {runtime.managedServer ? formatEndpoint(runtime.baseUrl) : "Not managed by app"}
          </span>
        </div>
        <div className="settings-server-status-row">
          <span className="settings-server-status-key">launch config</span>
          <span className="settings-server-status-value">
            {localProfile ? `${localProfile.startHost}:${localProfile.startPort}` : "Unavailable"}
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
            <span className="settings-server-status-value settings-server-status-value--error">{runtime.lastError}</span>
          </div>
        ) : null}
      </div>
      <p className="settings-server-help">
        Local OpenCode is managed by Orxa. The live endpoint can change on each launch, so this section shows the actual connected runtime rather than an editable profile.
      </p>
      <div className="settings-server-buttons">
        <button
          type="button"
          className="settings-server-btn"
          onClick={() => void refreshDiagnostics("Diagnostics refreshed", onGetServerDiagnostics)}
        >
          <ChevronDown size={12} />
          refresh diagnostics
        </button>
        <button
          type="button"
          className="settings-server-btn"
          onClick={() => void refreshDiagnostics("Runtime repaired", onRepairRuntime)}
        >
          <ChevronRight size={12} />
          repair runtime
        </button>
        {localProfile ? (
          <button
            type="button"
            className="settings-server-btn"
            onClick={() => void handleRestartLocal()}
          >
            restart local runtime
          </button>
        ) : null}
      </div>

      <p className="settings-server-subtitle" style={{ marginTop: 16 }}>// remote profiles</p>
      <p className="settings-server-help">
        Remote profiles are for attaching to an OpenCode server hosted elsewhere. They do not control the app-managed local runtime.
      </p>
      <div className="settings-profiles-layout">
        <div className="settings-profiles-list">
          {remoteProfiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              className={`settings-profile-item${profile.id === selected?.id ? " active" : ""}`}
              onClick={() => {
                setIsCreatingNew(false);
                setSelectedProfileId(profile.id);
              }}
            >
              <span className="settings-profile-item-name">{profile.name}</span>
              <span className="settings-profile-item-addr">
                {profile.https ? "https" : "http"}://{profile.host}:{profile.port}
              </span>
              {runtime.activeProfileId === profile.id && !runtime.managedServer ? (
                <span className="settings-profile-item-connected" />
              ) : null}
            </button>
          ))}
          <button type="button" className="settings-profile-add" onClick={createNewRemoteProfile}>
            <Plus size={12} /> new remote profile
          </button>
        </div>

        {draft ? (
          <div className="settings-profile-form">
            <label>
              name
              <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <div className="settings-profile-row-2">
              <label>
                host
                <input value={draft.host} onChange={(event) => setDraft({ ...draft, host: event.target.value })} />
              </label>
              <label>
                port
                <input
                  type="number"
                  value={draft.port}
                  onChange={(event) => setDraft({ ...draft, port: Number(event.target.value) })}
                />
              </label>
            </div>
            <div className="settings-profile-row-2">
              <label>
                username
                <input
                  value={draft.username ?? ""}
                  onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                />
              </label>
              <label>
                password
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </label>
            </div>
            <label className="settings-inline-toggle">
              use https
              <input
                type="checkbox"
                checked={draft.https}
                onChange={(event) => setDraft({ ...draft, https: event.target.checked })}
              />
            </label>
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
                <button type="button" className="settings-server-btn settings-profile-btn-danger" onClick={() => void handleDelete()}>
                  <Trash2 size={11} /> delete
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="settings-server-empty-state">
            No remote profiles yet. Add one to attach Orxa to an externally hosted OpenCode server.
          </div>
        )}
      </div>
    </section>
  );
}
