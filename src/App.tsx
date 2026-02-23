import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { parse as parseJsonc } from "jsonc-parser";
import {
  GitCommitHorizontal,
  Send,
  Upload,
} from "lucide-react";
import type {
  AppMode,
  AgentsDocument,
  ProjectListItem,
  RuntimeProfile,
  RuntimeProfileInput,
  RuntimeState,
  SkillEntry,
  SessionMessageBundle,
} from "@shared/ipc";
import { ComposerPanel } from "./components/ComposerPanel";
import { HomeDashboard } from "./components/HomeDashboard";
import { ContentTopBar } from "./components/ContentTopBar";
import { GlobalModalsHost } from "./components/GlobalModalsHost";
import { MessageFeed } from "./components/MessageFeed";
import { GitSidebar } from "./components/GitSidebar";
import { ProjectDashboard } from "./components/ProjectDashboard";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { TerminalPanel } from "./components/TerminalPanel";
import { JobsBoard } from "./components/JobsBoard";
import { WorkspaceSidebar } from "./components/WorkspaceSidebar";
import { ConfirmDialog, type ConfirmDialogProps } from "./components/ConfirmDialog";
import { TextInputDialog, type TextInputDialogProps } from "./components/TextInputDialog";
import { useJobsScheduler } from "./hooks/useJobsScheduler";
import { SkillsBoard } from "./components/SkillsBoard";
import { useComposerState } from "./hooks/useComposerState";
import { useDashboards } from "./hooks/useDashboards";
import { useGitPanel, type CommitNextStep } from "./hooks/useGitPanel";
import { usePersistedState } from "./hooks/usePersistedState";
import { useWorkspaceState } from "./hooks/useWorkspaceState";
import { findFallbackModel, listAgentOptions, listModelOptions, listModelOptionsFromConfig, type ModelOption } from "./lib/models";
import { preferredAgentForMode } from "./lib/app-mode";
import { opencodeClient } from "./lib/services/opencodeClient";
import type { AppPreferences } from "~/types/app";
import { CODE_FONT_OPTIONS } from "~/types/app";
import antigravityLogo from "./assets/app-icons/antigravity.png";
import cursorLogo from "./assets/app-icons/cursor.png";
import finderLogo from "./assets/app-icons/finder.png";
import ghosttyLogo from "./assets/app-icons/ghostty.png";
import terminalLogo from "./assets/app-icons/terminal.png";
import xcodeLogo from "./assets/app-icons/xcode.png";
import zedLogo from "./assets/app-icons/zed.png";

const INITIAL_RUNTIME: RuntimeState = {
  status: "disconnected",
  managedServer: false,
};

type OpenTarget = "cursor" | "antigravity" | "finder" | "terminal" | "ghostty" | "xcode" | "zed";

const DEFAULT_COMMIT_GUIDANCE_PROMPT = [
  "Write a high-quality conventional commit message.",
  "Use this format:",
  "1) First line: <type>(optional-scope): concise summary in imperative mood.",
  "2) Blank line.",
  "3) Body bullets grouped by area, clearly describing what changed and why.",
  "4) Mention notable side effects, risk, and follow-up work if relevant.",
  "5) Keep it specific to the included diff and avoid generic phrasing.",
].join("\n");

const DEFAULT_APP_PREFERENCES: AppPreferences = {
  showOperationsPane: true,
  autoOpenTerminalOnCreate: true,
  confirmDangerousActions: true,
  commitGuidancePrompt: DEFAULT_COMMIT_GUIDANCE_PROMPT,
  codeFont: "IBM Plex Mono",
};

const APP_PREFERENCES_KEY = "orxa:appPreferences:v1";
const OPEN_TARGET_KEY = "orxa:openTarget:v1";
const SIDEBAR_LEFT_WIDTH_KEY = "orxa:leftPaneWidth:v1";
const SIDEBAR_RIGHT_WIDTH_KEY = "orxa:rightPaneWidth:v1";

type ProjectSortMode = "updated" | "recent" | "alpha-asc" | "alpha-desc";

type OrxaTodoItem = {
  id: string;
  content: string;
  status?: string;
  priority?: string;
};

type OpenTargetOption = {
  id: OpenTarget;
  label: string;
  logo: string;
};

type TextInputDialogState = Omit<TextInputDialogProps, "isOpen" | "onCancel">;

type ConfirmDialogRequest = Omit<ConfirmDialogProps, "isOpen" | "onConfirm" | "onCancel">;

const OPEN_TARGETS: OpenTargetOption[] = [
  { id: "cursor", label: "Cursor", logo: cursorLogo },
  { id: "antigravity", label: "Antigravity", logo: antigravityLogo },
  { id: "finder", label: "Finder", logo: finderLogo },
  { id: "terminal", label: "Terminal", logo: terminalLogo },
  { id: "ghostty", label: "Ghostty", logo: ghosttyLogo },
  { id: "xcode", label: "Xcode", logo: xcodeLogo },
  { id: "zed", label: "Zed", logo: zedLogo },
];

function shouldAutoRenameSessionTitle(title: string | undefined) {
  if (!title) {
    return true;
  }
  const normalized = title.trim().toLowerCase();
  return normalized === "" || normalized === "new session" || normalized === "untitled session";
}

function deriveSessionTitleFromPrompt(prompt: string, maxLength = 56) {
  const cleaned = prompt
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s\-_:,.!?/]/gu, "")
    .trim();
  if (!cleaned) {
    return "New session";
  }
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 3).trimEnd()}...` : cleaned;
}

function parseTodoItemsFromValue(value: unknown): OrxaTodoItem[] {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parseTodoItemsFromValue(parsed);
    } catch {
      return [];
    }
  }

  if (Array.isArray(value)) {
    const items: OrxaTodoItem[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      if (!item || typeof item !== "object") {
        continue;
      }
      const candidate = item as { content?: unknown; status?: unknown; priority?: unknown; id?: unknown };
      const content = typeof candidate.content === "string" ? candidate.content.trim() : "";
      if (!content) {
        continue;
      }
      const status = typeof candidate.status === "string" ? candidate.status : undefined;
      const priority = typeof candidate.priority === "string" ? candidate.priority : undefined;
      const id = typeof candidate.id === "string" && candidate.id.trim().length > 0 ? candidate.id : `${content}:${index}`;
      items.push({ id, content, status, priority });
    }
    return items;
  }

  if (value && typeof value === "object") {
    const candidate = value as { todos?: unknown; items?: unknown };
    if (candidate.todos) {
      return parseTodoItemsFromValue(candidate.todos);
    }
    if (candidate.items) {
      return parseTodoItemsFromValue(candidate.items);
    }
  }

  return [];
}

function extractOrxaTodos(messages: SessionMessageBundle[]) {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const bundle = messages[messageIndex];
    for (let partIndex = bundle.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = bundle.parts[partIndex];
      if (part.type !== "tool" || !part.tool.toLowerCase().includes("todo")) {
        continue;
      }
      const state = part.state as { output?: unknown; input?: unknown };
      const fromOutput = parseTodoItemsFromValue(state.output);
      if (fromOutput.length > 0) {
        return fromOutput;
      }
      const fromInput = parseTodoItemsFromValue(state.input);
      if (fromInput.length > 0) {
        return fromInput;
      }
    }
  }
  return [];
}

export default function App() {
  const [appPreferences, setAppPreferences] = usePersistedState<AppPreferences>(APP_PREFERENCES_KEY, DEFAULT_APP_PREFERENCES, {
    deserialize: (raw) => {
      const parsed = JSON.parse(raw) as Partial<AppPreferences>;
      return {
        ...DEFAULT_APP_PREFERENCES,
        ...parsed,
      };
    },
  });
  const [appMode, setAppMode] = useState<AppMode>("standard");
  const [modeSwitching, setModeSwitching] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeState>(INITIAL_RUNTIME);
  const [profiles, setProfiles] = useState<RuntimeProfile[]>([]);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | undefined>();
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalTabs, setTerminalTabs] = useState<Array<{ id: string; label: string }>>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | undefined>();
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const option = CODE_FONT_OPTIONS.find((o) => o.value === appPreferences.codeFont);
    const stack = option?.stack ?? `"${appPreferences.codeFont}", monospace`;
    document.documentElement.style.setProperty("--code-font", stack);
  }, [appPreferences.codeFont]);
  const [confirmDialogRequest, setConfirmDialogRequest] = useState<ConfirmDialogRequest | null>(null);
  const [, setStatusLine] = useState<string>("Ready");
  const messageCacheRef = useRef<Record<string, SessionMessageBundle[]>>({});
  const projectLastOpenedRef = useRef<Record<string, number>>({});
  const projectLastUpdatedRef = useRef<Record<string, number>>({});
  const {
    sidebarMode,
    setSidebarMode,
    activeProjectDir,
    setActiveProjectDir,
    projectData,
    setProjectData,
    activeSessionID,
    setActiveSessionID,
    messages,
    setMessages,
    contextMenu,
    setContextMenu,
    pinnedSessions,
    collapsedProjects,
    setCollapsedProjects,
    refreshProject,
    selectProject,
    openWorkspaceDashboard,
    refreshMessages,
    selectSession: openSession,
    createSession: createWorkspaceSession,
    queueRefresh,
    startResponsePolling,
    stopResponsePolling,
    togglePinSession,
    openProjectContextMenu,
    openSessionContextMenu,
  } = useWorkspaceState({
    setStatusLine,
    terminalTabIds: terminalTabs.map((t) => t.id),
    setTerminalTabs,
    setActiveTerminalId,
    setTerminalOpen,
    messageCacheRef,
    projectLastOpenedRef,
    projectLastUpdatedRef,
  });
  const [projectSearchOpen, setProjectSearchOpen] = useState(false);
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [projectSortOpen, setProjectSortOpen] = useState(false);
  const [projectSortMode, setProjectSortMode] = useState<ProjectSortMode>("updated");
  const [allSessionsModalOpen, setAllSessionsModalOpen] = useState(false);
  const [projectsSidebarVisible, setProjectsSidebarVisible] = useState(true);
  const [leftPaneWidth, setLeftPaneWidth] = usePersistedState<number>(SIDEBAR_LEFT_WIDTH_KEY, 300, {
    deserialize: (raw) => {
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed >= 280 ? parsed : 300;
    },
    serialize: (value) => String(Math.round(value)),
  });
  const [rightPaneWidth, setRightPaneWidth] = usePersistedState<number>(SIDEBAR_RIGHT_WIDTH_KEY, 340, {
    deserialize: (raw) => {
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed >= 280 ? parsed : 340;
    },
    serialize: (value) => String(Math.round(value)),
  });
  const {
    jobs,
    jobTemplates,
    jobEditorOpen,
    jobDraft,
    jobRuns,
    unreadJobRunsCount,
    jobRunViewer,
    jobRunViewerMessages,
    jobRunViewerLoading,
    openJobEditor,
    closeJobEditor,
    updateJobEditor,
    saveJobEditor,
    removeJob,
    toggleJobEnabled,
    markAllJobRunsRead,
    openJobRunViewer,
    closeJobRunViewer,
  } = useJobsScheduler({
    activeProjectDir,
    onStatus: setStatusLine,
  });
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | undefined>();
  const [skillUseModal, setSkillUseModal] = useState<{ skill: SkillEntry; projectDir: string } | null>(null);
  const [configModelOptions, setConfigModelOptions] = useState<ModelOption[]>([]);
  const [orxaModels, setOrxaModels] = useState<{ orxa?: string; plan?: string }>({});
  const [orxaPrompts, setOrxaPrompts] = useState<{ orxa?: string; plan?: string }>({});
  const [rightSidebarTab, setRightSidebarTab] = useState<"git" | "files">("git");
  const [titleMenuOpen, setTitleMenuOpen] = useState(false);
  const [openMenuOpen, setOpenMenuOpen] = useState(false);
  const [preferredOpenTarget, setPreferredOpenTarget] = usePersistedState<OpenTarget>(OPEN_TARGET_KEY, "finder", {
    deserialize: (raw) => {
      const available = new Set<OpenTarget>(OPEN_TARGETS.map((target) => target.id));
      return available.has(raw as OpenTarget) ? (raw as OpenTarget) : "finder";
    },
    serialize: (value) => value,
  });
  const [commitMenuOpen, setCommitMenuOpen] = useState(false);
  const [todosOpen, setTodosOpen] = useState(false);
  const [permissionDecisionPending, setPermissionDecisionPending] = useState<"once" | "always" | "reject" | null>(null);
  const [textInputDialog, setTextInputDialog] = useState<TextInputDialogState | null>(null);
  const { dashboard, projectDashboard, refreshDashboard, refreshProjectDashboard } = useDashboards(
    projects,
    activeProjectDir ?? null,
    projectData,
  );
  const [agentsDocument, setAgentsDocument] = useState<AgentsDocument | null>(null);
  const [agentsDraft, setAgentsDraft] = useState("");
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsSaving, setAgentsSaving] = useState(false);
  const hasProjectContext = Boolean(activeProjectDir) && sidebarMode === "projects";
  const showProjectsPane = !hasProjectContext || projectsSidebarVisible;
  const showGitPane = hasProjectContext && sidebarMode === "projects" && appPreferences.showOperationsPane;
  const {
    branchState,
    gitPanelTab,
    setGitPanelTab,
    gitDiffViewMode,
    setGitDiffViewMode,
    gitPanelOutput,
    gitDiffStats,
    commitModalOpen,
    setCommitModalOpen,
    commitIncludeUnstaged,
    setCommitIncludeUnstaged,
    commitMessageDraft,
    setCommitMessageDraft,
    commitNextStep,
    setCommitNextStep,
    commitSummary,
    commitSummaryLoading,
    commitSubmitting,
    setCommitSubmitting,
    branchMenuOpen,
    setBranchMenuOpen,
    branchQuery,
    setBranchQuery,
    branchLoading,
    branchSwitching,
    branchCreateModalOpen,
    setBranchCreateModalOpen,
    branchCreateName,
    setBranchCreateName,
    branchCreateError,
    setBranchCreateError,
    loadGitDiff,
    loadGitLog,
    loadGitIssues,
    loadGitPrs,
    stageAllChanges,
    discardAllChanges,
    stageFile,
    restoreFile,
    unstageFile,
    checkoutBranch,
    openBranchCreateModal,
    submitBranchCreate,
  } = useGitPanel(activeProjectDir ?? null);

  const resizeStateRef = useRef<null | {
    side: "left" | "right";
    startX: number;
    startWidth: number;
    latestX: number;
    currentWidth?: number;
    rafId?: number;
  }>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const projectSearchInputRef = useRef<HTMLInputElement | null>(null);
  const branchSearchInputRef = useRef<HTMLInputElement | null>(null);
  const terminalAutoCreateTried = useRef(false);

  const sessions = useMemo(() => {
    if (!projectData) {
      return [];
    }
    const pinned = new Set(pinnedSessions[projectData.directory] ?? []);
    return [...projectData.sessions]
      .filter((item) => !item.time.archived)
      .sort((a, b) => {
        const aPinned = pinned.has(a.id) ? 1 : 0;
        const bPinned = pinned.has(b.id) ? 1 : 0;
        if (aPinned !== bPinned) {
          return bPinned - aPinned;
        }
        return b.time.updated - a.time.updated;
      });
  }, [pinnedSessions, projectData]);

  const availableSlashCommands = useMemo(() => {
    return projectData?.commands ?? [];
  }, [projectData?.commands]);

  const agentOptions = useMemo(() => listAgentOptions(projectData?.agents ?? []), [projectData?.agents]);
  const serverModelOptions = useMemo(
    () => listModelOptions(projectData?.providers ?? { all: [], connected: [], default: {} }),
    [projectData],
  );
  const modelOptions = useMemo(() => {
    const merged = [...serverModelOptions];
    for (const model of configModelOptions) {
      if (!merged.some((item) => item.key === model.key)) {
        merged.push(model);
      }
    }
    return merged.sort((a, b) => a.key.localeCompare(b.key));
  }, [configModelOptions, serverModelOptions]);
  const preferredAgentModel = useMemo(() => {
    if (selectedAgent === "plan") {
      return orxaModels.plan;
    }
    if (selectedAgent === "orxa") {
      return orxaModels.orxa;
    }
    return undefined;
  }, [orxaModels.orxa, orxaModels.plan, selectedAgent]);
  const selectedAgentDefinition = useMemo(
    () => agentOptions.find((agent) => agent.name === selectedAgent),
    [agentOptions, selectedAgent],
  );
  const serverAgentNames = useMemo(() => new Set(agentOptions.map((agent) => agent.name)), [agentOptions]);
  const hasPlanAgent = useMemo(
    () => serverAgentNames.has("plan") || Boolean(orxaModels.plan) || Boolean(orxaPrompts.plan),
    [serverAgentNames, orxaModels.plan, orxaPrompts.plan],
  );
  const hasOrxaAgent = useMemo(
    () => serverAgentNames.has("orxa") || Boolean(orxaModels.orxa) || Boolean(orxaPrompts.orxa),
    [serverAgentNames, orxaModels.orxa, orxaPrompts.orxa],
  );
  const isPlanMode = selectedAgent === "plan";
  const isOrxaMode = appMode === "orxa";
  const composerPlaceholder = isOrxaMode ? "Send message to Orxa" : "Send message";
  const assistantLabel = isOrxaMode ? "Orxa" : "Assistant";
  const todosLabel = isOrxaMode ? "Orxa Todos" : "Todos";
  const modelOptionsForAgent = useMemo(() => {
    if (selectedAgent === "orxa" && orxaModels.orxa) {
      const exact = modelOptions.filter((item) => item.key === orxaModels.orxa);
      return exact.length > 0 ? exact : modelOptions;
    }
    if (selectedAgent === "plan" && orxaModels.plan) {
      const exact = modelOptions.filter((item) => item.key === orxaModels.plan);
      return exact.length > 0 ? exact : modelOptions;
    }
    return modelOptions;
  }, [modelOptions, orxaModels.orxa, orxaModels.plan, selectedAgent]);
  const branchDisplayValue = useMemo(() => {
    if (branchLoading) {
      return "Loading branch...";
    }
    return branchState?.current || "Branch";
  }, [branchLoading, branchState]);
  const branchControlWidthCh = useMemo(() => Math.max(12, Math.min(30, branchDisplayValue.length + 5)), [branchDisplayValue]);
  const filteredBranches = useMemo(() => {
    const query = branchQuery.trim().toLowerCase();
    const branches = branchState?.branches ?? [];
    if (!query) {
      return branches;
    }
    return branches.filter((branch) => branch.toLowerCase().includes(query));
  }, [branchQuery, branchState]);

  const refreshProfiles = useCallback(async () => {
    const [nextRuntime, nextProfiles] = await Promise.all([window.orxa.runtime.getState(), window.orxa.runtime.listProfiles()]);
    setRuntime(nextRuntime);
    setProfiles(nextProfiles);
  }, []);

  const refreshMode = useCallback(async () => {
    const nextMode = await window.orxa.mode.get();
    setAppMode(nextMode);
    return nextMode;
  }, []);

  const refreshOrxaState = useCallback(async () => {
    try {
      const [doc, orxaPrompt, planPrompt] = await Promise.all([
        window.orxa.opencode.readOrxaConfig(),
        window.orxa.opencode.readOrxaAgentPrompt("orxa"),
        window.orxa.opencode.readOrxaAgentPrompt("plan"),
      ]);
      const parsed = parseJsonc(doc.content) as {
        model?: string;
        small_model?: string;
        orxa?: { model?: string };
        plan?: { model?: string };
      };
      setOrxaModels({
        orxa: parsed.orxa?.model ?? parsed.model,
        plan: parsed.plan?.model ?? parsed.small_model,
      });
      setOrxaPrompts({
        orxa: orxaPrompt,
        plan: planPrompt,
      });
    } catch {
      setOrxaModels({});
      setOrxaPrompts({});
    }
  }, []);

  const refreshConfigModels = useCallback(async () => {
    try {
      const doc = await window.orxa.opencode.readRawConfig("global");
      const parsed = parseJsonc(doc.content) as unknown;
      setConfigModelOptions(listModelOptionsFromConfig(parsed));
    } catch {
      setConfigModelOptions([]);
    }
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      const result = await window.orxa.opencode.bootstrap();
      setProjects(result.projects);
      setRuntime(result.runtime);
      if (activeProjectDir && !result.projects.some((item) => item.worktree === activeProjectDir)) {
        setActiveProjectDir(undefined);
        setProjectData(null);
        setActiveSessionID(undefined);
        setMessages([]);
      }
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, [activeProjectDir]);

  const {
    composer,
    setComposer,
    composerAttachments,
    selectedModel,
    setSelectedModel,
    selectedVariant,
    setSelectedVariant,
    selectedModelPayload,
    slashMenuOpen,
    filteredSlashCommands,
    slashSelectedIndex,
    handleComposerChange,
    insertSlashCommand,
    handleSlashKeyDown,
    pickImageAttachment,
    removeAttachment,
    sendPrompt,
    abortActiveSession,
  } = useComposerState(activeProjectDir ?? null, activeSessionID ?? null, {
    availableSlashCommands,
    refreshMessages,
    refreshProject,
    sessions,
    selectedAgent,
    serverAgentNames,
    setStatusLine,
    shouldAutoRenameSessionTitle,
    deriveSessionTitleFromPrompt,
    startResponsePolling,
    stopResponsePolling,
  });

  const modelSelectOptions = useMemo(() => {
    const items = [...modelOptionsForAgent];
    const extras = [preferredAgentModel, selectedModel].filter((value): value is string => Boolean(value));
    for (const key of extras) {
      if (items.some((item) => item.key === key)) {
        continue;
      }
      const [providerID, ...modelParts] = key.split("/");
      const modelID = modelParts.join("/");
      if (!providerID || !modelID) {
        continue;
      }
      items.unshift({
        key,
        providerID,
        modelID,
        providerName: providerID,
        modelName: modelID,
        variants: [],
      });
    }
    return items;
  }, [modelOptionsForAgent, preferredAgentModel, selectedModel]);
  const variantOptions = useMemo(() => {
    const model = modelSelectOptions.find((item) => item.key === selectedModel);
    return model?.variants ?? [];
  }, [selectedModel, modelSelectOptions]);
  const modelDisplayValue = useMemo(() => {
    const selected = modelSelectOptions.find((item) => item.key === selectedModel);
    if (selected) {
      return `${selected.providerName}/${selected.modelName}`;
    }
    return "Model";
  }, [modelSelectOptions, selectedModel]);
  const variantDisplayValue = selectedVariant && selectedVariant.trim().length > 0 ? selectedVariant : "(default)";
  const modelSelectWidthCh = useMemo(() => Math.max(18, Math.min(44, modelDisplayValue.length + 4)), [modelDisplayValue]);
  const variantSelectWidthCh = useMemo(() => Math.max(12, Math.min(24, variantDisplayValue.length + 4)), [variantDisplayValue]);

  useEffect(() => {
    void refreshProfiles()
      .then(async () => {
        const mode = await refreshMode();
        await bootstrap();
        await refreshConfigModels();
        if (mode === "orxa") {
          await refreshOrxaState();
          return;
        }
        setOrxaModels({});
        setOrxaPrompts({});
      })
      .catch((error) => setStatusLine(error instanceof Error ? error.message : String(error)));
  }, [bootstrap, refreshConfigModels, refreshMode, refreshOrxaState, refreshProfiles]);

  useEffect(() => {
    if (!activeSessionID || !activeProjectDir) {
      setMessages([]);
      return;
    }

    void refreshMessages();
  }, [activeProjectDir, activeSessionID, refreshMessages]);

  useEffect(() => {
    const preferredModel = selectedAgentDefinition?.model ?? preferredAgentModel ?? projectData?.config.model;
    const fallback = findFallbackModel(modelSelectOptions, selectedModel ?? preferredModel);
    if (!selectedModel) {
      setSelectedModel(preferredModel ?? fallback?.key);
    } else if (!modelSelectOptions.some((item) => item.key === selectedModel) && preferredModel) {
      setSelectedModel(preferredModel);
    }

    const available = new Set(agentOptions.map((item) => item.name));
    if (hasOrxaAgent) {
      available.add("orxa");
    }
    if (hasPlanAgent) {
      available.add("plan");
    }

    if (!selectedAgent || !available.has(selectedAgent)) {
      const preferred = preferredAgentForMode({
        mode: appMode,
        hasOrxaAgent,
        hasPlanAgent,
        serverAgentNames,
        firstAgentName: agentOptions[0]?.name,
      });
      setSelectedAgent(preferred);
    }
  }, [
    appMode,
    agentOptions,
    hasOrxaAgent,
    hasPlanAgent,
    modelSelectOptions,
    preferredAgentModel,
    projectData?.config.model,
    selectedAgent,
    selectedAgentDefinition?.model,
    selectedModel,
    serverAgentNames,
  ]);

  useEffect(() => {
    const events = window.orxa?.events;
    if (!events) {
      setStatusLine("Desktop bridge unavailable. Restart OrxaCode to reconnect.");
      return;
    }

    const unsubscribe = events.subscribe((event) => {
      if (event.type === "runtime.status") {
        setRuntime(event.payload);
      }

      if (event.type === "runtime.error") {
        setStatusLine(event.payload.message);
      }

      if (event.type === "opencode.global") {
        if (event.payload.event.type === "project.updated" || event.payload.event.type === "global.disposed") {
          void bootstrap();
        }
      }

      if (event.type === "opencode.project") {
        if (event.payload.directory !== activeProjectDir) {
          return;
        }

        const kind = String(event.payload.event.type);
        if (
          kind === "message.created" ||
          kind === "session.created" ||
          kind === "session.updated" ||
          kind === "session.deleted" ||
          kind === "session.status" ||
          kind === "session.idle" ||
          kind === "session.error" ||
          kind === "message.updated" ||
          kind === "message.part.added" ||
          kind === "message.part.created" ||
          kind === "message.part.delta" ||
          kind === "message.part.updated" ||
          kind === "message.part.removed" ||
          kind === "message.removed" ||
          kind === "permission.asked" ||
          kind === "permission.replied" ||
          kind === "question.asked" ||
          kind === "question.replied" ||
          kind === "question.rejected" ||
          kind === "pty.created" ||
          kind === "pty.deleted"
        ) {
          queueRefresh(`Updated from event: ${kind}`);
        }

        if (kind === "session.error") {
          const eventValue = event.payload.event as unknown as { properties?: { error?: { message?: string } } };
          const message = eventValue.properties?.error?.message;
          if (message && message.trim().length > 0) {
            setStatusLine(message);
          }
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [activeProjectDir, bootstrap, queueRefresh]);

  const activeProject = useMemo(() => projects.find((item) => item.worktree === activeProjectDir), [projects, activeProjectDir]);

  const filteredProjects = useMemo(() => {
    const query = projectSearchQuery.trim().toLowerCase();
    const filtered = projects.filter((project) => {
      const name = (project.name || project.worktree.split("/").at(-1) || project.worktree).toLowerCase();
      return query ? name.includes(query) : true;
    });
    const withIndex = filtered.map((project, index) => ({ project, index }));
    withIndex.sort((left, right) => {
      const leftName = left.project.name || left.project.worktree.split("/").at(-1) || left.project.worktree;
      const rightName = right.project.name || right.project.worktree.split("/").at(-1) || right.project.worktree;
      if (projectSortMode === "alpha-asc") {
        return leftName.localeCompare(rightName);
      }
      if (projectSortMode === "alpha-desc") {
        return rightName.localeCompare(leftName);
      }
      if (projectSortMode === "recent") {
        const leftTime = projectLastOpenedRef.current[left.project.worktree] ?? 0;
        const rightTime = projectLastOpenedRef.current[right.project.worktree] ?? 0;
        if (rightTime !== leftTime) {
          return rightTime - leftTime;
        }
      }
      if (projectSortMode === "updated") {
        const leftTime = projectLastUpdatedRef.current[left.project.worktree] ?? 0;
        const rightTime = projectLastUpdatedRef.current[right.project.worktree] ?? 0;
        if (rightTime !== leftTime) {
          return rightTime - leftTime;
        }
      }
      return left.index - right.index;
    });
    return withIndex.map((item) => item.project);
  }, [projectSearchQuery, projectSortMode, projects]);
  const getSessionStatusType = useCallback(
    (sessionID: string, directory?: string) => {
      if (!directory || !projectData || projectData.directory !== directory) {
        return "idle";
      }
      return projectData.sessionStatus[sessionID]?.type ?? "idle";
    },
    [projectData],
  );

  const refreshAgentsDocument = useCallback(
    async (directory?: string) => {
      const targetDirectory = directory ?? activeProjectDir;
      if (!targetDirectory) {
        setAgentsDocument(null);
        setAgentsDraft("");
        return;
      }
      try {
        setAgentsLoading(true);
        const doc = await window.orxa.opencode.readAgentsMd(targetDirectory);
        setAgentsDocument(doc);
        setAgentsDraft(doc.content);
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
      } finally {
        setAgentsLoading(false);
      }
    },
    [activeProjectDir],
  );

  const createAgentsDocument = useCallback(async () => {
    if (!activeProjectDir) {
      return;
    }
    const projectLabel = activeProject?.name || activeProjectDir.split("/").at(-1) || "Workspace";
    const template = [
      `# ${projectLabel} - Agent Instructions`,
      "",
      "## Scope",
      "- Work only inside this repository unless explicitly told otherwise.",
      "- Prefer minimal, safe changes that are easy to review.",
      "",
      "## Quality",
      "- Run relevant tests after changes.",
      "- Explain what changed, why, and how it was verified.",
      "",
      "## Notes",
      "- Add workspace-specific conventions and workflows here.",
      "",
    ].join("\n");
    try {
      setAgentsSaving(true);
      const doc = await window.orxa.opencode.writeAgentsMd(activeProjectDir, template);
      setAgentsDocument(doc);
      setAgentsDraft(doc.content);
      setStatusLine("AGENTS.md created");
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    } finally {
      setAgentsSaving(false);
    }
  }, [activeProject?.name, activeProjectDir]);

  const saveAgentsDocument = useCallback(async () => {
    if (!activeProjectDir) {
      return;
    }
    try {
      setAgentsSaving(true);
      const doc = await window.orxa.opencode.writeAgentsMd(activeProjectDir, agentsDraft);
      setAgentsDocument(doc);
      setAgentsDraft(doc.content);
      setStatusLine("AGENTS.md saved");
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    } finally {
      setAgentsSaving(false);
    }
  }, [activeProjectDir, agentsDraft]);

  useEffect(() => {
    if (activeProjectDir) {
      return;
    }
    void refreshDashboard();
  }, [activeProjectDir, refreshDashboard]);

  useEffect(() => {
    if (!activeProjectDir || activeSessionID) {
      return;
    }
    void refreshProjectDashboard();
    void refreshAgentsDocument(activeProjectDir);
  }, [activeProjectDir, activeSessionID, refreshAgentsDocument, refreshProjectDashboard]);

  useEffect(() => {
    if (activeProjectDir && !activeSessionID) {
      return;
    }
    setAgentsDocument(null);
    setAgentsDraft("");
  }, [activeProjectDir, activeSessionID]);

  const createSession = useCallback(
    async (directory?: string, initialPrompt?: string) => {
      await createWorkspaceSession(directory, initialPrompt, {
        selectedAgent,
        selectedModelPayload,
        selectedVariant,
        serverAgentNames,
      });
    },
    [createWorkspaceSession, selectedAgent, selectedModelPayload, selectedVariant, serverAgentNames],
  );

  const addProjectDirectory = useCallback(async (options?: { select?: boolean }) => {
    try {
      const result = await opencodeClient.addProjectDirectory();
      if (!result) {
        return undefined;
      }
      const directory = result.directory;
      await bootstrap();
      if (options?.select !== false) {
        await selectProject(directory);
      }
      setStatusLine(`Workspace added: ${directory}`);
      return directory;
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
      return undefined;
    }
  }, [bootstrap, selectProject]);

  const loadSkills = useCallback(async () => {
    try {
      setSkillsLoading(true);
      setSkillsError(undefined);
      const entries = await window.orxa.opencode.listSkills();
      setSkills(entries);
    } catch (error) {
      setSkillsError(error instanceof Error ? error.message : String(error));
    } finally {
      setSkillsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sidebarMode !== "skills") {
      return;
    }
    void loadSkills();
  }, [loadSkills, sidebarMode]);

  const openSkillUseModal = useCallback(
    (skill: SkillEntry) => {
      setSkillUseModal({
        skill,
        projectDir: activeProjectDir ?? projects[0]?.worktree ?? "",
      });
    },
    [activeProjectDir, projects],
  );

  const applySkillToProject = useCallback(
    async (skill: SkillEntry, targetProjectDir: string) => {
      const project = projects.find((item) => item.worktree === targetProjectDir);
      if (!project) {
        setStatusLine("Select a valid workspace");
        return;
      }
      const seedPrompt = [
        `Use skill: ${skill.name}`,
        "",
        skill.description,
        "",
        `Skill path: ${skill.path}`,
        "",
        "Apply this skill to the current task and ask clarifying questions if needed.",
      ].join("\n");

      await selectProject(targetProjectDir);
      const latest = await opencodeClient.refreshProject(targetProjectDir);
      setProjectData(latest);
      const session = [...latest.sessions]
        .filter((item) => !item.time.archived)
        .sort((left, right) => right.time.updated - left.time.updated)[0];
      if (session) {
        setActiveSessionID(session.id);
        const msgs = await opencodeClient.loadMessages(targetProjectDir, session.id).catch(() => []);
        messageCacheRef.current[`${targetProjectDir}:${session.id}`] = msgs;
        setMessages(msgs);
      } else {
        const created = await opencodeClient.createSession(targetProjectDir, `Skill: ${skill.name}`);
        setActiveSessionID(created.id);
        setMessages([]);
      }
      setComposer(seedPrompt);
      setSidebarMode("projects");
      setSkillUseModal(null);
      setStatusLine(`Prepared skill prompt for ${project.name || project.worktree.split("/").at(-1) || project.worktree}`);
    },
    [projects, selectProject],
  );

  useEffect(() => {
    if (!projectSearchOpen) {
      return;
    }
    projectSearchInputRef.current?.focus();
  }, [projectSearchOpen]);

  useEffect(() => {
    setAllSessionsModalOpen(false);
  }, [activeProjectDir]);

  const requestConfirmation = useCallback((request: ConfirmDialogRequest) => {
    return new Promise<boolean>((resolve) => {
      setConfirmDialogRequest(request);
      confirmDialogResolverRef.current = resolve;
    });
  }, []);

  const confirmDialogResolverRef = useRef<((value: boolean) => void) | null>(null);

  const closeConfirmDialog = useCallback((confirmed: boolean) => {
    const resolver = confirmDialogResolverRef.current;
    confirmDialogResolverRef.current = null;
    setConfirmDialogRequest(null);
    resolver?.(confirmed);
  }, []);

  const removeProjectDirectory = useCallback(
    async (directory: string, label: string) => {
      try {
        const confirmed = await requestConfirmation({
          title: "Remove workspace",
          message: `Remove "${label}" from OrxaCode workspace list?`,
          confirmLabel: "Remove",
          cancelLabel: "Cancel",
          variant: "danger",
        });
        if (!confirmed) {
          return;
        }
        await opencodeClient.removeProjectDirectory(directory);
        if (activeProjectDir === directory) {
          setActiveProjectDir(undefined);
          setProjectData(null);
          setActiveSessionID(undefined);
          setMessages([]);
          setTerminalTabs([]);
          setActiveTerminalId(undefined);
          setTerminalOpen(false);
        }
        await bootstrap();
        setStatusLine(`Removed workspace: ${label}`);
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
      }
    },
    [activeProjectDir, bootstrap, requestConfirmation],
  );

  const renameSession = useCallback(
    (directory: string, sessionID: string, currentTitle: string) => {
      setTextInputDialog({
        title: "Rename session",
        defaultValue: currentTitle,
        placeholder: "Session title",
        confirmLabel: "Rename",
        validate: (value) => {
          if (!value.trim()) {
            return "Session title is required";
          }
          return null;
        },
        onConfirm: async (value) => {
          const nextTitle = value.trim();
          if (nextTitle === currentTitle) {
            return;
          }
          try {
            await window.orxa.opencode.renameSession(directory, sessionID, nextTitle);
            await refreshProject(directory);
            setStatusLine("Session renamed");
          } catch (error) {
            setStatusLine(error instanceof Error ? error.message : String(error));
          }
        },
      });
    },
    [refreshProject],
  );

  const archiveSession = useCallback(
    async (directory: string, sessionID: string) => {
      try {
        await window.orxa.opencode.archiveSession(directory, sessionID);
        const next = await refreshProject(directory);
        if (sessionID === activeSessionID) {
          const sorted = [...next.sessions].filter((item) => !item.time.archived).sort((a, b) => b.time.updated - a.time.updated);
          setActiveSessionID(sorted[0]?.id);
        }
        setStatusLine("Session archived");
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
      }
    },
    [activeSessionID, refreshProject],
  );

  const copySessionID = useCallback(async (sessionID: string) => {
    try {
      await navigator.clipboard.writeText(sessionID);
      setStatusLine("Session ID copied");
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const copyProjectPath = useCallback(async (directory: string) => {
    try {
      await navigator.clipboard.writeText(directory);
      setStatusLine("Workspace path copied");
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const createWorktreeSession = useCallback(
    (directory: string, sessionID: string, currentTitle: string) => {
      const suggested = currentTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32);
      setTextInputDialog({
        title: "New worktree name",
        defaultValue: suggested || "feature",
        placeholder: "feature/my-worktree",
        confirmLabel: "Create",
        validate: (value) => {
          if (!value.trim()) {
            return "Worktree name is required";
          }
          return null;
        },
        onConfirm: async (value) => {
          const nameInput = value.trim();
          if (!nameInput) {
            return;
          }

          try {
            const result = await window.orxa.opencode.createWorktreeSession(directory, sessionID, nameInput || undefined);
            await bootstrap();
            await selectProject(result.worktree.directory);
            setActiveSessionID(result.session.id);
            setStatusLine(`Worktree session created: ${result.worktree.name}`);
          } catch (error) {
            setStatusLine(error instanceof Error ? error.message : String(error));
          }
        },
      });
    },
    [bootstrap, selectProject],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      setTitleMenuOpen(false);
      setOpenMenuOpen(false);
      setCommitMenuOpen(false);
      setProjectSearchOpen(false);
      setProjectSortOpen(false);
      setBranchMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }
      const insideTopMenus =
        target.closest(".titlebar-split") ||
        target.closest(".title-overflow-button") ||
        target.closest(".title-overflow-menu");
      if (!insideTopMenus) {
        setOpenMenuOpen(false);
        setCommitMenuOpen(false);
        setTitleMenuOpen(false);
      }
      if (!target.closest(".project-search-popover") && !target.closest(".pane-action-icon")) {
        setProjectSearchOpen(false);
      }
      if (!target.closest(".project-sort-popover") && !target.closest(".pane-action-icon")) {
        setProjectSortOpen(false);
      }
      if (!target.closest(".composer-branch-wrap")) {
        setBranchMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, []);

  const startSidebarResize = useCallback((side: "left" | "right", event: ReactMouseEvent) => {
    event.preventDefault();
    const startWidth = side === "left" ? leftPaneWidth : rightPaneWidth;
    document.body.classList.add("is-resizing");
    resizeStateRef.current = { side, startX: event.clientX, startWidth, latestX: event.clientX };
  }, [leftPaneWidth, rightPaneWidth]);

  const MIN_LEFT_PANE_WIDTH = 280;
  const MAX_LEFT_PANE_WIDTH = 520;

  useEffect(() => {
    const onMouseMove = (event: globalThis.MouseEvent) => {
      const state = resizeStateRef.current;
      if (!state) {
        return;
      }
      state.latestX = event.clientX;
      if (state.rafId !== undefined) {
        return;
      }
      state.rafId = requestAnimationFrame(() => {
        const s = resizeStateRef.current;
        if (!s) {
          return;
        }
        s.rafId = undefined;
        const el = workspaceRef.current;
        if (s.side === "left") {
          const next = Math.max(MIN_LEFT_PANE_WIDTH, Math.min(MAX_LEFT_PANE_WIDTH, s.startWidth + (s.latestX - s.startX)));
          el?.style.setProperty("--left-pane-width", `${next}px`);
          document.documentElement.style.setProperty("--left-pane-width", `${next}px`);
          s.currentWidth = next;
        } else {
          const workspaceWidth = el?.offsetWidth ?? window.innerWidth;
          const leftWidth = parseFloat(document.documentElement.style.getPropertyValue("--left-pane-width") || "300");
          const leftVisible = parseFloat(document.documentElement.style.getPropertyValue("--left-pane-visible") || "1");
          const leftActual = leftWidth * leftVisible;
          const leftResizer = 4 * leftVisible;
          const maxRight = Math.floor(workspaceWidth - leftActual - leftResizer - 4 - workspaceWidth * 0.2);
          const next = Math.max(280, Math.min(Math.max(280, maxRight), s.startWidth - (s.latestX - s.startX)));
          el?.style.setProperty("--right-pane-width", `${next}px`);
          s.currentWidth = next;
        }
      });
    };
    const onMouseUp = () => {
      const state = resizeStateRef.current;
      document.body.classList.remove("is-resizing");
      if (state?.rafId !== undefined) {
        cancelAnimationFrame(state.rafId);
      }
      if (state?.currentWidth !== undefined) {
        if (state.side === "left") {
          setLeftPaneWidth(state.currentWidth);
        } else {
          setRightPaneWidth(state.currentWidth);
        }
      }
      resizeStateRef.current = null;
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useEffect(() => {
    setTitleMenuOpen(false);
    setOpenMenuOpen(false);
    setCommitMenuOpen(false);
    setBranchMenuOpen(false);
  }, [activeProjectDir, activeSessionID]);

  useEffect(() => {
    if (!branchMenuOpen) {
      return;
    }
    window.setTimeout(() => {
      branchSearchInputRef.current?.focus();
    }, 0);
  }, [branchMenuOpen]);

  const togglePlanMode = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        if (hasPlanAgent) {
          setSelectedAgent("plan");
          if (orxaModels.plan) {
            setSelectedModel(orxaModels.plan);
          }
        }
        return;
      }
      if (appMode === "orxa" && hasOrxaAgent) {
        setSelectedAgent("orxa");
        if (orxaModels.orxa) {
          setSelectedModel(orxaModels.orxa);
        }
        return;
      }
      const nonPlanAgent = agentOptions.find((a) => a.name !== "plan" && a.name !== "orxa");
      setSelectedAgent(nonPlanAgent?.name ?? agentOptions.find((a) => a.name !== "plan")?.name ?? agentOptions[0]?.name);
    },
    [agentOptions, appMode, hasOrxaAgent, hasPlanAgent, orxaModels.orxa, orxaModels.plan],
  );

  const activeSession = useMemo(
    () => sessions.find((item) => item.id === activeSessionID),
    [activeSessionID, sessions],
  );
  const currentSessionStatus = activeSessionID ? projectData?.sessionStatus[activeSessionID] : undefined;
  const isSessionBusy = currentSessionStatus?.type === "busy" || currentSessionStatus?.type === "retry";
  const showingProjectDashboard = Boolean(activeProjectDir && !activeSessionID);
  const contentPaneTitle = showingProjectDashboard
    ? activeProject?.name || activeProjectDir?.split("/").at(-1) || "No workspace selected"
    : activeSession?.title?.trim() || activeSession?.slug || activeProject?.name || "Untitled session";
  const isActiveSessionPinned = Boolean(
    activeProjectDir && activeSessionID && (pinnedSessions[activeProjectDir] ?? []).includes(activeSessionID),
  );
  const orxaTodos = useMemo(() => extractOrxaTodos(messages), [messages]);
  const pendingPermission = useMemo(() => (projectData?.permissions ?? [])[0], [projectData?.permissions]);
  const pendingQuestion = useMemo(() => (projectData?.questions ?? [])[0] ?? null, [projectData?.questions]);
  const workspaceClassName = [
    "workspace",
    showGitPane ? "" : "workspace-no-ops",
    showProjectsPane ? "" : "workspace-left-collapsed",
    showGitPane ? "" : "workspace-right-collapsed",
  ]
    .filter(Boolean)
    .join(" ");
  const isDiffContentView =
    hasProjectContext && rightSidebarTab === "git" && gitPanelTab === "diff" && gitDiffViewMode !== "list";
  const effectiveRightPaneWidth = isDiffContentView ? Math.max(rightPaneWidth, 520) : rightPaneWidth;
  const workspaceStyle = useMemo(
    () =>
      ({
        "--left-pane-visible": showProjectsPane ? 1 : 0,
        "--right-pane-visible": showGitPane ? 1 : 0,
      }) as CSSProperties,
    [showGitPane, showProjectsPane],
  );

  useLayoutEffect(() => {
    if (!resizeStateRef.current) {
      workspaceRef.current?.style.setProperty("--left-pane-width", `${leftPaneWidth}px`);
      document.documentElement.style.setProperty("--left-pane-width", `${leftPaneWidth}px`);
    }
  }, [leftPaneWidth]);

  useLayoutEffect(() => {
    if (!resizeStateRef.current) {
      workspaceRef.current?.style.setProperty("--right-pane-width", `${effectiveRightPaneWidth}px`);
    }
  }, [effectiveRightPaneWidth]);

  useEffect(() => {
    document.documentElement.style.setProperty("--left-pane-visible", showProjectsPane ? "1" : "0");
  }, [showProjectsPane]);

  useEffect(() => {
    setTodosOpen(false);
  }, [activeSessionID]);

  const createTerminal = useCallback(async () => {
    if (!activeProjectDir) {
      return;
    }

    const cwd = projectData?.path.directory ?? activeProjectDir;
    try {
      const tabNum = terminalTabs.length + 1;
      const pty = await window.orxa.terminal.create(activeProjectDir, cwd, `Tab ${tabNum}`);
      const newTab = { id: pty.id, label: `Tab ${tabNum}` };
      setTerminalTabs((prev) => [...prev, newTab]);
      setActiveTerminalId(pty.id);
      setTerminalOpen(true);
      setStatusLine("Terminal created");
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, [activeProjectDir, projectData?.path.directory, terminalTabs.length]);

  const toggleTerminal = useCallback(async () => {
    if (terminalOpen) {
      setTerminalOpen(false);
      return;
    }
    if (!activeProjectDir) {
      return;
    }
    if (terminalTabs.length === 0) {
      await createTerminal();
      return;
    }
    setTerminalOpen(true);
  }, [activeProjectDir, createTerminal, terminalOpen, terminalTabs.length]);

  const closeTerminalTab = useCallback(
    async (ptyId: string) => {
      if (!activeProjectDir) return;
      await window.orxa.terminal.close(activeProjectDir, ptyId).catch(() => undefined);
      setTerminalTabs((prev) => {
        const remaining = prev.filter((t) => t.id !== ptyId);
        if (activeTerminalId === ptyId) {
          setActiveTerminalId(remaining[remaining.length - 1]?.id);
        }
        if (remaining.length === 0) {
          setTerminalOpen(false);
        }
        return remaining;
      });
    },
    [activeProjectDir, activeTerminalId],
  );

  const replyPendingPermission = useCallback(
    async (reply: "once" | "always" | "reject") => {
      if (!activeProjectDir || !pendingPermission) {
        return;
      }
      if (reply === "reject" && appPreferences.confirmDangerousActions) {
        const confirmed = await requestConfirmation({
          title: "Reject permission request",
          message: "Reject this permission request?",
          confirmLabel: "Reject",
          cancelLabel: "Cancel",
          variant: "danger",
        });
        if (!confirmed) {
          return;
        }
      }
      try {
        setPermissionDecisionPending(reply);
        await window.orxa.opencode.replyPermission(activeProjectDir, pendingPermission.id, reply);
        await refreshProject(activeProjectDir);
        setStatusLine(`Permission ${reply === "reject" ? "rejected" : "approved"}`);
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
      } finally {
        setPermissionDecisionPending(null);
      }
    },
    [activeProjectDir, appPreferences.confirmDangerousActions, pendingPermission, refreshProject, requestConfirmation],
  );

  const replyPendingQuestion = useCallback(
    async (answer: string) => {
      if (!activeProjectDir || !pendingQuestion) {
        return;
      }
      const trimmed = answer.trim();
      if (!trimmed) {
        return;
      }
      try {
        const answers = [[trimmed]] as unknown as Parameters<typeof window.orxa.opencode.replyQuestion>[2];
        await window.orxa.opencode.replyQuestion(activeProjectDir, pendingQuestion.id, answers);
        await refreshProject(activeProjectDir);
        setStatusLine("Question answered");
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
      }
    },
    [activeProjectDir, pendingQuestion, refreshProject],
  );

  const rejectPendingQuestion = useCallback(async () => {
    if (!activeProjectDir || !pendingQuestion) {
      return;
    }
    if (appPreferences.confirmDangerousActions) {
      const confirmed = await requestConfirmation({
        title: "Reject question request",
        message: "Reject this question request?",
        confirmLabel: "Reject",
        cancelLabel: "Cancel",
        variant: "danger",
      });
      if (!confirmed) {
        return;
      }
    }
    try {
      await window.orxa.opencode.rejectQuestion(activeProjectDir, pendingQuestion.id);
      await refreshProject(activeProjectDir);
      setStatusLine("Question rejected");
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, [activeProjectDir, appPreferences.confirmDangerousActions, pendingQuestion, refreshProject, requestConfirmation]);

  useEffect(() => {
    if (!terminalOpen || !activeProjectDir) {
      terminalAutoCreateTried.current = false;
      return;
    }

    if (terminalTabs.length > 0) {
      terminalAutoCreateTried.current = false;
      return;
    }

    if (terminalAutoCreateTried.current) {
      return;
    }

    terminalAutoCreateTried.current = true;
    void createTerminal();
  }, [activeProjectDir, createTerminal, terminalOpen, terminalTabs.length]);

  const openDirectoryInTarget = useCallback(
    async (target: OpenTarget) => {
      if (!activeProjectDir) {
        return;
      }
      setPreferredOpenTarget(target);
      try {
        const result = await window.orxa.opencode.openDirectoryIn(activeProjectDir, target);
        setStatusLine(result.detail);
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
      } finally {
        setOpenMenuOpen(false);
      }
    },
    [activeProjectDir],
  );

  const openCommitModal = useCallback(
    (nextStep?: CommitNextStep) => {
      if (!activeProjectDir) {
        return;
      }
      if (nextStep) {
        setCommitNextStep(nextStep);
      }
      setCommitModalOpen(true);
      setCommitMenuOpen(false);
    },
    [activeProjectDir],
  );

  const submitCommit = useCallback(async () => {
    if (!activeProjectDir) {
      return;
    }
    try {
      setCommitSubmitting(true);
      const result = await window.orxa.opencode.gitCommit(activeProjectDir, {
        includeUnstaged: commitIncludeUnstaged,
        message: commitMessageDraft.trim().length > 0 ? commitMessageDraft.trim() : undefined,
        guidancePrompt: appPreferences.commitGuidancePrompt,
        nextStep: commitNextStep,
      });
      setCommitModalOpen(false);
      setCommitMessageDraft("");
      const prSuffix = result.prUrl ? ` • PR ${result.prUrl}` : "";
      const pushSuffix = result.pushed ? " • pushed" : "";
      setStatusLine(`Committed ${result.commitHash.slice(0, 7)}${pushSuffix}${prSuffix}`);
      await refreshProject(activeProjectDir);
      if (rightSidebarTab === "git") {
        void loadGitDiff();
      }
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    } finally {
      setCommitSubmitting(false);
    }
  }, [
    activeProjectDir,
    appPreferences.commitGuidancePrompt,
    commitIncludeUnstaged,
    commitMessageDraft,
    commitNextStep,
    loadGitDiff,
    rightSidebarTab,
    refreshProject,
  ]);

  const appendPathToComposer = useCallback((filePath: string) => {
    setComposer((current) => (current.trim().length > 0 ? `${current}\n${filePath}` : filePath));
  }, []);

  useEffect(() => {
    if (!activeProjectDir) {
      setRightSidebarTab("git");
      return;
    }
  }, [activeProjectDir]);

  useEffect(() => {
    if (!activeProjectDir || rightSidebarTab !== "git") {
      return;
    }
    if (gitPanelTab === "diff") {
      void loadGitDiff();
      return;
    }
    if (gitPanelTab === "log") {
      void loadGitLog();
      return;
    }
    if (gitPanelTab === "issues") {
      void loadGitIssues();
      return;
    }
    void loadGitPrs();
  }, [activeProjectDir, gitPanelTab, loadGitDiff, loadGitIssues, loadGitLog, loadGitPrs, rightSidebarTab]);

  const openTargets = OPEN_TARGETS;
  const activeOpenTarget = openTargets.find((target) => target.id === preferredOpenTarget) ?? openTargets[2]!;

  const commitNextStepOptions: Array<{ id: CommitNextStep; label: string; icon: ReactNode }> = [
    { id: "commit", label: "Commit", icon: <GitCommitHorizontal size={14} aria-hidden="true" /> },
    { id: "commit_and_push", label: "Commit and push", icon: <Upload size={14} aria-hidden="true" /> },
    { id: "commit_and_create_pr", label: "Create PR", icon: <Send size={14} aria-hidden="true" /> },
  ];

  return (
    <div className="app-shell">
      <div className="window-drag-region" />
      {hasProjectContext ? (
        <ContentTopBar
          projectsPaneVisible={showProjectsPane}
          toggleProjectsPane={() => setProjectsSidebarVisible(!showProjectsPane)}
          showGitPane={showGitPane}
          setGitPaneVisible={(visible) =>
            setAppPreferences((current) => ({
              ...current,
              showOperationsPane: visible,
            }))
          }
          gitDiffStats={gitDiffStats}
          contentPaneTitle={contentPaneTitle}
          showingProjectDashboard={showingProjectDashboard}
          activeProjectDir={activeProjectDir ?? null}
          projectData={projectData}
          terminalOpen={terminalOpen}
          toggleTerminal={toggleTerminal}
          titleMenuOpen={titleMenuOpen}
          openMenuOpen={openMenuOpen}
          setOpenMenuOpen={setOpenMenuOpen}
          commitMenuOpen={commitMenuOpen}
          setCommitMenuOpen={setCommitMenuOpen}
          setTitleMenuOpen={setTitleMenuOpen}
          hasActiveSession={Boolean(activeSessionID)}
          isActiveSessionPinned={isActiveSessionPinned}
          onTogglePinSession={() => {
            if (!activeProjectDir || !activeSessionID) {
              return;
            }
            const nextPinned = !isActiveSessionPinned;
            togglePinSession(activeProjectDir, activeSessionID);
            setStatusLine(nextPinned ? "Session pinned" : "Session unpinned");
            setTitleMenuOpen(false);
          }}
          onRenameSession={() => {
            if (!activeProjectDir || !activeSessionID || !activeSession) {
              return;
            }
            setTitleMenuOpen(false);
            void renameSession(activeProjectDir, activeSessionID, activeSession.title || activeSession.slug);
          }}
          onArchiveSession={() => {
            if (!activeProjectDir || !activeSessionID) {
              return;
            }
            setTitleMenuOpen(false);
            void archiveSession(activeProjectDir, activeSessionID);
          }}
          onCopyPath={() => {
            if (!activeProjectDir) {
              return;
            }
            setTitleMenuOpen(false);
            void copyProjectPath(activeProjectDir);
          }}
          onCopySessionId={() => {
            if (!activeSessionID) {
              return;
            }
            setTitleMenuOpen(false);
            void copySessionID(activeSessionID);
          }}
          activeOpenTarget={activeOpenTarget}
          openTargets={openTargets}
          openDirectoryInTarget={openDirectoryInTarget}
          openCommitModal={openCommitModal}
          commitNextStepOptions={commitNextStepOptions}
          setCommitNextStep={setCommitNextStep}
        />
      ) : null}
      <div ref={workspaceRef} className={workspaceClassName} style={workspaceStyle}>
        <div className={`workspace-left-pane ${showProjectsPane ? "open" : "collapsed"}`.trim()}>
          <WorkspaceSidebar
            appMode={appMode}
            setAppMode={setAppMode}
            sidebarMode={sidebarMode}
            setSidebarMode={setSidebarMode}
            unreadJobRunsCount={unreadJobRunsCount}
            openWorkspaceDashboard={openWorkspaceDashboard}
            projectSearchOpen={projectSearchOpen}
            setProjectSearchOpen={setProjectSearchOpen}
            projectSortOpen={projectSortOpen}
            setProjectSortOpen={setProjectSortOpen}
            projectSortMode={projectSortMode}
            setProjectSortMode={setProjectSortMode}
            projectSearchInputRef={projectSearchInputRef}
            projectSearchQuery={projectSearchQuery}
            setProjectSearchQuery={setProjectSearchQuery}
            filteredProjects={filteredProjects}
            activeProjectDir={activeProjectDir}
            collapsedProjects={collapsedProjects}
            setCollapsedProjects={setCollapsedProjects}
            sessions={sessions}
            activeSessionID={activeSessionID ?? undefined}
            setAllSessionsModalOpen={setAllSessionsModalOpen}
            getSessionStatusType={getSessionStatusType}
            selectProject={selectProject}
            createSession={createSession}
            openSession={openSession}
            openProjectContextMenu={openProjectContextMenu}
            openSessionContextMenu={openSessionContextMenu}
            addProjectDirectory={() => addProjectDirectory()}
            openJobEditor={() => openJobEditor()}
            loadSkills={loadSkills}
            setProfileModalOpen={setProfileModalOpen}
            setSettingsOpen={setSettingsOpen}
          />
        </div>
        <button
          type="button"
          className={`sidebar-resizer sidebar-resizer-left ${showProjectsPane ? "" : "is-collapsed"}`.trim()}
          aria-label="Resize workspaces sidebar"
          onMouseDown={(event) => startSidebarResize("left", event)}
          disabled={!showProjectsPane}
        />

        <main className={`content-pane ${activeProjectDir ? "" : "content-pane-dashboard"}`.trim()}>
          {sidebarMode === "jobs" ? (
            <JobsBoard
              templates={jobTemplates}
              jobs={jobs}
              runs={jobRuns}
              unreadRuns={unreadJobRunsCount}
              projects={projects}
              onNewJob={() => openJobEditor()}
              onUseTemplate={(template) => openJobEditor(template)}
              onDeleteJob={removeJob}
              onToggleEnabled={toggleJobEnabled}
              onOpenRun={(runID) => void openJobRunViewer(runID)}
              onMarkAllRunsRead={markAllJobRunsRead}
            />
          ) : sidebarMode === "skills" ? (
            <SkillsBoard
              skills={skills}
              loading={skillsLoading}
              error={skillsError}
              onRefresh={() => void loadSkills()}
              onUseSkill={openSkillUseModal}
            />
          ) : activeProjectDir ? (
            <>
              {!showingProjectDashboard ? (
                <>
                  <MessageFeed
                    messages={messages}
                    showAssistantPlaceholder={isSessionBusy}
                    assistantLabel={assistantLabel}
                  />

                  {orxaTodos.length > 0 ? (
                    <section className={`todos-drawer ${todosOpen ? "open" : "closed"}`.trim()}>
                      <button type="button" className="todos-drawer-toggle" onClick={() => setTodosOpen((value) => !value)}>
                        <span>{todosLabel}</span>
                        <small>{orxaTodos.length}</small>
                      </button>
                      {todosOpen ? (
                        <div className="todos-drawer-body">
                          <ul>
                            {orxaTodos.map((todo) => (
                              <li key={todo.id}>
                                <span>{todo.content}</span>
                                {todo.status || todo.priority ? (
                                  <small>
                                    {[todo.status, todo.priority].filter(Boolean).join(" • ")}
                                  </small>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </section>
                  ) : null}

                  <ComposerPanel
                    composer={composer}
                    setComposer={handleComposerChange}
                    composerAttachments={composerAttachments}
                    removeAttachment={removeAttachment}
                    slashMenuOpen={slashMenuOpen}
                    filteredSlashCommands={filteredSlashCommands}
                    slashSelectedIndex={slashSelectedIndex}
                    insertSlashCommand={insertSlashCommand}
                    handleSlashKeyDown={handleSlashKeyDown}
                    sendPrompt={sendPrompt}
                    abortActiveSession={abortActiveSession}
                    isSessionBusy={isSessionBusy}
                    pickImageAttachment={pickImageAttachment}
                    hasActiveSession={Boolean(activeSessionID)}
                    isPlanMode={isPlanMode}
                    hasPlanAgent={hasPlanAgent}
                    togglePlanMode={togglePlanMode}
                    branchMenuOpen={branchMenuOpen}
                    setBranchMenuOpen={setBranchMenuOpen}
                    branchControlWidthCh={branchControlWidthCh}
                    branchLoading={branchLoading}
                    branchSwitching={branchSwitching}
                    hasActiveProject={Boolean(activeProjectDir)}
                    branchCurrent={branchState?.current}
                    branchDisplayValue={branchDisplayValue}
                    branchSearchInputRef={branchSearchInputRef}
                    branchQuery={branchQuery}
                    setBranchQuery={setBranchQuery}
                    checkoutBranch={checkoutBranch}
                    filteredBranches={filteredBranches}
                    openBranchCreateModal={openBranchCreateModal}
                    modelSelectOptions={modelSelectOptions}
                    selectedModel={selectedModel}
                    setSelectedModel={setSelectedModel}
                    modelSelectWidthCh={modelSelectWidthCh}
                    selectedVariant={selectedVariant}
                    setSelectedVariant={setSelectedVariant}
                    variantOptions={variantOptions}
                    variantSelectWidthCh={variantSelectWidthCh}
                    placeholder={composerPlaceholder}
                  />

                </>
              ) : (
                <ProjectDashboard
                  loading={projectDashboard.loading}
                  sessionCount={projectDashboard.sessionCount}
                  sessions7d={projectDashboard.sessions7d}
                  sessions30d={projectDashboard.sessions30d}
                  tokenInput30d={projectDashboard.tokenInput30d}
                  tokenOutput30d={projectDashboard.tokenOutput30d}
                  tokenCacheRead30d={projectDashboard.tokenCacheRead30d}
                  totalCost30d={projectDashboard.totalCost30d}
                  topModels={projectDashboard.topModels}
                  updatedAt={projectDashboard.updatedAt}
                  error={projectDashboard.error}
                  agentsDocument={agentsDocument}
                  agentsDraft={agentsDraft}
                  agentsLoading={agentsLoading}
                  agentsSaving={agentsSaving}
                  onAgentsDraftChange={setAgentsDraft}
                  onCreateAgents={() => void createAgentsDocument()}
                  onSaveAgents={() => void saveAgentsDocument()}
                  onRefreshAgents={() => void refreshAgentsDocument()}
                  onRefresh={() => void refreshProjectDashboard()}
                />
              )}
              <TerminalPanel
                directory={activeProjectDir}
                tabs={terminalTabs}
                activeTabId={activeTerminalId}
                open={terminalOpen}
                onCreateTab={createTerminal}
                onCloseTab={closeTerminalTab}
                onSwitchTab={setActiveTerminalId}
              />
            </>
          ) : (
            <HomeDashboard
              loading={dashboard.loading}
              projects={dashboard.projects}
              sessions7d={dashboard.sessions7d}
              sessions30d={dashboard.sessions30d}
              providersConnected={dashboard.providersConnected}
              topModels={dashboard.topModels}
              tokenInput30d={dashboard.tokenInput30d}
              tokenOutput30d={dashboard.tokenOutput30d}
              tokenCacheRead30d={dashboard.tokenCacheRead30d}
              totalCost30d={dashboard.totalCost30d}
              recentSessions={dashboard.recentSessions}
              daySeries={dashboard.daySeries}
              updatedAt={dashboard.updatedAt}
              error={dashboard.error}
              onRefresh={() => void refreshDashboard()}
              onAddWorkspace={() => void addProjectDirectory()}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          )}
        </main>
        {hasProjectContext ? (
          <button
            type="button"
            className={`sidebar-resizer sidebar-resizer-right ${showGitPane ? "" : "is-collapsed"}`.trim()}
            aria-label="Resize git sidebar"
            onMouseDown={(event) => startSidebarResize("right", event)}
            disabled={!showGitPane}
          />
        ) : null}
        {hasProjectContext ? (
          <div className={`workspace-right-pane ${showGitPane ? "open" : "collapsed"}`.trim()}>
            <GitSidebar
              sidebarPanelTab={rightSidebarTab}
              setSidebarPanelTab={setRightSidebarTab}
              gitPanelTab={gitPanelTab}
              setGitPanelTab={setGitPanelTab}
              gitDiffViewMode={gitDiffViewMode}
              setGitDiffViewMode={setGitDiffViewMode}
              gitPanelOutput={gitPanelOutput}
              branchState={branchState}
              branchQuery={branchQuery}
              setBranchQuery={setBranchQuery}
              activeProjectDir={activeProjectDir ?? null}
              onLoadGitDiff={loadGitDiff}
              onLoadGitLog={loadGitLog}
              onLoadGitIssues={loadGitIssues}
              onLoadGitPrs={loadGitPrs}
              onStageAllChanges={stageAllChanges}
              onDiscardAllChanges={discardAllChanges}
              onStageFile={stageFile}
              onRestoreFile={restoreFile}
              onUnstageFile={unstageFile}
              onAddToChatPath={appendPathToComposer}
              onStatusChange={setStatusLine}
            />
          </div>
        ) : null}
      </div>

      {contextMenu ? (
        <div className="context-menu-overlay" onClick={() => setContextMenu(null)} onContextMenu={(event) => event.preventDefault()}>
          <div
            className="context-menu"
            style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
            onClick={(event) => event.stopPropagation()}
          >
            {contextMenu.kind === "project" ? (
              <>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    const { directory, label } = contextMenu;
                    setContextMenu(null);
                    void removeProjectDirectory(directory, label);
                  }}
                >
                  Delete
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const { directory, sessionID } = contextMenu;
                    setContextMenu(null);
                    void archiveSession(directory, sessionID);
                  }}
                >
                  Archive Session
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const { sessionID } = contextMenu;
                    setContextMenu(null);
                    void copySessionID(sessionID);
                  }}
                >
                  Copy Session ID
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const { directory, sessionID, title } = contextMenu;
                    setContextMenu(null);
                    void createWorktreeSession(directory, sessionID, title);
                  }}
                >
                  Create Worktree Session
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const { directory, sessionID, title } = contextMenu;
                    setContextMenu(null);
                    void renameSession(directory, sessionID, title);
                  }}
                >
                  Rename Session
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        isOpen={Boolean(confirmDialogRequest)}
        title={confirmDialogRequest?.title ?? "Confirm"}
        message={confirmDialogRequest?.message ?? "Are you sure?"}
        confirmLabel={confirmDialogRequest?.confirmLabel}
        cancelLabel={confirmDialogRequest?.cancelLabel}
        variant={confirmDialogRequest?.variant}
        onConfirm={() => closeConfirmDialog(true)}
        onCancel={() => closeConfirmDialog(false)}
      />

      <TextInputDialog
        isOpen={Boolean(textInputDialog)}
        title={textInputDialog?.title ?? ""}
        placeholder={textInputDialog?.placeholder}
        defaultValue={textInputDialog?.defaultValue}
        confirmLabel={textInputDialog?.confirmLabel}
        cancelLabel={textInputDialog?.cancelLabel}
        validate={textInputDialog?.validate}
        onConfirm={(value) => {
          const dialog = textInputDialog;
          if (!dialog) {
            return;
          }
          setTextInputDialog(null);
          void Promise.resolve(dialog.onConfirm(value));
        }}
        onCancel={() => setTextInputDialog(null)}
      />

      <GlobalModalsHost
        activeProjectDir={activeProjectDir}
        permissionRequest={pendingPermission ?? null}
        permissionDecisionPending={permissionDecisionPending}
        replyPermission={replyPendingPermission}
        questionRequest={pendingQuestion}
        replyQuestion={replyPendingQuestion}
        rejectQuestion={rejectPendingQuestion}
        allSessionsModalOpen={allSessionsModalOpen}
        setAllSessionsModalOpen={setAllSessionsModalOpen}
        sessions={sessions}
        getSessionStatusType={getSessionStatusType}
        activeSessionID={activeSessionID}
        openSession={openSession}
        jobRunViewer={jobRunViewer}
        closeJobRunViewer={closeJobRunViewer}
        projects={projects}
        jobRunViewerLoading={jobRunViewerLoading}
        jobRunViewerMessages={jobRunViewerMessages}
        branchCreateModalOpen={branchCreateModalOpen}
        setBranchCreateModalOpen={setBranchCreateModalOpen}
        branchCreateName={branchCreateName}
        setBranchCreateName={setBranchCreateName}
        branchCreateError={branchCreateError}
        setBranchCreateError={setBranchCreateError}
        submitBranchCreate={submitBranchCreate}
        branchSwitching={branchSwitching}
        commitModalOpen={commitModalOpen}
        setCommitModalOpen={setCommitModalOpen}
        commitSummary={commitSummary}
        commitSummaryLoading={commitSummaryLoading}
        commitIncludeUnstaged={commitIncludeUnstaged}
        setCommitIncludeUnstaged={setCommitIncludeUnstaged}
        commitMessageDraft={commitMessageDraft}
        setCommitMessageDraft={setCommitMessageDraft}
        commitNextStepOptions={commitNextStepOptions}
        commitNextStep={commitNextStep}
        setCommitNextStep={setCommitNextStep}
        commitSubmitting={commitSubmitting}
        submitCommit={submitCommit}
        jobEditorOpen={jobEditorOpen}
        jobDraft={jobDraft}
        closeJobEditor={closeJobEditor}
        updateJobEditor={updateJobEditor}
        saveJobEditor={saveJobEditor}
        addProjectDirectory={addProjectDirectory}
        skillUseModal={skillUseModal}
        setSkillUseModal={setSkillUseModal}
        applySkillToProject={applySkillToProject}
        profileModalOpen={profileModalOpen}
        setProfileModalOpen={setProfileModalOpen}
        profiles={profiles}
        runtime={runtime}
        onSaveProfile={async (profile: RuntimeProfileInput) => {
          await window.orxa.runtime.saveProfile(profile);
          await refreshProfiles();
          setStatusLine("Profile saved");
        }}
        onDeleteProfile={async (profileID) => {
          await window.orxa.runtime.deleteProfile(profileID);
          await refreshProfiles();
          setStatusLine("Profile deleted");
        }}
        onAttachProfile={async (profileID) => {
          await window.orxa.runtime.attach(profileID);
          await refreshProfiles();
          await bootstrap();
          setStatusLine("Attached to server");
        }}
        onStartLocalProfile={async (profileID) => {
          await window.orxa.runtime.startLocal(profileID);
          await refreshProfiles();
          await bootstrap();
          setStatusLine("Local server started");
        }}
        onStopLocalProfile={async () => {
          await window.orxa.runtime.stopLocal();
          await refreshProfiles();
          setStatusLine("Local server stopped");
        }}
      />

      <SettingsDrawer
        open={settingsOpen}
        mode={appMode}
        modeSwitching={modeSwitching}
        directory={activeProjectDir}
        onClose={() => setSettingsOpen(false)}
        onReadRaw={(scope, directory) => window.orxa.opencode.readRawConfig(scope, directory)}
        onWriteRaw={async (scope, content, directory) => {
          const doc = await window.orxa.opencode.writeRawConfig(scope, content, directory);
          if (scope === "global") {
            await refreshConfigModels();
          }
          if (directory) {
            await refreshProject(directory);
          }
          setStatusLine("Raw config saved");
          return doc;
        }}
        onReadOrxa={() => window.orxa.opencode.readOrxaConfig()}
        onWriteOrxa={async (content) => {
          const doc = await window.orxa.opencode.writeOrxaConfig(content);
          setStatusLine("Orxa config saved");
          await Promise.all([refreshOrxaState(), refreshConfigModels()]);
          await bootstrap();
          return doc;
        }}
        onChangeMode={async (nextMode) => {
          try {
            setModeSwitching(true);
            const applied = await window.orxa.mode.set(nextMode);
            setAppMode(applied);
            await bootstrap();
            await refreshConfigModels();
            if (applied === "orxa") {
              await refreshOrxaState();
            } else {
              setOrxaModels({});
              setOrxaPrompts({});
            }
            setStatusLine(`Mode switched to ${applied === "orxa" ? "Orxa" : "Standard"}`);
          } finally {
            setModeSwitching(false);
          }
        }}
        onListOrxaAgents={() => window.orxa.opencode.listOrxaAgents()}
        onSaveOrxaAgent={async (input) => {
          const saved = await window.orxa.opencode.saveOrxaAgent(input);
          await refreshOrxaState();
          setStatusLine(`Saved agent ${saved.name}`);
          return saved;
        }}
        appPreferences={appPreferences}
        onAppPreferencesChange={setAppPreferences}
        onGetServerDiagnostics={() => window.orxa.opencode.getServerDiagnostics()}
        onRepairRuntime={() => window.orxa.opencode.repairRuntime()}
        onGetOrxaAgentDetails={(name) => window.orxa.opencode.getOrxaAgentDetails(name)}
        onResetOrxaAgent={(name) => window.orxa.opencode.resetOrxaAgent(name)}
        onRestoreOrxaAgentHistory={(name, historyID) => window.orxa.opencode.restoreOrxaAgentHistory(name, historyID)}
      />
    </div>
  );
}
