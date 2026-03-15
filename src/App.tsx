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
  ArtifactRetentionPolicy,
  ArtifactRecord,
  ArtifactSessionSummary,
  ChangeProvenanceRecord,
  ContextSelectionTrace,
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
  WorkspaceArtifactSummary,
  WorkspaceContextFile,
  McpDevToolsServerState,
} from "@shared/ipc";
import type { ProviderListResponse, QuestionAnswer } from "@opencode-ai/sdk/v2/client";
import { CanvasPane } from "./components/CanvasPane";
import { ComposerPanel } from "./components/ComposerPanel";
import { HomeDashboard } from "./components/HomeDashboard";
import { ContentTopBar, type CustomRunCommandInput, type CustomRunCommandPreset } from "./components/ContentTopBar";
import { GlobalModalsHost } from "./components/GlobalModalsHost";
import type { SkillPromptTarget } from "./components/GlobalModalsHost";
import { MessageFeed } from "./components/MessageFeed";
import { GitSidebar, type BrowserControlOwner, type BrowserSidebarState } from "./components/GitSidebar";
import { ProjectDashboard } from "./components/ProjectDashboard";
import { ArtifactsDrawer, type ArtifactScopeTab } from "./components/ArtifactsDrawer";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { TerminalPanel } from "./components/TerminalPanel";
import { JobsBoard } from "./components/JobsBoard";
import { WorkspaceSidebar } from "./components/WorkspaceSidebar";
import { MemoryBoard } from "./components/MemoryBoard";
import { ConfirmDialog, type ConfirmDialogProps } from "./components/ConfirmDialog";
import { TextInputDialog, type TextInputDialogProps } from "./components/TextInputDialog";
import { WorkspaceContextManager } from "./components/WorkspaceContextManager";
import { useJobsScheduler } from "./hooks/useJobsScheduler";
import { SkillsBoard } from "./components/SkillsBoard";
import { useCanvasState } from "./hooks/useCanvasState";
import { useComposerState } from "./hooks/useComposerState";
import { useDashboards } from "./hooks/useDashboards";
import { useGitPanel, type CommitNextStep } from "./hooks/useGitPanel";
import { usePersistedState } from "./hooks/usePersistedState";
import { useBrowserAgentBridge } from "./hooks/useBrowserAgentBridge";
import { useMemoryModeGuardrails } from "./hooks/useMemoryModeGuardrails";
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
import { syncAgentModelPreference } from "./lib/agent-model-preferences";
import {
  BROWSER_MODE_TOOLS_POLICY,
  MEMORY_MODE_TOOLS_POLICY,
  PLAN_MODE_TOOLS_POLICY,
  mergeModeToolPolicies,
} from "./lib/browser-tool-guardrails";
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
};

const APP_PREFERENCES_KEY = "orxa:appPreferences:v1";
const OPEN_TARGET_KEY = "orxa:openTarget:v1";
const SIDEBAR_LEFT_WIDTH_KEY = "orxa:leftPaneWidth:v1";
const SIDEBAR_RIGHT_WIDTH_KEY = "orxa:rightPaneWidth:v1";
const AGENT_MODEL_PREFS_KEY = "orxa:agentModelPrefs:v1";
const CUSTOM_RUN_COMMANDS_KEY = "orxa:customRunCommands:v1";
const SESSION_TYPES_KEY = "orxa:sessionTypes:v1";
const DEFAULT_COMPOSER_LAYOUT_HEIGHT = 132;
const COMPOSER_DRAWER_ATTACH_OFFSET = 12;

type ProjectSortMode = "updated" | "recent" | "alpha-asc" | "alpha-desc";

type OrxaTodoItem = {
  id: string;
  content: string;
  status?: string;
  priority?: string;
};

type SessionFeedNotice = {
  id: string;
  time: number;
  label: string;
  detail?: string;
  tone?: "info" | "error";
};

type CommitFlowState = {
  phase: "running" | "success" | "error";
  nextStep: CommitNextStep;
  message: string;
};

type UpdateProgressState = {
  phase: "downloading" | "installing" | "error";
  message: string;
  percent?: number;
  version?: string;
};

type StartupState = {
  phase: "running" | "done";
  message: string;
  completed: number;
  total: number;
};

const COMPLETED_TODO_STATUSES = new Set(["completed", "complete", "done", "finished", "success", "succeeded"]);

type OpenTargetOption = {
  id: OpenTarget;
  label: string;
  logo: string;
};

type TextInputDialogState = Omit<TextInputDialogProps, "isOpen" | "onCancel">;

type ConfirmDialogRequest = Omit<ConfirmDialogProps, "isOpen" | "onConfirm" | "onCancel">;
type AppToastTone = "info" | "warning" | "error";

type AppToast = {
  id: string;
  message: string;
  tone: AppToastTone;
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
const CONTEXT_MODE_BY_SESSION_KEY = "orxa:contextModeBySession:v1";
const BROWSER_AUTOMATION_HALTED_BY_SESSION_KEY = "orxa:browserAutomationHaltedBySession:v1";
const DEFAULT_BROWSER_LANDING_URL = "about:blank";
const STARTUP_TOTAL_STEPS = 8;
const STARTUP_STEP_TIMEOUT_MS = 12_000;
const URL_REFERENCE_PATTERN = /\bhttps?:\/\/\S+|\bwww\.\S+/i;
const WEB_TASK_HINT_PATTERN =
  /\b(research|browse|browsing|web|website|webpage|look up|lookup|search online|search the web|find online|url|latest|news|social media|reddit|linkedin|x\.com|twitter)\b/i;
const APP_PRIVATE_ARTIFACT_QUERY_LIMIT = 1_000;
const APP_PRIVATE_ARTIFACT_VIEW_LIMIT = 300;
const STATUS_TOAST_ERROR_PATTERN = /\b(error|failed|unable|cannot|can't|denied|rejected|missing|not found|unavailable|timed out|inaccessible)\b/i;
const STATUS_TOAST_WARNING_PATTERN = /\b(warning|interrupted|stopped|retry)\b/i;
const RECOVERABLE_SESSION_ERROR_PATTERN =
  /\b(skill|skills?|working directory|workspace|cwd|enoent|not found|no such file|no longer accessible)\b/i;

const EMPTY_BROWSER_RUNTIME_STATE: BrowserState = {
  partition: "persist:orxa-browser",
  bounds: { x: 0, y: 0, width: 0, height: 0 },
  tabs: [],
  activeTabID: undefined,
};

function isAbsoluteWorkspacePath(value: string) {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function isAppPrivateArtifact(record: ArtifactRecord) {
  return !isAbsoluteWorkspacePath(record.workspace);
}

function toAppPrivateArtifacts(records: ArtifactRecord[]) {
  return records.filter(isAppPrivateArtifact).slice(0, APP_PRIVATE_ARTIFACT_VIEW_LIMIT);
}

function toBrowserSidebarHistory(items: BrowserHistoryItem[]): BrowserSidebarState["history"] {
  return items.map((entry) => ({
    id: entry.id,
    label: entry.title?.trim() ? entry.title : entry.url,
    url: entry.url,
  }));
}

function toneForStatusLine(status: string): AppToastTone | null {
  const value = status.trim();
  if (!value) {
    return null;
  }
  if (STATUS_TOAST_ERROR_PATTERN.test(value)) {
    return "error";
  }
  if (STATUS_TOAST_WARNING_PATTERN.test(value)) {
    return "warning";
  }
  return null;
}

function isRecoverableSessionError(message: string, code?: string) {
  if (RECOVERABLE_SESSION_ERROR_PATTERN.test(message)) {
    return true;
  }
  if (typeof code === "string" && RECOVERABLE_SESSION_ERROR_PATTERN.test(code)) {
    return true;
  }
  return false;
}

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

function buildBrowserAutopilotHint(input: string): string | undefined {
  const text = input.trim();
  if (!text) {
    return undefined;
  }
  const hasUrl = URL_REFERENCE_PATTERN.test(text);
  const hasWebTask = WEB_TASK_HINT_PATTERN.test(text);
  if (!hasUrl && !hasWebTask) {
    return undefined;
  }

  const lines = [
    "Auto Browser Skill Triggered: the latest user request appears to need web browsing.",
    "Prefer integrated Orxa browser actions over any external/headless browser tool.",
  ];
  if (hasUrl) {
    lines.push("Use URLs mentioned by the user as first navigation targets.");
  }
  if (hasWebTask) {
    lines.push("For research tasks, follow a loop: navigate, wait_for_idle, extract_text, then summarize.");
  }
  return lines.join("\n");
}

function toBrowserSidebarState(input: {
  runtimeState: BrowserState;
  history: BrowserHistoryItem[];
  modeEnabled: boolean;
  controlOwner: BrowserControlOwner;
  actionRunning: boolean;
  canStop: boolean;
}): BrowserSidebarState {
  const tabs = input.runtimeState.tabs.map((tab) => ({
    id: tab.id,
    title: tab.title?.trim() ? tab.title : tab.url || "New Tab",
    url: tab.url,
    isActive: tab.id === input.runtimeState.activeTabID,
  }));
  const activeTab = input.runtimeState.tabs.find((tab) => tab.id === input.runtimeState.activeTabID) ?? null;

  return {
    modeEnabled: input.modeEnabled,
    controlOwner: input.controlOwner,
    tabs,
    activeTabID: input.runtimeState.activeTabID ?? null,
    activeUrl: activeTab?.url ?? "",
    history: toBrowserSidebarHistory(input.history),
    canGoBack: activeTab?.canGoBack ?? false,
    canGoForward: activeTab?.canGoForward ?? false,
    isLoading: activeTab?.loading ?? false,
    actionRunning: input.actionRunning,
    canStop: input.canStop,
  };
}

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

function formatMemoryGraphError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("No handler registered for 'orxa:opencode:memory:getGraph'")) {
    return "Memory IPC handlers are unavailable in the current desktop process. Restart the app to load memory routes.";
  }
  return message;
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
  const [appMode, setAppMode] = useState<AppMode>("standard");
  const [globalProviders, setGlobalProviders] = useState<ProviderListResponse>({ all: [], connected: [], default: {} });
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
  const [statusLine, setStatusLine] = useState<string>("Ready");
  const [toasts, setToasts] = useState<AppToast[]>([]);
  const [debugModalOpen, setDebugModalOpen] = useState(false);
  const [debugLogLevelFilter, setDebugLogLevelFilter] = useState<"all" | DebugLogLevel>("all");
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const toastTimersRef = useRef<Record<string, number>>({});
  const dismissToast = useCallback((id: string) => {
    const timer = toastTimersRef.current[id];
    if (timer) {
      window.clearTimeout(timer);
      delete toastTimersRef.current[id];
    }
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);
  const pushToast = useCallback((message: string, tone: AppToastTone = "info", durationMs = 5_200) => {
    const normalized = message.trim();
    if (!normalized) {
      return;
    }
    const id = `${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
    setToasts((current) => {
      const duplicate = current.find((item) => item.message === normalized && item.tone === tone);
      if (duplicate) {
        return current;
      }
      return [...current, { id, message: normalized, tone }].slice(-4);
    });
    toastTimersRef.current[id] = window.setTimeout(() => {
      dismissToast(id);
    }, durationMs);
  }, [dismissToast]);
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
  useEffect(() => {
    return () => {
      Object.values(toastTimersRef.current).forEach((timer) => window.clearTimeout(timer));
      toastTimersRef.current = {};
    };
  }, []);
  useEffect(() => {
    const message = statusLine.trim();
    if (!message) {
      return;
    }
    const tone = toneForStatusLine(message);
    if (tone) {
      pushToast(message, tone);
    }
  }, [pushToast, statusLine]);
  const [sessionProvenanceByPath, setSessionProvenanceByPath] = useState<Record<string, ChangeProvenanceRecord>>({});
  const [sessionFeedNotices, setSessionFeedNotices] = useState<Record<string, SessionFeedNotice[]>>({});
  const addSessionFeedNotice = useCallback(
    (directory: string, sessionID: string, notice: Omit<SessionFeedNotice, "id" | "time">) => {
      const key = `${directory}::${sessionID}`;
      setSessionFeedNotices((current) => {
        const nextNotice: SessionFeedNotice = {
          id: `${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
          time: Date.now(),
          ...notice,
        };
        const existing = current[key] ?? [];
        const duplicate = existing.some(
          (item) =>
            item.label === nextNotice.label &&
            item.detail === nextNotice.detail &&
            Math.abs(item.time - nextNotice.time) < 2_500,
        );
        if (duplicate) {
          return current;
        }
        const trimmed = [...existing, nextNotice].slice(-8);
        return {
          ...current,
          [key]: trimmed,
        };
      });
    },
    [],
  );
  const messageCacheRef = useRef<Record<string, SessionMessageBundle[]>>({});
  const projectLastOpenedRef = useRef<Record<string, number>>({});
  const projectLastUpdatedRef = useRef<Record<string, number>>({});
  const manualSessionStopsRef = useRef<Record<string, { requestedAt: number; noticeEmitted: boolean }>>({});
  const prevAppModeRef = useRef<typeof appMode>(appMode);
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
  const canvasState = useCanvasState(activeSessionID ?? "__none__");
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
  const [memoryGraph, setMemoryGraph] = useState<MemoryGraphSnapshot | null>(null);
  const [memoryGraphLoading, setMemoryGraphLoading] = useState(false);
  const [memoryGraphError, setMemoryGraphError] = useState<string | undefined>();
  const [memoryWorkspaceFilter, setMemoryWorkspaceFilter] = useState("all");
  const [memoryBackfillStatus, setMemoryBackfillStatus] = useState<MemoryBackfillStatus | null>(null);
  const [memoryBackfillSessionPreparing, setMemoryBackfillSessionPreparing] = useState(false);
  const [composerLayoutHeight, setComposerLayoutHeight] = useState(DEFAULT_COMPOSER_LAYOUT_HEIGHT);
  const [configModelOptions, setConfigModelOptions] = useState<ModelOption[]>([]);
  const [orxaModels, setOrxaModels] = useState<{ orxa?: string; plan?: string }>({});
  const [orxaPrompts, setOrxaPrompts] = useState<{ orxa?: string; plan?: string }>({});
  const [rightSidebarTab, setRightSidebarTab] = useState<"git" | "files" | "browser">("git");
  const [browserModeBySession, setBrowserModeBySession] = usePersistedState<Record<string, boolean>>(
    BROWSER_MODE_BY_SESSION_KEY,
    {},
  );
  const [contextModeBySession, setContextModeBySession] = usePersistedState<Record<string, boolean>>(
    CONTEXT_MODE_BY_SESSION_KEY,
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
  const [artifactsDrawerOpen, setArtifactsDrawerOpen] = useState(false);
  const [artifactsDrawerTab, setArtifactsDrawerTab] = useState<ArtifactScopeTab>("session");
  const [sessionArtifacts, setSessionArtifacts] = useState<ArtifactRecord[]>([]);
  const [workspaceArtifacts, setWorkspaceArtifacts] = useState<ArtifactRecord[]>([]);
  const [appArtifacts, setAppArtifacts] = useState<ArtifactRecord[]>([]);
  const [artifactSessionSummaries, setArtifactSessionSummaries] = useState<ArtifactSessionSummary[]>([]);
  const [workspaceArtifactSummary, setWorkspaceArtifactSummary] = useState<WorkspaceArtifactSummary | null>(null);
  const [artifactRetentionPolicy, setArtifactRetentionPolicy] = useState<ArtifactRetentionPolicy | null>(null);
  const [artifactRetentionBusy, setArtifactRetentionBusy] = useState(false);
  const [artifactExportBusy, setArtifactExportBusy] = useState(false);
  const [workspaceContextFiles, setWorkspaceContextFiles] = useState<WorkspaceContextFile[]>([]);
  const [workspaceContextManagerOpen, setWorkspaceContextManagerOpen] = useState(false);
  const [latestContextTrace, setLatestContextTrace] = useState<ContextSelectionTrace | null>(null);
  const [startupState, setStartupState] = useState<StartupState>({
    phase: "running",
    message: "Initializing Opencode Orxa…",
    completed: 0,
    total: STARTUP_TOTAL_STEPS,
  });
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
  const [commitFlowState, setCommitFlowState] = useState<CommitFlowState | null>(null);
  const [pendingPrUrl, setPendingPrUrl] = useState<string | null>(null);
  const [availableUpdateVersion, setAvailableUpdateVersion] = useState<string | null>(null);
  const [updateInstallPending, setUpdateInstallPending] = useState(false);
  const [updateProgressState, setUpdateProgressState] = useState<UpdateProgressState | null>(null);
  const [todosOpen, setTodosOpen] = useState(false);
  const [permissionDecisionPending, setPermissionDecisionPending] = useState<"once" | "always" | "reject" | null>(null);
  const [permissionDecisionPendingRequestID, setPermissionDecisionPendingRequestID] = useState<string | null>(null);
  const [dependencyReport, setDependencyReport] = useState<RuntimeDependencyReport | null>(null);
  const [dependencyModalOpen, setDependencyModalOpen] = useState(false);
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
  const activeSessionKey = useMemo(() => {
    if (!activeProjectDir || !activeSessionID) {
      return null;
    }
    return `${activeProjectDir}::${activeSessionID}`;
  }, [activeProjectDir, activeSessionID]);
  const browserModeEnabled = activeSessionKey ? browserModeBySession[activeSessionKey] === true : false;
  const contextModeEnabled = activeSessionKey ? contextModeBySession[activeSessionKey] === true : false;
  const browserAutomationHalted = activeSessionKey
    ? typeof browserAutomationHaltedBySession[activeSessionKey] === "number"
    : false;
  const hasProjectContext = Boolean(activeProjectDir) && sidebarMode === "projects";
  const showProjectsPane = !hasProjectContext || projectsSidebarVisible;
  const showGitPane = hasProjectContext && sidebarMode === "projects" && appPreferences.showOperationsPane;
  const browserPaneVisible = showGitPane && rightSidebarTab === "browser";
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
  const commitFlowDismissTimerRef = useRef<number | null>(null);
  const abortActiveSessionRef = useRef<(() => Promise<void>) | null>(null);
  const startupRanRef = useRef(false);
  const startupCompletedRef = useRef(false);

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
  const assistantLabel = selectedAgent
    ? selectedAgent.charAt(0).toUpperCase() + selectedAgent.slice(1)
    : isOrxaMode
      ? "Orxa"
      : "Assistant";
  const todosLabel = isOrxaMode ? "Orxa Todos" : "Todos";
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

  const refreshWorkspaceContextFiles = useCallback(async (workspace?: string | null) => {
    const targetWorkspace = workspace ?? activeProjectDir;
    if (!targetWorkspace) {
      setWorkspaceContextFiles([]);
      return;
    }
    try {
      const entries = await window.orxa.opencode.listWorkspaceContext(targetWorkspace);
      setWorkspaceContextFiles(entries);
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, [activeProjectDir]);

  const refreshArtifacts = useCallback(async (workspace?: string | null, sessionID?: string | null) => {
    const targetWorkspace = workspace ?? activeProjectDir;
    const targetSessionID = sessionID ?? activeSessionID;
    try {
      const appRecordsPromise = window.orxa.opencode.listArtifacts({ limit: APP_PRIVATE_ARTIFACT_QUERY_LIMIT });
      const retentionPolicyPromise = window.orxa.opencode.getArtifactRetentionPolicy();
      if (!targetWorkspace) {
        const [appRecords, retentionPolicy] = await Promise.all([appRecordsPromise, retentionPolicyPromise]);
        setWorkspaceArtifacts([]);
        setSessionArtifacts([]);
        setArtifactSessionSummaries([]);
        setWorkspaceArtifactSummary(null);
        setAppArtifacts(toAppPrivateArtifacts(appRecords));
        setArtifactRetentionPolicy(retentionPolicy);
        return;
      }

      const [workspaceRecords, sessionRecords, summaries, workspaceSummary, retentionPolicy, appRecords] = await Promise.all([
        window.orxa.opencode.listArtifacts({ workspace: targetWorkspace, limit: 300 }),
        targetSessionID
          ? window.orxa.opencode.listArtifacts({ workspace: targetWorkspace, sessionID: targetSessionID, limit: 150 })
          : Promise.resolve([]),
        window.orxa.opencode.listArtifactSessions(targetWorkspace),
        window.orxa.opencode.listWorkspaceArtifactSummary(targetWorkspace),
        retentionPolicyPromise,
        appRecordsPromise,
      ]);
      setWorkspaceArtifacts(workspaceRecords);
      setSessionArtifacts(sessionRecords);
      setArtifactSessionSummaries(summaries);
      setWorkspaceArtifactSummary(workspaceSummary);
      setAppArtifacts(toAppPrivateArtifacts(appRecords));
      setArtifactRetentionPolicy(retentionPolicy);
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, [activeProjectDir, activeSessionID]);

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
    if (!activeSessionKey) {
      return;
    }
    setBrowserModeBySession((current) => ({
      ...current,
      [activeSessionKey]: enabled,
    }));
    if (!enabled) {
      setBrowserActionRunning(false);
      // Stop MCP DevTools server when browser mode is turned off
      window.orxa.mcpDevTools.stop().then(
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
    // Start MCP DevTools server when browser mode is turned on
    window.orxa.mcpDevTools.start().then(
      (status) => setMcpDevToolsState(status.state),
      (err) => {
        console.error("Failed to start MCP DevTools server:", err);
        setMcpDevToolsState("error");
      },
    );
  }, [activeSessionKey, ensureBrowserTab, setBrowserModeBySession, syncBrowserSnapshot]);

  const setContextModeForSession = useCallback((enabled: boolean) => {
    if (!activeSessionKey) {
      return;
    }
    setContextModeBySession((current) => ({
      ...current,
      [activeSessionKey]: enabled,
    }));
  }, [activeSessionKey, setContextModeBySession]);

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

  const handleMemoryGuardrailViolation = useCallback((message: string) => {
    setStatusLine(message);
    void abortSessionViaComposer().catch((error) => {
      setStatusLine(error instanceof Error ? error.message : String(error));
    });
  }, [abortSessionViaComposer, setStatusLine]);

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
    const key = `${directory}::${sessionID}`;
    manualSessionStopsRef.current[key] = { requestedAt: now, noticeEmitted: false };
    setBrowserAutomationHaltedBySession((current) => ({
      ...current,
      [key]: now,
    }));
  }, [setBrowserAutomationHaltedBySession]);

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
      "Browser Mode is enabled in Opencode Orxa.",
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

  const contextModeSystemAddendum = useMemo(() => {
    if (!contextModeEnabled) {
      return undefined;
    }
    return [
      "Context Mode is enabled in Opencode Orxa.",
      "Use only in-app workspace context and local Opencode Orxa memory.",
      "Do not use external memory services or memory MCP integrations.",
      "Do not request external memory access when Context Mode is enabled.",
    ].join("\n");
  }, [contextModeEnabled]);

  const effectiveSystemAddendum = useMemo(() => {
    const parts = [browserSystemAddendum, browserAutopilotHint, contextModeSystemAddendum]
      .map((item) => item?.trim())
      .filter((item): item is string => Boolean(item));
    if (parts.length === 0) {
      return undefined;
    }
    return parts.join("\n\n");
  }, [browserAutopilotHint, browserSystemAddendum, contextModeSystemAddendum]);

  const activePromptToolsPolicy = useMemo(
    () =>
      mergeModeToolPolicies(
        isPlanMode ? PLAN_MODE_TOOLS_POLICY : undefined,
        contextModeEnabled ? MEMORY_MODE_TOOLS_POLICY : undefined,
        browserModeEnabled ? BROWSER_MODE_TOOLS_POLICY : undefined,
      ),
    [browserModeEnabled, contextModeEnabled, isPlanMode],
  );

  const sendComposerPrompt = useCallback(
    () => {
      if (activeProjectDir && activeSessionID) {
        clearBrowserAutomationHalt(activeProjectDir, activeSessionID);
      }
      return sendPrompt({
        systemAddendum: effectiveSystemAddendum,
        contextModeEnabled,
        promptSource: "user",
        tools: activePromptToolsPolicy,
      });
    },
    [activeProjectDir, activePromptToolsPolicy, activeSessionID, clearBrowserAutomationHalt, contextModeEnabled, effectiveSystemAddendum, sendPrompt],
  );

  const allModelOptions = settingsModelOptions;

  const modelSelectOptions = useMemo(
    () => filterHiddenModelOptions(allModelOptions, appPreferences.hiddenModels),
    [allModelOptions, appPreferences.hiddenModels],
  );
  const variantOptions = useMemo(() => {
    const model = modelSelectOptions.find((item) => item.key === selectedModel);
    return model?.variants ?? [];
  }, [selectedModel, modelSelectOptions]);
  useEffect(() => {
    if (startupRanRef.current) {
      return;
    }
    startupRanRef.current = true;
    startupCompletedRef.current = false;
    let cancelled = false;
    let completed = 0;
    const total = STARTUP_TOTAL_STEPS;
    const updateStartup = (message: string, phase: StartupState["phase"] = "running") => {
      if (cancelled) {
        return;
      }
      setStartupState({
        phase,
        message,
        completed,
        total,
      });
    };
    const markStepDone = (message: string) => {
      completed += 1;
      updateStartup(message);
    };
    const runStep = async <T,>(message: string, action: () => Promise<T>): Promise<T | undefined> => {
      updateStartup(message);
      let timeoutID: number | undefined;
      try {
        return await new Promise<T>((resolve, reject) => {
          timeoutID = window.setTimeout(() => {
            reject(new Error(`${message} timed out after ${STARTUP_STEP_TIMEOUT_MS}ms`));
          }, STARTUP_STEP_TIMEOUT_MS);
          void action()
            .then((result) => {
              resolve(result);
            })
            .catch((error) => {
              reject(error);
            });
        });
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
      } finally {
        if (timeoutID !== undefined) {
          window.clearTimeout(timeoutID);
        }
        markStepDone(message);
      }
      return undefined;
    };

    void (async () => {
      try {
        await runStep("Loading runtime profiles…", refreshProfiles);
        const mode = (await runStep("Loading app mode…", refreshMode)) ?? "standard";
        await runStep("Bootstrapping workspaces…", bootstrap);
        await runStep("Loading model references…", refreshConfigModels);
        await runStep("Loading provider registry…", refreshGlobalProviders);
        await runStep(mode === "orxa" ? "Loading Orxa defaults…" : "Skipping Orxa defaults…", async () => {
          if (mode === "orxa") {
            await refreshOrxaState();
            return;
          }
          setOrxaModels({});
          setOrxaPrompts({});
        });
        await runStep("Checking runtime dependencies…", refreshRuntimeDependencies);
        await runStep("Syncing browser state…", syncBrowserSnapshot);
      } finally {
        startupCompletedRef.current = true;
        updateStartup("Initialization complete", "done");
      }
    })();

    return () => {
      cancelled = true;
      if (!startupCompletedRef.current) {
        startupRanRef.current = false;
      }
    };
  }, [
    bootstrap,
    refreshConfigModels,
    refreshGlobalProviders,
    refreshMode,
    refreshOrxaState,
    refreshProfiles,
    refreshRuntimeDependencies,
    syncBrowserSnapshot,
  ]);

  useEffect(() => {
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
    if (!activeProjectDir) {
      setWorkspaceArtifacts([]);
      setSessionArtifacts([]);
      setArtifactSessionSummaries([]);
      setWorkspaceArtifactSummary(null);
      setWorkspaceContextFiles([]);
      return;
    }
    void refreshArtifacts(activeProjectDir, activeSessionID);
    void refreshWorkspaceContextFiles(activeProjectDir);
  }, [activeProjectDir, activeSessionID, refreshArtifacts, refreshWorkspaceContextFiles]);

  useEffect(() => {
    if (!artifactsDrawerOpen) {
      return;
    }
    void refreshArtifacts(activeProjectDir, activeSessionID);
  }, [activeProjectDir, activeSessionID, artifactsDrawerOpen, refreshArtifacts]);

  useEffect(() => {
    if (!workspaceContextManagerOpen || !activeProjectDir) {
      return;
    }
    void refreshWorkspaceContextFiles(activeProjectDir);
  }, [activeProjectDir, refreshWorkspaceContextFiles, workspaceContextManagerOpen]);

  useEffect(() => {
    setLatestContextTrace(null);
  }, [activeProjectDir, activeSessionID]);

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
    const available = new Set(agentOptions.map((item) => item.name));
    if (hasOrxaAgent) available.add("orxa");
    if (hasPlanAgent) available.add("plan");

    const modeChanged = prevAppModeRef.current !== appMode;
    prevAppModeRef.current = appMode;

    let nextAgent = selectedAgent;
    if (modeChanged || !selectedAgent || !available.has(selectedAgent)) {
      nextAgent = preferredAgentForMode({
        mode: appMode,
        hasOrxaAgent,
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
    if (!selectedModel || modeChanged || (nextAgent !== selectedAgent)) {
      setSelectedModel(preferredVisibleModel ?? fallback?.key);
    } else if (!modelSelectOptions.some((item) => item.key === selectedModel)) {
      setSelectedModel(preferredVisibleModel ?? fallback?.key);
    }
  }, [
    appMode,
    agentModelPrefs,
    agentOptions,
    hasOrxaAgent,
    hasPlanAgent,
    modelSelectOptions,
    preferredAgentModel,
    projectData?.config.model,
    selectedAgent,
    selectedAgentDefinition?.model,
    selectedModel,
    setSelectedModel,
    serverAgentNames,
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
      setStatusLine("Desktop bridge unavailable. Restart Opencode Orxa to reconnect.");
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
        if (event.payload.phase === "check.start") {
          setStatusLine("Checking for updates...");
        } else if (event.payload.phase === "update.available") {
          if (event.payload.version) {
            setAvailableUpdateVersion(event.payload.version);
            setStatusLine(`Update available: ${event.payload.version}`);
          }
        } else if (event.payload.phase === "check.success") {
          const timing = typeof event.payload.durationMs === "number" ? ` (${Math.round(event.payload.durationMs)}ms)` : "";
          if (event.payload.version) {
            setAvailableUpdateVersion(event.payload.version);
            setStatusLine(`Update available: ${event.payload.version}${timing}`);
          } else if (event.payload.manual) {
            setStatusLine(`Update check complete${timing}`);
          }
        } else if (event.payload.phase === "check.error") {
          setStatusLine(event.payload.message ? `Update check failed: ${event.payload.message}` : "Update check failed");
          if (updateInstallPending) {
            setUpdateInstallPending(false);
            setUpdateProgressState({
              phase: "error",
              message: event.payload.message ?? "Unable to update right now.",
            });
          }
        } else if (event.payload.phase === "download.start") {
          setUpdateProgressState({
            phase: "downloading",
            message: "Downloading update...",
            percent: 0,
            version: event.payload.version,
          });
        } else if (event.payload.phase === "download.progress") {
          setUpdateProgressState({
            phase: "downloading",
            message: "Downloading update...",
            percent: event.payload.percent,
            version: event.payload.version,
          });
        } else if (event.payload.phase === "download.complete") {
          setStatusLine("Update downloaded.");
        } else if (event.payload.phase === "install.start") {
          setUpdateInstallPending(false);
          setAvailableUpdateVersion(null);
          setUpdateProgressState({
            phase: "installing",
            message: "Installing update...",
            percent: 100,
            version: event.payload.version,
          });
          setStatusLine("Installing update...");
        }
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

      if (event.type === "artifact.created") {
        const artifact = event.payload;
        if (isAppPrivateArtifact(artifact)) {
          setAppArtifacts((current) => [artifact, ...current.filter((item) => item.id !== artifact.id)].slice(0, APP_PRIVATE_ARTIFACT_VIEW_LIMIT));
        }
        if (activeProjectDir && artifact.workspace === activeProjectDir) {
          setWorkspaceArtifacts((current) => [artifact, ...current.filter((item) => item.id !== artifact.id)].slice(0, 300));
          if (activeSessionID && artifact.sessionID === activeSessionID) {
            setSessionArtifacts((current) => [artifact, ...current.filter((item) => item.id !== artifact.id)].slice(0, 150));
          }
          void refreshArtifacts(activeProjectDir, activeSessionID).catch(() => undefined);
        } else if (isAppPrivateArtifact(artifact)) {
          void refreshArtifacts(activeProjectDir, activeSessionID).catch(() => undefined);
        }
      }

      if (event.type === "context.selection") {
        if (activeProjectDir && activeSessionID && event.payload.workspace === activeProjectDir && event.payload.sessionID === activeSessionID) {
          setLatestContextTrace(event.payload);
        }
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
        const eventSessionKey = eventSessionID ? `${event.payload.directory}::${eventSessionID}` : null;
        const now = Date.now();
        for (const [key, state] of Object.entries(manualSessionStopsRef.current)) {
          if (now - state.requestedAt > 120_000) {
            delete manualSessionStopsRef.current[key];
          }
        }
        const manualStopState = eventSessionKey ? manualSessionStopsRef.current[eventSessionKey] : undefined;
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
          kind === "pty.deleted"
        ) {
          const refreshDelay =
            kind === "message.part.delta" || kind === "message.part.updated" || kind === "message.part.added"
              ? 600
              : 180;
          queueRefresh(`Updated from event: ${kind}`, refreshDelay);
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
            manualSessionStopsRef.current[eventSessionKey] = { requestedAt: manualStopAt ?? now, noticeEmitted: true };
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
              manualSessionStopsRef.current[eventSessionKey] = { requestedAt: manualStopAt ?? now, noticeEmitted: true };
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
    loadMemoryGraph,
    pushToast,
    queueRefresh,
    refreshArtifacts,
    scheduleGitRefresh,
    sidebarMode,
    stopResponsePolling,
    updateInstallPending,
  ]);

  const downloadAndInstallUpdate = useCallback(async () => {
    if (updateInstallPending) {
      return;
    }
    setUpdateInstallPending(true);
    setUpdateProgressState((current) => current ?? { phase: "downloading", message: "Preparing update download...", percent: 0 });
    try {
      const result = await window.orxa.updates.downloadAndInstall();
      if (result.status === "error") {
        setUpdateInstallPending(false);
        setUpdateProgressState({
          phase: "error",
          message: result.message ?? "Unable to start update.",
        });
      } else if (result.status === "skipped") {
        const detail = result.message ?? "Unable to start update.";
        if (/already in progress/i.test(detail)) {
          setUpdateProgressState({
            phase: "downloading",
            message: "Downloading update...",
            percent: undefined,
            version: availableUpdateVersion ?? undefined,
          });
        } else {
          setUpdateInstallPending(false);
          setUpdateProgressState({
            phase: "error",
            message: detail,
          });
        }
      } else {
        setUpdateProgressState({
          phase: "downloading",
          message: "Downloading update...",
          percent: 0,
          version: availableUpdateVersion ?? undefined,
        });
      }
      if (result.message) {
        setStatusLine(result.message);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setUpdateInstallPending(false);
      setUpdateProgressState({
        phase: "error",
        message: detail,
      });
      setStatusLine(detail);
    }
  }, [availableUpdateVersion, updateInstallPending]);

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
      if (projectData.permissions.some((request) => request.sessionID === sessionID)) {
        return "permission";
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
    async (directory?: string, sessionTypeOrPrompt?: SessionType | string) => {
      const isSessionType = sessionTypeOrPrompt === "standalone" || sessionTypeOrPrompt === "canvas";
      const sessionType: SessionType = isSessionType ? (sessionTypeOrPrompt as SessionType) : "standalone";
      const initialPrompt = isSessionType ? undefined : sessionTypeOrPrompt;

      const createdSessionId = await createWorkspaceSession(directory, initialPrompt, {
        selectedAgent,
        selectedModelPayload,
        selectedVariant,
        serverAgentNames,
      });

      if (sessionType === "canvas" && createdSessionId) {
        setSessionTypes((prev) => ({ ...prev, [createdSessionId]: "canvas" }));
      }
    },
    [createWorkspaceSession, selectedAgent, selectedModelPayload, selectedVariant, serverAgentNames, setSessionTypes],
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
          message: `Remove "${label}" from Opencode Orxa workspace list?`,
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
    [bootstrap, selectProject, setActiveSessionID],
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
    [agentOptions, appMode, hasOrxaAgent, hasPlanAgent, orxaModels.orxa, orxaModels.plan, setSelectedModel],
  );

  const activeSession = useMemo(
    () => sessions.find((item) => item.id === activeSessionID),
    [activeSessionID, sessions],
  );
  const currentSessionStatus = activeSessionID ? projectData?.sessionStatus[activeSessionID] : undefined;
  const isSessionBusy = currentSessionStatus?.type === "busy" || currentSessionStatus?.type === "retry";
  const isSessionInProgress = isSessionBusy || isSendingPrompt;
  const showingProjectDashboard = Boolean(activeProjectDir && !activeSessionID);
  const contentPaneTitle = showingProjectDashboard
    ? activeProject?.name || activeProjectDir?.split("/").at(-1) || "No workspace selected"
    : activeSession?.title?.trim() || activeSession?.slug || activeProject?.name || "Untitled session";
  const activeSessionNoticeKey = activeProjectDir && activeSessionID ? `${activeProjectDir}::${activeSessionID}` : null;
  const activeSessionNotices = useMemo(
    () => (activeSessionNoticeKey ? (sessionFeedNotices[activeSessionNoticeKey] ?? []) : []),
    [activeSessionNoticeKey, sessionFeedNotices],
  );
  const isActiveSessionPinned = Boolean(
    activeProjectDir && activeSessionID && (pinnedSessions[activeProjectDir] ?? []).includes(activeSessionID),
  );
  const orxaTodos = useMemo(() => extractOrxaTodos(messages), [messages]);
  const completedTodoCount = useMemo(
    () => orxaTodos.reduce((count, todo) => (isTodoCompleted(todo) ? count + 1 : count), 0),
    [orxaTodos],
  );
  const allTodosCompleted = orxaTodos.length > 0 && completedTodoCount === orxaTodos.length;
  const effectiveBrowserState = useMemo(() => toBrowserSidebarState({
    runtimeState: browserRuntimeState,
    history: browserHistoryItems,
    modeEnabled: browserModeEnabled,
    controlOwner: browserControlOwner,
    actionRunning: browserActionRunning,
    canStop: browserActionRunning || isSessionInProgress,
  }), [browserActionRunning, browserControlOwner, browserHistoryItems, browserModeEnabled, browserRuntimeState, isSessionInProgress]);
  const startupProgressPercent = useMemo(() => {
    if (startupState.total <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round((startupState.completed / startupState.total) * 100)));
  }, [startupState.completed, startupState.total]);

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

  useMemoryModeGuardrails({
    activeProjectDir: activeProjectDir ?? null,
    activeSessionID: activeSessionID ?? null,
    messages,
    memoryModeEnabled: contextModeEnabled,
    onGuardrailViolation: handleMemoryGuardrailViolation,
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

  const clearCommitFlowDismissTimer = useCallback(() => {
    if (commitFlowDismissTimerRef.current !== null) {
      window.clearTimeout(commitFlowDismissTimerRef.current);
      commitFlowDismissTimerRef.current = null;
    }
  }, []);

  const scheduleCommitFlowDismiss = useCallback(
    (delayMs: number) => {
      clearCommitFlowDismissTimer();
      commitFlowDismissTimerRef.current = window.setTimeout(() => {
        setCommitFlowState(null);
        commitFlowDismissTimerRef.current = null;
      }, delayMs);
    },
    [clearCommitFlowDismissTimer],
  );

  useEffect(() => () => clearCommitFlowDismissTimer(), [clearCommitFlowDismissTimer]);

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
      setCommitFlowState({
        phase: "running",
        nextStep: selectedNextStep,
        message: commitFlowRunningMessage(selectedNextStep),
      });
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
      setCommitFlowState({
        phase: "success",
        nextStep: selectedNextStep,
        message: commitFlowSuccessMessage(selectedNextStep),
      });
      scheduleCommitFlowDismiss(1150);
      await refreshProject(activeProjectDir);
      if (rightSidebarTab === "git") {
        void loadGitDiff();
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setStatusLine(detail);
      setCommitFlowState({
        phase: "error",
        nextStep: selectedNextStep,
        message: detail,
      });
      clearCommitFlowDismissTimer();
    } finally {
      setCommitSubmitting(false);
    }
  }, [
    activeProjectDir,
    appPreferences.commitGuidancePrompt,
    clearCommitFlowDismissTimer,
    commitBaseBranch,
    commitIncludeUnstaged,
    commitMessageDraft,
    commitNextStep,
    loadGitDiff,
    rightSidebarTab,
    refreshProject,
    scheduleCommitFlowDismiss,
    setCommitMessageDraft,
    setCommitModalOpen,
    setCommitSubmitting,
  ]);

  const appendPathToComposer = useCallback((filePath: string) => {
    setComposer((current) => (current.trim().length > 0 ? `${current}\n${filePath}` : filePath));
  }, [setComposer]);

  const openArtifactsDrawer = useCallback((tab: ArtifactScopeTab) => {
    setArtifactsDrawerTab(tab);
    setArtifactsDrawerOpen(true);
  }, []);

  const closeArtifactsDrawer = useCallback(() => {
    setArtifactsDrawerOpen(false);
  }, []);

  const applyArtifactRetentionCap = useCallback(async (maxBytes: number) => {
    setArtifactRetentionBusy(true);
    try {
      const policy = await window.orxa.opencode.setArtifactRetentionPolicy({ maxBytes });
      setArtifactRetentionPolicy(policy);
      await refreshArtifacts(activeProjectDir, activeSessionID);
      setStatusLine(`Artifact cap set to ${Math.round(policy.maxBytes / (1024 * 1024))} MB`);
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    } finally {
      setArtifactRetentionBusy(false);
    }
  }, [activeProjectDir, activeSessionID, refreshArtifacts]);

  const pruneArtifactsNow = useCallback(async () => {
    setArtifactRetentionBusy(true);
    try {
      const result = await window.orxa.opencode.pruneArtifactsNow(activeProjectDir ?? undefined);
      await refreshArtifacts(activeProjectDir, activeSessionID);
      setStatusLine(`Pruned ${result.removed} artifacts (${Math.round(result.removedBytes / 1024)} KB freed)`);
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    } finally {
      setArtifactRetentionBusy(false);
    }
  }, [activeProjectDir, activeSessionID, refreshArtifacts]);

  const exportArtifactsBundle = useCallback(async () => {
    if (!activeProjectDir || artifactsDrawerTab === "app") {
      return;
    }
    setArtifactExportBusy(true);
    try {
      const result = await window.orxa.opencode.exportArtifactBundle({
        workspace: activeProjectDir,
        sessionID: artifactsDrawerTab === "session" ? activeSessionID ?? undefined : undefined,
        limit: 1_000,
      });
      setStatusLine(`Exported ${result.exportedArtifacts} artifacts to ${result.bundlePath}`);
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    } finally {
      setArtifactExportBusy(false);
    }
  }, [activeProjectDir, activeSessionID, artifactsDrawerTab]);

  const openWorkspaceContextManager = useCallback(async () => {
    if (!activeProjectDir) {
      return;
    }
    setWorkspaceContextManagerOpen(true);
    await refreshWorkspaceContextFiles(activeProjectDir);
  }, [activeProjectDir, refreshWorkspaceContextFiles]);

  const createWorkspaceContext = useCallback(async () => {
    if (!activeProjectDir) {
      return;
    }
    setTextInputDialog({
      title: "New context file",
      defaultValue: "vision.md",
      placeholder: "vision.md",
      confirmLabel: "Create",
      validate: (value) => {
        if (!value.trim()) {
          return "Filename is required";
        }
        return null;
      },
      onConfirm: async (value) => {
        const filename = value.trim();
        if (!filename) {
          return;
        }
        try {
          await window.orxa.opencode.writeWorkspaceContext({
            workspace: activeProjectDir,
            filename,
            title: filename.replace(/\.md$/i, ""),
            content: `# ${filename.replace(/\.md$/i, "")}\n\n`,
          });
          await refreshWorkspaceContextFiles(activeProjectDir);
          setWorkspaceContextManagerOpen(true);
          setStatusLine("Workspace context created");
        } catch (error) {
          setStatusLine(error instanceof Error ? error.message : String(error));
        }
      },
    });
  }, [activeProjectDir, refreshWorkspaceContextFiles]);

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
      {startupState.phase === "running" ? (
        <section className="startup-overlay" aria-live="polite" role="status">
          <div className="startup-card">
            <h2>Initializing Opencode Orxa</h2>
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
          showingProjectDashboard={showingProjectDashboard}
          activeProjectDir={activeProjectDir ?? null}
          projectData={projectData}
          terminalOpen={terminalOpen}
          toggleTerminal={toggleTerminal}
          artifactsOpen={artifactsDrawerOpen}
          onToggleArtifacts={() => {
            if (artifactsDrawerOpen) {
              closeArtifactsDrawer();
            } else {
              openArtifactsDrawer(activeProjectDir ? "session" : "app");
            }
          }}
          titleMenuOpen={titleMenuOpen}
          openMenuOpen={openMenuOpen}
          setOpenMenuOpen={setOpenMenuOpen}
          commitMenuOpen={commitMenuOpen}
          setCommitMenuOpen={setCommitMenuOpen}
          setTitleMenuOpen={setTitleMenuOpen}
          hasActiveSession={Boolean(activeSessionID)}
          isActiveSessionCanvasSession={Boolean(activeSessionID && sessionTypes[activeSessionID] === "canvas")}
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
            appMode={appMode}
            setAppMode={setAppMode}
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
              {!showingProjectDashboard && activeSessionID && sessionTypes[activeSessionID] === "canvas" ? (
                <CanvasPane canvasState={canvasState} directory={activeProjectDir} mcpDevToolsState={mcpDevToolsState} />
              ) : !showingProjectDashboard ? (
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
                    contextModeEnabled={contextModeEnabled}
                    setContextModeEnabled={setContextModeForSession}
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
                  workspaceContextFiles={workspaceContextFiles}
                  workspaceContextLoading={false}
                  onViewAllWorkspaceContext={() => {
                    void openWorkspaceContextManager();
                  }}
                  onAddWorkspaceContext={() => {
                    void createWorkspaceContext();
                  }}
                  workspaceArtifactsSummary={workspaceArtifactSummary}
                  workspaceArtifactsLoading={false}
                  onViewAllWorkspaceArtifacts={() => openArtifactsDrawer("workspace")}
                />
              )}
              {!(activeSessionID && sessionTypes[activeSessionID] === "canvas") && (
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
        dismissCommitFlowState={() => {
          clearCommitFlowDismissTimer();
          setCommitFlowState(null);
        }}
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

      <ArtifactsDrawer
        open={artifactsDrawerOpen}
        tab={artifactsDrawerTab}
        onTabChange={setArtifactsDrawerTab}
        onClose={closeArtifactsDrawer}
        sessionArtifacts={sessionArtifacts}
        workspaceArtifacts={workspaceArtifacts}
        appArtifacts={appArtifacts}
        sessionSummaries={artifactSessionSummaries}
        workspaceSummary={workspaceArtifactSummary}
        retentionPolicy={artifactRetentionPolicy}
        retentionBusy={artifactRetentionBusy}
        exportBusy={artifactExportBusy}
        contextTrace={latestContextTrace}
        activeSessionID={activeSessionID ?? null}
        onRefresh={() => void refreshArtifacts(activeProjectDir, activeSessionID)}
        onApplyRetentionCap={(maxBytes) => void applyArtifactRetentionCap(maxBytes)}
        onPruneNow={() => void pruneArtifactsNow()}
        onExportBundle={activeProjectDir && artifactsDrawerTab !== "app" ? () => void exportArtifactsBundle() : undefined}
        onDeleteArtifact={async (artifactID) => {
          try {
            await window.orxa.opencode.deleteArtifact(artifactID);
            await refreshArtifacts(activeProjectDir, activeSessionID);
          } catch (error) {
            setStatusLine(error instanceof Error ? error.message : String(error));
          }
        }}
      />

      <WorkspaceContextManager
        open={workspaceContextManagerOpen}
        files={workspaceContextFiles}
        onClose={() => setWorkspaceContextManagerOpen(false)}
        onRefresh={() => void refreshWorkspaceContextFiles(activeProjectDir)}
        onCreate={() => void createWorkspaceContext()}
        onSave={async (input) => {
          if (!activeProjectDir) {
            return;
          }
          await window.orxa.opencode.writeWorkspaceContext({
            ...input,
            workspace: activeProjectDir,
          });
          await refreshWorkspaceContextFiles(activeProjectDir);
        }}
        onDelete={async (id) => {
          if (!activeProjectDir) {
            return;
          }
          await window.orxa.opencode.deleteWorkspaceContext(activeProjectDir, id);
          await refreshWorkspaceContextFiles(activeProjectDir);
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
            await Promise.all([refreshConfigModels(), refreshGlobalProviders()]);
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
          const savedModel = saved.model?.trim();
          setAgentModelPrefs((current) => syncAgentModelPreference(current, saved.name, savedModel));
          if (selectedAgent === saved.name) {
            const fallback = findFallbackModel(modelSelectOptions, savedModel ?? projectData?.config.model);
            setSelectedModel(fallback?.key);
          }
          await Promise.all([refreshOrxaState(), refreshConfigModels()]);
          if (activeProjectDir) {
            await refreshProject(activeProjectDir);
          }
          setStatusLine(`Saved agent ${saved.name}`);
          return saved;
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
        onGetOrxaAgentDetails={(name) => window.orxa.opencode.getOrxaAgentDetails(name)}
        onResetOrxaAgent={(name) => window.orxa.opencode.resetOrxaAgent(name)}
        onRestoreOrxaAgentHistory={(name, historyID) => window.orxa.opencode.restoreOrxaAgentHistory(name, historyID)}
        allModelOptions={settingsModelOptions}
      />

    </div>
  );
}
