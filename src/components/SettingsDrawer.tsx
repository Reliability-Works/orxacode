import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type {
  AgentsDocument,
  CodexDoctorResult,
  CodexModelEntry,
  CodexUpdateResult,
  OpenCodeAgentFile,
  RawConfigDocument,
  RuntimeProfile,
  RuntimeProfileInput,
  RuntimeState,
  ServerDiagnostics,
  UpdatePreferences,
} from "@shared/ipc";
import type { ModelOption } from "../lib/models";
import type { AppPreferences } from "~/types/app";
import { readPersistedValue, writePersistedValue } from "../lib/persistence";
import {
  AppearanceSection,
  AppSettingsSection,
  ConfigSection,
  GitSettingsSection,
  PersonalizationSection,
  PreferencesSection,
  ServerSection,
} from "./settings-drawer/core-sections";
import {
  ClaudeConfigSection,
  ClaudeDirsSection,
  ClaudePermissionsSection,
  ClaudePersonalizationSection,
} from "./settings-drawer/claude-sections";
import {
  CodexAccessSection,
  CodexConfigSection,
  CodexDirsSection,
  CodexGeneralSection,
  CodexModelsSection,
  CodexPersonalizationSection,
} from "./settings-drawer/codex-sections";
import type { OcAgentFilenameDialog } from "./settings-drawer/opencode-agents-section";
import { OpenCodeAgentsSection } from "./settings-drawer/opencode-agents-section";
import { ProviderModelsSection } from "./settings-drawer/provider-models-section";

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
  allModelOptions: ModelOption[];
  profiles: RuntimeProfile[];
  runtime: RuntimeState;
  onSaveProfile: (profile: RuntimeProfileInput) => Promise<void>;
  onDeleteProfile: (profileID: string) => Promise<void>;
  onAttachProfile: (profileID: string) => Promise<void>;
  onStartLocalProfile: (profileID: string) => Promise<void>;
  onStopLocalProfile: () => Promise<void>;
  onRefreshProfiles: () => Promise<void>;
};

type SettingsSection =
  | "config"
  | "provider-models"
  | "opencode-agents"
  | "personalization"
  | "git"
  | "app"
  | "appearance"
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
  allModelOptions,
  profiles,
  runtime,
  onSaveProfile,
  onDeleteProfile,
  onAttachProfile,
  onStartLocalProfile,
  onStopLocalProfile,
  onRefreshProfiles,
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
      const raw = readPersistedValue(UPDATE_CHECK_STATUS_KEY);
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
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
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
      writePersistedValue(UPDATE_CHECK_STATUS_KEY, JSON.stringify(status));
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
      const [raw, globalAgents, diagnostics, updaterPrefs] = await Promise.all([
        onReadRaw(effectiveScope, directory),
        onReadGlobalAgentsMd(),
        onGetServerDiagnostics(),
        onGetUpdatePreferences(),
      ]);
      setRawDoc(raw);
      setRawText(raw.content);
      setGlobalAgentsDoc(globalAgents);
      setGlobalAgentsText(globalAgents.content);
      setUpdatePreferences(updaterPrefs);
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
      return (
        <AppSettingsSection
          appPreferences={appPreferences}
          onAppPreferencesChange={onAppPreferencesChange}
          updatePreferences={updatePreferences}
          onSetUpdatePreferences={onSetUpdatePreferences}
          checkingForUpdates={checkingForUpdates}
          setCheckingForUpdates={setCheckingForUpdates}
          onCheckForUpdates={onCheckForUpdates}
          updateUpdateCheckStatus={updateUpdateCheckStatus}
          setFeedback={setFeedback}
          updateCheckStatus={updateCheckStatus}
          formatUpdateCheckStatus={formatUpdateCheckStatus}
          setUpdatePreferences={setUpdatePreferences}
          appVersion={appVersion}
        />
      );
    }

    if (section === "appearance") {
      return <AppearanceSection appPreferences={appPreferences} onAppPreferencesChange={onAppPreferencesChange} />;
    }

    if (section === "git") {
      return <GitSettingsSection appPreferences={appPreferences} onAppPreferencesChange={onAppPreferencesChange} />;
    }

    if (section === "personalization") {
      return (
        <PersonalizationSection
          globalAgentsDoc={globalAgentsDoc}
          globalAgentsText={globalAgentsText}
          setGlobalAgentsText={setGlobalAgentsText}
          onWriteGlobalAgentsMd={onWriteGlobalAgentsMd}
          onReadGlobalAgentsMd={onReadGlobalAgentsMd}
          setGlobalAgentsDoc={setGlobalAgentsDoc}
          setFeedback={setFeedback}
        />
      );
    }

    if (section === "preferences") {
      return <PreferencesSection appPreferences={appPreferences} onAppPreferencesChange={onAppPreferencesChange} />;
    }

    if (section === "server") {
      return (
        <ServerSection
          serverDiagnostics={serverDiagnostics}
          onGetServerDiagnostics={onGetServerDiagnostics}
          onRepairRuntime={onRepairRuntime}
          setServerDiagnostics={setServerDiagnostics}
          setFeedback={setFeedback}
          profiles={profiles}
          runtime={runtime}
          onSaveProfile={onSaveProfile}
          onDeleteProfile={onDeleteProfile}
          onAttachProfile={onAttachProfile}
          onStartLocalProfile={onStartLocalProfile}
          onStopLocalProfile={onStopLocalProfile}
          onRefreshProfiles={onRefreshProfiles}
        />
      );
    }

    if (section === "config") {
      return (
        <ConfigSection
          effectiveScope={effectiveScope}
          directory={directory}
          setScope={setScope}
          openEditor={openEditor}
          rawDoc={rawDoc}
          rawText={rawText}
          setRawText={setRawText}
          onWriteRaw={onWriteRaw}
          setRawDoc={setRawDoc}
          setFeedback={setFeedback}
          onReadRaw={onReadRaw}
        />
      );
    }

    if (section === "provider-models") {
      return (
        <ProviderModelsSection
          allModelOptions={allModelOptions}
          appPreferences={appPreferences}
          onAppPreferencesChange={onAppPreferencesChange}
          collapsedProviders={collapsedProviders}
          setCollapsedProviders={setCollapsedProviders}
        />
      );
    }

    if (section === "claude-config") {
      return (
        <ClaudeConfigSection
          claudeLoading={claudeLoading}
          claudeSettingsJson={claudeSettingsJson}
          setClaudeSettingsJson={setClaudeSettingsJson}
          setFeedback={setFeedback}
        />
      );
    }

    if (section === "claude-personalization") {
      return (
        <ClaudePersonalizationSection
          claudeLoading={claudeLoading}
          claudeMd={claudeMd}
          setClaudeMd={setClaudeMd}
          setFeedback={setFeedback}
        />
      );
    }

    if (section === "claude-permissions") {
      return <ClaudePermissionsSection appPreferences={appPreferences} onAppPreferencesChange={onAppPreferencesChange} />;
    }

    if (section === "claude-dirs") {
      return <ClaudeDirsSection />;
    }

    if (section === "codex-general") {
      return (
        <CodexGeneralSection
          appPreferences={appPreferences}
          onAppPreferencesChange={onAppPreferencesChange}
          codexState={codexState}
          codexDoctorRunning={codexDoctorRunning}
          setCodexDoctorRunning={setCodexDoctorRunning}
          codexDoctorResult={codexDoctorResult}
          setCodexDoctorResult={setCodexDoctorResult}
          codexUpdateRunning={codexUpdateRunning}
          setCodexUpdateRunning={setCodexUpdateRunning}
          codexUpdateResult={codexUpdateResult}
          setCodexUpdateResult={setCodexUpdateResult}
          setFeedback={setFeedback}
        />
      );
    }

    if (section === "codex-models") {
      return (
        <CodexModelsSection
          appPreferences={appPreferences}
          onAppPreferencesChange={onAppPreferencesChange}
          codexModels={codexModels}
          codexModelsLoading={codexModelsLoading}
          setCodexModelsLoading={setCodexModelsLoading}
          setCodexModels={setCodexModels}
          setFeedback={setFeedback}
        />
      );
    }

    if (section === "codex-access") {
      return <CodexAccessSection appPreferences={appPreferences} onAppPreferencesChange={onAppPreferencesChange} />;
    }

    if (section === "codex-config") {
      return (
        <CodexConfigSection
          codexLoading={codexLoading}
          codexConfigToml={codexConfigToml}
          setCodexConfigToml={setCodexConfigToml}
          setFeedback={setFeedback}
        />
      );
    }

    if (section === "codex-personalization") {
      return (
        <CodexPersonalizationSection
          codexLoading={codexLoading}
          codexAgentsMd={codexAgentsMd}
          setCodexAgentsMd={setCodexAgentsMd}
          setFeedback={setFeedback}
        />
      );
    }

    if (section === "codex-dirs") {
      return <CodexDirsSection />;
    }

    if (section === "opencode-agents") {
      return (
        <OpenCodeAgentsSection
          ocAgents={ocAgents}
          selectedOcAgent={selectedOcAgent}
          setSelectedOcAgent={setSelectedOcAgent}
          ocAgentDraft={ocAgentDraft}
          setOcAgentDraft={setOcAgentDraft}
          ocAgentSaving={ocAgentSaving}
          setOcAgentSaving={setOcAgentSaving}
          ocOpenInMenu={ocOpenInMenu}
          setOcOpenInMenu={setOcOpenInMenu}
          setFeedback={setFeedback}
          loadOcAgents={loadOcAgents}
          setOcFilenameDialog={setOcFilenameDialog}
          setOcFilenameValue={setOcFilenameValue}
          setOcFilenameError={setOcFilenameError}
        />
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
                <button type="button" className="settings-back-button" onClick={onClose}>
                  <ArrowLeft size={14} aria-hidden="true" />
                  <span>Back to app</span>
                </button>
              </div>
              <div className="settings-nav-list">
                <span
                  className={`settings-nav-group-label${collapsedGroups.orxa ? " collapsed" : ""}`}
                  onClick={() => setCollapsedGroups((prev) => ({ ...prev, orxa: !prev.orxa }))}
                >
                  ORXA CODE
                </span>
                {!collapsedGroups.orxa ? (
                  <>
                    <button type="button" className={section === "app" ? "active" : ""} onClick={() => setSection("app")}>
                      {section === "app" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                      App
                    </button>
                    <button type="button" className={section === "appearance" ? "active" : ""} onClick={() => setSection("appearance")}>
                      {section === "appearance" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                      Appearance
                    </button>
                    <button type="button" className={section === "preferences" ? "active" : ""} onClick={() => setSection("preferences")}>
                      {section === "preferences" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                      Preferences
                    </button>
                    <button type="button" className={section === "git" ? "active" : ""} onClick={() => setSection("git")}>
                      {section === "git" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                      Git
                    </button>
                  </>
                ) : null}

                <span
                  className={`settings-nav-group-label${collapsedGroups.opencode ? " collapsed" : ""}`}
                  onClick={() => setCollapsedGroups((prev) => ({ ...prev, opencode: !prev.opencode }))}
                >
                  OPENCODE
                </span>
                {!collapsedGroups.opencode ? (
                  <>
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
                    <button type="button" className={section === "personalization" ? "active" : ""} onClick={() => setSection("personalization")}>
                      {section === "personalization" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                      Personalization
                    </button>
                    <button type="button" className={section === "server" ? "active" : ""} onClick={() => setSection("server")}>
                      {section === "server" ? <span className="settings-nav-chevron" aria-hidden="true">&gt;</span> : null}
                      Server
                    </button>
                  </>
                ) : null}

                <span
                  className={`settings-nav-group-label${collapsedGroups.claude ? " collapsed" : ""}`}
                  onClick={() => setCollapsedGroups((prev) => ({ ...prev, claude: !prev.claude }))}
                >
                  CLAUDE
                </span>
                {!collapsedGroups.claude ? (
                  <>
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
                  </>
                ) : null}

                <span
                  className={`settings-nav-group-label${collapsedGroups.codex ? " collapsed" : ""}`}
                  onClick={() => setCollapsedGroups((prev) => ({ ...prev, codex: !prev.codex }))}
                >
                  CODEX
                </span>
                {!collapsedGroups.codex ? (
                  <>
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
                  </>
                ) : null}
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
