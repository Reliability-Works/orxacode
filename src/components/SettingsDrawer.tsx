import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type {
  AppMode,
  MemoryBackfillStatus,
  MemoryPolicyMode,
  MemorySettings,
  MemorySettingsUpdateInput,
  MemoryTemplate,
  OpenCodeAgentFile,
  OpenDirectoryTarget,
  OrxaAgentDetails,
  OrxaAgentDocument,
  RawConfigDocument,
  ServerDiagnostics,
  UpdatePreferences,
} from "@shared/ipc";
import type { ModelOption } from "../lib/models";
import type { AppPreferences } from "~/types/app";
import { CODE_FONT_OPTIONS } from "~/types/app";

type Props = {
  open: boolean;
  mode: AppMode;
  modeSwitching: boolean;
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
  onGetUpdatePreferences: () => Promise<UpdatePreferences>;
  onSetUpdatePreferences: (input: Partial<UpdatePreferences>) => Promise<UpdatePreferences>;
  onCheckForUpdates: () => Promise<{ ok: boolean; status: "started" | "skipped" | "error"; message?: string }>;
  onGetMemorySettings: (directory?: string) => Promise<MemorySettings>;
  onUpdateMemorySettings: (input: MemorySettingsUpdateInput) => Promise<MemorySettings>;
  onListMemoryTemplates: () => Promise<MemoryTemplate[]>;
  onApplyMemoryTemplate: (templateID: string, directory?: string, scope?: "global" | "workspace") => Promise<MemorySettings>;
  onBackfillMemory: (directory?: string) => Promise<MemoryBackfillStatus>;
  onClearWorkspaceMemory: (directory: string) => Promise<boolean>;
  onChangeMode: (mode: AppMode) => Promise<void>;
  allModelOptions: ModelOption[];
};

type SettingsSection = "config" | "agents" | "provider-models" | "opencode-agents" | "app" | "server" | "preferences" | "memory";
type EditorKind = "opencode" | "orxa";
type OcAgentFilenameDialog =
  | { kind: "create"; title: string }
  | { kind: "duplicate"; title: string; content: string };

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
  mode,
  modeSwitching,
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
  onGetUpdatePreferences,
  onSetUpdatePreferences,
  onCheckForUpdates,
  onGetMemorySettings,
  onUpdateMemorySettings,
  onListMemoryTemplates,
  onApplyMemoryTemplate,
  onBackfillMemory,
  onClearWorkspaceMemory,
  onChangeMode,
  allModelOptions,
}: Props) {
  const appVersion = __APP_VERSION__?.trim().length ? __APP_VERSION__ : "dev";
  const [section, setSection] = useState<SettingsSection>("config");
  const [scope, setScope] = useState<"project" | "global">("global");
  const [nextMode, setNextMode] = useState<AppMode>(mode);

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
  const [updatePreferences, setUpdatePreferences] = useState<UpdatePreferences>({
    autoCheckEnabled: true,
    releaseChannel: "stable",
  });
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
  const [memorySettings, setMemorySettings] = useState<MemorySettings | null>(null);
  const [memoryTemplates, setMemoryTemplates] = useState<MemoryTemplate[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryBackfillStatus, setMemoryBackfillStatus] = useState<MemoryBackfillStatus | null>(null);

  const [ocAgents, setOcAgents] = useState<OpenCodeAgentFile[]>([]);
  const [selectedOcAgent, setSelectedOcAgent] = useState<string | undefined>();
  const [ocAgentDraft, setOcAgentDraft] = useState("");
  const [ocAgentSaving, setOcAgentSaving] = useState(false);
  const [ocOpenInMenu, setOcOpenInMenu] = useState(false);
  const [collapsedProviders, setCollapsedProviders] = useState<Record<string, boolean>>({});

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorKind, setEditorKind] = useState<EditorKind>("opencode");
  const [editorText, setEditorText] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [ocFilenameDialog, setOcFilenameDialog] = useState<OcAgentFilenameDialog | null>(null);
  const [ocFilenameValue, setOcFilenameValue] = useState("");
  const [ocFilenameError, setOcFilenameError] = useState<string | null>(null);

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
  const availableSections = useMemo<SettingsSection[]>(() => {
    if (mode === "standard") {
      return ["config", "provider-models", "opencode-agents", "memory", "app", "preferences", "server"];
    }
    return ["config", "agents", "provider-models", "opencode-agents", "memory", "app", "preferences", "server"];
  }, [mode]);

  useEffect(() => {
    setNextMode(mode);
  }, [mode]);

  useEffect(() => {
    if (availableSections.includes(section)) {
      return;
    }
    setSection("config");
  }, [availableSections, section]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const load = async () => {
      const [raw, diagnostics, orxa, nextAgents, updaterPrefs, nextMemorySettings, templates] = await Promise.all([
        onReadRaw(effectiveScope, directory),
        onGetServerDiagnostics(),
        mode === "orxa" ? onReadOrxa() : Promise.resolve(null),
        mode === "orxa" ? onListOrxaAgents() : Promise.resolve([]),
        onGetUpdatePreferences(),
        onGetMemorySettings(directory),
        onListMemoryTemplates(),
      ]);
      setRawDoc(raw);
      setRawText(raw.content);
      setOrxaDoc(orxa);
      setOrxaText(orxa?.content ?? "");
      setAgents(nextAgents);
      setUpdatePreferences(updaterPrefs);
      setMemorySettings(nextMemorySettings);
      setMemoryTemplates(templates);
      setMemoryBackfillStatus(null);
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
    mode,
    onReadOrxa,
    onListOrxaAgents,
    onGetServerDiagnostics,
    onGetUpdatePreferences,
    onGetMemorySettings,
    onListMemoryTemplates,
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

  const loadOcAgents = useCallback(async () => {
    try {
      const files = await window.orxa.opencode.listAgentFiles();
      setOcAgents(files);
      if (!selectedOcAgent && files.length > 0) {
        setSelectedOcAgent(files[0].filename);
        setOcAgentDraft(files[0].content);
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    }
  }, [selectedOcAgent]);

  const closeOcFilenameDialog = () => {
    setOcFilenameDialog(null);
    setOcFilenameValue("");
    setOcFilenameError(null);
  };

  const normalizeOcAgentFilename = (raw: string): { filename: string } | { error: string } => {
    const trimmed = raw.trim();
    if (!trimmed) {
      return { error: "Filename is required." };
    }

    const withExt = trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;
    if (withExt.includes("/") || withExt.includes("\\") || withExt.includes("..")) {
      return { error: "Use a plain filename only (no folders)." };
    }

    return { filename: withExt };
  };

  const submitOcFilenameDialog = async () => {
    if (!ocFilenameDialog) {
      return;
    }

    const parsed = normalizeOcAgentFilename(ocFilenameValue);
    if ("error" in parsed) {
      setOcFilenameError(parsed.error);
      return;
    }

    const filename = parsed.filename;
    const exists = ocAgents.some((item) => item.filename.toLowerCase() === filename.toLowerCase());
    if (exists) {
      setOcFilenameError(`Agent file ${filename} already exists.`);
      return;
    }

    try {
      if (ocFilenameDialog.kind === "create") {
        const baseName = filename.replace(/\.md$/, "");
        const template = [
          "---",
          `description: ${baseName} agent`,
          "mode: subagent",
          "model: ",
          "temperature: 0.1",
          "---",
          "",
          `# ${baseName.charAt(0).toUpperCase() + baseName.slice(1)}`,
          "",
          "Your system prompt here.",
          "",
        ].join("\n");
        await window.orxa.opencode.writeAgentFile(filename, template);
        await loadOcAgents();
        setSelectedOcAgent(filename);
        setOcAgentDraft(template);
        setFeedback(`Created ${filename}`);
      } else {
        const content = ocFilenameDialog.content;
        await window.orxa.opencode.writeAgentFile(filename, content);
        await loadOcAgents();
        setSelectedOcAgent(filename);
        setOcAgentDraft(content);
        setFeedback(`Duplicated as ${filename}`);
      }
      closeOcFilenameDialog();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (open && section === "opencode-agents" && ocAgents.length === 0) {
      void loadOcAgents();
    }
  }, [open, section, loadOcAgents, ocAgents.length]);

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
      const applyUpdatePreferences = (patch: Partial<UpdatePreferences>) => {
        void onSetUpdatePreferences(patch)
          .then((next) => {
            setUpdatePreferences(next);
            setFeedback("Update preferences saved");
          })
          .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)));
      };

      return (
        <section className="settings-section-card settings-pad">
          <h3>App Preferences</h3>
          <p className="raw-path">Version: v{appVersion}</p>
          <div className="settings-controls">
            <label>
              Application mode
              <select value={nextMode} onChange={(event) => setNextMode(event.target.value as AppMode)}>
                <option value="orxa">Orxa Mode</option>
                <option value="standard">Standard Mode</option>
              </select>
            </label>
          </div>
          <p className="raw-path">Current mode: {mode === "orxa" ? "Orxa Mode" : "Standard Mode"}</p>
          <div className="settings-actions">
            <button
              type="button"
              disabled={modeSwitching || nextMode === mode}
              onClick={() =>
                void onChangeMode(nextMode)
                  .then(() => setFeedback(`Mode switched to ${nextMode === "orxa" ? "Orxa" : "Standard"}`))
                  .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
              }
            >
              {modeSwitching ? "Applying..." : "Apply Mode"}
            </button>
          </div>
          <label className="settings-inline-toggle">
            <input
              type="checkbox"
              checked={appPreferences.showOperationsPane}
              onChange={(event) =>
                onAppPreferencesChange({ ...appPreferences, showOperationsPane: event.target.checked })
              }
            />
            Show Git sidebar
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
          <label className="settings-inline-toggle">
            <input
              type="checkbox"
              checked={updatePreferences.autoCheckEnabled}
              onChange={(event) => applyUpdatePreferences({ autoCheckEnabled: event.target.checked })}
            />
            Automatically check for updates (packaged app builds only)
          </label>
          <div className="settings-update-row">
            <label className="settings-update-channel">
              Release channel
              <select
                value={updatePreferences.releaseChannel}
                onChange={(event) =>
                  applyUpdatePreferences({ releaseChannel: event.target.value as UpdatePreferences["releaseChannel"] })
                }
              >
                <option value="stable">Stable (production releases)</option>
                <option value="prerelease">Prerelease (beta/RC releases)</option>
              </select>
            </label>
            <button
              type="button"
              className="settings-update-check-btn"
              disabled={checkingForUpdates}
              onClick={() => {
                setCheckingForUpdates(true);
                void onCheckForUpdates()
                  .then((result) => {
                    if (result.status === "started") {
                      setFeedback("Update check started");
                    } else if (result.message) {
                      setFeedback(result.message);
                    } else {
                      setFeedback("Update check skipped");
                    }
                  })
                  .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
                  .finally(() => setCheckingForUpdates(false));
              }}
            >
              {checkingForUpdates ? "Checking..." : "Check for updates now"}
            </button>
          </div>
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

    if (section === "preferences") {
      return (
        <section className="settings-section-card settings-pad">
          <h3>Preferences</h3>
          <p className="raw-path" style={{ margin: "4px 0 12px" }}>Code font — used in the diff viewer, file tree, and file preview.</p>
          <div className="settings-font-list">
            {CODE_FONT_OPTIONS.map((opt) => {
              const isSelected = appPreferences.codeFont === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={`settings-font-option${isSelected ? " active" : ""}`}
                  onClick={() => onAppPreferencesChange({ ...appPreferences, codeFont: opt.value })}
                >
                  <span className="settings-font-option-name">{opt.label}</span>
                  <span className="settings-font-option-preview" style={{ fontFamily: opt.stack }}>
                    {`const greet = (name) => \`Hello, \${name}!\`;`}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      );
    }

    if (section === "memory") {
      const settings = memorySettings;
      const globalPolicy = settings?.global;
      const workspacePolicy = settings?.workspace;
      const hasWorkspaceOverride = Boolean(settings?.hasWorkspaceOverride);

      const applyGlobalPatch = (patch: MemorySettingsUpdateInput["global"]) => {
        setMemoryLoading(true);
        void onUpdateMemorySettings({
          directory,
          global: patch,
        })
          .then((next) => {
            setMemorySettings(next);
            setFeedback("Memory settings updated");
          })
          .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
          .finally(() => setMemoryLoading(false));
      };

      const applyWorkspacePatch = (patch: MemorySettingsUpdateInput["workspace"]) => {
        if (!directory) {
          setFeedback("Select a workspace to edit workspace memory settings.");
          return;
        }
        setMemoryLoading(true);
        void onUpdateMemorySettings({
          directory,
          workspace: patch,
        })
          .then((next) => {
            setMemorySettings(next);
            setFeedback("Workspace memory settings updated");
          })
          .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
          .finally(() => setMemoryLoading(false));
      };

      return (
        <section className="settings-section-card settings-pad">
          <h3>Memory</h3>
          <p className="raw-path">
            Memory is scoped by workspace for retrieval. Graph view can aggregate all workspaces.
          </p>
          <div className="settings-controls">
            <label>
              Global mode
              <select
                value={globalPolicy?.mode ?? "balanced"}
                onChange={(event) => applyGlobalPatch({ mode: event.target.value as MemoryPolicyMode })}
                disabled={memoryLoading}
              >
                <option value="conservative">conservative</option>
                <option value="balanced">balanced</option>
                <option value="aggressive">aggressive</option>
                <option value="codebase-facts">codebase-facts</option>
              </select>
            </label>
            <label className="settings-inline-toggle">
              <input
                type="checkbox"
                checked={globalPolicy?.enabled ?? false}
                onChange={(event) => applyGlobalPatch({ enabled: event.target.checked })}
                disabled={memoryLoading}
              />
              Enable memory globally
            </label>
            <label>
              Prompt memory limit
              <input
                type="number"
                min={1}
                max={12}
                value={globalPolicy?.maxPromptMemories ?? 6}
                onChange={(event) => applyGlobalPatch({ maxPromptMemories: Number(event.target.value) })}
                disabled={memoryLoading}
              />
            </label>
          </div>
          <label className="settings-textarea-label">
            Global memory guidance
            <textarea
              rows={6}
              value={globalPolicy?.guidance ?? ""}
              onChange={(event) => applyGlobalPatch({ guidance: event.target.value })}
              disabled={memoryLoading}
            />
          </label>

          <h4>Workspace Override</h4>
          <p className="raw-path">{directory ?? "No workspace selected"}</p>
          <div className="settings-controls">
            <label>
              Workspace mode
              <select
                value={workspacePolicy?.mode ?? globalPolicy?.mode ?? "balanced"}
                onChange={(event) => applyWorkspacePatch({ mode: event.target.value as MemoryPolicyMode })}
                disabled={!directory || memoryLoading}
              >
                <option value="conservative">conservative</option>
                <option value="balanced">balanced</option>
                <option value="aggressive">aggressive</option>
                <option value="codebase-facts">codebase-facts</option>
              </select>
            </label>
            <label className="settings-inline-toggle">
              <input
                type="checkbox"
                checked={workspacePolicy?.enabled ?? globalPolicy?.enabled ?? false}
                onChange={(event) => applyWorkspacePatch({ enabled: event.target.checked })}
                disabled={!directory || memoryLoading}
              />
              Enable memory for workspace
            </label>
            <label>
              Capture limit/session
              <input
                type="number"
                min={1}
                max={60}
                value={workspacePolicy?.maxCapturePerSession ?? globalPolicy?.maxCapturePerSession ?? 24}
                onChange={(event) => applyWorkspacePatch({ maxCapturePerSession: Number(event.target.value) })}
                disabled={!directory || memoryLoading}
              />
            </label>
          </div>
          <label className="settings-textarea-label">
            Workspace guidance
            <textarea
              rows={5}
              value={workspacePolicy?.guidance ?? ""}
              onChange={(event) => applyWorkspacePatch({ guidance: event.target.value })}
              disabled={!directory || memoryLoading}
            />
          </label>
          <div className="settings-actions">
            <button
              type="button"
              disabled={!directory || !hasWorkspaceOverride || memoryLoading}
              onClick={() => {
                if (!directory) {
                  return;
                }
                setMemoryLoading(true);
                void onUpdateMemorySettings({ directory, clearWorkspaceOverride: true })
                  .then((next) => {
                    setMemorySettings(next);
                    setFeedback("Workspace override cleared");
                  })
                  .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
                  .finally(() => setMemoryLoading(false));
              }}
            >
              Clear workspace override
            </button>
          </div>

          <h4>Template Import</h4>
          <div className="settings-actions">
            {memoryTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                disabled={memoryLoading}
                onClick={() => {
                  setMemoryLoading(true);
                  void onApplyMemoryTemplate(template.id, directory, directory ? "workspace" : "global")
                    .then((next) => {
                      setMemorySettings(next);
                      setFeedback(`Applied ${template.name} template`);
                    })
                    .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
                    .finally(() => setMemoryLoading(false));
                }}
              >
                Import {template.name}
              </button>
            ))}
          </div>

          <h4>Maintenance</h4>
          <div className="settings-actions">
            <button
              type="button"
              disabled={memoryLoading}
              onClick={() => {
                setMemoryLoading(true);
                void onBackfillMemory(directory)
                  .then((status) => {
                    setMemoryBackfillStatus(status);
                    setFeedback(status.message ?? "Memory backfill completed");
                  })
                  .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
                  .finally(() => setMemoryLoading(false));
              }}
            >
              Backfill now
            </button>
            <button
              type="button"
              disabled={!directory || memoryLoading}
              onClick={() => {
                if (!directory) {
                  return;
                }
                if (!window.confirm(`Clear all stored memory for ${directory}?`)) {
                  return;
                }
                setMemoryLoading(true);
                void onClearWorkspaceMemory(directory)
                  .then(() => setFeedback("Workspace memory cleared"))
                  .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
                  .finally(() => setMemoryLoading(false));
              }}
            >
              Clear workspace memory
            </button>
          </div>
          {memoryBackfillStatus ? (
            <p className="raw-path">
              {memoryBackfillStatus.message ?? "Backfill"} ({Math.round(memoryBackfillStatus.progress * 100)}% •{" "}
              {memoryBackfillStatus.scannedSessions}/{memoryBackfillStatus.totalSessions})
            </p>
          ) : null}
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
          {mode === "orxa" ? (
            <>
              <p className="raw-path">Plugin configured: {serverDiagnostics?.plugin.configured ? "yes" : "no"}</p>
              <p className="raw-path">Plugin installed: {serverDiagnostics?.plugin.installed ? "yes" : "no"}</p>
              <p className="raw-path">{serverDiagnostics?.plugin.configPath}</p>
            </>
          ) : null}
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
            {mode === "orxa" ? (
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
            ) : null}
          </div>
        </section>
      );
    }

    if (section === "config") {
      return (
        <section className="settings-section-card settings-pad settings-config">
          <div className={`settings-controls settings-config-controls${mode === "standard" ? " settings-config-controls--standard" : ""}`}>
            <label>
              Scope
              <select value={effectiveScope} onChange={(event) => setScope(event.target.value as "project" | "global")}> 
                <option value="project" disabled={!directory}>
                  Workspace
                </option>
                <option value="global">Global</option>
              </select>
            </label>
            {mode === "standard" ? (
              <button
                type="button"
                className="settings-config-open-btn"
                onClick={() => openEditor("opencode")}
              >
                Open OpenCode JSON Editor
              </button>
            ) : null}
          </div>

          {mode === "orxa" ? (
            <div className="settings-actions settings-top-actions">
              <button type="button" onClick={() => openEditor("opencode")}>
                Open OpenCode JSON Editor
              </button>
              <button type="button" onClick={() => openEditor("orxa")}>
                Open Orxa JSON Editor
              </button>
            </div>
          ) : null}

          <div className={`settings-config-grid${mode !== "orxa" ? " settings-config-grid--single" : ""}`}>
            <article className="settings-config-card">
              <h4>OpenCode JSON</h4>
              <p className="raw-path">{rawDoc?.path}</p>
              <textarea value={rawText} onChange={(event) => setRawText(event.target.value)} />
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

            {mode === "orxa" ? (
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
            ) : null}
          </div>
        </section>
      );
    }

    if (section === "provider-models") {
      const providerMap = new Map<string, { name: string; models: { key: string; modelName: string }[] }>();
      for (const m of allModelOptions) {
        if (!providerMap.has(m.providerID)) {
          providerMap.set(m.providerID, { name: m.providerName, models: [] });
        }
        providerMap.get(m.providerID)!.models.push({ key: m.key, modelName: m.modelName });
      }
      const providers = [...providerMap.entries()];
      const hidden = new Set(appPreferences.hiddenModels);

      const toggleModel = (key: string) => {
        const next = new Set(hidden);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        onAppPreferencesChange({ ...appPreferences, hiddenModels: [...next] });
      };

      const enableAll = (allKeys: string[]) => {
        const next = new Set(hidden);
        for (const k of allKeys) next.delete(k);
        onAppPreferencesChange({ ...appPreferences, hiddenModels: [...next] });
      };

      const disableAll = (allKeys: string[]) => {
        const next = new Set(hidden);
        for (const k of allKeys) next.add(k);
        onAppPreferencesChange({ ...appPreferences, hiddenModels: [...next] });
      };

      const toggleCollapse = (providerID: string) => {
        setCollapsedProviders((prev) => ({ ...prev, [providerID]: !prev[providerID] }));
      };

      return (
        <section className="settings-section-card settings-pad">
          <h3>Provider Models</h3>
          <p className="raw-path">Toggle which models appear in the model selector. Unticked models will be hidden.</p>
          <div className="provider-models-list">
            {providers.map(([providerID, group]) => {
              const allKeys = group.models.map((m) => m.key);
              const visibleCount = allKeys.filter((k) => !hidden.has(k)).length;
              const isCollapsed = Boolean(collapsedProviders[providerID]);
              return (
                <div key={providerID} className="provider-models-group">
                  <div className="provider-models-header">
                    <button type="button" className="provider-models-chevron" onClick={() => toggleCollapse(providerID)}>
                      {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </button>
                    <strong onClick={() => toggleCollapse(providerID)} className="provider-models-name">{group.name}</strong>
                    <small>{visibleCount}/{allKeys.length} enabled</small>
                    <button type="button" className="provider-models-toggle-btn" onClick={() => enableAll(allKeys)}>Enable all</button>
                    <button type="button" className="provider-models-toggle-btn" onClick={() => disableAll(allKeys)}>Disable all</button>
                  </div>
                  {!isCollapsed ? (
                    <div className="provider-models-items">
                      {group.models.map((m) => (
                        <label key={m.key} className="provider-models-item">
                          <input
                            type="checkbox"
                            checked={!hidden.has(m.key)}
                            onChange={() => toggleModel(m.key)}
                          />
                          <span>{m.modelName}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      );
    }

    if (section === "opencode-agents") {
      const currentOcAgent = ocAgents.find((a) => a.filename === selectedOcAgent);

      const saveOcAgent = async () => {
        if (!selectedOcAgent) return;
        setOcAgentSaving(true);
        try {
          await window.orxa.opencode.writeAgentFile(selectedOcAgent, ocAgentDraft);
          await loadOcAgents();
          setFeedback(`Saved ${selectedOcAgent}`);
        } catch (error) {
          setFeedback(error instanceof Error ? error.message : String(error));
        } finally {
          setOcAgentSaving(false);
        }
      };

      const deleteOcAgent = async () => {
        if (!selectedOcAgent || !window.confirm(`Delete agent file ${selectedOcAgent}?`)) return;
        try {
          await window.orxa.opencode.deleteAgentFile(selectedOcAgent);
          setSelectedOcAgent(undefined);
          setOcAgentDraft("");
          await loadOcAgents();
          setFeedback(`Deleted ${selectedOcAgent}`);
        } catch (error) {
          setFeedback(error instanceof Error ? error.message : String(error));
        }
      };

      const createOcAgent = async () => {
        const existing = new Set(ocAgents.map((a) => a.filename.toLowerCase()));
        let index = 1;
        let filenameStem = "new-agent";
        while (existing.has(`${filenameStem}.md`)) {
          index += 1;
          filenameStem = `new-agent-${index}`;
        }
        setOcFilenameDialog({ kind: "create", title: "Create new agent file" });
        setOcFilenameValue(filenameStem);
        setOcFilenameError(null);
      };

      const openOcAgentIn = async (target: OpenDirectoryTarget) => {
        if (!currentOcAgent) return;
        try {
          await window.orxa.opencode.openFileIn(currentOcAgent.path, target);
          setOcOpenInMenu(false);
        } catch (error) {
          setFeedback(error instanceof Error ? error.message : String(error));
        }
      };

      const duplicateOcAgent = async () => {
        if (!currentOcAgent) return;
        const existing = new Set(ocAgents.map((a) => a.filename.toLowerCase()));
        const baseName = currentOcAgent.filename.replace(/\.md$/i, "");
        let index = 1;
        let filenameStem = `${baseName}-copy`;
        while (existing.has(`${filenameStem}.md`)) {
          index += 1;
          filenameStem = `${baseName}-copy-${index}`;
        }
        const content = ocAgentDraft || currentOcAgent.content;
        setOcFilenameDialog({ kind: "duplicate", title: `Duplicate ${currentOcAgent.filename} as`, content });
        setOcFilenameValue(filenameStem);
        setOcFilenameError(null);
      };

      return (
        <section className="settings-section-card settings-pad oc-agents-section">
          <div className="oc-agents-toolbar">
            <select
              className="oc-agents-select"
              value={selectedOcAgent ?? ""}
              onChange={(e) => {
                const filename = e.target.value;
                if (!filename) { setSelectedOcAgent(undefined); setOcAgentDraft(""); return; }
                const agent = ocAgents.find((a) => a.filename === filename);
                if (agent) { setSelectedOcAgent(filename); setOcAgentDraft(agent.content); }
              }}
            >
              <option value="">Select agent...</option>
              {ocAgents.map((agent) => (
                <option key={agent.filename} value={agent.filename}>
                  {agent.name} ({agent.mode})
                </option>
              ))}
            </select>
            <button type="button" className="oc-agents-new-btn" onClick={() => void createOcAgent()}>Create new agent</button>
            {currentOcAgent ? (
              <button type="button" className="oc-agents-new-btn" onClick={() => void duplicateOcAgent()}>Duplicate</button>
            ) : null}
          </div>

          {selectedOcAgent ? (
            <div className="oc-agents-editor">
              <div className="oc-agents-meta">
                <span className="oc-agents-filename">{selectedOcAgent}</span>
                {currentOcAgent?.model ? <span className="oc-agents-model">{currentOcAgent.model}</span> : null}
              </div>
              <textarea
                className="oc-agents-textarea"
                value={ocAgentDraft}
                onChange={(event) => setOcAgentDraft(event.target.value)}
              />
              <div className="oc-agents-actions">
                <button type="button" className="oc-agents-action-btn" disabled={ocAgentSaving} onClick={() => void saveOcAgent()}>
                  {ocAgentSaving ? "Saving..." : "Save"}
                </button>
                <button type="button" className="oc-agents-action-btn" onClick={() => void loadOcAgents()}>Reload</button>
                <button type="button" className="oc-agents-action-btn oc-agents-action-btn--danger" onClick={() => void deleteOcAgent()}>Delete</button>
                <div className="oc-agents-openin-wrap">
                  <button
                    type="button"
                    className="oc-agents-action-btn"
                    onClick={() => setOcOpenInMenu((v) => !v)}
                    disabled={!currentOcAgent}
                  >
                    Open in...
                  </button>
                  {ocOpenInMenu ? (
                    <div className="oc-agents-openin-menu">
                      <button type="button" onClick={() => void openOcAgentIn("cursor")}>Cursor</button>
                      <button type="button" onClick={() => void openOcAgentIn("zed")}>Zed</button>
                      <button type="button" onClick={() => void openOcAgentIn("finder")}>Finder</button>
                      <button type="button" onClick={() => void openOcAgentIn("terminal")}>Terminal</button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <p className="oc-agents-empty">Select an agent to edit, or create a new one.</p>
          )}
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
              {mode === "orxa" ? (
                <button type="button" className={section === "agents" ? "active" : ""} onClick={() => setSection("agents")}>
                  Orxa Agents
                </button>
              ) : null}
              <button type="button" className={section === "provider-models" ? "active" : ""} onClick={() => setSection("provider-models")}>
                Provider Models
              </button>
              <button type="button" className={section === "opencode-agents" ? "active" : ""} onClick={() => setSection("opencode-agents")}>
                Agents
              </button>
              <button type="button" className={section === "memory" ? "active" : ""} onClick={() => setSection("memory")}>
                Memory
              </button>
              <button type="button" className={section === "app" ? "active" : ""} onClick={() => setSection("app")}>
                App
              </button>
              <button
                type="button"
                className={section === "preferences" ? "active" : ""}
                onClick={() => setSection("preferences")}
              >
                Preferences
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

      {ocFilenameDialog ? (
        <div className="overlay settings-modal-overlay">
          <div className="modal oc-agent-filename-modal">
            <div className="modal-header">
              <h2>{ocFilenameDialog.title}</h2>
              <button type="button" onClick={closeOcFilenameDialog}>
                Close
              </button>
            </div>
            <form
              className="oc-agent-filename-body"
              onSubmit={(event) => {
                event.preventDefault();
                void submitOcFilenameDialog();
              }}
            >
              <p className="raw-path">Enter a filename. If `.md` is omitted, it will be added automatically.</p>
              <input
                autoFocus
                type="text"
                value={ocFilenameValue}
                onChange={(event) => {
                  setOcFilenameValue(event.target.value);
                  if (ocFilenameError) {
                    setOcFilenameError(null);
                  }
                }}
                placeholder="agent-name"
              />
              {ocFilenameError ? <p className="raw-path">{ocFilenameError}</p> : null}
              <div className="settings-actions">
                <button type="submit">Save</button>
                <button type="button" onClick={closeOcFilenameDialog}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editorOpen ? (
        <div className="overlay settings-modal-overlay">
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
