import { useEffect, useMemo, useState } from "react";
import type { RuntimeProfile, RuntimeProfileInput, RuntimeState } from "@shared/ipc";

type Props = {
  open: boolean;
  profiles: RuntimeProfile[];
  runtime: RuntimeState;
  onClose: () => void;
  onSave: (profile: RuntimeProfileInput) => Promise<void>;
  onDelete: (profileID: string) => Promise<void>;
  onAttach: (profileID: string) => Promise<void>;
  onStartLocal: (profileID: string) => Promise<void>;
  onStopLocal: () => Promise<void>;
};

export function ProfileModal({
  open,
  profiles,
  runtime,
  onClose,
  onSave,
  onDelete,
  onAttach,
  onStartLocal,
  onStopLocal,
}: Props) {
  const [selectedProfileId, setSelectedProfileId] = useState<string | undefined>(profiles[0]?.id);
  const selected = useMemo(() => profiles.find((item) => item.id === selectedProfileId) ?? profiles[0], [profiles, selectedProfileId]);
  const [password, setPassword] = useState("");
  const [draft, setDraft] = useState<RuntimeProfileInput | null>(selected ? { ...selected, password: "" } : null);

  useEffect(() => {
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
  }, [selected]);

  if (!open || !draft) {
    return null;
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Connection profiles">
      <div className="modal profile-modal">
        <header className="modal-header">
          <h2>profiles</h2>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            X
          </button>
        </header>

        <div className="profile-layout">
          <aside className="profile-list">
            {profiles.map((profile) => (
              <button
                type="button"
                key={profile.id}
                className={profile.id === selected?.id ? "active" : ""}
                onClick={() => setSelectedProfileId(profile.id)}
              >
                <span>{profile.name}</span>
                <small>
                  {profile.host}:{profile.port}
                </small>
              </button>
            ))}
            <button
              type="button"
              className="add-profile"
              onClick={() => {
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
              }}
            >
              + New Profile
            </button>
          </aside>

          <section className="profile-form">
            <label>
              Name
              <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <div className="row-two">
              <label>
                Host
                <input value={draft.host} onChange={(event) => setDraft({ ...draft, host: event.target.value })} />
              </label>
              <label>
                Port
                <input
                  type="number"
                  value={draft.port}
                  onChange={(event) => setDraft({ ...draft, port: Number(event.target.value) })}
                />
              </label>
            </div>
            <div className="row-two">
              <label>
                Username
                <input
                  value={draft.username ?? ""}
                  onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                />
              </label>
              <label>
                Password
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </label>
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.startCommand}
                onChange={(event) => setDraft({ ...draft, startCommand: event.target.checked })}
              />
              Start local OpenCode server from app
            </label>
            <div className="row-two">
              <label>
                Start Host
                <input value={draft.startHost} onChange={(event) => setDraft({ ...draft, startHost: event.target.value })} />
              </label>
              <label>
                Start Port
                <input
                  type="number"
                  value={draft.startPort}
                  onChange={(event) => setDraft({ ...draft, startPort: Number(event.target.value) })}
                />
              </label>
            </div>
            <label>
              OpenCode binary path override (optional)
              <input
                value={draft.cliPath ?? ""}
                placeholder="opencode"
                onChange={(event) => setDraft({ ...draft, cliPath: event.target.value })}
              />
            </label>

            <div className="profile-actions">
              <button
                type="button"
                onClick={() =>
                  void onSave({
                    ...draft,
                    password,
                    corsOrigins: draft.corsOrigins,
                  })
                }
              >
                Save
              </button>
              {draft.id ? (
                <button type="button" className="danger" onClick={() => void onDelete(draft.id!)}>
                  Delete
                </button>
              ) : null}
              {draft.id ? (
                <button type="button" onClick={() => void onAttach(draft.id!)}>
                  Attach
                </button>
              ) : null}
              {draft.id ? (
                <button type="button" onClick={() => void onStartLocal(draft.id!)}>
                  Start Local
                </button>
              ) : null}
              <button type="button" onClick={() => void onStopLocal()}>
                Stop Local
              </button>
            </div>

            <div className="runtime-status-inline">
              <strong>Status:</strong> {runtime.status}
              <span>{runtime.managedServer ? "Managed by app" : "External server"}</span>
              {runtime.lastError ? <span className="error">{runtime.lastError}</span> : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
