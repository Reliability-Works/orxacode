import { useEffect, useMemo, useState } from "react";
import type {
  OrxaAgentDetails,
  OrxaAgentDocument,
  RawConfigDocument,
  ServerDiagnostics,
} from "@shared/ipc";
import type { AppPreferences } from "~/types/app";

type Props = {
  open: boolean;
  directory: string | undefined;
  onClose: () => void;
  onReadRaw: (scope: "project" | "global", directory?: string) => Promise<RawConfigDocument>;
  onWriteRaw: (scope: "project" | "global", content: string, directory?: string) => Promise<RawConfigDocument>;
  onReadOrxa: () => Promise<RawConfigDocument>;
  onWriteOrxa: (content: string) => Promise<RawConfigDocument>;
  onListOrxaAgents: () => Promise<OrxaAgentDocument[]>;
  onSaveOrxaAgent: (input: {
    name: string;
    mode: "primary" | "subagent" | "all";
    description?: string;
    model?: string;
    prompt?: string;
  }) => Promise<OrxaAgentDocument>;
  onGetOrxaAgentDetails: (name: string) => Promise<OrxaAgentDetails>;
  onResetOrxaAgent: (name: string) => Promise<OrxaAgentDocument | undefined>;
  onRestoreOrxaAgentHistory: (name: string, historyID: string) => Promise<OrxaAgentDocument | undefined>;
  appPreferences: AppPreferences;
  onAppPreferencesChange: (next: AppPreferences) => void;
  onGetServerDiagnostics: () => Promise<ServerDiagnostics>;
  onRepairRuntime: () => Promise<ServerDiagnostics>;
};

type SettingsSection = "config" | "agents" | "app" | "server";
type EditorKind = "opencode" | "orxa";

function buildSimpleDiff(baseText: string, currentText: string) {
  const base = baseText.split("\n");
  const current = currentText.split("\n");
  const max = Math.max(base.length, current.length);
  const lines: string[] = [];
  for (let index = 0; index < max; index += 1) {
    const left = base[index] ?? "";
    const right = current[index] ?? "";
    if (left === right) {
      lines.push(`  ${left}`);
      continue;
    }
    if (left.length > 0) {
      lines.push(`- ${left}`);
    }
    if (right.length > 0) {
      lines.push(`+ ${right}`);
    }
  }
  return lines.join("\n");
}

export function SettingsDrawer({
  open,
  directory,
  onClose,
  onReadRaw,
  onWriteRaw,
  onReadOrxa,
  onWriteOrxa,
  onListOrxaAgents,
  onSaveOrxaAgent,
  onGetOrxaAgentDetails,
  onResetOrxaAgent,
  onRestoreOrxaAgentHistory,
  appPreferences,
  onAppPreferencesChange,
  onGetServerDiagnostics,
  onRepairRuntime,
}: Props) {
  const [section, setSection] = useState<SettingsSection>("config");
  const [scope, setScope] = useState<"project" | "global">("project");

  const [rawDoc, setRawDoc] = useState<RawConfigDocument | null>(null);
  const [rawText, setRawText] = useState("");
  const [orxaDoc, setOrxaDoc] = useState<RawConfigDocument | null>(null);
  const [orxaText, setOrxaText] = useState("");

  const [agents, setAgents] = useState<OrxaAgentDocument[]>([]);
  const [selectedAgentPath, setSelectedAgentPath] = useState<string | undefined>();
  const [agentDraft, setAgentDraft] = useState<{
    name: string;
    mode: "primary" | "subagent" | "all";
    description: string;
    model: string;
    prompt: string;
  } | null>(null);
  const [agentDetails, setAgentDetails] = useState<OrxaAgentDetails | null>(null);

  const [serverDiagnostics, setServerDiagnostics] = useState<ServerDiagnostics | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorKind, setEditorKind] = useState<EditorKind>("opencode");
  const [editorText, setEditorText] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const effectiveScope = useMemo(() => {
    if (scope === "project" && !directory) {
      return "global";
    }
    return scope;
  }, [scope, directory]);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.path === selectedAgentPath),
    [agents, selectedAgentPath],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const load = async () => {
      const [raw, orxa, nextAgents, diagnostics] = await Promise.all([
        onReadRaw(effectiveScope, directory),
        onReadOrxa(),
        onListOrxaAgents(),
        onGetServerDiagnostics(),
      ]);
      setRawDoc(raw);
      setRawText(raw.content);
      setOrxaDoc(orxa);
      setOrxaText(orxa.content);
      setAgents(nextAgents);
      setSelectedAgentPath((current) => current ?? nextAgents[0]?.path);
      setServerDiagnostics(diagnostics);
      setFeedback(null);
    };
    void load().catch((error: unknown) => {
      setFeedback(error instanceof Error ? error.message : String(error));
    });
  }, [
    open,
    effectiveScope,
    directory,
    onReadRaw,
    onReadOrxa,
    onListOrxaAgents,
    onGetServerDiagnostics,
  ]);

  useEffect(() => {
    if (!selectedAgent) {
      setAgentDraft(null);
      setAgentDetails(null);
      return;
    }

    setAgentDraft({
      name: selectedAgent.name,
      mode: selectedAgent.mode,
      description: selectedAgent.description ?? "",
      model: selectedAgent.model ?? "",
      prompt: selectedAgent.prompt ?? "",
    });

    void onGetOrxaAgentDetails(selectedAgent.name)
      .then((details) => setAgentDetails(details))
      .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)));
  }, [onGetOrxaAgentDetails, selectedAgent]);

  if (!open) {
    return null;
  }

  const openEditor = (kind: EditorKind) => {
    setEditorKind(kind);
    setEditorText(kind === "orxa" ? orxaText : rawText);
    setEditorOpen(true);
  };

  const saveEditor = async () => {
    if (editorKind === "orxa") {
      const next = await onWriteOrxa(editorText);
      setOrxaDoc(next);
      setOrxaText(next.content);
      setFeedback("Orxa config saved");
      setEditorOpen(false);
      return;
    }

    const next = await onWriteRaw(effectiveScope, editorText, directory);
    setRawDoc(next);
    setRawText(next.content);
    setFeedback("OpenCode config saved");
    setEditorOpen(false);
  };

  const refreshAgents = async (focusPath?: string) => {
    const next = await onListOrxaAgents();
    setAgents(next);
    const nextSelected = focusPath ?? selectedAgentPath ?? next[0]?.path;
    setSelectedAgentPath(nextSelected);
    const target = next.find((agent) => agent.path === nextSelected) ?? next[0];
    if (target) {
      const details = await onGetOrxaAgentDetails(target.name).catch(() => undefined);
      setAgentDetails(details ?? null);
    }
  };

  const renderSectionContent = () => {
    if (section === "app") {
      return (
        <section className="settings-section-card settings-pad">
          <h3>App Preferences</h3>
          <label className="settings-inline-toggle">
            <input
              type="checkbox"
              checked={appPreferences.showOperationsPane}
              onChange={(event) =>
                onAppPreferencesChange({ ...appPreferences, showOperationsPane: event.target.checked })
              }
            />
            Show operations sidebar
          </label>
          <label className="settings-inline-toggle">
            <input
              type="checkbox"
              checked={appPreferences.autoOpenTerminalOnCreate}
              onChange={(event) =>
                onAppPreferencesChange({ ...appPreferences, autoOpenTerminalOnCreate: event.target.checked })
              }
            />
            Auto-open terminal when creating PTY
          </label>
          <label className="settings-inline-toggle">
            <input
              type="checkbox"
              checked={appPreferences.confirmDangerousActions}
              onChange={(event) =>
                onAppPreferencesChange({ ...appPreferences, confirmDangerousActions: event.target.checked })
              }
            />
            Confirm dangerous actions (reject buttons)
          </label>
          <label className="settings-textarea-label">
            Commit message guidance prompt
            <textarea
              rows={8}
              value={appPreferences.commitGuidancePrompt}
              onChange={(event) =>
                onAppPreferencesChange({ ...appPreferences, commitGuidancePrompt: event.target.value })
              }
            />
          </label>
        </section>
      );
    }

    if (section === "server") {
      return (
        <section className="settings-section-card settings-pad settings-server-grid">
          <h3>Server Diagnostics</h3>
          <p className="raw-path">Status: {serverDiagnostics?.runtime.status ?? "unknown"}</p>
          <p className="raw-path">Health: {serverDiagnostics?.health ?? "unknown"}</p>
          <p className="raw-path">Active profile: {serverDiagnostics?.activeProfile?.name ?? "none"}</p>
          <p className="raw-path">Plugin configured: {serverDiagnostics?.plugin.configured ? "yes" : "no"}</p>
          <p className="raw-path">Plugin installed: {serverDiagnostics?.plugin.installed ? "yes" : "no"}</p>
          <p className="raw-path">{serverDiagnostics?.plugin.configPath}</p>
          <div className="settings-actions">
            <button
              type="button"
              onClick={() =>
                void onGetServerDiagnostics()
                  .then((next) => {
                    setServerDiagnostics(next);
                    setFeedback("Diagnostics refreshed");
                  })
                  .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
              }
            >
              Refresh Diagnostics
            </button>
            <button
              type="button"
              onClick={() =>
                void onRepairRuntime()
                  .then((next) => {
                    setServerDiagnostics(next);
                    setFeedback("Runtime repaired");
                  })
                  .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
              }
            >
              Repair Runtime
            </button>
          </div>
        </section>
      );
    }

    if (section === "config") {
      return (
        <section className="settings-section-card settings-pad settings-config">
          <div className="settings-controls">
            <label>
              Scope
              <select value={effectiveScope} onChange={(event) => setScope(event.target.value as "project" | "global")}> 
                <option value="project" disabled={!directory}>
                  Workspace
                </option>
                <option value="global">Global</option>
              </select>
            </label>
          </div>

          <div className="settings-actions settings-top-actions">
            <button type="button" onClick={() => openEditor("opencode")}>
              Open OpenCode JSON Editor
            </button>
            <button type="button" onClick={() => openEditor("orxa")}>
              Open Orxa JSON Editor
            </button>
          </div>

          <div className="settings-config-grid">
            <article className="settings-config-card">
              <h4>OpenCode JSON</h4>
              <p className="raw-path">{rawDoc?.path}</p>
              <textarea rows={16} value={rawText} onChange={(event) => setRawText(event.target.value)} />
              <div className="settings-actions">
                <button
                  type="button"
                  onClick={() =>
                    void onWriteRaw(effectiveScope, rawText, directory)
                      .then((next) => {
                        setRawDoc(next);
                        setFeedback("OpenCode config saved");
                      })
                      .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
                  }
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void onReadRaw(effectiveScope, directory).then((next) => {
                      setRawDoc(next);
                      setRawText(next.content);
                    })
                  }
                >
                  Reload
                </button>
              </div>
            </article>

            <article className="settings-config-card">
              <h4>Orxa JSON</h4>
              <p className="raw-path">{orxaDoc?.path}</p>
              <textarea rows={16} value={orxaText} onChange={(event) => setOrxaText(event.target.value)} />
              <div className="settings-actions">
                <button
                  type="button"
                  onClick={() =>
                    void onWriteOrxa(orxaText)
                      .then((next) => {
                        setOrxaDoc(next);
                        setOrxaText(next.content);
                        setFeedback("Orxa config saved");
                      })
                      .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
                  }
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void onReadOrxa().then((next) => {
                      setOrxaDoc(next);
                      setOrxaText(next.content);
                    })
                  }
                >
                  Reload
                </button>
              </div>
            </article>
          </div>
        </section>
      );
    }

    return (
      <section className="settings-section-card settings-pad">
        <div className="settings-agents">
          <div className="settings-agents-list">
            {agents.map((agent) => (
              <button
                key={`${agent.path}:${agent.name}`}
                type="button"
                className={agent.path === selectedAgentPath ? "active" : ""}
                onClick={() => setSelectedAgentPath(agent.path)}
              >
                <strong>{agent.name}</strong>
                <small>{agent.mode}</small>
              </button>
            ))}
          </div>

          <div className="settings-agents-editor">
            {agentDraft ? (
              <>
                <div className="settings-controls">
                  <label>
                    Name
                    <input value={agentDraft.name} disabled />
                  </label>
                  <label>
                    Current Source
                    <input value={selectedAgent?.source ?? "unknown"} disabled />
                  </label>
                  <label>
                    Mode
                    <select
                      value={agentDraft.mode}
                      onChange={(event) =>
                        setAgentDraft({ ...agentDraft, mode: event.target.value as "primary" | "subagent" | "all" })
                      }
                    >
                      <option value="primary">primary</option>
                      <option value="subagent">subagent</option>
                      <option value="all">all</option>
                    </select>
                  </label>
                  <label>
                    Model
                    <input
                      value={agentDraft.model}
                      placeholder="provider/model"
                      onChange={(event) => setAgentDraft({ ...agentDraft, model: event.target.value })}
                    />
                  </label>
                </div>

                <label>
                  Description
                  <input
                    value={agentDraft.description}
                    onChange={(event) => setAgentDraft({ ...agentDraft, description: event.target.value })}
                  />
                </label>
                <label>
                  System Prompt
                  <textarea
                    rows={12}
                    value={agentDraft.prompt}
                    onChange={(event) => setAgentDraft({ ...agentDraft, prompt: event.target.value })}
                  />
                </label>

                <p className="raw-path">{selectedAgent?.path}</p>
                <div className="settings-actions">
                  <button
                    type="button"
                    onClick={() =>
                      void onSaveOrxaAgent({
                        name: agentDraft.name,
                        mode: agentDraft.mode,
                        description: agentDraft.description,
                        model: agentDraft.model,
                        prompt: agentDraft.prompt,
                      })
                        .then(async () => {
                          await refreshAgents(selectedAgent?.path);
                          setFeedback(`Saved agent ${agentDraft.name}`);
                        })
                        .catch((error: unknown) =>
                          setFeedback(error instanceof Error ? error.message : String(error)),
                        )
                    }
                  >
                    Save Agent
                  </button>
                  <button type="button" onClick={() => void refreshAgents(selectedAgent?.path)}>
                    Reload
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedAgent) {
                        return;
                      }
                      if (!window.confirm(`Reset ${selectedAgent.name} to template?`)) {
                        return;
                      }
                      void onResetOrxaAgent(selectedAgent.name)
                        .then(async () => {
                          await refreshAgents(selectedAgent.path);
                          setFeedback(`Reset ${selectedAgent.name} to template`);
                        })
                        .catch((error: unknown) =>
                          setFeedback(error instanceof Error ? error.message : String(error)),
                        );
                    }}
                  >
                    Reset To Template
                  </button>
                </div>

                <div className="settings-advanced-grid">
                  <div>
                    <h4>Template Prompt</h4>
                    <textarea value={agentDetails?.base?.prompt ?? ""} readOnly rows={10} />
                  </div>
                  <div>
                    <h4>Current Prompt</h4>
                    <textarea value={agentDetails?.current?.prompt ?? ""} readOnly rows={10} />
                  </div>
                </div>

                <label>
                  Prompt Diff
                  <textarea
                    rows={10}
                    readOnly
                    value={buildSimpleDiff(agentDetails?.base?.prompt ?? "", agentDetails?.current?.prompt ?? "")}
                  />
                </label>

                <h4>History</h4>
                <div className="settings-history-list">
                  {(agentDetails?.history ?? []).slice(0, 15).map((item) => (
                    <div key={item.id} className="settings-history-item">
                      <div>
                        <strong>{new Date(item.updatedAt).toLocaleString()}</strong>
                        <p className="raw-path">{item.path}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (!selectedAgent) {
                            return;
                          }
                          void onRestoreOrxaAgentHistory(selectedAgent.name, item.id)
                            .then(async () => {
                              await refreshAgents(selectedAgent.path);
                              setFeedback(`Restored snapshot ${item.id}`);
                            })
                            .catch((error: unknown) =>
                              setFeedback(error instanceof Error ? error.message : String(error)),
                            );
                        }}
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                  {(agentDetails?.history ?? []).length === 0 ? <p className="raw-path">No history snapshots yet.</p> : null}
                </div>
              </>
            ) : (
              <p className="raw-path">No agent selected.</p>
            )}
          </div>
        </div>
      </section>
    );
  };

  return (
    <>
      <div className="settings-overlay">
        <section className="settings-center">
          <header className="settings-center-header">
            <div className="settings-center-title">
              <button type="button" className="settings-back-button" onClick={onClose}>
                X
              </button>
              <div>
                <h2>Settings Center</h2>
                <small>{directory ?? "No workspace selected"}</small>
              </div>
            </div>
          </header>

          <div className="settings-layout">
            <aside className="settings-sidebar-nav">
              <button type="button" className={section === "config" ? "active" : ""} onClick={() => setSection("config")}>
                Config Files
              </button>
              <button type="button" className={section === "agents" ? "active" : ""} onClick={() => setSection("agents")}>
                Agents
              </button>
              <button type="button" className={section === "app" ? "active" : ""} onClick={() => setSection("app")}>
                App
              </button>
              <button type="button" className={section === "server" ? "active" : ""} onClick={() => setSection("server")}>
                Server
              </button>
            </aside>

            <div className="settings-center-body">{renderSectionContent()}</div>
          </div>

          {feedback ? <footer className="settings-feedback">{feedback}</footer> : null}
        </section>
      </div>

      {editorOpen ? (
        <div className="overlay">
          <div className="modal raw-editor-modal">
            <div className="modal-header">
              <h2>{editorKind === "orxa" ? "Edit orxa.json" : "Edit opencode.json"}</h2>
              <button type="button" onClick={() => setEditorOpen(false)}>
                Close
              </button>
            </div>
            <div className="raw-editor-body">
              <p className="raw-path">{editorKind === "orxa" ? orxaDoc?.path : rawDoc?.path}</p>
              <textarea value={editorText} onChange={(event) => setEditorText(event.target.value)} />
              <div className="settings-actions">
                <button
                  type="button"
                  onClick={() =>
                    void saveEditor().catch((error: unknown) => {
                      setFeedback(error instanceof Error ? error.message : String(error));
                    })
                  }
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void (editorKind === "orxa" ? onReadOrxa() : onReadRaw(effectiveScope, directory)).then((next) => {
                      setEditorText(next.content);
                    })
                  }
                >
                  Reload
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
