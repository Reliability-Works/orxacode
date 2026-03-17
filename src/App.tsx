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
  AgentsDocument,
  ChangeProvenanceRecord,
  MemoryBackfillStatus,
  MemoryGraphSnapshot,
  ProjectListItem,
  RuntimeProfile,
  RuntimeProfileInput,
  RuntimeDependencyReport,
  RuntimeState,
  SkillEntry,
  SessionMessageBundle,
  BrowserHistoryItem,
  BrowserState,
  OrxaEvent,
  McpDevToolsServerState,
  ProviderUsageStats,
} from "@shared/ipc";
import type { ProviderListResponse, QuestionAnswer } from "@opencode-ai/sdk/v2/client";
import { CanvasPane } from "./components/CanvasPane";
import { ClaudeTerminalPane } from "./components/ClaudeTerminalPane";
import { CodexPane } from "./components/CodexPane";
import { ComposerPanel } from "./components/ComposerPanel";
import type { TodoItem } from "./components/chat/TodoDock";
import type { AgentQuestion } from "./components/chat/QuestionDock";
import { HomeDashboard } from "./components/HomeDashboard";
import { ContentTopBar, type CustomRunCommandInput, type CustomRunCommandPreset } from "./components/ContentTopBar";
import { GlobalModalsHost } from "./components/GlobalModalsHost";
import type { SkillPromptTarget } from "./components/GlobalModalsHost";
import { MessageFeed } from "./components/MessageFeed";
import { GitSidebar, type BrowserControlOwner } from "./components/GitSidebar";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { TerminalPanel } from "./components/TerminalPanel";
import { JobsBoard } from "./components/JobsBoard";
import { WorkspaceSidebar } from "./components/WorkspaceSidebar";
import { MemoryBoard } from "./components/MemoryBoard";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { TextInputDialog } from "./components/TextInputDialog";
import { useJobsScheduler } from "./hooks/useJobsScheduler";
import { SkillsBoard } from "./components/SkillsBoard";
import { useAppShellCommitFlow } from "./hooks/useAppShellCommitFlow";
import { useAppShellDialogs } from "./hooks/useAppShellDialogs";
import { useAppShellSessionFeedNotices } from "./hooks/useAppShellSessionFeedNotices";
import { useAppShellStartupFlow } from "./hooks/useAppShellStartupFlow";
import { useAppShellToasts } from "./hooks/useAppShellToasts";
import { useAppShellUpdateFlow } from "./hooks/useAppShellUpdateFlow";
import { useCanvasState } from "./hooks/useCanvasState";
import { useComposerState } from "./hooks/useComposerState";
import { useDashboards } from "./hooks/useDashboards";
import { useGitPanel, type CommitNextStep } from "./hooks/useGitPanel";
import { usePersistedState } from "./hooks/usePersistedState";
import { useBrowserAgentBridge } from "./hooks/useBrowserAgentBridge";
import { useWorkspaceState } from "./hooks/useWorkspaceState";
import {
  filterHiddenModelOptions,
  findFallbackModel,
  listAgentOptions,
  listModelOptions,
  listModelOptionsFromConfigReferences,
  mergeDiscoverableModelOptions,
  type ModelOption,
} from "./lib/models";
import { preferredAgentForMode } from "./lib/app-mode";
import {
  BROWSER_MODE_TOOLS_POLICY,
  BROWSER_MODE_TOOLS_POLICY_WITH_MCP,
  PLAN_MODE_TOOLS_POLICY,
  mergeModeToolPolicies,
} from "./lib/browser-tool-guardrails";
import {
  DEFAULT_BROWSER_LANDING_URL,
  EMPTY_BROWSER_RUNTIME_STATE,
  buildBrowserAutopilotHint,
  deriveSessionTitleFromPrompt,
  formatMemoryGraphError,
  isRecoverableSessionError,
  shouldAutoRenameSessionTitle,
  toneForStatusLine,
} from "./lib/app-session-utils";
import {
  buildAppShellBrowserSidebarState,
  buildAppShellHomeDashboardProps,
  deriveAppShellWorkspaceLayout,
} from "./lib/app-shell-view-models";
import { opencodeClient } from "./lib/services/opencodeClient";
import type { AppPreferences } from "~/types/app";
import type { SessionType } from "~/types/canvas";
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
  permissionMode: "ask-write",
  commitGuidancePrompt: DEFAULT_COMMIT_GUIDANCE_PROMPT,
  codeFont: "IBM Plex Mono",
  hiddenModels: [],
  codexPath: "",
  codexArgs: "",
  codexDefaultModel: "",
  codexReasoningEffort: "medium",
  codexAccessMode: "on-request",
  gitAgent: "opencode",
  notifyOnAwaitingInput: true,
  notifyOnTaskComplete: true,
  collaborationModesEnabled: true,
  subagentSystemNotificationsEnabled: true,
};

const APP_PREFERENCES_KEY = "orxa:appPreferences:v1";
const OPEN_TARGET_KEY = "orxa:openTarget:v1";
const SIDEBAR_LEFT_WIDTH_KEY = "orxa:leftPaneWidth:v1";
const SIDEBAR_RIGHT_WIDTH_KEY = "orxa:rightPaneWidth:v1";
const AGENT_MODEL_PREFS_KEY = "orxa:agentModelPrefs:v1";
const CUSTOM_RUN_COMMANDS_KEY = "orxa:customRunCommands:v1";
const SESSION_TYPES_KEY = "orxa:sessionTypes:v1";
const SESSION_TITLES_KEY = "orxa:sessionTitles:v1";
const DEFAULT_COMPOSER_LAYOUT_HEIGHT = 132;
const COMPOSER_DRAWER_ATTACH_OFFSET = 12;

type ProjectSortMode = "updated" | "recent" | "alpha-asc" | "alpha-desc";

type OrxaTodoItem = {
  id: string;
  content: string;
  status?: string;
  priority?: string;
};

const COMPLETED_TODO_STATUSES = new Set(["completed", "complete", "done", "finished", "success", "succeeded"]);

type OpenTargetOption = {
  id: OpenTarget;
  label: string;
  logo: string;
};

type DebugLogLevel = "info" | "warn" | "error";

type DebugLogEntry = {
  id: string;
  time: number;
  level: DebugLogLevel;
  eventType: string;
  summary: string;
  details?: string;
};

const OPEN_TARGETS: OpenTargetOption[] = [
  { id: "cursor", label: "cursor", logo: cursorLogo },
  { id: "antigravity", label: "antigravity", logo: antigravityLogo },
  { id: "finder", label: "finder", logo: finderLogo },
  { id: "terminal", label: "terminal", logo: terminalLogo },
  { id: "ghostty", label: "ghostty", logo: ghosttyLogo },
  { id: "xcode", label: "xcode", logo: xcodeLogo },
  { id: "zed", label: "zed", logo: zedLogo },
];

function commitFlowRunningMessage(nextStep: CommitNextStep) {
  if (nextStep === "commit_and_push") {
    return "Committing changes and pushing";
  }
  if (nextStep === "commit_and_create_pr") {
    return "Creating Pull Request";
  }
  return "Committing changes";
}

function commitFlowSuccessMessage(nextStep: CommitNextStep) {
  if (nextStep === "commit_and_push") {
    return "Changes committed and pushed";
  }
  if (nextStep === "commit_and_create_pr") {
    return "Pull request created";
  }
  return "Changes committed";
}
const DEFAULT_COMPACTION_THRESHOLD = 120_000;
const MIN_COMPACTION_THRESHOLD = 24_000;
const PERMISSION_REPLY_TIMEOUT_MS = 15_000;
const BROWSER_MODE_BY_SESSION_KEY = "orxa:browserModeBySession:v1";
const BROWSER_AUTOMATION_HALTED_BY_SESSION_KEY = "orxa:browserAutomationHaltedBySession:v1";
const STARTUP_TOTAL_STEPS = 8;
const STARTUP_STEP_TIMEOUT_MS = 12_000;

function toDebugLogFromEvent(event: OrxaEvent): Omit<DebugLogEntry, "id" | "time"> {
  const stringifyDetails = (value: unknown) => {
    if (value === undefined) {
      return undefined;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  if (event.type === "runtime.error") {
    return {
      level: "error",
      eventType: "runtime.error",
      summary: event.payload.message || "Runtime error",
      details: stringifyDetails(event.payload),
    };
  }

  if (event.type === "updater.telemetry") {
    const phase = event.payload.phase;
    const level: DebugLogLevel = phase === "check.error" ? "error" : "info";
    const summary = phase === "check.error"
      ? `Updater check failed${event.payload.message ? `: ${event.payload.message}` : ""}`
      : `Updater event: ${phase}`;
    return {
      level,
      eventType: `updater.${phase}`,
      summary,
      details: stringifyDetails(event.payload),
    };
  }

  if (event.type === "opencode.project") {
    const streamType = String(event.payload.event.type ?? "project.event");
    const properties = event.payload.event.properties;
    if (streamType === "session.error") {
      const errorRecord =
        properties?.error && typeof properties.error === "object"
          ? (properties.error as Record<string, unknown>)
          : undefined;
      const message = typeof errorRecord?.message === "string" ? errorRecord.message : "Session error";
      return {
        level: "error",
        eventType: streamType,
        summary: message,
        details: stringifyDetails(properties),
      };
    }
    if (streamType === "session.status") {
      const status =
        properties?.status && typeof properties.status === "object"
          ? (properties.status as Record<string, unknown>)
          : undefined;
      const statusType = typeof status?.type === "string" ? status.type : "unknown";
      return {
        level: statusType === "retry" ? "warn" : "info",
        eventType: streamType,
        summary: `Session status: ${statusType}`,
        details: stringifyDetails(properties),
      };
    }
    return {
      level: "info",
      eventType: streamType,
      summary: `Project event: ${streamType}`,
      details: stringifyDetails(properties),
    };
  }

  if (event.type === "browser.agent.action") {
    return {
      level: event.payload.ok ? "info" : "error",
      eventType: `browser.${event.payload.action}`,
      summary: event.payload.ok
        ? `Browser action completed: ${event.payload.action}`
        : `Browser action failed: ${event.payload.action}${event.payload.error ? ` (${event.payload.error})` : ""}`,
      details: stringifyDetails(event.payload),
    };
  }

  return {
    level: "info",
    eventType: event.type,
    summary: event.type,
    details: stringifyDetails(event.payload),
  };
}

function parseCustomRunCommands(raw: string): CustomRunCommandPreset[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    return [];
  }
  const result: CustomRunCommandPreset[] = [];
  const seenIDs = new Set<string>();
  for (let index = 0; index < parsed.length; index += 1) {
    const item = parsed[index];
    if (!item || typeof item !== "object") {
      continue;
    }
    const candidate = item as Partial<CustomRunCommandPreset>;
    const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
    const commands = typeof candidate.commands === "string" ? candidate.commands.trim() : "";
    if (!title || !commands) {
      continue;
    }
    const rawID = typeof candidate.id === "string" && candidate.id.trim().length > 0
      ? candidate.id.trim()
      : `legacy-${index}`;
    if (seenIDs.has(rawID)) {
      continue;
    }
    seenIDs.add(rawID);
    const updatedAt = typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt)
      ? candidate.updatedAt
      : Date.now() - index;
    result.push({
      id: rawID,
      title,
      commands: commands.replace(/\r\n/g, "\n"),
      updatedAt,
    });
  }
  return result.sort((a, b) => b.updatedAt - a.updatedAt);
}

function splitCommandLines(commands: string) {
  return commands
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function buildMemoryBackfillSeedPrompt(workspaces: ProjectListItem[]) {
  const workspaceLines = workspaces
    .map((project, index) => {
      const label = project.name?.trim();
      return `${index + 1}. ${project.worktree}${label ? ` (${label})` : ""}`;
    })
    .join("\n");

  return [
    "Goal: backfill OpencodeOrxa in-app local memory across all registered workspaces in this app.",
    "",
    "Critical constraints:",
    "- Use ONLY this app's local OpencodeOrxa memory system.",
    "- Do NOT use any external memory service, third-party memory tool, or out-of-app memory integration.",
    "- Do NOT pause to ask for memory tool access; you can complete this task with filesystem/session analysis only.",
    "- The app ingests structured memory lines from your reply automatically.",
    "",
    "Registered workspaces:",
    workspaceLines || "(none)",
    "",
    "Required output format (one memory per line):",
    '[ORXA_MEMORY] workspace="<absolute workspace path>" type="<preference|constraint|decision|fact>" tags="<comma,separated,tags>" content="<single-line durable memory>"',
    "",
    "Execution plan:",
    "1. Iterate each workspace path above.",
    "2. For each workspace, enumerate sessions and inspect message history.",
    "3. Extract durable memories only (preferences, constraints, decisions, and stable codebase facts) and output them ONLY in the required format.",
    "4. Keep retrieval isolation per workspace. Do not mix memory from different workspaces.",
    "5. Build useful relationships between related memories and avoid duplicates.",
    "6. Summarize what was backfilled, what was skipped, and why.",
    "",
    "Safety constraints:",
    "- Skip noisy conversational filler.",
    "- Do not store secrets or credentials.",
    "- Preserve workspace boundaries when writing memory.",
    "- Do not propose alternative memory systems or tooling in this task.",
    "",
    "After preparing the plan, ask me to confirm before running bulk changes.",
  ].join("\n");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string) {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
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

function isTodoCompleted(todo: OrxaTodoItem) {
  const status = todo.status?.trim().toLowerCase();
  if (!status) {
    return false;
  }
  return COMPLETED_TODO_STATUSES.has(status);
}

function tokenCountFromMessageInfo(info: SessionMessageBundle["info"]) {
  if (info.role !== "assistant") {
    return 0;
  }
  const assistantInfo = info as SessionMessageBundle["info"] & {
    tokens?: {
      total?: number;
      input?: number;
      output?: number;
      cache?: { read?: number; write?: number };
    };
  };
  const total = typeof assistantInfo.tokens?.total === "number" ? assistantInfo.tokens.total : 0;
  if (total > 0) {
    return total;
  }
  const input = typeof assistantInfo.tokens?.input === "number" ? assistantInfo.tokens.input : 0;
  const output = typeof assistantInfo.tokens?.output === "number" ? assistantInfo.tokens.output : 0;
  const cacheRead = typeof assistantInfo.tokens?.cache?.read === "number" ? assistantInfo.tokens.cache.read : 0;
  const cacheWrite = typeof assistantInfo.tokens?.cache?.write === "number" ? assistantInfo.tokens.cache.write : 0;
  return input + output + cacheRead + cacheWrite;
}

function buildCompactionMeterState(messages: SessionMessageBundle[]) {
  const compactionIndexes: number[] = [];
  const compactionThresholdHints: number[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const bundle = messages[index];
    if (!bundle.parts.some((part) => part.type === "compaction")) {
      continue;
    }
    compactionIndexes.push(index);
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      const previousTokens = tokenCountFromMessageInfo(messages[previous]!.info);
      if (previousTokens > 0) {
        compactionThresholdHints.push(previousTokens);
        break;
      }
    }
  }

  const lastCompactionIndex = compactionIndexes.length > 0 ? compactionIndexes[compactionIndexes.length - 1]! : -1;
  let currentTokens = 0;
  for (let index = messages.length - 1; index > lastCompactionIndex; index -= 1) {
    const tokens = tokenCountFromMessageInfo(messages[index]!.info);
    if (tokens > 0) {
      currentTokens = tokens;
      break;
    }
  }

  let threshold = compactionThresholdHints.length > 0
    ? compactionThresholdHints[compactionThresholdHints.length - 1]!
    : DEFAULT_COMPACTION_THRESHOLD;
  threshold = Math.max(MIN_COMPACTION_THRESHOLD, threshold);
  if (currentTokens > threshold) {
    threshold = currentTokens;
  }

  const progress = threshold > 0 ? Math.min(1, currentTokens / threshold) : 0;
  const compacted = lastCompactionIndex >= 0 && currentTokens < Math.max(4_000, Math.round(threshold * 0.22));
  const hint = compacted
    ? "Recent context compaction completed. The context window has been reset."
    : `Estimated context usage before auto-compaction (${currentTokens.toLocaleString()} / ${threshold.toLocaleString()} tokens).`;

  return { progress, hint, compacted };
}

export default function App() {
  const [appPreferences, setAppPreferences] = usePersistedState<AppPreferences>(APP_PREFERENCES_KEY, DEFAULT_APP_PREFERENCES, {
    deserialize: (raw) => {
      const parsed = JSON.parse(raw) as Partial<AppPreferences>;
      const merged: AppPreferences = {
        ...DEFAULT_APP_PREFERENCES,
        ...parsed,
      };
      if (!Array.isArray(merged.hiddenModels)) {
        merged.hiddenModels = [];
      } else {
        merged.hiddenModels = [
          ...new Set(
            merged.hiddenModels
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim())
              .filter((item) => item.length > 0),
          ),
        ];
      }
      if (merged.permissionMode !== "ask-write" && merged.permissionMode !== "yolo-write") {
        merged.permissionMode = "ask-write";
      }
      return merged;
    },
  });
  const [globalProviders, setGlobalProviders] = useState<ProviderListResponse>({ all: [], connected: [], default: {} });
  const [runtime, setRuntime] = useState<RuntimeState>(INITIAL_RUNTIME);
  const [profiles, setProfiles] = useState<RuntimeProfile[]>([]);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | undefined>();
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalTabs, setTerminalTabs] = useState<Array<{ id: string; label: string }>>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | undefined>();
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [followupQueue, setFollowupQueue] = useState<Array<{ id: string; text: string; timestamp: number }>>([]);
  const [sendingQueuedId, setSendingQueuedId] = useState<string | undefined>();

  useEffect(() => {
    const option = CODE_FONT_OPTIONS.find((o) => o.value === appPreferences.codeFont);
    const stack = option?.stack ?? `"${appPreferences.codeFont}", monospace`;
    document.documentElement.style.setProperty("--code-font", stack);
  }, [appPreferences.codeFont]);
  const [statusLine, setStatusLine] = useState<string>("Ready");
  const [debugModalOpen, setDebugModalOpen] = useState(false);
  const [debugLogLevelFilter, setDebugLogLevelFilter] = useState<"all" | DebugLogLevel>("all");
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const appendDebugLog = useCallback((entry: Omit<DebugLogEntry, "id" | "time">) => {
    setDebugLogs((current) => {
      const next: DebugLogEntry = {
        id: `${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
        time: Date.now(),
        ...entry,
      };
      return [...current, next].slice(-1200);
    });
  }, []);
  const { toasts, dismissToast, pushToast } = useAppShellToasts({ statusLine, toneForStatusLine });
  const {
    confirmDialogRequest,
    textInputDialog,
    setTextInputDialog,
    requestConfirmation,
    closeConfirmDialog,
    closeTextInputDialog,
    submitTextInputDialog,
  } = useAppShellDialogs();
  const [sessionProvenanceByPath, setSessionProvenanceByPath] = useState<Record<string, ChangeProvenanceRecord>>({});
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
    clearPendingSession,
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
    selectSession: selectSessionRaw,
    createSession: createWorkspaceSession,
    queueRefresh,
    startResponsePolling,
    stopResponsePolling,
    togglePinSession,
    openProjectContextMenu,
    openSessionContextMenu,
    markSessionUsed,
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

  const openSession = useCallback(
    (sessionID: string) => {
      setSidebarMode("projects");
      selectSessionRaw(sessionID);
    },
    [selectSessionRaw, setSidebarMode],
  );

  const [projectSearchOpen, setProjectSearchOpen] = useState(false);
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [projectSortOpen, setProjectSortOpen] = useState(false);
  const [projectSortMode, setProjectSortMode] = usePersistedState<ProjectSortMode>("orxa:projectSortMode:v1", "updated", {
    deserialize: (raw) => {
      const valid: ProjectSortMode[] = ["updated", "recent", "alpha-asc", "alpha-desc"];
      return valid.includes(raw as ProjectSortMode) ? (raw as ProjectSortMode) : "updated";
    },
    serialize: (value) => value,
  });
  const [allSessionsModalOpen, setAllSessionsModalOpen] = useState(false);
  const [sessionTypes, setSessionTypes] = usePersistedState<Record<string, SessionType>>(SESSION_TYPES_KEY, {});
  const [sessionTitles, setSessionTitles] = usePersistedState<Record<string, string>>(SESSION_TITLES_KEY, {});
  const canvasState = useCanvasState(activeSessionID ?? "__none__");
  const [projectsSidebarVisible, setProjectsSidebarVisible] = useState(true);
  const [codexAwaiting, setCodexAwaiting] = useState(false);
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
  const [memoryGraph, setMemoryGraph] = useState<MemoryGraphSnapshot | null>(null);
  const [memoryGraphLoading, setMemoryGraphLoading] = useState(false);
  const [memoryGraphError, setMemoryGraphError] = useState<string | undefined>();
  const [memoryWorkspaceFilter, setMemoryWorkspaceFilter] = useState("all");
  const [memoryBackfillStatus, setMemoryBackfillStatus] = useState<MemoryBackfillStatus | null>(null);
  const [memoryBackfillSessionPreparing, setMemoryBackfillSessionPreparing] = useState(false);
  const [composerLayoutHeight, setComposerLayoutHeight] = useState(DEFAULT_COMPOSER_LAYOUT_HEIGHT);
  const [configModelOptions, setConfigModelOptions] = useState<ModelOption[]>([]);
  const [rightSidebarTab, setRightSidebarTab] = useState<"git" | "files" | "browser">("git");
  const [browserModeBySession, setBrowserModeBySession] = usePersistedState<Record<string, boolean>>(
    BROWSER_MODE_BY_SESSION_KEY,
    {},
  );
  const [browserAutomationHaltedBySession, setBrowserAutomationHaltedBySession] = usePersistedState<Record<string, number>>(
    BROWSER_AUTOMATION_HALTED_BY_SESSION_KEY,
    {},
  );
  const [browserControlOwner, setBrowserControlOwner] = useState<BrowserControlOwner>("agent");
  const [browserRuntimeState, setBrowserRuntimeState] = useState<BrowserState>(EMPTY_BROWSER_RUNTIME_STATE);
  const [browserHistoryItems, setBrowserHistoryItems] = useState<BrowserHistoryItem[]>([]);
  const [browserActionRunning, setBrowserActionRunning] = useState(false);
  const [mcpDevToolsState, setMcpDevToolsState] = useState<McpDevToolsServerState>("stopped");
  const [titleMenuOpen, setTitleMenuOpen] = useState(false);
  const [openMenuOpen, setOpenMenuOpen] = useState(false);
  const [preferredOpenTarget, setPreferredOpenTarget] = usePersistedState<OpenTarget>(OPEN_TARGET_KEY, "finder", {
    deserialize: (raw) => {
      const available = new Set<OpenTarget>(OPEN_TARGETS.map((target) => target.id));
      if (available.has(raw as OpenTarget)) {
        return raw as OpenTarget;
      }
      try {
        const parsed = JSON.parse(raw);
        if (available.has(parsed as OpenTarget)) {
          return parsed as OpenTarget;
        }
      } catch {
        // keep fallback
      }
      return "finder";
    },
    serialize: (value) => value,
  });
  const [customRunCommands, setCustomRunCommands] = usePersistedState<CustomRunCommandPreset[]>(
    CUSTOM_RUN_COMMANDS_KEY,
    [],
    {
      deserialize: parseCustomRunCommands,
    },
  );
  const [agentModelPrefs, setAgentModelPrefs] = usePersistedState<Record<string, string>>(AGENT_MODEL_PREFS_KEY, {});
  const [commitMenuOpen, setCommitMenuOpen] = useState(false);
  const {
    commitFlowState,
    clearCommitFlowDismissTimer,
    scheduleCommitFlowDismiss,
    startCommitFlow,
    completeCommitFlow,
    failCommitFlow,
    dismissCommitFlowState,
  } = useAppShellCommitFlow<CommitNextStep>({
    runningMessage: commitFlowRunningMessage,
    successMessage: commitFlowSuccessMessage,
  });
  const [pendingPrUrl, setPendingPrUrl] = useState<string | null>(null);
  const {
    availableUpdateVersion,
    updateInstallPending,
    updateProgressState,
    setUpdateProgressState,
    handleUpdaterTelemetry,
    downloadAndInstallUpdate,
  } = useAppShellUpdateFlow({ setStatusLine });
  const [todosOpen, setTodosOpen] = useState(false);
  const [dockTodosOpen, setDockTodosOpen] = useState(false);
  const [sdkTodoItems, setSdkTodoItems] = useState<TodoItem[]>([]);
  const [permissionDecisionPending, setPermissionDecisionPending] = useState<"once" | "always" | "reject" | null>(null);
  const [permissionDecisionPendingRequestID, setPermissionDecisionPendingRequestID] = useState<string | null>(null);
  const [dependencyReport, setDependencyReport] = useState<RuntimeDependencyReport | null>(null);
  const [dependencyModalOpen, setDependencyModalOpen] = useState(false);
  const { dashboard, refreshDashboard } = useDashboards(
    projects,
    activeProjectDir ?? null,
    projectData,
  );
  const codexSessionCount = useMemo(
    () => Object.values(sessionTypes).filter((t) => t === "codex").length,
    [sessionTypes],
  );
  const claudeSessionCount = useMemo(
    () => Object.values(sessionTypes).filter((t) => t === "claude").length,
    [sessionTypes],
  );
  const [codexUsage, setCodexUsage] = useState<ProviderUsageStats | null>(null);
  const [claudeUsage, setClaudeUsage] = useState<ProviderUsageStats | null>(null);
  const [codexUsageLoading, setCodexUsageLoading] = useState(false);
  const [claudeUsageLoading, setClaudeUsageLoading] = useState(false);
  const refreshCodexUsage = useCallback(async () => {
    setCodexUsageLoading(true);
    try {
      const stats = await window.orxa.usage.getCodexStats();
      setCodexUsage(stats);
    } catch {
      // Non-fatal
    } finally {
      setCodexUsageLoading(false);
    }
  }, []);
  const refreshClaudeUsage = useCallback(async () => {
    setClaudeUsageLoading(true);
    try {
      const stats = await window.orxa.usage.getClaudeStats();
      setClaudeUsage(stats);
    } catch {
      // Non-fatal
    } finally {
      setClaudeUsageLoading(false);
    }
  }, []);
  const [, setAgentsDocument] = useState<AgentsDocument | null>(null);
  const [, setAgentsDraft] = useState("");
  const [, setAgentsLoading] = useState(false);
  const activeSessionKey = useMemo(() => {
    if (!activeProjectDir || !activeSessionID) {
      return null;
    }
    return `${activeProjectDir}::${activeSessionID}`;
  }, [activeProjectDir, activeSessionID]);
  const browserModeEnabled = activeSessionKey ? browserModeBySession[activeSessionKey] === true : false;
  const browserAutomationHalted = activeSessionKey
    ? typeof browserAutomationHaltedBySession[activeSessionKey] === "number"
    : false;
  const {
    addSessionFeedNotice,
    activeSessionNotices,
    buildSessionKey: buildSessionFeedNoticeKey,
    getManualSessionStopState,
    markManualSessionStopNoticeEmitted,
    markManualSessionStopRequested,
    pruneManualSessionStops,
  } = useAppShellSessionFeedNotices({
    activeProjectDir,
    activeSessionID,
  });
  // Track whether any overlay/modal is visible in the DOM.
  // The BrowserView is a native Electron overlay that sits on top of the renderer,
  // so we must hide it whenever ANY modal/overlay appears — not just ones we track in state.
  const [anyOverlayInDom, setAnyOverlayInDom] = useState(false);
  useEffect(() => {
    const check = () => {
      const hasOverlay = document.querySelector(".overlay, .model-modal-overlay, .settings-overlay, .run-command-modal-overlay") !== null;
      setAnyOverlayInDom(hasOverlay);
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  const { hasProjectContext, showProjectsPane, showGitPane, browserPaneVisible } = deriveAppShellWorkspaceLayout({
    activeProjectDir,
    sidebarMode,
    projectsSidebarVisible,
    showOperationsPane: appPreferences.showOperationsPane,
    rightSidebarTab,
    anyOverlayInDom,
  });
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
    commitBaseBranch,
    setCommitBaseBranch,
    commitBaseBranchOptions,
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
    branchActionError,
    setBranchActionError,
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
    scheduleGitRefresh,
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
  const lastBrowserBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const abortActiveSessionRef = useRef<(() => Promise<void>) | null>(null);

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
  // Fetch OpenCode agent files from ~/.config/opencode/agents
  const [opencodeAgentFiles, setOpencodeAgentFiles] = useState<Array<{ name: string; mode: string; description?: string }>>([]);
  useEffect(() => {
    void window.orxa.opencode.listAgentFiles()
      .then((files) => setOpencodeAgentFiles(files.map((f) => ({ name: f.name, mode: f.mode, description: f.description }))))
      .catch(() => {});
  }, [activeProjectDir, projectData?.agents]);

  const composerAgentOptions = useMemo(() => {
    // Use OpenCode agent files (from ~/.config/opencode/agents), filter to primary/all
    return opencodeAgentFiles
      .filter((agent) => {
        const mode = agent.mode as string;
        return mode === "primary" || mode === "all";
      })
      .map((agent) => ({
        name: agent.name,
        mode: agent.mode as "primary" | "subagent" | "all",
        description: agent.description,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [opencodeAgentFiles]);
  const serverModelOptions = useMemo(
    () => listModelOptions(projectData?.providers ?? { all: [], connected: [], default: {} }),
    [projectData],
  );
  const globalServerModelOptions = useMemo(() => {
    return listModelOptions(globalProviders);
  }, [globalProviders]);
  const discoverableModelOptions = useMemo(
    () => mergeDiscoverableModelOptions(configModelOptions, serverModelOptions, globalServerModelOptions),
    [configModelOptions, globalServerModelOptions, serverModelOptions],
  );
  const settingsModelsRef = useRef<ModelOption[]>([]);
  const settingsModelOptions = useMemo(() => {
    const merged = discoverableModelOptions;
    if (merged.length > 0) {
      settingsModelsRef.current = merged;
    }
    return settingsModelsRef.current.length > 0 ? settingsModelsRef.current : merged;
  }, [discoverableModelOptions]);
  const preferredAgentModel = useMemo(() => {
    return undefined;
  }, []);
  const selectedAgentDefinition = useMemo(
    () => agentOptions.find((agent) => agent.name === selectedAgent),
    [agentOptions, selectedAgent],
  );
  const serverAgentNames = useMemo(() => new Set(agentOptions.map((agent) => agent.name)), [agentOptions]);
  const hasPlanAgent = useMemo(
    () => serverAgentNames.has("plan"),
    [serverAgentNames],
  );
  const isPlanMode = selectedAgent === "plan";
  const composerPlaceholder = "Send message";
  const assistantLabel = selectedAgent
    ? selectedAgent.charAt(0).toUpperCase() + selectedAgent.slice(1)
    : "Assistant";
  const todosLabel = "Todos";
  const branchDisplayValue = useMemo(() => {
    if (branchLoading) {
      return "Loading branch...";
    }
    return branchState?.current || "Branch";
  }, [branchLoading, branchState]);
  const branchControlWidthCh = useMemo(() => Math.max(16, Math.min(54, branchDisplayValue.length + 7)), [branchDisplayValue]);
  const compactionMeter = useMemo(() => buildCompactionMeterState(messages), [messages]);
  const filteredBranches = useMemo(() => {
    const query = branchQuery.trim().toLowerCase();
    const branches = branchState?.branches ?? [];
    if (!query) {
      return branches;
    }
    return branches.filter((branch) => branch.toLowerCase().includes(query));
  }, [branchQuery, branchState]);
  const filteredDebugLogs = useMemo(() => {
    if (debugLogLevelFilter === "all") {
      return debugLogs;
    }
    return debugLogs.filter((entry) => entry.level === debugLogLevelFilter);
  }, [debugLogLevelFilter, debugLogs]);
  const copyDebugLogsAsJson = useCallback(async () => {
    const payload = filteredDebugLogs.map((entry) => ({
      timestamp: new Date(entry.time).toISOString(),
      level: entry.level,
      eventType: entry.eventType,
      summary: entry.summary,
      details: entry.details,
    }));
    const json = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        filter: debugLogLevelFilter,
        count: payload.length,
        logs: payload,
      },
      null,
      2,
    );
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard is not available in this environment.");
      }
      await navigator.clipboard.writeText(json);
      setStatusLine(`Copied ${payload.length} debug logs as JSON`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusLine(`Failed to copy debug logs: ${message}`);
      pushToast(`Failed to copy debug logs: ${message}`, "error");
    }
  }, [debugLogLevelFilter, filteredDebugLogs, pushToast, setStatusLine]);

  const refreshProfiles = useCallback(async () => {
    const [nextRuntime, nextProfiles] = await Promise.all([window.orxa.runtime.getState(), window.orxa.runtime.listProfiles()]);
    setRuntime(nextRuntime);
    setProfiles(nextProfiles);
  }, []);

  const refreshConfigModels = useCallback(async () => {
    try {
      const docs: Array<{ content: string }> = [];
      if (activeProjectDir) {
        const projectDoc = await window.orxa.opencode.readRawConfig("project", activeProjectDir).catch(() => undefined);
        if (projectDoc) {
          docs.push(projectDoc);
        }
      }
      const globalDoc = await window.orxa.opencode.readRawConfig("global");
      docs.push(globalDoc);
      const parsed = docs.map((doc) => parseJsonc(doc.content) as unknown);
      const merged = mergeDiscoverableModelOptions(...parsed.map((item) => listModelOptionsFromConfigReferences(item)));
      setConfigModelOptions(merged);
    } catch {
      setConfigModelOptions([]);
    }
  }, [activeProjectDir]);

  const refreshGlobalProviders = useCallback(async () => {
    try {
      const providers = await window.orxa.opencode.listProviders();
      setGlobalProviders(providers);
    } catch {
      setGlobalProviders({ all: [], connected: [], default: {} });
    }
  }, []);

  const refreshRuntimeDependencies = useCallback(async () => {
    try {
      const report = await window.orxa.opencode.checkDependencies();
      setDependencyReport(report);
      setDependencyModalOpen(report.missingAny);
    } catch {
      setDependencyReport(null);
    }
  }, []);

  const syncBrowserSnapshot = useCallback(async () => {
    const [nextState, nextHistory] = await Promise.all([window.orxa.browser.getState(), window.orxa.browser.listHistory(200)]);
    setBrowserRuntimeState(nextState);
    setBrowserHistoryItems(nextHistory);
  }, []);

  const ensureBrowserTab = useCallback(async () => {
    const current = await window.orxa.browser.getState();
    if (current.tabs.length > 0) {
      setBrowserRuntimeState(current);
      return current;
    }
    const nextState = await window.orxa.browser.openTab(DEFAULT_BROWSER_LANDING_URL, true);
    setBrowserRuntimeState(nextState);
    return nextState;
  }, []);

  const runBrowserStateCommand = useCallback(async (command: () => Promise<BrowserState>) => {
    try {
      const nextState = await command();
      setBrowserRuntimeState(nextState);
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const abortSessionViaComposer = useCallback(async () => {
    if (abortActiveSessionRef.current) {
      await abortActiveSessionRef.current();
      return;
    }
    if (activeProjectDir && activeSessionID) {
      await window.orxa.opencode.abortSession(activeProjectDir, activeSessionID);
    }
  }, [activeProjectDir, activeSessionID]);

  const setBrowserMode = useCallback(async (enabled: boolean) => {
    if (!activeSessionKey || !activeProjectDir) {
      return;
    }
    setBrowserModeBySession((current) => ({
      ...current,
      [activeSessionKey]: enabled,
    }));
    if (!enabled) {
      setBrowserActionRunning(false);
      // Disconnect MCP DevTools via SDK when browser mode is turned off
      window.orxa.mcpDevTools.stop(activeProjectDir).then(
        (status) => setMcpDevToolsState(status.state),
        () => setMcpDevToolsState("stopped"),
      );
      return;
    }
    try {
      await ensureBrowserTab();
      await syncBrowserSnapshot();
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
    // Register and connect MCP DevTools via SDK when browser mode is turned on
    window.orxa.mcpDevTools.start(activeProjectDir).then(
      (status) => {
        if (status.state === "error") {
          setStatusLine(`MCP DevTools error: ${status.error ?? "unknown"}`);
        }
        setMcpDevToolsState(status.state);
      },
      (err) => {
        const message = err instanceof Error ? err.message : String(err);
        setStatusLine(`MCP DevTools failed: ${message}`);
        setMcpDevToolsState("error");
      },
    );
  }, [activeProjectDir, activeSessionKey, ensureBrowserTab, setBrowserModeBySession, syncBrowserSnapshot]);


  const browserNavigate = useCallback(async (url: string) => {
    await runBrowserStateCommand(() => window.orxa.browser.navigate(url));
  }, [runBrowserStateCommand]);

  const browserOpenTab = useCallback(async () => {
    await runBrowserStateCommand(() => window.orxa.browser.openTab(DEFAULT_BROWSER_LANDING_URL, true));
  }, [runBrowserStateCommand]);

  const browserCloseTab = useCallback(async (tabID: string) => {
    await runBrowserStateCommand(() => window.orxa.browser.closeTab(tabID));
  }, [runBrowserStateCommand]);

  const browserGoBack = useCallback(async () => {
    await runBrowserStateCommand(() => window.orxa.browser.back());
  }, [runBrowserStateCommand]);

  const browserGoForward = useCallback(async () => {
    await runBrowserStateCommand(() => window.orxa.browser.forward());
  }, [runBrowserStateCommand]);

  const browserReload = useCallback(async () => {
    await runBrowserStateCommand(() => window.orxa.browser.reload());
  }, [runBrowserStateCommand]);

  const browserSelectTab = useCallback(async (tabID: string) => {
    await runBrowserStateCommand(() => window.orxa.browser.switchTab(tabID));
  }, [runBrowserStateCommand]);

  const browserSelectHistory = useCallback(async (url: string) => {
    await runBrowserStateCommand(() => window.orxa.browser.navigate(url));
  }, [runBrowserStateCommand]);

  const browserReportViewportBounds = useCallback((bounds: { x: number; y: number; width: number; height: number }) => {
    const previous = lastBrowserBoundsRef.current;
    if (
      previous &&
      previous.x === bounds.x &&
      previous.y === bounds.y &&
      previous.width === bounds.width &&
      previous.height === bounds.height
    ) {
      return;
    }
    lastBrowserBoundsRef.current = bounds;
    void window.orxa.browser.setBounds(bounds)
      .then((nextState) => {
        setBrowserRuntimeState(nextState);
      })
      .catch((error) => {
        setStatusLine(error instanceof Error ? error.message : String(error));
      });
  }, []);

  const browserTakeControl = useCallback(async () => {
    setBrowserControlOwner("human");
    setBrowserActionRunning(false);
    try {
      await abortSessionViaComposer();
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, [abortSessionViaComposer]);

  const browserHandBack = useCallback(() => {
    setBrowserControlOwner("agent");
  }, []);

  const browserStop = useCallback(async () => {
    setBrowserActionRunning(false);
    try {
      await abortSessionViaComposer();
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, [abortSessionViaComposer]);

  const handleBrowserGuardrailViolation = useCallback((message: string) => {
    const now = Date.now();
    const normalized = message.toLowerCase();
    const isForbiddenToolUsage = normalized.includes("blocked forbidden tool usage in browser mode");
    const shouldHaltAutomation = normalized.includes("automation was halted");
    setBrowserActionRunning(false);
    appendDebugLog({
      level: "warn",
      eventType: "browser.guardrail",
      summary: message,
      details: JSON.stringify(
        {
          sessionID: activeSessionID ?? null,
          workspace: activeProjectDir ?? null,
          halted: shouldHaltAutomation,
          hiddenFromToast: true,
        },
        null,
        2,
      ),
    });
    if (!isForbiddenToolUsage) {
      setStatusLine(message);
    }
    if (shouldHaltAutomation && activeProjectDir && activeSessionID) {
      const key = `${activeProjectDir}::${activeSessionID}`;
      setBrowserAutomationHaltedBySession((current) => ({
        ...current,
        [key]: now,
      }));
    }
  }, [activeProjectDir, activeSessionID, appendDebugLog, setBrowserAutomationHaltedBySession, setStatusLine]);


  const bootstrap = useCallback(async () => {
    try {
      const result = await window.orxa.opencode.bootstrap();
      setProjects(result.projects);
      setRuntime(result.runtime);
      if (activeProjectDir && !result.projects.some((item) => item.worktree === activeProjectDir)) {
        setStatusLine(`Workspace directory is no longer accessible: ${activeProjectDir}`);
        setActiveProjectDir(undefined);
        setProjectData(null);
        setActiveSessionID(undefined);
        setMessages([]);
      }
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, [activeProjectDir, setActiveProjectDir, setActiveSessionID, setMessages, setProjectData]);

  const markSessionAbortRequested = useCallback((directory: string, sessionID: string) => {
    const now = Date.now();
    const key = buildSessionFeedNoticeKey(directory, sessionID);
    markManualSessionStopRequested(directory, sessionID, now);
    setBrowserAutomationHaltedBySession((current) => ({
      ...current,
      [key]: now,
    }));
  }, [buildSessionFeedNoticeKey, markManualSessionStopRequested, setBrowserAutomationHaltedBySession]);

  const clearBrowserAutomationHalt = useCallback((directory: string, sessionID: string) => {
    const key = `${directory}::${sessionID}`;
    setBrowserAutomationHaltedBySession((current) => {
      if (!(key in current)) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, [setBrowserAutomationHaltedBySession]);

  const {
    composer,
    setComposer,
    composerAttachments,
    isSendingPrompt,
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
    addComposerAttachments,
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
    clearPendingSession,
    onSessionAbortRequested: markSessionAbortRequested,
  });

  useEffect(() => {
    abortActiveSessionRef.current = async () => {
      await Promise.resolve(abortActiveSession());
    };
    return () => {
      abortActiveSessionRef.current = null;
    };
  }, [abortActiveSession]);

  const browserSystemAddendum = useMemo(() => {
    if (!browserModeEnabled) {
      return undefined;
    }
    return [
      "Browser Mode is enabled in Orxa Code.",
      browserControlOwner === "agent"
        ? "Agent currently owns browser control."
        : "Human currently owns browser control. Browser actions will be blocked until hand-back.",
      "To request browser automation, emit exactly one tag per action:",
      "<orxa_browser_action>{\"id\":\"unique-action-id\",\"action\":\"navigate\",\"args\":{\"url\":\"https://example.com\"}}</orxa_browser_action>",
      "Supported actions: open_tab, close_tab, switch_tab, navigate, back, forward, reload, click, type, press, scroll, extract_text, exists, visible, wait_for, wait_for_navigation, wait_for_idle, screenshot.",
      "For dynamic pages prefer robust locators in args.locator (selector/selectors/text/role/name/label/frameSelector/includeShadowDom/exact), plus timeoutMs/maxAttempts where needed.",
      "Do not stop at first paint: continue with scroll, click, wait_for_idle, and extract_text loops until requested evidence is gathered.",
      "Hard guardrail: do not use Playwright, MCP tools, web.run, or any external/headless/system browser tool in this session.",
      "Only the in-app Orxa browser is allowed while Browser Mode is enabled.",
      "Do not assume native browser tools. Wait for machine result messages prefixed with [ORXA_BROWSER_RESULT].",
    ].join("\n");
  }, [browserControlOwner, browserModeEnabled]);

  const browserAutopilotHint = useMemo(() => {
    if (!browserModeEnabled || browserControlOwner !== "agent") {
      return undefined;
    }
    return buildBrowserAutopilotHint(composer);
  }, [browserControlOwner, browserModeEnabled, composer]);

  const effectiveSystemAddendum = useMemo(() => {
    const parts = [browserSystemAddendum, browserAutopilotHint]
      .map((item) => item?.trim())
      .filter((item): item is string => Boolean(item));
    if (parts.length === 0) {
      return undefined;
    }
    return parts.join("\n\n");
  }, [browserAutopilotHint, browserSystemAddendum]);

  const mcpConnected = mcpDevToolsState === "running";
  const activePromptToolsPolicy = useMemo(
    () =>
      mergeModeToolPolicies(
        isPlanMode ? PLAN_MODE_TOOLS_POLICY : undefined,
        browserModeEnabled
          ? mcpConnected ? BROWSER_MODE_TOOLS_POLICY_WITH_MCP : BROWSER_MODE_TOOLS_POLICY
          : undefined,
      ),
    [browserModeEnabled, isPlanMode, mcpConnected],
  );

  const sendComposerPrompt = useCallback(
    () => {
      if (activeProjectDir && activeSessionID) {
        clearBrowserAutomationHalt(activeProjectDir, activeSessionID);
      }
      // Mark session as used so it won't be cleaned up on navigation
      if (activeSessionID) {
        markSessionUsed(activeSessionID);
      }
      return sendPrompt({
        systemAddendum: effectiveSystemAddendum,
        promptSource: "user",
        tools: activePromptToolsPolicy,
      });
    },
    [activeProjectDir, activePromptToolsPolicy, activeSessionID, clearBrowserAutomationHalt, effectiveSystemAddendum, markSessionUsed, sendPrompt],
  );

  const queueFollowupMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const id = `fq:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
    setFollowupQueue((current) => [...current, { id, text: trimmed, timestamp: Date.now() }]);
    setComposer("");
    pushToast("Message queued — will send when agent finishes", "info", 3_500);
  }, [setComposer, pushToast]);

  const removeQueuedMessage = useCallback((id: string) => {
    setFollowupQueue((current) => current.filter((item) => item.id !== id));
  }, []);

  const editQueuedMessage = useCallback((id: string) => {
    setFollowupQueue((current) => {
      const item = current.find((m) => m.id === id);
      if (item) {
        setComposer(item.text);
      }
      return current.filter((m) => m.id !== id);
    });
  }, [setComposer]);

  const allModelOptions = settingsModelOptions;

  const modelSelectOptions = useMemo(
    () => filterHiddenModelOptions(allModelOptions, appPreferences.hiddenModels),
    [allModelOptions, appPreferences.hiddenModels],
  );
  const variantOptions = useMemo(() => {
    const model = modelSelectOptions.find((item) => item.key === selectedModel);
    return model?.variants ?? [];
  }, [selectedModel, modelSelectOptions]);
  const startupSteps = useMemo(() => [
    { message: "Loading runtime profiles…", action: refreshProfiles },
    { message: "Bootstrapping workspaces…", action: bootstrap },
    { message: "Loading model references…", action: refreshConfigModels },
    { message: "Loading provider registry…", action: refreshGlobalProviders },
    { message: "Checking runtime dependencies…", action: refreshRuntimeDependencies },
    { message: "Syncing browser state…", action: syncBrowserSnapshot },
  ], [
    bootstrap,
    refreshConfigModels,
    refreshGlobalProviders,
    refreshProfiles,
    refreshRuntimeDependencies,
    syncBrowserSnapshot,
  ]);
  const handleStartupStepError = useCallback((error: unknown) => {
    setStatusLine(error instanceof Error ? error.message : String(error));
  }, []);
  const { startupState, startupProgressPercent } = useAppShellStartupFlow({
    initialMessage: "Initializing Orxa Code…",
    totalSteps: STARTUP_TOTAL_STEPS,
    stepTimeoutMs: STARTUP_STEP_TIMEOUT_MS,
    steps: startupSteps,
    onStepError: handleStartupStepError,
  });

  useEffect(() => {
    if (browserPaneVisible) {
      // Zero out stale bounds before making the view visible so the
      // ResizeObserver's next report delivers fresh, accurate coordinates.
      // The browser-controller will keep the view detached until setBounds()
      // provides valid (x > 0) bounds.
      lastBrowserBoundsRef.current = null;
      void window.orxa.browser.setBounds({ x: 0, y: 0, width: 0, height: 0 }).catch(() => undefined);
    }
    void window.orxa.browser.setVisible(browserPaneVisible)
      .then((nextState) => {
        setBrowserRuntimeState(nextState);
      })
      .catch((error) => {
        setStatusLine(error instanceof Error ? error.message : String(error));
      });
  }, [browserPaneVisible]);

  useEffect(() => {
    if (rightSidebarTab !== "browser") {
      return;
    }
    void ensureBrowserTab().catch((error) => {
      setStatusLine(error instanceof Error ? error.message : String(error));
    });
  }, [ensureBrowserTab, rightSidebarTab]);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }
    void Promise.all([refreshConfigModels(), refreshGlobalProviders()]).catch(() => undefined);
  }, [refreshConfigModels, refreshGlobalProviders, settingsOpen]);

  useEffect(() => {
    if (!activeSessionID || !activeProjectDir) {
      setMessages([]);
      return;
    }

    setMessages([]);
    void refreshMessages();
  }, [activeProjectDir, activeSessionID, refreshMessages, setMessages]);

  useEffect(() => {
    if (!activeProjectDir || !activeSessionID) {
      setSessionProvenanceByPath({});
      return;
    }
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void opencodeClient
        .loadChangeProvenance(activeProjectDir, activeSessionID, 0)
        .then((snapshot) => {
          if (cancelled) {
            return;
          }
          const next: Record<string, ChangeProvenanceRecord> = {};
          const ordered = [...snapshot.records].sort((a, b) => b.timestamp - a.timestamp);
          for (const record of ordered) {
            if (!record.filePath || next[record.filePath]) {
              continue;
            }
            next[record.filePath] = record;
          }
          setSessionProvenanceByPath(next);
        })
        .catch(() => {
          if (!cancelled) {
            setSessionProvenanceByPath({});
          }
        });
    }, 140);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [activeProjectDir, activeSessionID, messages]);

  useEffect(() => {
    // Use composerAgentOptions (from listAgentFiles) for availability check,
    // not agentOptions (from SDK which may have a different/stale list)
    const available = new Set([
      ...agentOptions.map((item) => item.name),
      ...composerAgentOptions.map((item) => item.name),
    ]);
    if (hasPlanAgent) available.add("plan");

    let nextAgent = selectedAgent;
    if (!selectedAgent || !available.has(selectedAgent)) {
      // Prefer first composerAgentOption (user's actual primary agents)
      const firstPrimary = composerAgentOptions[0]?.name;
      nextAgent = firstPrimary ?? preferredAgentForMode({
        hasPlanAgent,
        serverAgentNames,
        firstAgentName: agentOptions[0]?.name,
      });
      setSelectedAgent(nextAgent);
    }

    const savedModel = nextAgent ? agentModelPrefs[nextAgent] : undefined;
    const preferredModel = savedModel ?? selectedAgentDefinition?.model ?? preferredAgentModel ?? projectData?.config.model;
    const preferredVisibleModel = preferredModel && modelSelectOptions.some((item) => item.key === preferredModel)
      ? preferredModel
      : undefined;
    const fallback = findFallbackModel(modelSelectOptions, selectedModel ?? preferredVisibleModel ?? preferredModel);
    if (!selectedModel || (nextAgent !== selectedAgent)) {
      setSelectedModel(preferredVisibleModel ?? fallback?.key);
    } else if (!modelSelectOptions.some((item) => item.key === selectedModel)) {
      setSelectedModel(preferredVisibleModel ?? fallback?.key);
    }
  }, [
    agentModelPrefs,
    agentOptions,
    hasPlanAgent,
    modelSelectOptions,
    preferredAgentModel,
    projectData?.config.model,
    selectedAgent,
    selectedAgentDefinition?.model,
    selectedModel,
    setSelectedModel,
    serverAgentNames,
    composerAgentOptions,
  ]);

  const prevSelectedAgentRef = useRef<string | undefined>(selectedAgent);
  useEffect(() => {
    if (selectedModel && selectedAgent && prevSelectedAgentRef.current === selectedAgent) {
      if (modelSelectOptions.some((item) => item.key === selectedModel)) {
        setAgentModelPrefs((prev) => {
          if (prev[selectedAgent] === selectedModel) return prev;
          return { ...prev, [selectedAgent]: selectedModel };
        });
      }
    }
    prevSelectedAgentRef.current = selectedAgent;
  }, [selectedModel, selectedAgent, modelSelectOptions, setAgentModelPrefs]);

  const loadMemoryGraph = useCallback(async () => {
    try {
      setMemoryGraphLoading(true);
      setMemoryGraphError(undefined);
      const snapshot = await window.orxa.opencode.getMemoryGraph(
        memoryWorkspaceFilter === "all" ? {} : { workspace: memoryWorkspaceFilter },
      );
      setMemoryGraph(snapshot);
    } catch (error) {
      setMemoryGraphError(formatMemoryGraphError(error));
    } finally {
      setMemoryGraphLoading(false);
    }
  }, [memoryWorkspaceFilter]);

  useEffect(() => {
    const events = window.orxa?.events;
    if (!events) {
      setStatusLine("Desktop bridge unavailable. Restart Orxa Code to reconnect.");
      return;
    }

    const unsubscribe = events.subscribe((event) => {
      appendDebugLog(toDebugLogFromEvent(event));

      if (event.type === "runtime.status") {
        setRuntime(event.payload);
      }

      if (event.type === "runtime.error") {
        setStatusLine(event.payload.message);
      }

      if (event.type === "updater.telemetry") {
        handleUpdaterTelemetry(event.payload);
      }

      if (event.type === "memory.backfill") {
        setMemoryBackfillStatus(event.payload);
        if (!event.payload.running && sidebarMode === "memory") {
          void loadMemoryGraph();
        }
      }

      if (event.type === "browser.state") {
        setBrowserRuntimeState(event.payload);
      }

      if (event.type === "mcp.devtools.status") {
        setMcpDevToolsState(event.payload.state);
      }

      if (event.type === "browser.history.added") {
        setBrowserHistoryItems((current) => {
          const withoutMatch = current.filter((item) => item.id !== event.payload.id && item.url !== event.payload.url);
          return [event.payload, ...withoutMatch].slice(0, 1_000);
        });
      }

      if (event.type === "browser.history.cleared") {
        setBrowserHistoryItems([]);
      }

      if (event.type === "browser.agent.action") {
        setBrowserActionRunning(false);
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
        const eventProperties =
          event.payload.event.properties && typeof event.payload.event.properties === "object"
            ? (event.payload.event.properties as Record<string, unknown>)
            : undefined;
        const eventSessionID =
          eventProperties && typeof eventProperties.sessionID === "string"
            ? eventProperties.sessionID
            : undefined;
        const eventSessionKey = eventSessionID ? buildSessionFeedNoticeKey(event.payload.directory, eventSessionID) : null;
        const now = Date.now();
        pruneManualSessionStops(now);
        const manualStopState = getManualSessionStopState(eventSessionKey);
        const manualStopAt = manualStopState?.requestedAt;
        const isRecentManualStop = typeof manualStopAt === "number" && now - manualStopAt < 30_000;
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
          kind === "pty.deleted" ||
          kind === "todo.updated"
        ) {
          const refreshDelay =
            kind === "message.part.delta" || kind === "message.part.updated" || kind === "message.part.added"
              ? 600
              : 180;
          queueRefresh(`Updated from event: ${kind}`, refreshDelay);
        }

        if (kind === "todo.updated" && eventProperties) {
          const todos = eventProperties.todos;
          if (Array.isArray(todos)) {
            const mapped: TodoItem[] = todos.map((t: Record<string, unknown>, i: number) => ({
              id: typeof t.id === "string" ? t.id : `todo-${i}`,
              content: typeof t.content === "string" ? t.content : "",
              status: (() => {
                const s = typeof t.status === "string" ? t.status.toLowerCase().trim() : "pending";
                if (s === "in_progress" || s === "in-progress" || s === "active" || s === "running") return "in_progress" as const;
                if (s === "completed" || s === "complete" || s === "done" || s === "finished" || s === "success" || s === "succeeded") return "completed" as const;
                if (s === "cancelled" || s === "canceled" || s === "skipped") return "cancelled" as const;
                return "pending" as const;
              })(),
            }));
            setSdkTodoItems(mapped);
          }
        }

        if (
          kind === "message.created" ||
          kind === "message.updated" ||
          kind === "message.part.added" ||
          kind === "message.part.created" ||
          kind === "message.part.delta" ||
          kind === "message.part.updated" ||
          kind === "message.part.removed" ||
          kind === "message.removed" ||
          kind === "session.updated" ||
          kind === "session.deleted" ||
          kind === "session.status" ||
          kind === "session.idle" ||
          kind === "session.error"
        ) {
          const delay = kind === "message.part.delta" ? 720 : 280;
          scheduleGitRefresh(delay);
        }

        if (kind === "session.error") {
          const errorRecord =
            eventProperties?.error && typeof eventProperties.error === "object"
              ? (eventProperties.error as Record<string, unknown>)
              : undefined;
          const message = typeof errorRecord?.message === "string" ? errorRecord.message.trim() : "";
          const errorCode = typeof errorRecord?.code === "string" ? errorRecord.code.trim() : "";
          const sessionID = eventSessionID ?? activeSessionID;
          const interruptedDetail = "User interrupted. Send a new message to continue.";
          const useInterruptedReason = isRecentManualStop;
          const useRecoverableReason = !useInterruptedReason && isRecoverableSessionError(message, errorCode);
          const interruptedAlreadyNoticed = Boolean(manualStopState?.noticeEmitted);
          if (useInterruptedReason && interruptedAlreadyNoticed) {
            if (sessionID && sessionID === activeSessionID) {
              stopResponsePolling();
            }
            return;
          }
          if (sessionID) {
            addSessionFeedNotice(event.payload.directory, sessionID, {
              label: useInterruptedReason
                ? "Session stopped by user"
                : useRecoverableReason
                  ? "Session warning"
                  : "Session stopped due to an error",
              detail: useInterruptedReason
                ? interruptedDetail
                : message || "No additional error details were returned by the backend.",
              tone: useInterruptedReason || useRecoverableReason ? "info" : "error",
            });
          }
          if (useInterruptedReason && eventSessionKey) {
            markManualSessionStopNoticeEmitted(eventSessionKey, manualStopAt ?? now);
          }
          const detail = useInterruptedReason
            ? interruptedDetail
            : message || "Session stopped due to an error.";
          setStatusLine(detail);
          if (useRecoverableReason) {
            pushToast(detail, "warning");
          }
          if (sessionID && sessionID === activeSessionID) {
            stopResponsePolling();
          }
        }
        if (kind === "session.idle" && isRecentManualStop && eventSessionID) {
          if (!manualStopState?.noticeEmitted) {
            addSessionFeedNotice(event.payload.directory, eventSessionID, {
              label: "Session stopped by user",
              detail: "User interrupted. Send a new message to continue.",
              tone: "info",
            });
            setStatusLine("User interrupted. Send a new message to continue.");
            if (eventSessionKey) {
              markManualSessionStopNoticeEmitted(eventSessionKey, manualStopAt ?? now);
            }
          }
          if (eventSessionID === activeSessionID) {
            stopResponsePolling();
          }
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [
    activeProjectDir,
    activeSessionID,
    addSessionFeedNotice,
    appendDebugLog,
    bootstrap,
    buildSessionFeedNoticeKey,
    getManualSessionStopState,
    handleUpdaterTelemetry,
    loadMemoryGraph,
    markManualSessionStopNoticeEmitted,
    pruneManualSessionStops,
    pushToast,
    queueRefresh,
    scheduleGitRefresh,
    sidebarMode,
    stopResponsePolling,
  ]);

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
      // Codex sessions: check the codex-specific awaiting state
      if (sessionTypes[sessionID] === "codex" && codexAwaiting && sessionID === activeSessionID) {
        return "awaiting";
      }
      if (projectData.permissions.some((request) => request.sessionID === sessionID)) {
        return "awaiting";
      }
      if ((projectData.questions ?? []).some((request) => request.sessionID === sessionID)) {
        return "awaiting";
      }
      return projectData.sessionStatus[sessionID]?.type ?? "idle";
    },
    [activeSessionID, codexAwaiting, projectData, sessionTypes],
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
    void refreshAgentsDocument(activeProjectDir);
  }, [activeProjectDir, activeSessionID, refreshAgentsDocument]);

  useEffect(() => {
    if (activeProjectDir && !activeSessionID) {
      return;
    }
    setAgentsDocument(null);
    setAgentsDraft("");
  }, [activeProjectDir, activeSessionID]);

  const createSession = useCallback(
    async (directory?: string, sessionTypeOrPrompt?: SessionType | string) => {
      const isSessionType =
        sessionTypeOrPrompt === "standalone" ||
        sessionTypeOrPrompt === "canvas" ||
        sessionTypeOrPrompt === "claude" ||
        sessionTypeOrPrompt === "codex";
      const sessionType: SessionType = isSessionType ? (sessionTypeOrPrompt as SessionType) : "standalone";
      const initialPrompt = isSessionType ? undefined : sessionTypeOrPrompt;

      const createdSessionId = await createWorkspaceSession(directory, initialPrompt, {
        selectedAgent,
        selectedModelPayload,
        selectedVariant,
        serverAgentNames,
      });

      if (sessionType !== "standalone" && createdSessionId) {
        setSessionTypes((prev) => ({ ...prev, [createdSessionId]: sessionType }));
        const titleMap: Record<string, string> = { claude: "Claude Code", canvas: "Canvas", codex: "Codex Session" };
        if (titleMap[sessionType]) {
          setSessionTitles((prev) => ({ ...prev, [createdSessionId]: titleMap[sessionType] }));
        }
      }
    },
    [createWorkspaceSession, selectedAgent, selectedModelPayload, selectedVariant, serverAgentNames, setSessionTypes, setSessionTitles],
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

  const changeProjectDirectory = useCallback(async (directory: string, label: string) => {
    try {
      const nextDirectory = await addProjectDirectory();
      if (!nextDirectory) {
        return;
      }
      if (nextDirectory === directory) {
        setStatusLine(`Workspace already points to ${nextDirectory}`);
        return;
      }
      await opencodeClient.removeProjectDirectory(directory);
      await bootstrap();
      if (activeProjectDir === directory) {
        await selectProject(nextDirectory);
      }
      setStatusLine(`Updated workspace "${label}"`);
      pushToast(`Workspace path updated to ${nextDirectory}`, "info", 4_000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusLine(message);
      pushToast(message, "error");
    }
  }, [activeProjectDir, addProjectDirectory, bootstrap, pushToast, selectProject, setStatusLine]);

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

  useEffect(() => {
    if (sidebarMode !== "memory") {
      return;
    }
    void loadMemoryGraph();
  }, [loadMemoryGraph, sidebarMode]);

  const prepareMemoryBackfillSession = useCallback(async () => {
    if (memoryBackfillSessionPreparing) {
      return;
    }
    if (projects.length === 0) {
      setStatusLine("Add at least one workspace before preparing a memory backfill session.");
      return;
    }
    const targetProject = projects.find((item) => item.worktree === activeProjectDir) ?? projects[0];
    if (!targetProject) {
      setStatusLine("Select a workspace to prepare a memory backfill session.");
      return;
    }
    try {
      setMemoryBackfillSessionPreparing(true);
      const seedPrompt = buildMemoryBackfillSeedPrompt(projects);
      const memorySettings = await window.orxa.opencode.getMemorySettings(targetProject.worktree);
      const memoryEnabled = memorySettings.workspace?.enabled ?? memorySettings.global.enabled;
      if (!memoryEnabled) {
        await window.orxa.opencode.updateMemorySettings({
          directory: targetProject.worktree,
          workspace: {
            enabled: true,
          },
        });
      }
      await selectProject(targetProject.worktree);
      const created = await opencodeClient.createSession(targetProject.worktree, "Memory Backfill");
      const latest = await opencodeClient.refreshProject(targetProject.worktree);
      setProjectData(latest);
      setActiveSessionID(created.id);
      setMessages([]);
      setComposer(seedPrompt);
      setSidebarMode("projects");
      const targetLabel = targetProject.name || targetProject.worktree.split("/").at(-1) || targetProject.worktree;
      if (!memoryEnabled) {
        setStatusLine(`Prepared backfill session for ${targetLabel}. Memory was enabled for this workspace; review prompt and press Send.`);
      } else {
        setStatusLine(`Prepared backfill session for ${targetLabel}. Review prompt and press Send.`);
      }
    } catch (error) {
      setMemoryGraphError(error instanceof Error ? error.message : String(error));
    } finally {
      setMemoryBackfillSessionPreparing(false);
    }
  }, [
    activeProjectDir,
    memoryBackfillSessionPreparing,
    projects,
    selectProject,
    setActiveSessionID,
    setComposer,
    setMessages,
    setProjectData,
    setSidebarMode,
  ]);

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
    async (skill: SkillEntry, targetProjectDir: string, sessionTarget: SkillPromptTarget) => {
      try {
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

        let targetSessionID: string | null = null;
        let usedCurrentSession = false;
        if (sessionTarget === "current" && activeProjectDir === targetProjectDir && activeSessionID) {
          const currentSessionAvailable = latest.sessions.some(
            (item) => item.id === activeSessionID && !item.time.archived,
          );
          if (currentSessionAvailable) {
            targetSessionID = activeSessionID;
            usedCurrentSession = true;
          }
        }

        if (!targetSessionID) {
          const created = await opencodeClient.createSession(targetProjectDir, `Skill: ${skill.name}`);
          targetSessionID = created.id;
          setMessages([]);
        } else {
          const msgs = await opencodeClient.loadMessages(targetProjectDir, targetSessionID).catch(() => []);
          messageCacheRef.current[`${targetProjectDir}:${targetSessionID}`] = msgs;
          setMessages(msgs);
        }

        setActiveSessionID(targetSessionID);
        setComposer(seedPrompt);
        setSidebarMode("projects");
        setSkillUseModal(null);
        const projectLabel = project.name || project.worktree.split("/").at(-1) || project.worktree;
        const targetLabel = usedCurrentSession ? "current session" : "new session";
        setStatusLine(`Prepared skill prompt for ${projectLabel} (${targetLabel})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatusLine(message);
        pushToast(message, "warning");
      }
    },
    [activeProjectDir, activeSessionID, projects, pushToast, selectProject, setActiveSessionID, setComposer, setMessages, setProjectData, setSidebarMode],
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

  const removeProjectDirectory = useCallback(
    async (directory: string, label: string) => {
      try {
        const confirmed = await requestConfirmation({
          title: "Remove workspace",
          message: `Remove "${label}" from Orxa Code workspace list?`,
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
    [activeProjectDir, bootstrap, requestConfirmation, setActiveProjectDir, setActiveSessionID, setMessages, setProjectData],
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
    [refreshProject, setTextInputDialog],
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
    [activeSessionID, refreshProject, setActiveSessionID],
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
    [bootstrap, selectProject, setActiveSessionID, setTextInputDialog],
  );

  useEffect(() => {
    const activeStatus = activeSessionID ? projectData?.sessionStatus[activeSessionID]?.type : undefined;
    const canAbortSession = activeStatus === "busy" || activeStatus === "retry" || isSendingPrompt;
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
      if (canAbortSession) {
        event.preventDefault();
        void abortActiveSession();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [abortActiveSession, activeSessionID, isSendingPrompt, projectData, setBranchMenuOpen]);

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
  }, [setBranchMenuOpen]);

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
  }, [setLeftPaneWidth, setRightPaneWidth]);

  useEffect(() => {
    setTitleMenuOpen(false);
    setOpenMenuOpen(false);
    setCommitMenuOpen(false);
    setBranchMenuOpen(false);
  }, [activeProjectDir, activeSessionID, setBranchMenuOpen]);

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
        }
        return;
      }
      const nonPlanAgent = agentOptions.find((a) => a.name !== "plan");
      setSelectedAgent(nonPlanAgent?.name ?? agentOptions[0]?.name);
    },
    [agentOptions, hasPlanAgent],
  );

  const activeSession = useMemo(
    () => sessions.find((item) => item.id === activeSessionID),
    [activeSessionID, sessions],
  );
  const currentSessionStatus = activeSessionID ? projectData?.sessionStatus[activeSessionID] : undefined;
  const isSessionBusy = currentSessionStatus?.type === "busy" || currentSessionStatus?.type === "retry";
  const isSessionInProgress = isSessionBusy || isSendingPrompt;
  const contentPaneTitle = activeSession?.title?.trim() || activeSession?.slug || activeProject?.name || "Untitled session";
  const isActiveSessionPinned = Boolean(
    activeProjectDir && activeSessionID && (pinnedSessions[activeProjectDir] ?? []).includes(activeSessionID),
  );
  const orxaTodos = useMemo(() => extractOrxaTodos(messages), [messages]);
  const completedTodoCount = useMemo(
    () => orxaTodos.reduce((count, todo) => (isTodoCompleted(todo) ? count + 1 : count), 0),
    [orxaTodos],
  );
  const allTodosCompleted = orxaTodos.length > 0 && completedTodoCount === orxaTodos.length;
  const effectiveBrowserState = useMemo(() => buildAppShellBrowserSidebarState({
    runtimeState: browserRuntimeState,
    history: browserHistoryItems,
    modeEnabled: browserModeEnabled,
    controlOwner: browserControlOwner,
    actionRunning: browserActionRunning,
    isSessionInProgress,
  }), [browserActionRunning, browserControlOwner, browserHistoryItems, browserModeEnabled, browserRuntimeState, isSessionInProgress]);

  useEffect(() => {
    if (browserAutomationHalted) {
      setBrowserActionRunning(false);
    }
  }, [browserAutomationHalted]);

  useBrowserAgentBridge({
    activeProjectDir: activeProjectDir ?? null,
    activeSessionID: activeSessionID ?? null,
    messages,
    browserModeEnabled,
    controlOwner: browserControlOwner,
    automationHalted: browserAutomationHalted,
    onActionStart: () => {
      setRightSidebarTab("browser");
      setBrowserActionRunning(true);
    },
    onStatus: setStatusLine,
    onGuardrailViolation: handleBrowserGuardrailViolation,
  });


  const composerOffsetLift = Math.max(0, composerLayoutHeight - DEFAULT_COMPOSER_LAYOUT_HEIGHT);
  const messageFeedBottomClearance = useMemo(() => {
    if (orxaTodos.length === 0) {
      return 24;
    }
    const base = todosOpen ? 286 : 78;
    return base + composerOffsetLift;
  }, [composerOffsetLift, orxaTodos.length, todosOpen]);
  const composerAnchorBottom = useMemo(
    () => Math.max(0, composerLayoutHeight - COMPOSER_DRAWER_ATTACH_OFFSET) + (terminalOpen ? 286 : 0),
    [composerLayoutHeight, terminalOpen],
  );
  const todosDrawerStyle = useMemo(
    () =>
      ({
        "--todos-anchor-bottom": `${composerAnchorBottom}px`,
      }) as CSSProperties,
    [composerAnchorBottom],
  );
  const composerToastStyle = useMemo(
    () =>
      ({
        "--composer-toast-bottom": `${Math.max(116, composerAnchorBottom - 4)}px`,
      }) as CSSProperties,
    [composerAnchorBottom],
  );
  const pendingPermission = useMemo(() => (projectData?.permissions ?? [])[0], [projectData?.permissions]);
  const isPermissionDecisionInFlight = Boolean(
    pendingPermission &&
      permissionDecisionPending !== null &&
      permissionDecisionPendingRequestID === pendingPermission.id,
  );

  useEffect(() => {
    if (!permissionDecisionPending) {
      if (permissionDecisionPendingRequestID !== null) {
        setPermissionDecisionPendingRequestID(null);
      }
      return;
    }
    if (!pendingPermission || permissionDecisionPendingRequestID !== pendingPermission.id) {
      setPermissionDecisionPending(null);
      setPermissionDecisionPendingRequestID(null);
    }
  }, [pendingPermission, permissionDecisionPending, permissionDecisionPendingRequestID]);

  useEffect(() => {
    if (appPreferences.permissionMode !== "yolo-write") {
      return;
    }
    if (!activeProjectDir || !pendingPermission || isPermissionDecisionInFlight) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        setPermissionDecisionPending("once");
        setPermissionDecisionPendingRequestID(pendingPermission.id);
        await window.orxa.opencode.replyPermission(
          activeProjectDir,
          pendingPermission.id,
          "once",
          "Auto-approved in Yolo mode",
        );
        if (!cancelled) {
          await refreshProject(activeProjectDir);
        }
      } catch (error) {
        if (!cancelled) {
          setStatusLine(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setPermissionDecisionPending(null);
          setPermissionDecisionPendingRequestID(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeProjectDir,
    appPreferences.permissionMode,
    isPermissionDecisionInFlight,
    pendingPermission,
    permissionDecisionPendingRequestID,
    refreshProject,
    setStatusLine,
  ]);
  const pendingQuestion = useMemo(() => (projectData?.questions ?? [])[0] ?? null, [projectData?.questions]);

  // Hide BrowserView when permission/question modals are open
  useEffect(() => {
    if (pendingPermission || pendingQuestion) {
      void window.orxa.browser.setVisible(false).catch(() => {});
    }
  }, [pendingPermission, pendingQuestion]);

  const workspaceClassName = [
    "workspace",
    showGitPane ? "" : "workspace-no-ops",
    showProjectsPane ? "" : "workspace-left-collapsed",
    showGitPane ? "" : "workspace-right-collapsed",
    hasProjectContext ? "workspace-has-topbar" : "",
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
    setDockTodosOpen(false);
    setSdkTodoItems([]);
  }, [activeSessionID]);

  const createTerminalTab = useCallback(async (): Promise<string> => {
    if (!activeProjectDir) {
      throw new Error("No active workspace selected.");
    }

    const cwd = projectData?.path.directory ?? activeProjectDir;
    const tabNum = terminalTabs.length + 1;
    const pty = await window.orxa.terminal.create(activeProjectDir, cwd, `Tab ${tabNum}`);
    const newTab = { id: pty.id, label: `Tab ${tabNum}` };
    setTerminalTabs((prev) => [...prev, newTab]);
    setActiveTerminalId(pty.id);
    setTerminalOpen(true);
    return pty.id;
  }, [activeProjectDir, projectData?.path.directory, terminalTabs.length]);

  const createTerminal = useCallback(async () => {
    try {
      await createTerminalTab();
      setStatusLine("Terminal created");
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, [createTerminalTab]);

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

  const upsertCustomRunCommand = useCallback(
    (input: CustomRunCommandInput): CustomRunCommandPreset => {
      const title = input.title.trim();
      const commands = input.commands.replace(/\r\n/g, "\n").trim();
      if (!title) {
        throw new Error("Name is required.");
      }
      if (!commands) {
        throw new Error("Add at least one command.");
      }

      const normalizedID = input.id?.trim();
      const next: CustomRunCommandPreset = {
        id: normalizedID && normalizedID.length > 0 ? normalizedID : `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        commands,
        updatedAt: Date.now(),
      };
      setCustomRunCommands((current) => {
        const remaining = current.filter((item) => item.id !== next.id);
        return [next, ...remaining].sort((a, b) => b.updatedAt - a.updatedAt);
      });
      return next;
    },
    [setCustomRunCommands],
  );

  const runCustomRunCommand = useCallback(
    async (preset: CustomRunCommandPreset) => {
      if (!activeProjectDir) {
        setStatusLine("Select a workspace before running commands.");
        return;
      }
      const commandLines = splitCommandLines(preset.commands);
      if (commandLines.length === 0) {
        setStatusLine(`No commands found for ${preset.title}.`);
        return;
      }

      let targetPtyID = activeTerminalId ?? terminalTabs[0]?.id;
      try {
        if (!targetPtyID) {
          targetPtyID = await createTerminalTab();
        }

        if (activeTerminalId !== targetPtyID) {
          setActiveTerminalId(targetPtyID);
        }
        setTerminalOpen(true);
        await window.orxa.terminal.connect(activeProjectDir, targetPtyID);
        for (const command of commandLines) {
          await window.orxa.terminal.write(activeProjectDir, targetPtyID, `${command}\n`);
        }
        setStatusLine(
          `Ran ${commandLines.length} command${commandLines.length === 1 ? "" : "s"} from ${preset.title}.`,
        );
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
      }
    },
    [activeProjectDir, activeTerminalId, createTerminalTab, terminalTabs],
  );

  const deleteCustomRunCommand = useCallback(
    (id: string) => {
      setCustomRunCommands((current) => current.filter((item) => item.id !== id));
      setStatusLine("Custom run command deleted.");
    },
    [setCustomRunCommands],
  );

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
        if (reply === "always") {
          setAppPreferences((current) =>
            current.permissionMode === "yolo-write"
              ? current
              : {
                  ...current,
                  permissionMode: "yolo-write",
                },
          );
        }
        setPermissionDecisionPending(reply);
        setPermissionDecisionPendingRequestID(pendingPermission.id);
        await withTimeout(
          window.orxa.opencode.replyPermission(activeProjectDir, pendingPermission.id, reply),
          PERMISSION_REPLY_TIMEOUT_MS,
          "Permission response timed out. Please try again.",
        );
        await refreshProject(activeProjectDir);
        setStatusLine(`Permission ${reply === "reject" ? "rejected" : "approved"}`);
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
      } finally {
        setPermissionDecisionPending(null);
        setPermissionDecisionPendingRequestID(null);
      }
    },
    [
      activeProjectDir,
      appPreferences.confirmDangerousActions,
      pendingPermission,
      refreshProject,
      requestConfirmation,
      setAppPreferences,
      setStatusLine,
    ],
  );

  const replyPendingQuestion = useCallback(
    async (answers: QuestionAnswer[]) => {
      if (!activeProjectDir || !pendingQuestion) {
        return;
      }
      const normalized = answers.map((item) => item.map((value) => value.trim()).filter((value) => value.length > 0));
      if (!normalized.some((item) => item.length > 0)) {
        return;
      }
      try {
        await window.orxa.opencode.replyQuestion(activeProjectDir, pendingQuestion.id, normalized);
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

  // --- Dock props for ComposerPanel ---

  const dockPendingPermission = useMemo(() => {
    if (!pendingPermission || isPermissionDecisionInFlight) return null;
    return {
      description: pendingPermission.permission ?? "Permission requested",
      filePattern: pendingPermission.patterns?.[0],
      command: undefined as string[] | undefined,
      onDecide: (decision: "allow_once" | "allow_always" | "reject") => {
        const replyMap: Record<string, "once" | "always" | "reject"> = {
          allow_once: "once",
          allow_always: "always",
          reject: "reject",
        };
        void replyPendingPermission(replyMap[decision]);
      },
    };
  }, [pendingPermission, isPermissionDecisionInFlight, replyPendingPermission]);

  const dockPendingQuestion = useMemo(() => {
    if (!pendingQuestion) return null;
    const mapped: AgentQuestion[] = (pendingQuestion.questions ?? []).map(
      (qi: { question: string; header?: string; options?: Array<{ label: string; description?: string }>; multiple?: boolean }, idx: number) => ({
        id: `${pendingQuestion.id}-q${idx}`,
        header: qi.header,
        text: qi.question,
        options: qi.options?.map((opt) => ({ label: opt.label, value: opt.label })),
        multiSelect: qi.multiple,
      }),
    );
    return {
      questions: mapped,
      onSubmit: (answers: Record<string, string | string[]>) => {
        const ordered: QuestionAnswer[] = mapped.map((q) => {
          const ans = answers[q.id];
          if (!ans) return [] as string[];
          if (Array.isArray(ans)) return ans;
          return [ans];
        });
        void replyPendingQuestion(ordered);
      },
      onReject: () => {
        void rejectPendingQuestion();
      },
    };
  }, [pendingQuestion, replyPendingQuestion, rejectPendingQuestion]);

  // ── Desktop notifications ──────────────────────────────────────────
  const prevSessionBusy = useRef(false);

  useEffect(() => {
    if (!appPreferences.notifyOnAwaitingInput || document.hasFocus()) return;
    if (dockPendingPermission || dockPendingQuestion) {
      new Notification("Orxa Code", {
        body: dockPendingQuestion ? "Agent is asking a question" : "Agent needs permission to continue",
        silent: false,
      }).onclick = () => window.focus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dockPendingPermission, dockPendingQuestion]);

  useEffect(() => {
    const isBusy = isSessionInProgress;
    const wasBusy = prevSessionBusy.current;
    prevSessionBusy.current = isBusy;
    if (!appPreferences.notifyOnTaskComplete || document.hasFocus()) return;
    if (wasBusy && !isBusy && activeSessionID) {
      new Notification("Orxa Code", {
        body: "Agent has finished its task",
        silent: false,
      }).onclick = () => window.focus();
    }
  }, [isSessionInProgress, activeSessionID, appPreferences.notifyOnTaskComplete]);

  // Auto-send first queued followup when session becomes idle
  const prevSessionBusyForQueue = useRef(false);
  useEffect(() => {
    const isBusy = isSessionInProgress;
    const wasBusy = prevSessionBusyForQueue.current;
    prevSessionBusyForQueue.current = isBusy;
    if (wasBusy && !isBusy && followupQueue.length > 0) {
      // Session just went idle — show the dock so user can choose to send
      // (The dock is already visible; no auto-send to keep user in control)
    }
  }, [isSessionInProgress, followupQueue.length]);

  // Clear queue when active session changes
  useEffect(() => {
    setFollowupQueue([]);
    setSendingQueuedId(undefined);
  }, [activeSessionID]);

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

  const selectOpenTarget = useCallback(
    (target: OpenTarget) => {
      setPreferredOpenTarget(target);
      setOpenMenuOpen(false);
    },
    [setPreferredOpenTarget],
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
    [activeProjectDir, setCommitModalOpen, setCommitNextStep],
  );

  const openTodoReviewChanges = useCallback(() => {
    setAppPreferences((current) => ({
      ...current,
      showOperationsPane: true,
    }));
    setRightSidebarTab("git");
    setGitPanelTab("diff");
    void loadGitDiff();
  }, [loadGitDiff, setAppPreferences, setGitPanelTab, setRightSidebarTab]);

  const handleComposerLayoutHeightChange = useCallback((height: number) => {
    setComposerLayoutHeight((current) => (current === height ? current : height));
  }, []);

  const openPendingPullRequest = useCallback(() => {
    if (!pendingPrUrl) {
      return;
    }
    void window.orxa.app.openExternal(pendingPrUrl)
      .then(() => {
        setStatusLine("Opened pull request");
      })
      .catch((error) => {
        setStatusLine(error instanceof Error ? error.message : String(error));
      });
    setPendingPrUrl(null);
    setCommitMenuOpen(false);
    setOpenMenuOpen(false);
    setTitleMenuOpen(false);
  }, [pendingPrUrl, setStatusLine]);

  const submitCommit = useCallback(async () => {
    if (!activeProjectDir) {
      return;
    }
    const selectedNextStep = commitNextStep;
    clearCommitFlowDismissTimer();
    try {
      setCommitModalOpen(false);
      setCommitSubmitting(true);
      startCommitFlow(selectedNextStep);
      const result = await window.orxa.opencode.gitCommit(activeProjectDir, {
        includeUnstaged: commitIncludeUnstaged,
        message: commitMessageDraft.trim().length > 0 ? commitMessageDraft.trim() : undefined,
        guidancePrompt: appPreferences.commitGuidancePrompt,
        baseBranch: selectedNextStep === "commit_and_create_pr" ? commitBaseBranch || undefined : undefined,
        nextStep: selectedNextStep,
      });
      setCommitMessageDraft("");
      const prSuffix = result.prUrl ? ` • PR ${result.prUrl}` : "";
      const pushSuffix = result.pushed ? " • pushed" : "";
      setStatusLine(`Committed ${result.commitHash.slice(0, 7)}${pushSuffix}${prSuffix}`);
      if (result.prUrl) {
        setPendingPrUrl(result.prUrl);
      }
      completeCommitFlow(selectedNextStep);
      scheduleCommitFlowDismiss(1150);
      await refreshProject(activeProjectDir);
      if (rightSidebarTab === "git") {
        void loadGitDiff();
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setStatusLine(detail);
      failCommitFlow(selectedNextStep, detail);
    } finally {
      setCommitSubmitting(false);
    }
  }, [
    activeProjectDir,
    appPreferences.commitGuidancePrompt,
    completeCommitFlow,
    clearCommitFlowDismissTimer,
    commitBaseBranch,
    commitIncludeUnstaged,
    commitMessageDraft,
    commitNextStep,
    failCommitFlow,
    loadGitDiff,
    rightSidebarTab,
    refreshProject,
    scheduleCommitFlowDismiss,
    startCommitFlow,
    setCommitMessageDraft,
    setCommitModalOpen,
    setCommitSubmitting,
  ]);

  const appendPathToComposer = useCallback((filePath: string) => {
    setComposer((current) => (current.trim().length > 0 ? `${current}\n${filePath}` : filePath));
  }, [setComposer]);

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
  const homeDashboardProps = useMemo(() => buildAppShellHomeDashboardProps({
    dashboard,
    codexSessionCount,
    claudeSessionCount,
    codexUsage,
    claudeUsage,
    codexUsageLoading,
    claudeUsageLoading,
    onRefreshCodexUsage: () => void refreshCodexUsage(),
    onRefreshClaudeUsage: () => void refreshClaudeUsage(),
    onRefresh: () => void refreshDashboard(),
    onAddWorkspace: () => void addProjectDirectory(),
    onOpenSettings: () => setSettingsOpen(true),
  }), [
    addProjectDirectory,
    claudeSessionCount,
    claudeUsage,
    claudeUsageLoading,
    codexSessionCount,
    codexUsage,
    codexUsageLoading,
    dashboard,
    refreshClaudeUsage,
    refreshCodexUsage,
    refreshDashboard,
  ]);

  return (
    <div className="app-shell">
      <div className="window-drag-region" />
      {startupState.phase === "running" ? (
        <section className="startup-overlay" aria-live="polite" role="status">
          <div className="startup-card">
            <h2>Initializing Orxa Code</h2>
            <p>{startupState.message}</p>
            <div className="startup-meter" aria-label="Startup progress">
              <div className="startup-meter-fill" style={{ width: `${startupProgressPercent}%` }} />
            </div>
            <small>{startupProgressPercent}%</small>
          </div>
        </section>
      ) : null}
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
          isActiveSessionCanvasSession={Boolean(activeSessionID && sessionTypes[activeSessionID] === "canvas")}
          activeSessionType={activeSessionID ? sessionTypes[activeSessionID] : undefined}
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
          onViewWorkspace={() => {
            setTitleMenuOpen(false);
            openWorkspaceDashboard();
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
          onSelectOpenTarget={selectOpenTarget}
          openDirectoryInTarget={openDirectoryInTarget}
          openCommitModal={openCommitModal}
          pendingPrUrl={pendingPrUrl}
          onOpenPendingPullRequest={openPendingPullRequest}
          commitNextStepOptions={commitNextStepOptions}
          setCommitNextStep={setCommitNextStep}
          customRunCommands={customRunCommands}
          onUpsertCustomRunCommand={upsertCustomRunCommand}
          onRunCustomRunCommand={runCustomRunCommand}
          onDeleteCustomRunCommand={deleteCustomRunCommand}
        />
      ) : null}
      <div ref={workspaceRef} className={workspaceClassName} style={workspaceStyle}>
        <div className={`workspace-left-pane ${showProjectsPane ? "open" : "collapsed"}`.trim()}>
          <WorkspaceSidebar
            sidebarMode={sidebarMode}
            setSidebarMode={setSidebarMode}
            unreadJobRunsCount={unreadJobRunsCount}
            updateAvailableVersion={availableUpdateVersion}
            updateInstallPending={updateInstallPending}
            onDownloadAndInstallUpdate={downloadAndInstallUpdate}
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
            sessionTypes={sessionTypes}
            sessionTitles={sessionTitles}
            selectProject={selectProject}
            createSession={createSession}
            openSession={openSession}
            openProjectContextMenu={openProjectContextMenu}
            openSessionContextMenu={openSessionContextMenu}
            addProjectDirectory={() => addProjectDirectory()}
            setProfileModalOpen={setProfileModalOpen}
            onOpenDebugLogs={() => setDebugModalOpen(true)}
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
          ) : sidebarMode === "memory" ? (
            <MemoryBoard
              snapshot={memoryGraph}
              loading={memoryGraphLoading}
              error={memoryGraphError}
              workspaceFilter={memoryWorkspaceFilter}
              workspaceOptions={projects.map((project) => project.worktree)}
              onWorkspaceFilterChange={setMemoryWorkspaceFilter}
              onRefresh={() => void loadMemoryGraph()}
              onPrepareBackfillSession={() => void prepareMemoryBackfillSession()}
              preparingBackfillSession={memoryBackfillSessionPreparing}
              backfillStatus={memoryBackfillStatus}
            />
          ) : activeProjectDir ? (
            <>
              {activeSessionID && sessionTypes[activeSessionID] === "canvas" ? (
                <CanvasPane canvasState={canvasState} directory={activeProjectDir} mcpDevToolsState={mcpDevToolsState} />
              ) : activeSessionID && sessionTypes[activeSessionID] === "claude" ? (
                <ClaudeTerminalPane directory={activeProjectDir} onExit={openWorkspaceDashboard} onFirstInteraction={() => activeSessionID && markSessionUsed(activeSessionID)} />
              ) : activeSessionID && sessionTypes[activeSessionID] === "codex" ? (
                <CodexPane
                  directory={activeProjectDir}
                  onExit={openWorkspaceDashboard}
                  onFirstMessage={() => activeSessionID && markSessionUsed(activeSessionID)}
                  onTitleChange={(title) => activeSessionID && setSessionTitles((prev) => ({ ...prev, [activeSessionID]: title }))}
                  notifyOnAwaitingInput={appPreferences.notifyOnAwaitingInput}
                  subagentSystemNotificationsEnabled={appPreferences.subagentSystemNotificationsEnabled}
                  onAwaitingChange={(awaiting) => setCodexAwaiting(awaiting)}
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
                  branchActionError={branchActionError}
                  clearBranchActionError={() => setBranchActionError(null)}
                  checkoutBranch={checkoutBranch}
                  filteredBranches={filteredBranches}
                  openBranchCreateModal={openBranchCreateModal}
                />
              ) : (
                <>
                  <MessageFeed
                    messages={messages}
                    sessionNotices={activeSessionNotices}
                    showAssistantPlaceholder={isSessionInProgress}
                    assistantLabel={assistantLabel}
                    workspaceDirectory={activeProjectDir ?? null}
                    bottomClearance={messageFeedBottomClearance}
                  />

                  {orxaTodos.length > 0 ? (
                    <section className={`todos-drawer ${todosOpen ? "open" : "closed"}`.trim()} style={todosDrawerStyle}>
                      <button type="button" className="todos-drawer-toggle" onClick={() => setTodosOpen((value) => !value)}>
                        <span className="todos-drawer-progress">
                          {completedTodoCount} out of {orxaTodos.length} tasks completed
                        </span>
                        <small>{todosOpen ? "Hide" : "Show"}</small>
                      </button>
                      <div className="todos-drawer-body" aria-hidden={!todosOpen}>
                        <div className="todos-drawer-body-inner">
                          <ol>
                            {orxaTodos.map((todo, index) => {
                              const completed = isTodoCompleted(todo);
                              return (
                                <li key={todo.id} className={completed ? "completed" : ""}>
                                  <div className="todo-item-main">
                                    <span className={`todo-item-status ${completed ? "done" : "pending"}`.trim()}>{completed ? "✓" : ""}</span>
                                    <span className="todo-item-index">{index + 1}.</span>
                                    <span className="todo-item-content">{todo.content}</span>
                                  </div>
                                  {todo.status || todo.priority ? (
                                    <small>
                                      {[todo.status, todo.priority].filter(Boolean).join(" • ")}
                                    </small>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ol>
                          <div className="todos-drawer-footer">
                            <span className="todos-drawer-diff">
                              {gitDiffStats.hasChanges
                                ? `${gitDiffStats.filesChanged} files changed`
                                : "No local changes"}
                              {gitDiffStats.hasChanges ? (
                                <>
                                  <strong className="todos-drawer-diff-add"> +{gitDiffStats.additions}</strong>
                                  <strong className="todos-drawer-diff-del"> -{gitDiffStats.deletions}</strong>
                                </>
                              ) : null}
                            </span>
                            {allTodosCompleted ? (
                              <button type="button" className="todos-review-btn" onClick={openTodoReviewChanges}>
                                Review changes
                              </button>
                            ) : null}
                          </div>
                          <div className="todos-drawer-label">{todosLabel}</div>
                        </div>
                      </div>
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
                    addComposerAttachments={addComposerAttachments}
                    sendPrompt={sendComposerPrompt}
                    abortActiveSession={abortActiveSession}
                    isSessionBusy={isSessionInProgress}
                    isSendingPrompt={isSendingPrompt}
                    pickImageAttachment={pickImageAttachment}
                    hasActiveSession={Boolean(activeSessionID)}
                    isPlanMode={isPlanMode}
                    hasPlanAgent={hasPlanAgent}
                    togglePlanMode={togglePlanMode}
                    browserModeEnabled={browserModeEnabled}
                    setBrowserModeEnabled={(enabled) => void setBrowserMode(enabled)}
                    agentOptions={composerAgentOptions}
                    selectedAgent={selectedAgent}
                    onAgentChange={setSelectedAgent}
                    permissionMode={appPreferences.permissionMode}
                    onPermissionModeChange={(mode) => setAppPreferences({ ...appPreferences, permissionMode: mode })}
                    compactionProgress={compactionMeter.progress}
                    compactionHint={compactionMeter.hint}
                    compactionCompacted={compactionMeter.compacted}
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
                    branchActionError={branchActionError}
                    clearBranchActionError={() => setBranchActionError(null)}
                    checkoutBranch={checkoutBranch}
                    filteredBranches={filteredBranches}
                    openBranchCreateModal={openBranchCreateModal}
                    modelSelectOptions={modelSelectOptions}
                    selectedModel={selectedModel}
                    setSelectedModel={setSelectedModel}
                    selectedVariant={selectedVariant}
                    setSelectedVariant={setSelectedVariant}
                    variantOptions={variantOptions}
                    placeholder={composerPlaceholder}
                    onLayoutHeightChange={handleComposerLayoutHeightChange}
                    todoItems={sdkTodoItems}
                    todoOpen={dockTodosOpen}
                    onTodoToggle={() => setDockTodosOpen((v) => !v)}
                    pendingPermission={dockPendingPermission}
                    pendingQuestion={dockPendingQuestion}
                    queuedMessages={followupQueue}
                    sendingQueuedId={sendingQueuedId}
                    onQueueMessage={queueFollowupMessage}
                    onSendQueuedNow={(id) => {
                      const item = followupQueue.find((m) => m.id === id);
                      if (!item || sendingQueuedId) return;
                      setSendingQueuedId(id);
                      removeQueuedMessage(id);
                      setComposer(item.text);
                    }}
                    onEditQueued={editQueuedMessage}
                    onRemoveQueued={removeQueuedMessage}
                  />

                </>
              )}
              {!(activeSessionID && (sessionTypes[activeSessionID] === "canvas" || sessionTypes[activeSessionID] === "codex" || sessionTypes[activeSessionID] === "claude")) && (
                <TerminalPanel
                  directory={activeProjectDir}
                  tabs={terminalTabs}
                  activeTabId={activeTerminalId}
                  open={terminalOpen}
                  onCreateTab={createTerminal}
                  onCloseTab={closeTerminalTab}
                  onSwitchTab={setActiveTerminalId}
                />
              )}
            </>
          ) : (
            <HomeDashboard {...homeDashboardProps} />
          )}
          {toasts.length > 0 ? (
            <div className="composer-toast-stack" style={composerToastStyle} role="status" aria-live="polite">
              {toasts.map((toast) => (
                <article key={toast.id} className={`composer-toast ${toast.tone}`.trim()}>
                  <p>{toast.message}</p>
                  <button type="button" onClick={() => dismissToast(toast.id)} aria-label="Dismiss notification">
                    ×
                  </button>
                </article>
              ))}
            </div>
          ) : null}
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
              fileProvenanceByPath={sessionProvenanceByPath}
              onAddToChatPath={appendPathToComposer}
              onStatusChange={setStatusLine}
              browserState={effectiveBrowserState}
              onBrowserOpenTab={browserOpenTab}
              onBrowserCloseTab={browserCloseTab}
              onBrowserNavigate={browserNavigate}
              onBrowserGoBack={browserGoBack}
              onBrowserGoForward={browserGoForward}
              onBrowserReload={browserReload}
              onBrowserSelectTab={browserSelectTab}
              onBrowserSelectHistory={browserSelectHistory}
              onBrowserReportViewportBounds={browserReportViewportBounds}
              onBrowserTakeControl={browserTakeControl}
              onBrowserHandBack={browserHandBack}
              onBrowserStop={browserStop}
              mcpDevToolsState={mcpDevToolsState}
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
                  onClick={() => {
                    const { directory, label } = contextMenu;
                    setContextMenu(null);
                    void changeProjectDirectory(directory, label);
                  }}
                >
                  Change Working Directory...
                </button>
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

      {debugModalOpen ? (
        <div className="overlay debug-log-overlay" onClick={() => setDebugModalOpen(false)}>
          <section
            className="modal debug-log-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Session debug logs"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-header">
              <div>
                <h2>Session Debug Logs</h2>
                <small className="debug-log-subtitle">Current status: {statusLine}</small>
              </div>
              <button type="button" onClick={() => setDebugModalOpen(false)}>
                Close
              </button>
            </header>
            <div className="debug-log-toolbar">
              <span className="debug-log-filter-label">Filter level</span>
              {(["all", "info", "warn", "error"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  className={debugLogLevelFilter === level ? "active" : ""}
                  onClick={() => setDebugLogLevelFilter(level)}
                >
                  {level === "all" ? "All" : level.toUpperCase()}
                </button>
              ))}
              <button type="button" className="debug-log-copy-btn" onClick={() => void copyDebugLogsAsJson()}>
                Copy logs as JSON
              </button>
            </div>
            <div className="debug-log-list" role="log" aria-live="polite">
              {filteredDebugLogs.length === 0 ? (
                <p className="dashboard-empty">No debug logs yet.</p>
              ) : (
                filteredDebugLogs
                  .slice()
                  .reverse()
                  .map((entry) => (
                    <article key={entry.id} className={`debug-log-item ${entry.level}`.trim()}>
                      <div className="debug-log-item-meta">
                        <span>{new Date(entry.time).toLocaleTimeString()}</span>
                        <span>{entry.eventType}</span>
                      </div>
                      <p>{entry.summary}</p>
                      {entry.details ? (
                        <details>
                          <summary>Details</summary>
                          <pre>{entry.details}</pre>
                        </details>
                      ) : null}
                    </article>
                  ))
              )}
            </div>
          </section>
        </div>
      ) : null}

      {updateProgressState ? (
        <div className="overlay" onClick={updateProgressState.phase === "error" ? () => setUpdateProgressState(null) : undefined}>
          <section className="modal update-progress-modal" onClick={(event) => event.stopPropagation()}>
            <div className="update-progress-body">
              {updateProgressState.phase === "error" ? (
                <>
                  <h2>Update failed</h2>
                  <p>{updateProgressState.message}</p>
                  <button type="button" onClick={() => setUpdateProgressState(null)}>
                    Dismiss
                  </button>
                </>
              ) : (
                <>
                  <span className="session-status-indicator busy commit-progress-spinner" aria-hidden="true" />
                  <h2>
                    {updateProgressState.phase === "installing" ? "Installing update" : "Downloading update"}
                    {updateProgressState.version ? ` ${updateProgressState.version}` : ""}
                  </h2>
                  <p>{updateProgressState.message}</p>
                  {updateProgressState.phase === "downloading" ? (
                    <div className="update-progress-meter" aria-label="Update download progress">
                      <div
                        className="update-progress-meter-fill"
                        style={{
                          width: `${Math.max(0, Math.min(100, updateProgressState.percent ?? 0))}%`,
                        }}
                      />
                    </div>
                  ) : null}
                  {updateProgressState.phase === "downloading" ? (
                    <small>{typeof updateProgressState.percent === "number" ? `${Math.round(updateProgressState.percent)}%` : "Starting..."}</small>
                  ) : null}
                </>
              )}
            </div>
          </section>
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
        onConfirm={submitTextInputDialog}
        onCancel={closeTextInputDialog}
      />

      <GlobalModalsHost
        activeProjectDir={activeProjectDir}
        permissionMode={appPreferences.permissionMode}
        dependencyReport={dependencyReport}
        dependencyModalOpen={dependencyModalOpen}
        setDependencyModalOpen={setDependencyModalOpen}
        onCheckDependencies={refreshRuntimeDependencies}
        permissionRequest={pendingPermission ?? null}
        permissionDecisionInFlight={isPermissionDecisionInFlight}
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
        commitBaseBranch={commitBaseBranch}
        setCommitBaseBranch={setCommitBaseBranch}
        commitBaseBranchOptions={commitBaseBranchOptions}
        commitBaseBranchLoading={branchLoading}
        commitFlowState={commitFlowState}
        dismissCommitFlowState={dismissCommitFlowState}
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
        directory={activeProjectDir}
        onClose={() => setSettingsOpen(false)}
        onReadRaw={(scope, directory) => window.orxa.opencode.readRawConfig(scope, directory)}
        onWriteRaw={async (scope, content, directory) => {
          const doc = await window.orxa.opencode.writeRawConfig(scope, content, directory);
          if (scope === "global") {
            await Promise.all([refreshConfigModels(), refreshGlobalProviders()]);
          }
          if (directory) {
            await refreshProject(directory);
          }
          setStatusLine("Raw config saved");
          return doc;
        }}
        onReadGlobalAgentsMd={() => window.orxa.opencode.readGlobalAgentsMd()}
        onWriteGlobalAgentsMd={async (content) => {
          const doc = await window.orxa.opencode.writeGlobalAgentsMd(content);
          setStatusLine("Global AGENTS.md saved");
          return doc;
        }}
        appPreferences={appPreferences}
        onAppPreferencesChange={setAppPreferences}
        onGetServerDiagnostics={() => window.orxa.opencode.getServerDiagnostics()}
        onRepairRuntime={() => window.orxa.opencode.repairRuntime()}
        onGetUpdatePreferences={() => window.orxa.updates.getPreferences()}
        onSetUpdatePreferences={(input) => window.orxa.updates.setPreferences(input)}
        onCheckForUpdates={() => window.orxa.updates.checkNow()}
        onGetMemorySettings={(directory) => window.orxa.opencode.getMemorySettings(directory)}
        onUpdateMemorySettings={(input) => window.orxa.opencode.updateMemorySettings(input)}
        onListMemoryTemplates={() => window.orxa.opencode.listMemoryTemplates()}
        onApplyMemoryTemplate={(templateID, directory, scope) => window.orxa.opencode.applyMemoryTemplate(templateID, directory, scope)}
        onBackfillMemory={(directory) => window.orxa.opencode.backfillMemory(directory)}
        onClearWorkspaceMemory={(directory) => window.orxa.opencode.clearWorkspaceMemory(directory)}
        allModelOptions={settingsModelOptions}
      />

    </div>
  );
}
