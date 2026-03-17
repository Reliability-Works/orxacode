import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type {
  AgentsDocument,
  CodexDoctorResult,
  CodexModelEntry,
  CodexUpdateResult,
  MemoryBackfillStatus,
  MemoryPolicyMode,
  MemorySettings,
  MemorySettingsUpdateInput,
  MemoryTemplate,
  OpenCodeAgentFile,
  OpenDirectoryTarget,
  RawConfigDocument,
  ServerDiagnostics,
  UpdatePreferences,
} from "@shared/ipc";
import type { ModelOption } from "../lib/models";
import type { AppPreferences } from "~/types/app";
import { CODE_FONT_OPTIONS } from "~/types/app";

type Props = {
  open: boolean;
  directory: string | undefined;
  onClose: () => void;
  onReadRaw: (scope: "project" | "global", directory?: string) => Promise<RawConfigDocument>;
  onWriteRaw: (scope: "project" | "global", content: string, directory?: string) => Promise<RawConfigDocument>;
  onReadGlobalAgentsMd: () => Promise<AgentsDocument>;
  onWriteGlobalAgentsMd: (content: string) => Promise<AgentsDocument>;
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
  allModelOptions: ModelOption[];
};

type SettingsSection =
  | "config"
  | "provider-models"
  | "opencode-agents"
  | "memory"
  | "personalization"
  | "git"
  | "app"
  | "preferences"
  | "server"
  | "claude-config"
  | "claude-permissions"
  | "claude-dirs"
  | "claude-personalization"
  | "codex-general"
  | "codex-models"
  | "codex-access"
  | "codex-config"
  | "codex-personalization"
  | "codex-dirs";
type OcAgentFilenameDialog =
  | { kind: "create"; title: string }
  | { kind: "duplicate"; title: string; content: string };
type UpdateCheckStatus = {
  checkedAt: number;
  state: "started" | "skipped" | "error";
  message?: string;
};

const UPDATE_CHECK_STATUS_KEY = "orxa:updateCheckStatus:v1";

function formatUpdateCheckStatus(status: UpdateCheckStatus | null): string {
  if (!status) {
    return "Last checked: Never";
  }
  const checkedAt = new Date(status.checkedAt);
  const timestamp = Number.isNaN(checkedAt.getTime()) ? "unknown time" : checkedAt.toLocaleString();
  if (status.message && status.message.trim().length > 0) {
    return `Last checked: ${timestamp} (${status.message.trim()})`;
  }
  if (status.state === "started") {
    return `Last checked: ${timestamp} (Update check started)`;
  }
  if (status.state === "error") {
    return `Last checked: ${timestamp} (Update check failed)`;
  }
  return `Last checked: ${timestamp} (Update check skipped)`;
}

export function SettingsDrawer({
  open,
  directory,
  onClose,
  onReadRaw,
  onWriteRaw,
  onReadGlobalAgentsMd,
  onWriteGlobalAgentsMd,
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
  allModelOptions,
}: Props) {
  const appVersion = __APP_VERSION__?.trim().length ? __APP_VERSION__ : "dev";
  const [section, setSection] = useState<SettingsSection>("app");
  const [scope, setScope] = useState<"project" | "global">("global");

  const [rawDoc, setRawDoc] = useState<RawConfigDocument | null>(null);
  const [rawText, setRawText] = useState("");
  const [globalAgentsDoc, setGlobalAgentsDoc] = useState<AgentsDocument | null>(null);
  const [globalAgentsText, setGlobalAgentsText] = useState("");

  const [serverDiagnostics, setServerDiagnostics] = useState<ServerDiagnostics | null>(null);
  const [updatePreferences, setUpdatePreferences] = useState<UpdatePreferences>({
    autoCheckEnabled: true,
    releaseChannel: "stable",
  });
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
  const [updateCheckStatus, setUpdateCheckStatus] = useState<UpdateCheckStatus | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }
    try {
      const raw = window.localStorage.getItem(UPDATE_CHECK_STATUS_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as Partial<UpdateCheckStatus>;
      if (typeof parsed.checkedAt !== "number" || !Number.isFinite(parsed.checkedAt)) {
        return null;
      }
      if (parsed.state !== "started" && parsed.state !== "skipped" && parsed.state !== "error") {
        return null;
      }
      return {
        checkedAt: parsed.checkedAt,
        state: parsed.state,
        message: typeof parsed.message === "string" ? parsed.message : undefined,
      };
    } catch {
      return null;
    }
  });
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

  const [claudeSettingsJson, setClaudeSettingsJson] = useState("");
  const [claudeMd, setClaudeMd] = useState("");
  const [claudeLoading, setClaudeLoading] = useState(false);
  const [codexConfigToml, setCodexConfigToml] = useState("");
  const [codexAgentsMd, setCodexAgentsMd] = useState("");
  const [codexLoading, setCodexLoading] = useState(false);
  const [codexState, setCodexState] = useState<{ status: string } | null>(null);
  const [codexDoctorResult, setCodexDoctorResult] = useState<CodexDoctorResult | null>(null);
  const [codexDoctorRunning, setCodexDoctorRunning] = useState(false);
  const [codexUpdateResult, setCodexUpdateResult] = useState<CodexUpdateResult | null>(null);
  const [codexUpdateRunning, setCodexUpdateRunning] = useState(false);
  const [codexModels, setCodexModels] = useState<CodexModelEntry[]>([]);
  const [codexModelsLoading, setCodexModelsLoading] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorText, setEditorText] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [ocFilenameDialog, setOcFilenameDialog] = useState<OcAgentFilenameDialog | null>(null);
  const [ocFilenameValue, setOcFilenameValue] = useState("");
  const [ocFilenameError, setOcFilenameError] = useState<string | null>(null);

  const updateUpdateCheckStatus = useCallback((status: UpdateCheckStatus) => {
    setUpdateCheckStatus(status);
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(UPDATE_CHECK_STATUS_KEY, JSON.stringify(status));
    } catch {
      // ignore persistence failures
    }
  }, []);

  const effectiveScope = useMemo(() => {
    if (scope === "project" && !directory) {
      return "global";
    }
    return scope;
  }, [scope, directory]);


  useEffect(() => {
    if (!open) {
      return;
    }
    const load = async () => {
      const [raw, globalAgents, diagnostics, updaterPrefs, nextMemorySettings, templates] = await Promise.all([
        onReadRaw(effectiveScope, directory),
        onReadGlobalAgentsMd(),
        onGetServerDiagnostics(),
        onGetUpdatePreferences(),
        onGetMemorySettings(directory),
        onListMemoryTemplates(),
      ]);
      setRawDoc(raw);
      setRawText(raw.content);
      setGlobalAgentsDoc(globalAgents);
      setGlobalAgentsText(globalAgents.content);
      setUpdatePreferences(updaterPrefs);
      setMemorySettings(nextMemorySettings);
      setMemoryTemplates(templates);
      setMemoryBackfillStatus(null);
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
    onReadGlobalAgentsMd,
    onGetServerDiagnostics,
    onGetUpdatePreferences,
    onGetMemorySettings,
    onListMemoryTemplates,
  ]);

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

  const isClaudeSection = section === "claude-config" || section === "claude-permissions" || section === "claude-dirs" || section === "claude-personalization";
  useEffect(() => {
    if (!open || !isClaudeSection) return;
    setClaudeLoading(true);
    void Promise.all([
      window.orxa.app.readTextFile("~/.claude/settings.json"),
      window.orxa.app.readTextFile("~/.claude/CLAUDE.md"),
    ])
      .then(([settingsJson, claudeMdContent]) => {
        setClaudeSettingsJson(settingsJson);
        setClaudeMd(claudeMdContent);
      })
      .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
      .finally(() => setClaudeLoading(false));
  }, [open, isClaudeSection]);

  const isCodexSection =
    section === "codex-general" ||
    section === "codex-models" ||
    section === "codex-access" ||
    section === "codex-config" ||
    section === "codex-personalization" ||
    section === "codex-dirs";
  useEffect(() => {
    if (!open || !isCodexSection) return;
    setCodexLoading(true);
    void Promise.all([
      window.orxa.app.readTextFile("~/.codex/config.toml"),
      window.orxa.app.readTextFile("~/.codex/AGENTS.md"),
      window.orxa.codex.getState(),
      window.orxa.codex.listModels(),
    ])
      .then(([configToml, agentsMd, state, models]) => {
        setCodexConfigToml(configToml);
        setCodexAgentsMd(agentsMd);
        setCodexState(state);
        setCodexModels(models);
      })
      .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
      .finally(() => setCodexLoading(false));
  }, [open, isCodexSection]);

  if (!open) {
    return null;
  }

  const openEditor = () => {
    setEditorText(rawText);
    setEditorOpen(true);
  };

  const saveEditor = async () => {
    const next = await onWriteRaw(effectiveScope, editorText, directory);
    setRawDoc(next);
    setRawText(next.content);
    setFeedback("OpenCode config saved");
    setEditorOpen(false);
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
        <section className="settings-section-card">
          <h3>app settings</h3>

          <div className="settings-toggle-group">
            <label className="settings-inline-toggle">
              auto-open terminal when creating PTY
              <input
                type="checkbox"
                checked={appPreferences.autoOpenTerminalOnCreate}
                onChange={(event) =>
                  onAppPreferencesChange({ ...appPreferences, autoOpenTerminalOnCreate: event.target.checked })
                }
              />
            </label>
            <label className="settings-inline-toggle">
              confirm dangerous actions (reject buttons)
              <input
                type="checkbox"
                checked={appPreferences.confirmDangerousActions}
                onChange={(event) =>
                  onAppPreferencesChange({ ...appPreferences, confirmDangerousActions: event.target.checked })
                }
              />
            </label>
            <label className="settings-inline-toggle">
              automatically check for updates
              <input
                type="checkbox"
                checked={updatePreferences.autoCheckEnabled}
                onChange={(event) => applyUpdatePreferences({ autoCheckEnabled: event.target.checked })}
              />
            </label>
            <label className="settings-inline-toggle">
              notify when agent is waiting for input
              <input
                type="checkbox"
                checked={appPreferences.notifyOnAwaitingInput}
                onChange={(e) => onAppPreferencesChange({ ...appPreferences, notifyOnAwaitingInput: e.target.checked })}
              />
            </label>
            <label className="settings-inline-toggle">
              notify when agent finishes a task
              <input
                type="checkbox"
                checked={appPreferences.notifyOnTaskComplete}
                onChange={(e) => onAppPreferencesChange({ ...appPreferences, notifyOnTaskComplete: e.target.checked })}
              />
            </label>
            <label className="settings-inline-toggle">
              enable collaboration modes (codex)
              <input
                type="checkbox"
                checked={appPreferences.collaborationModesEnabled}
                onChange={(e) => onAppPreferencesChange({ ...appPreferences, collaborationModesEnabled: e.target.checked })}
              />
            </label>
            <label className="settings-inline-toggle">
              notify on subagent system events
              <input
                type="checkbox"
                checked={appPreferences.subagentSystemNotificationsEnabled}
                onChange={(e) => onAppPreferencesChange({ ...appPreferences, subagentSystemNotificationsEnabled: e.target.checked })}
              />
            </label>
          </div>

          <div className="settings-divider" />

          <div className="settings-update-row">
            <label className="settings-update-channel">
              release_channel
              <select
                value={updatePreferences.releaseChannel}
                onChange={(event) =>
                  applyUpdatePreferences({ releaseChannel: event.target.value as UpdatePreferences["releaseChannel"] })
                }
              >
                <option value="stable">stable</option>
                <option value="prerelease">prerelease</option>
              </select>
            </label>
          </div>

          <div className="settings-divider" />

          <div className="settings-update-section">
            <button
              type="button"
              className="settings-update-check-btn"
              disabled={checkingForUpdates}
              onClick={() => {
                setCheckingForUpdates(true);
                void onCheckForUpdates()
                  .then((result) => {
                    updateUpdateCheckStatus({
                      checkedAt: Date.now(),
                      state: result.status,
                      message: result.message,
                    });
                    if (result.status === "started") {
                      setFeedback("Update check started");
                    } else if (result.message) {
                      setFeedback(result.message);
                    } else {
                      setFeedback("Update check skipped");
                    }
                  })
                  .catch((error: unknown) => {
                    const message = error instanceof Error ? error.message : String(error);
                    updateUpdateCheckStatus({
                      checkedAt: Date.now(),
                      state: "error",
                      message,
                    });
                    setFeedback(message);
                  })
                  .finally(() => setCheckingForUpdates(false));
              }}
            >
              {checkingForUpdates ? "checking..." : "check for updates now"}
            </button>
            <p className="settings-update-last-checked">{formatUpdateCheckStatus(updateCheckStatus)}</p>
          </div>

          <p className="settings-version-label">Version: v{appVersion}</p>
        </section>
      );
    }

    if (section === "git") {
      return (
        <section className="settings-section-card settings-pad">
          <p className="settings-git-textarea-label">commit message guidance prompt</p>
          <textarea
            className="settings-git-textarea"
            value={appPreferences.commitGuidancePrompt}
            onChange={(event) =>
              onAppPreferencesChange({ ...appPreferences, commitGuidancePrompt: event.target.value })
            }
          />
          <label className="settings-update-channel" style={{ marginTop: "16px" }}>
            git command agent
            <select
              value={appPreferences.gitAgent}
              onChange={(event) =>
                onAppPreferencesChange({ ...appPreferences, gitAgent: event.target.value as "opencode" | "claude" | "codex" })
              }
            >
              <option value="opencode">opencode</option>
              <option value="claude">claude</option>
              <option value="codex">codex</option>
            </select>
          </label>
          <p className="settings-codex-help">// which ai agent handles git commits, pushes, and PR creation</p>
        </section>
      );
    }

    if (section === "personalization") {
      return (
        <section className="settings-section-card settings-pad">
          <p className="settings-personalization-desc">your global AGENTS.md which will apply to all workspace sessions.</p>
          <p className="settings-personalization-path">{globalAgentsDoc?.path ?? "~/.config/opencode/AGENTS.md"}</p>
          <label htmlFor="global-agents-textarea" className="settings-personalization-field-label">global AGENTS.md</label>
          <textarea
            id="global-agents-textarea"
            className="settings-personalization-textarea"
            value={globalAgentsText}
            placeholder="Add personal agent rules for all workspaces..."
            onChange={(event) => setGlobalAgentsText(event.target.value)}
          />
          <div className="settings-personalization-actions">
            <button
              type="button"
              className="settings-personalization-save-btn"
              onClick={() =>
                void onWriteGlobalAgentsMd(globalAgentsText)
                  .then((doc) => {
                    setGlobalAgentsDoc(doc);
                    setGlobalAgentsText(doc.content);
                    setFeedback("Global AGENTS.md saved");
                  })
                  .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
              }
            >
              save
            </button>
            <button
              type="button"
              className="settings-personalization-reload-btn"
              onClick={() =>
                void onReadGlobalAgentsMd()
                  .then((doc) => {
                    setGlobalAgentsDoc(doc);
                    setGlobalAgentsText(doc.content);
                    setFeedback("Global AGENTS.md reloaded");
                  })
                  .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
              }
            >
              reload
            </button>
          </div>
        </section>
      );
    }

    if (section === "preferences") {
      return (
        <section className="settings-section-card settings-pad">
          <p className="settings-preferences-title">preferences</p>
          <p className="settings-preferences-desc">code font — used in the diff viewer, file tree, and file preview.</p>
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
                  <div className="settings-font-option-header">
                    {isSelected ? (
                      <ChevronRight size={12} className="settings-font-option-check" style={{ color: "var(--accent-green)" }} />
                    ) : null}
                    <span className="settings-font-option-name">{opt.label}</span>
                  </div>
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
          <h2 className="settings-memory-title">memory</h2>
          <p className="settings-memory-desc">
            memory is scoped by workspace for retrieval. graph view can aggregate all workspaces.
          </p>

          <div className="settings-memory-section">
            <p className="settings-memory-section-label">// global settings</p>
            <div className="settings-memory-row">
              <span className="settings-memory-row-label">global mode</span>
              <select
                className="settings-memory-select"
                value={globalPolicy?.mode ?? "balanced"}
                onChange={(event) => applyGlobalPatch({ mode: event.target.value as MemoryPolicyMode })}
                disabled={memoryLoading}
              >
                <option value="conservative">conservative</option>
                <option value="balanced">balanced</option>
                <option value="aggressive">aggressive</option>
                <option value="codebase-facts">codebase-facts</option>
              </select>
            </div>
            <label className="settings-inline-toggle">
              enable memory globally
              <input
                type="checkbox"
                checked={globalPolicy?.enabled ?? false}
                onChange={(event) => applyGlobalPatch({ enabled: event.target.checked })}
                disabled={memoryLoading}
              />
            </label>
            <div className="settings-memory-row">
              <span className="settings-memory-row-label">prompt memory limit</span>
              <input
                type="number"
                className="settings-memory-number"
                min={1}
                max={12}
                value={globalPolicy?.maxPromptMemories ?? 6}
                onChange={(event) => applyGlobalPatch({ maxPromptMemories: Number(event.target.value) })}
                disabled={memoryLoading}
              />
            </div>
            <div className="settings-memory-textarea-group">
              <span className="settings-memory-textarea-label">global memory guidance</span>
              <textarea
                className="settings-memory-textarea"
                rows={5}
                value={globalPolicy?.guidance ?? ""}
                placeholder="enter guidance for how memory should behave globally..."
                onChange={(event) => applyGlobalPatch({ guidance: event.target.value })}
                disabled={memoryLoading}
              />
            </div>
          </div>

          <div className="settings-memory-section">
            <p className="settings-memory-section-label">// workspace override</p>
            <p className="settings-memory-path">{directory ?? "no workspace selected"}</p>
            <div className="settings-memory-row">
              <span className="settings-memory-row-label">workspace mode</span>
              <select
                className="settings-memory-select"
                value={workspacePolicy?.mode ?? globalPolicy?.mode ?? "balanced"}
                onChange={(event) => applyWorkspacePatch({ mode: event.target.value as MemoryPolicyMode })}
                disabled={!directory || memoryLoading}
              >
                <option value="conservative">conservative</option>
                <option value="balanced">balanced</option>
                <option value="aggressive">aggressive</option>
                <option value="codebase-facts">codebase-facts</option>
              </select>
            </div>
            <label className="settings-inline-toggle">
              enable memory for workspace
              <input
                type="checkbox"
                checked={workspacePolicy?.enabled ?? globalPolicy?.enabled ?? false}
                onChange={(event) => applyWorkspacePatch({ enabled: event.target.checked })}
                disabled={!directory || memoryLoading}
              />
            </label>
            <div className="settings-memory-row">
              <span className="settings-memory-row-label">capture limit/session</span>
              <input
                type="number"
                className="settings-memory-number"
                min={1}
                max={60}
                value={workspacePolicy?.maxCapturePerSession ?? globalPolicy?.maxCapturePerSession ?? 24}
                onChange={(event) => applyWorkspacePatch({ maxCapturePerSession: Number(event.target.value) })}
                disabled={!directory || memoryLoading}
              />
            </div>
            <div className="settings-memory-textarea-group">
              <span className="settings-memory-textarea-label">workspace guidance</span>
              <textarea
                className="settings-memory-textarea"
                rows={4}
                value={workspacePolicy?.guidance ?? ""}
                placeholder="enter workspace-specific memory guidance..."
                onChange={(event) => applyWorkspacePatch({ guidance: event.target.value })}
                disabled={!directory || memoryLoading}
              />
            </div>
            <button
              type="button"
              className="settings-memory-ws-clear-btn"
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
              clear workspace override
            </button>
          </div>

          <div className="settings-memory-section">
            <p className="settings-memory-section-label">// template import</p>
            <div className="settings-memory-template-row">
              {memoryTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="settings-memory-tpl-btn"
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
                  {template.name}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-memory-section">
            <p className="settings-memory-section-label">// maintenance</p>
            <div className="settings-memory-maint-row">
              <button
                type="button"
                className="settings-memory-maint-btn"
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
                backfill now
              </button>
              <button
                type="button"
                className="settings-memory-maint-btn settings-memory-maint-btn--danger"
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
                clear workspace memory
              </button>
            </div>
            {memoryBackfillStatus ? (
              <p className="settings-memory-path" style={{ marginTop: "4px" }}>
                {memoryBackfillStatus.message ?? "Backfill"} ({Math.round(memoryBackfillStatus.progress * 100)}% •{" "}
                {memoryBackfillStatus.scannedSessions}/{memoryBackfillStatus.totalSessions})
              </p>
            ) : null}
          </div>
        </section>
      );
    }

    if (section === "server") {
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

    if (section === "config") {
      return (
        <section className="settings-section-card settings-pad settings-config">
          <div className="settings-config-top-row">
            <div className="settings-config-segment">
              <button
                type="button"
                className={`settings-config-segment-btn${effectiveScope === "project" ? " active" : ""}`}
                disabled={!directory}
                onClick={() => setScope("project")}
              >
                workspace
              </button>
              <button
                type="button"
                className={`settings-config-segment-btn${effectiveScope === "global" ? " active" : ""}`}
                onClick={() => setScope("global")}
              >
                global
              </button>
            </div>
            <span className="settings-config-spacer" />
            <button type="button" className="settings-config-top-btn" onClick={() => openEditor()}>
              open opencode json editor
            </button>
          </div>

          <div className="settings-config-grid settings-config-grid--single">
            <article className="settings-config-card">
              <h4>opencode json</h4>
              <p className="raw-path">{rawDoc?.path}</p>
              <textarea value={rawText} onChange={(event) => setRawText(event.target.value)} />
              <div className="settings-actions">
                <button
                  type="button"
                  className="settings-config-card-save"
                  onClick={() =>
                    void onWriteRaw(effectiveScope, rawText, directory)
                      .then((next) => {
                        setRawDoc(next);
                        setFeedback("OpenCode config saved");
                      })
                      .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
                  }
                >
                  save
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
                  reload
                </button>
              </div>
            </article>

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
        setCollapsedProviders((prev) => ({ ...prev, [providerID]: prev[providerID] === false ? true : false }));
      };

      return (
        <section className="settings-section-card settings-pad">
          <p className="raw-path" style={{ marginBottom: 0, color: "var(--text-secondary)", fontSize: "13px", lineHeight: "1.6", fontFamily: "var(--font-mono)" }}>
            // toggle which models appear in the model selector. unticked models will be hidden.
          </p>
          <div className="provider-models-list">
            {providers.map(([providerID, group]) => {
              const allKeys = group.models.map((m) => m.key);
              const visibleCount = allKeys.filter((k) => !hidden.has(k)).length;
              const isCollapsed = collapsedProviders[providerID] !== false;
              return (
                <div key={providerID} className="provider-models-group">
                  <div className="provider-models-header">
                    <button type="button" className="provider-models-chevron" onClick={() => toggleCollapse(providerID)}>
                      {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </button>
                    <strong onClick={() => toggleCollapse(providerID)} className="provider-models-name">{group.name}</strong>
                    <small>{visibleCount}/{allKeys.length} enabled</small>
                    <button type="button" className="provider-models-enable-link" onClick={() => enableAll(allKeys)}>enable all</button>
                    <button type="button" className="provider-models-disable-link" onClick={() => disableAll(allKeys)}>disable all</button>
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

    if (section === "claude-config") {
      return (
        <section className="settings-section-card settings-pad settings-server-grid">
          <p className="settings-server-title">claude / config</p>

          <p className="settings-server-subtitle">// settings.json</p>
          <p className="raw-path">~/.claude/settings.json</p>
          {claudeLoading ? (
            <p className="settings-memory-desc">loading...</p>
          ) : (
            <textarea
              className="settings-personalization-textarea"
              value={claudeSettingsJson}
              onChange={(e) => setClaudeSettingsJson(e.target.value)}
              placeholder="(file not found or empty)"
              style={{ minHeight: "160px" }}
            />
          )}
          <div className="settings-codex-field-row">
            <button
              type="button"
              className="settings-server-btn"
              onClick={() => {
                void window.orxa.app.writeTextFile("~/.claude/settings.json", claudeSettingsJson)
                  .then(() => setFeedback("settings.json saved"))
                  .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)));
              }}
            >
              save
            </button>
            <button
              type="button"
              className="settings-server-btn"
              onClick={() => {
                void window.orxa.app.readTextFile("~/.claude/settings.json")
                  .then((content) => { setClaudeSettingsJson(content); setFeedback("settings.json refreshed"); })
                  .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)));
              }}
            >
              refresh
            </button>
          </div>
        </section>
      );
    }

    if (section === "claude-personalization") {
      return (
        <section className="settings-section-card settings-pad settings-server-grid">
          <p className="settings-server-title">claude / personalization</p>

          <p className="settings-server-subtitle">// global instructions (CLAUDE.md)</p>
          <p className="raw-path">~/.claude/CLAUDE.md</p>
          {claudeLoading ? (
            <p className="settings-memory-desc">loading...</p>
          ) : (
            <textarea
              className="settings-personalization-textarea"
              value={claudeMd}
              onChange={(e) => setClaudeMd(e.target.value)}
              placeholder="(file not found or empty)"
              style={{ minHeight: "280px" }}
            />
          )}
          <div className="settings-codex-field-row">
            <button
              type="button"
              className="settings-server-btn"
              onClick={() => {
                void window.orxa.app.writeTextFile("~/.claude/CLAUDE.md", claudeMd)
                  .then(() => setFeedback("CLAUDE.md saved"))
                  .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)));
              }}
            >
              save
            </button>
            <button
              type="button"
              className="settings-server-btn"
              onClick={() => {
                void window.orxa.app.readTextFile("~/.claude/CLAUDE.md")
                  .then((content) => { setClaudeMd(content); setFeedback("CLAUDE.md refreshed"); })
                  .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)));
              }}
            >
              refresh
            </button>
          </div>
        </section>
      );
    }

    if (section === "claude-permissions") {
      return (
        <section className="settings-section-card settings-pad settings-server-grid">
          <p className="settings-server-title">claude / permissions</p>

          <p className="settings-server-subtitle">// default permission mode</p>
          <div className="settings-server-status-card">
            <div className="settings-server-status-row">
              <span className="settings-server-status-key">default permission mode</span>
              <span className="settings-server-status-value">{appPreferences.permissionMode ?? "ask-write"}</span>
            </div>
          </div>

          <p className="settings-server-subtitle" style={{ marginTop: "16px" }}>// permission mode</p>
          <select
            className="settings-codex-input"
            value={appPreferences.permissionMode}
            onChange={(e) =>
              onAppPreferencesChange({ ...appPreferences, permissionMode: e.target.value as "ask-write" | "yolo-write" })
            }
          >
            <option value="ask-write">ask-write (prompt before writing)</option>
            <option value="yolo-write">yolo-write (auto-approve writes)</option>
          </select>
        </section>
      );
    }

    if (section === "claude-dirs") {
      return (
        <section className="settings-section-card settings-pad settings-server-grid">
          <p className="settings-server-title">claude / directories</p>

          <p className="settings-server-subtitle">// claude directories</p>
          <div className="settings-claude-dirs">
            <div className="settings-dir-row">
              <span className="settings-server-status-key">~/.claude/agents/</span>
              <button
                type="button"
                className="settings-server-btn"
                onClick={() => void window.orxa.app.revealInFinder("~/.claude/agents")}
              >
                open in finder
              </button>
            </div>
            <div className="settings-dir-row">
              <span className="settings-server-status-key">~/.claude/skills/</span>
              <button
                type="button"
                className="settings-server-btn"
                onClick={() => void window.orxa.app.revealInFinder("~/.claude/skills")}
              >
                open in finder
              </button>
            </div>
            <div className="settings-dir-row">
              <span className="settings-server-status-key">~/.claude/plugins/</span>
              <button
                type="button"
                className="settings-server-btn"
                onClick={() => void window.orxa.app.revealInFinder("~/.claude/plugins")}
              >
                open in finder
              </button>
            </div>
          </div>
        </section>
      );
    }

    if (section === "codex-general") {
      const codexStatus = codexState?.status ?? "unknown";
      const codexConnected = codexStatus === "connected";
      return (
        <section className="settings-section-card settings-pad settings-server-grid">
          <p className="settings-server-title">codex / general</p>

          <p className="settings-server-subtitle">// codex binary path</p>
          <div className="settings-codex-field-row">
            <input
              type="text"
              className="settings-codex-input"
              value={appPreferences.codexPath}
              onChange={(e) => onAppPreferencesChange({ ...appPreferences, codexPath: e.target.value })}
              placeholder="(uses system PATH)"
            />
            <button
              type="button"
              className="settings-server-btn"
              onClick={() => {
                void window.orxa.app.openFile({ title: "Select codex binary", filters: [] }).then((result) => {
                  if (result) onAppPreferencesChange({ ...appPreferences, codexPath: result.path });
                });
              }}
            >
              browse
            </button>
            <button
              type="button"
              className="settings-server-btn"
              onClick={() => onAppPreferencesChange({ ...appPreferences, codexPath: "" })}
            >
              use PATH
            </button>
          </div>
          <p className="settings-codex-help">Leave empty to use the system PATH resolution.</p>

          <p className="settings-server-subtitle" style={{ marginTop: "16px" }}>// default codex args</p>
          <div className="settings-codex-field-row">
            <input
              type="text"
              className="settings-codex-input"
              value={appPreferences.codexArgs}
              onChange={(e) => onAppPreferencesChange({ ...appPreferences, codexArgs: e.target.value })}
              placeholder="e.g. --quiet --no-color"
            />
            <button
              type="button"
              className="settings-server-btn"
              onClick={() => onAppPreferencesChange({ ...appPreferences, codexArgs: "" })}
            >
              clear
            </button>
          </div>
          <p className="settings-codex-help">Extra flags passed to the codex app-server. Supports --quiet, --no-color, etc.</p>

          <p className="settings-server-subtitle" style={{ marginTop: "16px" }}>// diagnostics</p>
          <div className="settings-codex-field-row">
            <button
              type="button"
              className="settings-server-btn"
              disabled={codexDoctorRunning}
              onClick={() => {
                setCodexDoctorRunning(true);
                setCodexDoctorResult(null);
                void window.orxa.codex.doctor()
                  .then((result) => { setCodexDoctorResult(result); setFeedback("Doctor completed"); })
                  .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
                  .finally(() => setCodexDoctorRunning(false));
              }}
            >
              {codexDoctorRunning ? "running..." : "run doctor"}
            </button>
            <button
              type="button"
              className="settings-server-btn"
              disabled={codexUpdateRunning}
              onClick={() => {
                setCodexUpdateRunning(true);
                setCodexUpdateResult(null);
                void window.orxa.codex.update()
                  .then((result) => { setCodexUpdateResult(result); setFeedback(result.message); })
                  .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
                  .finally(() => setCodexUpdateRunning(false));
              }}
            >
              {codexUpdateRunning ? "updating..." : "update codex"}
            </button>
          </div>
          {codexDoctorResult ? (
            <div className={`settings-codex-doctor ${codexDoctorResult.appServer === "ok" ? "settings-codex-doctor--ok" : "settings-codex-doctor--error"}`}>
              <div className="settings-server-status-row">
                <span className="settings-server-status-key">version</span>
                <span className="settings-server-status-value">{codexDoctorResult.version}</span>
              </div>
              <div className="settings-server-status-row">
                <span className="settings-server-status-key">app-server</span>
                <span className={`settings-server-status-value${codexDoctorResult.appServer === "ok" ? " settings-server-status-value--green" : ""}`}>
                  {codexDoctorResult.appServer}
                </span>
              </div>
              <div className="settings-server-status-row">
                <span className="settings-server-status-key">node</span>
                <span className={`settings-server-status-value${codexDoctorResult.node === "ok" ? " settings-server-status-value--green" : ""}`}>
                  {codexDoctorResult.node}
                </span>
              </div>
              <div className="settings-server-status-row">
                <span className="settings-server-status-key">path</span>
                <span className="settings-server-status-value settings-server-status-value--path">{codexDoctorResult.path}</span>
              </div>
            </div>
          ) : null}
          {codexUpdateResult ? (
            <div className={`settings-codex-doctor ${codexUpdateResult.ok ? "settings-codex-doctor--ok" : "settings-codex-doctor--error"}`}>
              <p className="settings-memory-desc">{codexUpdateResult.message}</p>
            </div>
          ) : null}

          <p className="settings-server-subtitle" style={{ marginTop: "16px" }}>// connection status</p>
          <div className="settings-server-status-card">
            <div className="settings-server-status-row">
              <span className="settings-server-status-key">codex app-server</span>
              <span className={`settings-server-status-value${codexConnected ? " settings-server-status-value--green" : ""}`}>
                {codexStatus}
              </span>
            </div>
          </div>
        </section>
      );
    }

    if (section === "codex-models") {
      const selectedModelEntry = codexModels.find((m) => m.id === appPreferences.codexDefaultModel);
      return (
        <section className="settings-section-card settings-pad settings-server-grid">
          <p className="settings-server-title">codex / models</p>

          <p className="settings-server-subtitle">// default model</p>
          <div className="settings-codex-field-row">
            <select
              className="settings-codex-input"
              value={appPreferences.codexDefaultModel}
              onChange={(e) => onAppPreferencesChange({ ...appPreferences, codexDefaultModel: e.target.value })}
            >
              <option value="">(none -- use codex default)</option>
              {codexModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name || m.id}</option>
              ))}
            </select>
            <button
              type="button"
              className="settings-server-btn"
              disabled={codexModelsLoading}
              onClick={() => {
                setCodexModelsLoading(true);
                void window.orxa.codex.listModels()
                  .then((models) => { setCodexModels(models); setFeedback("Models refreshed"); })
                  .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
                  .finally(() => setCodexModelsLoading(false));
              }}
            >
              {codexModelsLoading ? "loading..." : "refresh"}
            </button>
          </div>

          <p className="settings-server-subtitle" style={{ marginTop: "16px" }}>// reasoning effort</p>
          <select
            className="settings-codex-input"
            value={appPreferences.codexReasoningEffort}
            disabled={!selectedModelEntry || selectedModelEntry.supportedReasoningEfforts.length === 0}
            onChange={(e) => onAppPreferencesChange({ ...appPreferences, codexReasoningEffort: e.target.value })}
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
          {!selectedModelEntry || selectedModelEntry.supportedReasoningEfforts.length === 0 ? (
            <p className="settings-codex-help">Reasoning effort is not supported by the selected model.</p>
          ) : null}
        </section>
      );
    }

    if (section === "codex-access") {
      return (
        <section className="settings-section-card settings-pad settings-server-grid">
          <p className="settings-server-title">codex / access</p>

          <p className="settings-server-subtitle">// access mode</p>
          <select
            className="settings-codex-input"
            value={appPreferences.codexAccessMode}
            onChange={(e) => onAppPreferencesChange({ ...appPreferences, codexAccessMode: e.target.value })}
          >
            <option value="read-only">read-only</option>
            <option value="on-request">on-request (ask for approval)</option>
            <option value="full-access">full-access (auto-approve)</option>
          </select>
        </section>
      );
    }

    if (section === "codex-config") {
      return (
        <section className="settings-section-card settings-pad settings-server-grid">
          <p className="settings-server-title">codex / config</p>

          <p className="settings-server-subtitle">// config.toml</p>
          <p className="raw-path">~/.codex/config.toml</p>
          {codexLoading ? (
            <p className="settings-memory-desc">loading...</p>
          ) : (
            <textarea
              className="settings-personalization-textarea"
              value={codexConfigToml}
              onChange={(e) => setCodexConfigToml(e.target.value)}
              placeholder="(file not found or empty)"
              style={{ minHeight: "280px" }}
            />
          )}
          <div className="settings-codex-field-row">
            <button
              type="button"
              className="settings-server-btn"
              onClick={() => {
                void window.orxa.app.writeTextFile("~/.codex/config.toml", codexConfigToml)
                  .then(() => setFeedback("config.toml saved"))
                  .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)));
              }}
            >
              save
            </button>
            <button
              type="button"
              className="settings-server-btn"
              onClick={() => {
                void window.orxa.app.readTextFile("~/.codex/config.toml")
                  .then((content) => { setCodexConfigToml(content); setFeedback("config.toml refreshed"); })
                  .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)));
              }}
            >
              refresh
            </button>
          </div>
        </section>
      );
    }

    if (section === "codex-personalization") {
      return (
        <section className="settings-section-card settings-pad settings-server-grid">
          <p className="settings-server-title">codex / personalization</p>

          <p className="settings-server-subtitle">// agent instructions (AGENTS.md)</p>
          <p className="raw-path">~/.codex/AGENTS.md</p>
          {codexLoading ? (
            <p className="settings-memory-desc">loading...</p>
          ) : (
            <textarea
              className="settings-personalization-textarea"
              value={codexAgentsMd}
              onChange={(e) => setCodexAgentsMd(e.target.value)}
              placeholder="(file not found or empty)"
              style={{ minHeight: "280px" }}
            />
          )}
          <div className="settings-codex-field-row">
            <button
              type="button"
              className="settings-server-btn"
              onClick={() => {
                void window.orxa.app.writeTextFile("~/.codex/AGENTS.md", codexAgentsMd)
                  .then(() => setFeedback("AGENTS.md saved"))
                  .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)));
              }}
            >
              save
            </button>
            <button
              type="button"
              className="settings-server-btn"
              onClick={() => {
                void window.orxa.app.readTextFile("~/.codex/AGENTS.md")
                  .then((content) => { setCodexAgentsMd(content); setFeedback("AGENTS.md refreshed"); })
                  .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)));
              }}
            >
              refresh
            </button>
          </div>
        </section>
      );
    }

    if (section === "codex-dirs") {
      return (
        <section className="settings-section-card settings-pad settings-server-grid">
          <p className="settings-server-title">codex / directories</p>

          <p className="settings-server-subtitle">// codex directories</p>
          <div className="settings-claude-dirs">
            <div className="settings-dir-row">
              <span className="settings-server-status-key">~/.codex/memories/</span>
              <button
                type="button"
                className="settings-server-btn"
                onClick={() => void window.orxa.app.revealInFinder("~/.codex/memories")}
              >
                open in finder
              </button>
            </div>
            <div className="settings-dir-row">
              <span className="settings-server-status-key">~/.codex/skills/</span>
              <button
                type="button"
                className="settings-server-btn"
                onClick={() => void window.orxa.app.revealInFinder("~/.codex/skills")}
              >
                open in finder
              </button>
            </div>
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
            <button type="button" className="oc-agents-new-btn" onClick={() => void createOcAgent()}>+ create new agent</button>
            {currentOcAgent ? (
              <button type="button" className="oc-agents-new-btn" onClick={() => void duplicateOcAgent()}>duplicate</button>
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
                <button type="button" className="oc-agents-action-btn oc-agents-action-btn--save" disabled={ocAgentSaving} onClick={() => void saveOcAgent()}>
                  {ocAgentSaving ? "saving..." : "save"}
                </button>
                <button type="button" className="oc-agents-action-btn" onClick={() => void loadOcAgents()}>reload</button>
                <button type="button" className="oc-agents-action-btn oc-agents-action-btn--danger" onClick={() => void deleteOcAgent()}>delete</button>
                <div className="oc-agents-openin-wrap">
                  <button
                    type="button"
                    className="oc-agents-action-btn"
                    onClick={() => setOcOpenInMenu((v) => !v)}
                    disabled={!currentOcAgent}
                  >
                    open in...
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

    return null;
  };

  return (
    <>
      <div className="settings-overlay">
        <section className="settings-center">
          <div className="settings-layout">
            <aside className="settings-sidebar-nav">
              <div className="settings-nav-header">
                <span className="settings-nav-title">settings</span>
                <button type="button" className="settings-close-button" onClick={onClose}>
                  X
                </button>
              </div>
              <div className="settings-nav-list">
                <span className="settings-nav-group-label">ORXA CODE</span>
                <button type="button" className={section === "app" ? "active" : ""} onClick={() => setSection("app")}>
                  {section === "app" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                  App
                </button>
                <button
                  type="button"
                  className={section === "preferences" ? "active" : ""}
                  onClick={() => setSection("preferences")}
                >
                  {section === "preferences" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                  Preferences
                </button>
                <button type="button" className={section === "git" ? "active" : ""} onClick={() => setSection("git")}>
                  {section === "git" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                  Git
                </button>
                <button type="button" className={section === "memory" ? "active" : ""} onClick={() => setSection("memory")}>
                  {section === "memory" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                  Memory
                </button>

                <span className="settings-nav-group-label">OPENCODE</span>
                <button type="button" className={section === "config" ? "active" : ""} onClick={() => setSection("config")}>
                  {section === "config" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                  Config Files
                </button>
                <button type="button" className={section === "provider-models" ? "active" : ""} onClick={() => setSection("provider-models")}>
                  {section === "provider-models" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                  Provider Models
                </button>
                <button type="button" className={section === "opencode-agents" ? "active" : ""} onClick={() => setSection("opencode-agents")}>
                  {section === "opencode-agents" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                  Agents
                </button>
                <button
                  type="button"
                  className={section === "personalization" ? "active" : ""}
                  onClick={() => setSection("personalization")}
                >
                  {section === "personalization" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                  Personalization
                </button>
                <button type="button" className={section === "server" ? "active" : ""} onClick={() => setSection("server")}>
                  {section === "server" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                  Server
                </button>

                <span className="settings-nav-group-label">CLAUDE</span>
                <button type="button" className={section === "claude-config" ? "active" : ""} onClick={() => setSection("claude-config")}>
                  {section === "claude-config" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                  Config
                </button>
                <button type="button" className={section === "claude-personalization" ? "active" : ""} onClick={() => setSection("claude-personalization")}>
                  {section === "claude-personalization" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                  Personalization
                </button>
                <button type="button" className={section === "claude-permissions" ? "active" : ""} onClick={() => setSection("claude-permissions")}>
                  {section === "claude-permissions" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                  Permissions
                </button>
                <button type="button" className={section === "claude-dirs" ? "active" : ""} onClick={() => setSection("claude-dirs")}>
                  {section === "claude-dirs" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                  Directories
                </button>

                <span className="settings-nav-group-label">CODEX</span>
                <button type="button" className={section === "codex-general" ? "active" : ""} onClick={() => setSection("codex-general")}>
                  {section === "codex-general" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                  General
                </button>
                <button type="button" className={section === "codex-models" ? "active" : ""} onClick={() => setSection("codex-models")}>
                  {section === "codex-models" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                  Models
                </button>
                <button type="button" className={section === "codex-access" ? "active" : ""} onClick={() => setSection("codex-access")}>
                  {section === "codex-access" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                  Access
                </button>
                <button type="button" className={section === "codex-config" ? "active" : ""} onClick={() => setSection("codex-config")}>
                  {section === "codex-config" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                  Config
                </button>
                <button type="button" className={section === "codex-personalization" ? "active" : ""} onClick={() => setSection("codex-personalization")}>
                  {section === "codex-personalization" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                  Personalization
                </button>
                <button type="button" className={section === "codex-dirs" ? "active" : ""} onClick={() => setSection("codex-dirs")}>
                  {section === "codex-dirs" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                  Directories
                </button>
              </div>
            </aside>

            <div className="settings-center-body">
              {renderSectionContent()}
              {feedback ? <p className="settings-feedback-inline">{feedback}</p> : null}
            </div>
          </div>
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
              <h2>Edit opencode.json</h2>
              <button type="button" onClick={() => setEditorOpen(false)}>
                Close
              </button>
            </div>
            <div className="raw-editor-body">
              <p className="raw-path">{rawDoc?.path}</p>
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
                    void onReadRaw(effectiveScope, directory).then((next) => {
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
