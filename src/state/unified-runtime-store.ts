import { create } from "zustand";
import {
  deriveUnifiedSessionStatus,
  makeUnifiedSessionKey,
  type CodexThreadRuntimeSnapshot,
  type UnifiedClaudeChatSessionRuntime,
  type OpencodeSessionRuntimeSnapshot,
  type UnifiedCodexSessionRuntime,
  type UnifiedOpencodeSessionRuntime,
  type UnifiedProvider,
  type UnifiedSessionStatus,
} from "./unified-runtime";
import type {
  ClaudeChatApprovalRequest,
  ClaudeChatUserInputRequest,
  CodexApprovalRequest,
  CodexState,
  CodexThread,
  CodexUserInputRequest,
  ProjectBootstrap,
  SessionMessageBundle,
} from "@shared/ipc";
import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import type { TodoItem } from "../components/chat/TodoDock";
import type { CodexMessageItem, SubagentInfo } from "../hooks/useCodexSession";
import {
  buildClaudeChatBackgroundAgents,
  buildCodexBackgroundAgents,
  buildCodexBackgroundAgentsFromChildThreads,
  buildCodexBackgroundAgentsFromMessages,
  buildComposerPresentation,
  buildOpencodeBackgroundAgents,
  buildPermissionDockData,
  buildPlanDockData,
  buildQuestionDockData,
  buildSidebarSessionPresentation,
  buildTaskListPresentation,
  extractCodexTodoItemsFromMessages,
  extractOpencodeTodoItems,
  filterOutCurrentCodexThreadAgent,
  type UnifiedBackgroundAgentSummary,
  type UnifiedComposerState,
  type UnifiedPendingActionSurface,
  type UnifiedPermissionDockData,
  type UnifiedPlanDockData,
  type UnifiedProjectedSessionPresentation,
  type UnifiedQuestionDockData,
  type UnifiedSidebarSessionState,
  type UnifiedTaskListPresentation,
} from "../lib/session-presentation";
import { projectCodexSessionPresentation } from "../lib/session-presentation";
import { projectOpencodeSessionPresentation } from "../lib/opencode-session-presentation";
import { projectClaudeChatProjectedSessionPresentation } from "../lib/claude-chat-session-presentation";
import type { ClaudeChatMessageItem, ClaudeChatSubagentState } from "../hooks/useClaudeChatSession";

const SESSION_READ_TIMESTAMPS_KEY = "orxa:sessionReadTimestamps:v2";
const COLLAPSED_PROJECTS_KEY = "orxa:collapsedProjects:v1";

function readJsonRecord(key: string) {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function debouncePersist(key: string, value: Record<string, unknown>) {
  if (typeof window === "undefined") {
    return;
  }
  window.clearTimeout((debouncePersist as unknown as { timers?: Record<string, number> }).timers?.[key]);
  const timers = ((debouncePersist as unknown as { timers?: Record<string, number> }).timers ??= {});
  timers[key] = window.setTimeout(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage failures.
    }
  }, 220);
}

type UnifiedClaudeSessionRuntime = {
  key: string;
  directory: string;
  busy: boolean;
  awaiting: boolean;
  activityAt: number;
};

type UnifiedWorkspaceMeta = {
  lastOpenedAt: number;
  lastUpdatedAt: number;
};

type UnifiedRuntimeStoreState = {
  activeWorkspaceDirectory?: string;
  activeSessionID?: string;
  pendingSessionId?: string;
  activeProvider?: UnifiedProvider;
  projectDataByDirectory: Record<string, ProjectBootstrap>;
  workspaceMetaByDirectory: Record<string, UnifiedWorkspaceMeta>;
  opencodeSessions: Record<string, UnifiedOpencodeSessionRuntime>;
  codexSessions: Record<string, UnifiedCodexSessionRuntime>;
  claudeChatSessions: Record<string, UnifiedClaudeChatSessionRuntime>;
  claudeSessions: Record<string, UnifiedClaudeSessionRuntime>;
  sessionReadTimestamps: Record<string, number>;
  collapsedProjects: Record<string, boolean>;
  setActiveWorkspaceDirectory: (directory?: string) => void;
  setActiveSession: (sessionID?: string, provider?: UnifiedProvider) => void;
  setPendingSessionId: (sessionID?: string) => void;
  setProjectData: (directory: string, project: ProjectBootstrap) => void;
  removeProjectData: (directory: string) => void;
  setWorkspaceMeta: (directory: string, meta: Partial<UnifiedWorkspaceMeta>) => void;
  setOpencodeMessages: (directory: string, sessionID: string, messages: SessionMessageBundle[]) => void;
  setOpencodeRuntimeSnapshot: (directory: string, sessionID: string, snapshot: OpencodeSessionRuntimeSnapshot) => void;
  setOpencodeTodoItems: (directory: string, sessionID: string, items: TodoItem[]) => void;
  removeOpencodeSession: (directory: string, sessionID: string) => void;
  setCollapsedProject: (directory: string, collapsed: boolean) => void;
  replaceCollapsedProjects: (next: Record<string, boolean>) => void;
  setSessionReadAt: (sessionKey: string, timestamp: number) => void;
  clearSessionReadAt: (sessionKey: string) => void;
  initClaudeChatSession: (sessionKey: string, directory: string) => void;
  setClaudeChatConnectionState: (
    sessionKey: string,
    status: UnifiedClaudeChatSessionRuntime["connectionStatus"],
    providerThreadId?: string | null,
    activeTurnId?: string | null,
    lastError?: string,
  ) => void;
  setClaudeChatProviderThreadId: (sessionKey: string, providerThreadId: string | null) => void;
  replaceClaudeChatMessages: (sessionKey: string, messages: ClaudeChatMessageItem[]) => void;
  updateClaudeChatMessages: (sessionKey: string, updater: (previous: ClaudeChatMessageItem[]) => ClaudeChatMessageItem[]) => void;
  setClaudeChatHistoryMessages: (sessionKey: string, messages: UnifiedClaudeChatSessionRuntime["historyMessages"]) => void;
  setClaudeChatPendingApproval: (sessionKey: string, request: ClaudeChatApprovalRequest | null) => void;
  setClaudeChatPendingUserInput: (sessionKey: string, request: ClaudeChatUserInputRequest | null) => void;
  setClaudeChatStreaming: (sessionKey: string, isStreaming: boolean) => void;
  setClaudeChatSubagents: (
    sessionKey: string,
    subagents: ClaudeChatSubagentState[] | ((previous: ClaudeChatSubagentState[]) => ClaudeChatSubagentState[]),
  ) => void;
  removeClaudeChatSession: (sessionKey: string) => void;
  initClaudeSession: (sessionKey: string, directory: string) => void;
  setClaudeBusy: (sessionKey: string, busy: boolean) => void;
  setClaudeAwaiting: (sessionKey: string, awaiting: boolean) => void;
  setClaudeActivityAt: (sessionKey: string, activityAt: number) => void;
  removeClaudeSession: (sessionKey: string) => void;
  initCodexSession: (sessionKey: string, directory: string) => void;
  setCodexConnectionState: (sessionKey: string, status: CodexState["status"], serverInfo?: CodexState["serverInfo"], lastError?: string) => void;
  setCodexThread: (sessionKey: string, thread: CodexThread | null) => void;
  setCodexRuntimeSnapshot: (sessionKey: string, snapshot: CodexThreadRuntimeSnapshot | null) => void;
  replaceCodexMessages: (sessionKey: string, messages: CodexMessageItem[]) => void;
  updateCodexMessages: (sessionKey: string, updater: (previous: CodexMessageItem[]) => CodexMessageItem[]) => void;
  setCodexPendingApproval: (sessionKey: string, request: CodexApprovalRequest | null) => void;
  setCodexPendingUserInput: (sessionKey: string, request: CodexUserInputRequest | null) => void;
  setCodexStreaming: (sessionKey: string, isStreaming: boolean) => void;
  setCodexThreadName: (sessionKey: string, name?: string) => void;
  setCodexPlanItems: (sessionKey: string, items: TodoItem[]) => void;
  setCodexDismissedPlanIds: (sessionKey: string, ids: string[]) => void;
  setCodexSubagents: (sessionKey: string, subagents: SubagentInfo[]) => void;
  setCodexActiveSubagentThreadId: (sessionKey: string, threadId: string | null) => void;
  resetCodexSession: (sessionKey: string) => void;
  removeCodexSession: (sessionKey: string) => void;
};

function buildOpencodeKey(directory: string, sessionID: string) {
  return makeUnifiedSessionKey("opencode", directory, sessionID);
}

function describeApprovalRequest(request: { reason: string; method: string }) {
  const trimmedReason = request.reason.trim();
  if (trimmedReason) {
    return trimmedReason;
  }
  if (request.method.includes("commandExecution")) {
    return "Approval required to run a command.";
  }
  if (request.method.includes("fileChange")) {
    return "Approval required to edit files.";
  }
  if (request.method.includes("fileRead")) {
    return "Approval required to read files.";
  }
  return "Approval required.";
}

function formatPendingApprovalFiles(changes?: Array<{ path: string; type: string }>) {
  if (!changes || changes.length === 0) {
    return undefined;
  }
  const normalized = changes
    .map((change) => {
      const path = change.path.trim();
      if (!path) {
        return null;
      }
      const prefix = change.type === "add" ? "A" : change.type === "delete" ? "D" : change.type ? "M" : "";
      return prefix ? `${prefix} ${path}` : path;
    })
    .filter((entry): entry is string => Boolean(entry));
  if (normalized.length === 0) {
    return undefined;
  }
  if (normalized.length <= 4) {
    return normalized.join(", ");
  }
  return `${normalized.slice(0, 4).join(", ")} +${normalized.length - 4} more`;
}

function ensureCodexSession(state: UnifiedRuntimeStoreState, sessionKey: string, directory = "") {
  const existing = state.codexSessions[sessionKey];
  if (existing) {
    return existing;
  }
  return {
    key: sessionKey,
    directory,
    connectionStatus: "disconnected",
    thread: null,
    runtimeSnapshot: null,
    messages: [],
    pendingApproval: null,
    pendingUserInput: null,
    isStreaming: false,
    planItems: [],
    dismissedPlanIds: [],
    subagents: [],
    activeSubagentThreadId: null,
  } satisfies UnifiedCodexSessionRuntime;
}

function ensureClaudeSession(state: UnifiedRuntimeStoreState, sessionKey: string, directory = "") {
  const existing = state.claudeSessions[sessionKey];
  if (existing) {
    return existing;
  }
  return {
    key: sessionKey,
    directory,
    busy: false,
    awaiting: false,
    activityAt: 0,
  } satisfies UnifiedClaudeSessionRuntime;
}

function ensureClaudeChatSession(state: UnifiedRuntimeStoreState, sessionKey: string, directory = "") {
  const existing = state.claudeChatSessions[sessionKey];
  if (existing) {
    return existing;
  }
  return {
    key: sessionKey,
    directory,
    connectionStatus: "disconnected",
    providerThreadId: null,
    activeTurnId: null,
    messages: [],
    historyMessages: [],
    pendingApproval: null,
    pendingUserInput: null,
    isStreaming: false,
    lastError: undefined,
    subagents: [],
  } satisfies UnifiedClaudeChatSessionRuntime;
}

export const useUnifiedRuntimeStore = create<UnifiedRuntimeStoreState>((set) => ({
  activeWorkspaceDirectory: undefined,
  activeSessionID: undefined,
  pendingSessionId: undefined,
  activeProvider: undefined,
  projectDataByDirectory: {},
  workspaceMetaByDirectory: {},
  opencodeSessions: {},
  codexSessions: {},
  claudeChatSessions: {},
  claudeSessions: {},
  sessionReadTimestamps: Object.fromEntries(
    Object.entries(readJsonRecord(SESSION_READ_TIMESTAMPS_KEY)).filter(([, value]) => typeof value === "number"),
  ) as Record<string, number>,
  collapsedProjects: Object.fromEntries(
    Object.entries(readJsonRecord(COLLAPSED_PROJECTS_KEY)).filter(([, value]) => typeof value === "boolean"),
  ) as Record<string, boolean>,
  setActiveWorkspaceDirectory: (directory) => set({ activeWorkspaceDirectory: directory }),
  setActiveSession: (sessionID, provider) => set({ activeSessionID: sessionID, activeProvider: provider }),
  setPendingSessionId: (sessionID) => set({ pendingSessionId: sessionID }),
  setProjectData: (directory, project) =>
    set((state) => ({
      projectDataByDirectory: { ...state.projectDataByDirectory, [directory]: project },
    })),
  removeProjectData: (directory) =>
    set((state) => {
      const next = { ...state.projectDataByDirectory };
      delete next[directory];
      return { projectDataByDirectory: next };
    }),
  setWorkspaceMeta: (directory, meta) =>
    set((state) => {
      const existing = state.workspaceMetaByDirectory[directory] ?? { lastOpenedAt: 0, lastUpdatedAt: 0 };
      return {
        workspaceMetaByDirectory: {
          ...state.workspaceMetaByDirectory,
          [directory]: {
            ...existing,
            ...meta,
          },
        },
      };
    }),
  setOpencodeMessages: (directory, sessionID, messages) =>
    set((state) => {
      const key = buildOpencodeKey(directory, sessionID);
      const existing = state.opencodeSessions[key];
      return {
        opencodeSessions: {
          ...state.opencodeSessions,
          [key]: {
            key,
            directory,
            sessionID,
            runtimeSnapshot: existing?.runtimeSnapshot ?? null,
            messages,
            todoItems: existing?.todoItems ?? [],
          },
        },
      };
    }),
  setOpencodeRuntimeSnapshot: (directory, sessionID, snapshot) =>
    set((state) => {
      const key = buildOpencodeKey(directory, sessionID);
      const existing = state.opencodeSessions[key];
      return {
        opencodeSessions: {
          ...state.opencodeSessions,
          [key]: {
            key,
            directory,
            sessionID,
            runtimeSnapshot: snapshot,
            messages: snapshot.messages,
            todoItems: existing?.todoItems ?? [],
          },
        },
      };
    }),
  setOpencodeTodoItems: (directory, sessionID, items) =>
    set((state) => {
      const key = buildOpencodeKey(directory, sessionID);
      const existing = state.opencodeSessions[key];
      return {
        opencodeSessions: {
          ...state.opencodeSessions,
          [key]: {
            key,
            directory,
            sessionID,
            runtimeSnapshot: existing?.runtimeSnapshot ?? null,
            messages: existing?.messages ?? [],
            todoItems: items,
          },
        },
      };
    }),
  removeOpencodeSession: (directory, sessionID) =>
    set((state) => {
      const key = buildOpencodeKey(directory, sessionID);
      const next = { ...state.opencodeSessions };
      delete next[key];
      return { opencodeSessions: next };
    }),
  setCollapsedProject: (directory, collapsed) =>
    set((state) => {
      const next = { ...state.collapsedProjects, [directory]: collapsed };
      debouncePersist(COLLAPSED_PROJECTS_KEY, next);
      return { collapsedProjects: next };
    }),
  replaceCollapsedProjects: (next) =>
    set(() => {
      debouncePersist(COLLAPSED_PROJECTS_KEY, next);
      return { collapsedProjects: next };
    }),
  setSessionReadAt: (sessionKey, timestamp) =>
    set((state) => {
      const next = { ...state.sessionReadTimestamps, [sessionKey]: timestamp };
      debouncePersist(SESSION_READ_TIMESTAMPS_KEY, next);
      return { sessionReadTimestamps: next };
    }),
  clearSessionReadAt: (sessionKey) =>
    set((state) => {
      if (!(sessionKey in state.sessionReadTimestamps)) {
        return state;
      }
      const next = { ...state.sessionReadTimestamps };
      delete next[sessionKey];
      debouncePersist(SESSION_READ_TIMESTAMPS_KEY, next);
      return { sessionReadTimestamps: next };
    }),
  initClaudeChatSession: (sessionKey, directory) =>
    set((state) => ({
      claudeChatSessions: {
        ...state.claudeChatSessions,
        [sessionKey]: ensureClaudeChatSession(state, sessionKey, directory),
      },
    })),
  setClaudeChatConnectionState: (sessionKey, status, providerThreadId, activeTurnId, lastError) =>
    set((state) => {
      const session = ensureClaudeChatSession(state, sessionKey);
      return {
        claudeChatSessions: {
          ...state.claudeChatSessions,
          [sessionKey]: {
            ...session,
            connectionStatus: status,
            providerThreadId: providerThreadId !== undefined ? providerThreadId : session.providerThreadId,
            activeTurnId: activeTurnId !== undefined ? activeTurnId : session.activeTurnId,
            lastError: lastError !== undefined ? lastError : session.lastError,
          },
        },
      };
    }),
  setClaudeChatProviderThreadId: (sessionKey, providerThreadId) =>
    set((state) => {
      const session = ensureClaudeChatSession(state, sessionKey);
      return {
        claudeChatSessions: {
          ...state.claudeChatSessions,
          [sessionKey]: { ...session, providerThreadId },
        },
      };
    }),
  replaceClaudeChatMessages: (sessionKey, messages) =>
    set((state) => {
      const session = ensureClaudeChatSession(state, sessionKey);
      return {
        claudeChatSessions: {
          ...state.claudeChatSessions,
          [sessionKey]: { ...session, messages },
        },
      };
    }),
  updateClaudeChatMessages: (sessionKey, updater) =>
    set((state) => {
      const session = ensureClaudeChatSession(state, sessionKey);
      return {
        claudeChatSessions: {
          ...state.claudeChatSessions,
          [sessionKey]: { ...session, messages: updater(session.messages) },
        },
      };
    }),
  setClaudeChatHistoryMessages: (sessionKey, messages) =>
    set((state) => {
      const session = ensureClaudeChatSession(state, sessionKey);
      return {
        claudeChatSessions: {
          ...state.claudeChatSessions,
          [sessionKey]: { ...session, historyMessages: messages },
        },
      };
    }),
  setClaudeChatPendingApproval: (sessionKey, request) =>
    set((state) => {
      const session = ensureClaudeChatSession(state, sessionKey);
      return {
        claudeChatSessions: {
          ...state.claudeChatSessions,
          [sessionKey]: { ...session, pendingApproval: request },
        },
      };
    }),
  setClaudeChatPendingUserInput: (sessionKey, request) =>
    set((state) => {
      const session = ensureClaudeChatSession(state, sessionKey);
      return {
        claudeChatSessions: {
          ...state.claudeChatSessions,
          [sessionKey]: { ...session, pendingUserInput: request },
        },
      };
    }),
  setClaudeChatStreaming: (sessionKey, isStreaming) =>
    set((state) => {
      const session = ensureClaudeChatSession(state, sessionKey);
      return {
        claudeChatSessions: {
          ...state.claudeChatSessions,
          [sessionKey]: { ...session, isStreaming },
        },
      };
    }),
  setClaudeChatSubagents: (sessionKey, subagents) =>
    set((state) => {
      const session = ensureClaudeChatSession(state, sessionKey);
      const nextSubagents = typeof subagents === "function" ? subagents(session.subagents) : subagents;
      return {
        claudeChatSessions: {
          ...state.claudeChatSessions,
          [sessionKey]: { ...session, subagents: nextSubagents },
        },
      };
    }),
  removeClaudeChatSession: (sessionKey) =>
    set((state) => {
      if (!(sessionKey in state.claudeChatSessions)) {
        return state;
      }
      const next = { ...state.claudeChatSessions };
      delete next[sessionKey];
      return { claudeChatSessions: next };
    }),
  initClaudeSession: (sessionKey, directory) =>
    set((state) => ({
      claudeSessions: {
        ...state.claudeSessions,
        [sessionKey]: ensureClaudeSession(state, sessionKey, directory),
      },
    })),
  setClaudeBusy: (sessionKey, busy) =>
    set((state) => {
      const session = ensureClaudeSession(state, sessionKey);
      return {
        claudeSessions: {
          ...state.claudeSessions,
          [sessionKey]: { ...session, busy },
        },
      };
    }),
  setClaudeAwaiting: (sessionKey, awaiting) =>
    set((state) => {
      const session = ensureClaudeSession(state, sessionKey);
      return {
        claudeSessions: {
          ...state.claudeSessions,
          [sessionKey]: { ...session, awaiting },
        },
      };
    }),
  setClaudeActivityAt: (sessionKey, activityAt) =>
    set((state) => {
      const session = ensureClaudeSession(state, sessionKey);
      return {
        claudeSessions: {
          ...state.claudeSessions,
          [sessionKey]: { ...session, activityAt },
        },
      };
    }),
  removeClaudeSession: (sessionKey) =>
    set((state) => {
      if (!(sessionKey in state.claudeSessions)) {
        return state;
      }
      const next = { ...state.claudeSessions };
      delete next[sessionKey];
      return { claudeSessions: next };
    }),
  initCodexSession: (sessionKey, directory) =>
    set((state) => ({
      codexSessions: {
        ...state.codexSessions,
        [sessionKey]: ensureCodexSession(state, sessionKey, directory),
      },
    })),
  setCodexConnectionState: (sessionKey, status, serverInfo, lastError) =>
    set((state) => {
      const session = ensureCodexSession(state, sessionKey);
      return {
        codexSessions: {
          ...state.codexSessions,
          [sessionKey]: { ...session, connectionStatus: status, serverInfo, lastError },
        },
      };
    }),
  setCodexThread: (sessionKey, thread) =>
    set((state) => {
      const session = ensureCodexSession(state, sessionKey);
      return {
        codexSessions: {
          ...state.codexSessions,
          [sessionKey]: { ...session, thread },
        },
      };
    }),
  setCodexRuntimeSnapshot: (sessionKey, snapshot) =>
    set((state) => {
      const session = ensureCodexSession(state, sessionKey);
      return {
        codexSessions: {
          ...state.codexSessions,
          [sessionKey]: { ...session, runtimeSnapshot: snapshot },
        },
      };
    }),
  replaceCodexMessages: (sessionKey, messages) =>
    set((state) => {
      const session = ensureCodexSession(state, sessionKey);
      return {
        codexSessions: {
          ...state.codexSessions,
          [sessionKey]: { ...session, messages },
        },
      };
    }),
  updateCodexMessages: (sessionKey, updater) =>
    set((state) => {
      const session = ensureCodexSession(state, sessionKey);
      return {
        codexSessions: {
          ...state.codexSessions,
          [sessionKey]: { ...session, messages: updater(session.messages) },
        },
      };
    }),
  setCodexPendingApproval: (sessionKey, request) =>
    set((state) => {
      const session = ensureCodexSession(state, sessionKey);
      return {
        codexSessions: {
          ...state.codexSessions,
          [sessionKey]: { ...session, pendingApproval: request },
        },
      };
    }),
  setCodexPendingUserInput: (sessionKey, request) =>
    set((state) => {
      const session = ensureCodexSession(state, sessionKey);
      return {
        codexSessions: {
          ...state.codexSessions,
          [sessionKey]: { ...session, pendingUserInput: request },
        },
      };
    }),
  setCodexStreaming: (sessionKey, isStreaming) =>
    set((state) => {
      const session = ensureCodexSession(state, sessionKey);
      return {
        codexSessions: {
          ...state.codexSessions,
          [sessionKey]: { ...session, isStreaming },
        },
      };
    }),
  setCodexThreadName: (sessionKey, name) =>
    set((state) => {
      const session = ensureCodexSession(state, sessionKey);
      return {
        codexSessions: {
          ...state.codexSessions,
          [sessionKey]: { ...session, threadName: name },
        },
      };
    }),
  setCodexPlanItems: (sessionKey, items) =>
    set((state) => {
      const session = ensureCodexSession(state, sessionKey);
      return {
        codexSessions: {
          ...state.codexSessions,
          [sessionKey]: { ...session, planItems: items },
        },
      };
    }),
  setCodexDismissedPlanIds: (sessionKey, ids) =>
    set((state) => {
      const session = ensureCodexSession(state, sessionKey);
      return {
        codexSessions: {
          ...state.codexSessions,
          [sessionKey]: { ...session, dismissedPlanIds: ids },
        },
      };
    }),
  setCodexSubagents: (sessionKey, subagents) =>
    set((state) => {
      const session = ensureCodexSession(state, sessionKey);
      return {
        codexSessions: {
          ...state.codexSessions,
          [sessionKey]: { ...session, subagents },
        },
      };
    }),
  setCodexActiveSubagentThreadId: (sessionKey, threadId) =>
    set((state) => {
      const session = ensureCodexSession(state, sessionKey);
      return {
        codexSessions: {
          ...state.codexSessions,
          [sessionKey]: { ...session, activeSubagentThreadId: threadId },
        },
      };
    }),
  resetCodexSession: (sessionKey) =>
    set((state) => {
      const session = ensureCodexSession(state, sessionKey);
      return {
        codexSessions: {
          ...state.codexSessions,
          [sessionKey]: {
            ...session,
            thread: null,
            runtimeSnapshot: null,
            messages: [],
            pendingApproval: null,
            pendingUserInput: null,
            isStreaming: false,
            lastError: undefined,
            threadName: undefined,
            planItems: [],
            dismissedPlanIds: [],
            subagents: [],
            activeSubagentThreadId: null,
          },
        },
      };
    }),
  removeCodexSession: (sessionKey) =>
    set((state) => {
      const next = { ...state.codexSessions };
      delete next[sessionKey];
      return { codexSessions: next };
    }),
}));

export function selectOpencodeSessionRuntime(directory: string | undefined, sessionID: string | undefined) {
  if (!directory || !sessionID) {
    return null;
  }
  const key = buildOpencodeKey(directory, sessionID);
  return useUnifiedRuntimeStore.getState().opencodeSessions[key] ?? null;
}

export function selectCodexSessionRuntime(sessionKey: string | undefined) {
  if (!sessionKey) {
    return null;
  }
  return useUnifiedRuntimeStore.getState().codexSessions[sessionKey] ?? null;
}

export function selectClaudeChatSessionRuntime(sessionKey: string | undefined) {
  if (!sessionKey) {
    return null;
  }
  return useUnifiedRuntimeStore.getState().claudeChatSessions[sessionKey] ?? null;
}

export function buildCodexSessionStatus(sessionKey: string, isActive: boolean): UnifiedSessionStatus {
  const state = useUnifiedRuntimeStore.getState();
  const session = state.codexSessions[sessionKey];
  const activityAt = session?.messages.at(-1)?.timestamp ?? 0;
  return deriveUnifiedSessionStatus({
    busy: Boolean(session?.isStreaming),
    awaiting: Boolean(session?.pendingApproval || session?.pendingUserInput),
    planReady: Boolean(session && session.planItems.length > 0 && !session.isStreaming),
    activityAt,
    lastReadAt: state.sessionReadTimestamps[sessionKey],
    isActive,
  });
}

export function buildClaudeSessionStatus(sessionKey: string, isActive: boolean): UnifiedSessionStatus {
  const state = useUnifiedRuntimeStore.getState();
  const session = state.claudeSessions[sessionKey];
  return deriveUnifiedSessionStatus({
    busy: Boolean(session?.busy),
    awaiting: Boolean(session?.awaiting),
    planReady: false,
    activityAt: session?.activityAt ?? 0,
    lastReadAt: state.sessionReadTimestamps[sessionKey],
    isActive,
  });
}

export function buildClaudeChatSessionStatus(sessionKey: string, isActive: boolean): UnifiedSessionStatus {
  const state = useUnifiedRuntimeStore.getState();
  const session = state.claudeChatSessions[sessionKey];
  const activityAt = session?.messages.at(-1)?.timestamp ?? 0;
  return deriveUnifiedSessionStatus({
    busy: Boolean(session?.isStreaming || session?.connectionStatus === "connecting"),
    awaiting: Boolean(session?.pendingApproval || session?.pendingUserInput),
    planReady: false,
    activityAt,
    lastReadAt: state.sessionReadTimestamps[sessionKey],
    isActive,
  });
}

export function buildOpencodeSessionStatus(
  directory: string,
  sessionID: string,
  isActive: boolean,
  sessionKey = `${directory}::${sessionID}`,
): UnifiedSessionStatus {
  const state = useUnifiedRuntimeStore.getState();
  const runtime = state.opencodeSessions[buildOpencodeKey(directory, sessionID)];
  const runtimeSnapshot = runtime?.runtimeSnapshot;
  const projectData = state.projectDataByDirectory[directory];
  const sessionStatus = runtimeSnapshot?.sessionStatus ?? projectData?.sessionStatus[sessionID];
  const latestSessionUpdate =
    runtimeSnapshot?.session?.time.updated ??
    projectData?.sessions.find((session) => session.id === sessionID)?.time.updated ??
    0;
  const latestAssistantMessageAt =
    [...(runtimeSnapshot?.messages ?? [])]
      .reverse()
      .find((bundle) => bundle.info.role === "assistant")?.info.time.created ?? 0;
  const latestUserMessageAt =
    [...(runtimeSnapshot?.messages ?? [])]
      .reverse()
      .find((bundle) => bundle.info.role === "user")?.info.time.created ?? 0;
  const latestMessageAt = runtimeSnapshot?.messages.at(-1)?.info.time.created ?? runtime?.messages.at(-1)?.info.time.created ?? 0;
  const activityAt = Math.max(latestMessageAt, latestSessionUpdate);
  const awaiting = Boolean(
    runtimeSnapshot?.permissions.some((request) => request.sessionID === sessionID) ||
    runtimeSnapshot?.questions.some((request) => request.sessionID === sessionID) ||
    projectData?.permissions.some((request) => request.sessionID === sessionID) ||
    projectData?.questions.some((request) => request.sessionID === sessionID),
  );
  const hasRunningPart = Boolean(
    runtimeSnapshot?.messages.some((bundle) =>
      bundle.info.role === "assistant" &&
      bundle.parts.some((part) => {
        if (part.type !== "tool") {
          return false;
        }
        const toolState = part.state as { status?: string } | undefined;
        return toolState?.status === "running" || toolState?.status === "pending";
      }),
    ),
  );
  const inferredActiveTurnBusy =
    isActive &&
    !sessionStatus &&
    latestAssistantMessageAt >= latestUserMessageAt &&
    latestAssistantMessageAt > 0 &&
    Date.now() - latestAssistantMessageAt < 45_000;
  const busy = Boolean(
    sessionStatus?.type === "busy" ||
    sessionStatus?.type === "retry" ||
    hasRunningPart ||
    inferredActiveTurnBusy,
  );

  return deriveUnifiedSessionStatus({
    busy,
    awaiting,
    planReady: false,
    activityAt,
    lastReadAt: state.sessionReadTimestamps[sessionKey],
    isActive,
  });
}

export function selectSidebarSessionPresentation(input: {
  provider: UnifiedProvider | "claude";
  directory: string;
  sessionID: string;
  updatedAt: number;
  isActive: boolean;
  sessionKey: string;
}): UnifiedSidebarSessionState {
  const { directory, isActive, provider, sessionID, sessionKey, updatedAt } = input;
  const status =
    provider === "codex"
      ? buildCodexSessionStatus(sessionKey, isActive)
      : provider === "claude-chat"
        ? buildClaudeChatSessionStatus(sessionKey, isActive)
      : provider === "claude"
        ? buildClaudeSessionStatus(sessionKey, isActive)
        : buildOpencodeSessionStatus(directory, sessionID, isActive, sessionKey);
  const presentation = buildSidebarSessionPresentation({
    sessionKey,
    status,
    updatedAt,
    isActive,
  });
  if (provider === "claude") {
    return {
      ...presentation,
      indicator: "none",
    };
  }
  return presentation;
}

export function selectActivePendingActionSurface(input: {
  provider: UnifiedProvider | "claude" | undefined;
  directory?: string;
  sessionID?: string;
  sessionKey?: string;
}): UnifiedPendingActionSurface | null {
  const { directory, provider, sessionID, sessionKey } = input;
  const state = useUnifiedRuntimeStore.getState();
  if (provider === "codex" && sessionKey) {
    const session = state.codexSessions[sessionKey];
    if (session?.pendingApproval) {
      return { kind: "permission", provider: "codex", awaiting: true, label: "Agent needs permission to continue" };
    }
    if (session?.pendingUserInput) {
      return { kind: "question", provider: "codex", awaiting: true, label: "Agent is asking a question" };
    }
    if (session && session.planItems.length > 0 && !session.isStreaming) {
      return { kind: "plan", provider: "codex", awaiting: true, label: "Plan is ready for review" };
    }
    return null;
  }
  if (provider === "claude-chat" && sessionKey) {
    const session = state.claudeChatSessions[sessionKey];
    if (session?.pendingApproval) {
      return { kind: "permission", provider: "claude-chat", awaiting: true, label: "Claude needs permission to continue" };
    }
    if (session?.pendingUserInput) {
      return { kind: "question", provider: "claude-chat", awaiting: true, label: "Claude is asking a question" };
    }
    return null;
  }
  if (provider === "opencode" && directory && sessionID) {
    const runtime = state.opencodeSessions[buildOpencodeKey(directory, sessionID)]?.runtimeSnapshot;
    const permission = runtime?.permissions.find((request) => request.sessionID === sessionID);
    if (permission) {
      return { kind: "permission", provider: "opencode", awaiting: true, label: permission.permission ?? "Agent needs permission to continue" };
    }
    const question = runtime?.questions.find((request) => request.sessionID === sessionID);
    if (question) {
      return { kind: "question", provider: "opencode", awaiting: true, label: "Agent is asking a question" };
    }
  }
  return null;
}

export function selectActiveTaskListPresentation(input: {
  provider: UnifiedProvider | "claude" | undefined;
  directory?: string;
  sessionID?: string;
  sessionKey?: string;
}): UnifiedTaskListPresentation | null {
  const { directory, provider, sessionID, sessionKey } = input;
  const state = useUnifiedRuntimeStore.getState();
  if (provider === "codex" && sessionKey) {
    const session = state.codexSessions[sessionKey];
    const items = session?.planItems?.length ? session.planItems : extractCodexTodoItemsFromMessages(session?.messages ?? []);
    return buildTaskListPresentation("codex", items);
  }
  if (provider === "opencode" && directory && sessionID) {
    const runtime = state.opencodeSessions[buildOpencodeKey(directory, sessionID)];
    const items = runtime?.todoItems?.length ? runtime.todoItems : extractOpencodeTodoItems(runtime?.messages ?? []);
    return buildTaskListPresentation("opencode", items);
  }
  return null;
}

export function selectActiveBackgroundAgentsPresentation(input: {
  provider: UnifiedProvider | "claude" | undefined;
  directory?: string;
  sessionID?: string;
  sessionKey?: string;
}): UnifiedBackgroundAgentSummary[] {
  const { directory, provider, sessionID, sessionKey } = input;
  const state = useUnifiedRuntimeStore.getState();
  if (provider === "codex" && sessionKey) {
    const session = state.codexSessions[sessionKey];
    const currentThreadId = session?.thread?.id ?? session?.runtimeSnapshot?.thread?.id ?? null;
    const runtimeAgents = buildCodexBackgroundAgents(session?.subagents ?? []);
    if (runtimeAgents.length > 0) {
      return filterOutCurrentCodexThreadAgent(runtimeAgents, currentThreadId);
    }
    const childThreadAgents = buildCodexBackgroundAgentsFromChildThreads(session?.runtimeSnapshot?.childThreads ?? []);
    if (childThreadAgents.length > 0) {
      return filterOutCurrentCodexThreadAgent(childThreadAgents, currentThreadId);
    }
    return filterOutCurrentCodexThreadAgent(
      buildCodexBackgroundAgentsFromMessages(session?.messages ?? []),
      currentThreadId,
    );
  }
  if (provider === "claude-chat" && sessionKey) {
    return buildClaudeChatBackgroundAgents(state.claudeChatSessions[sessionKey]?.subagents ?? []);
  }
  if (provider === "opencode" && directory && sessionID) {
    const runtime = state.opencodeSessions[buildOpencodeKey(directory, sessionID)];
    const sessionStatus = state.projectDataByDirectory[directory]?.sessionStatus;
    return buildOpencodeBackgroundAgents(runtime?.messages ?? [], sessionStatus);
  }
  return [];
}

export function selectSessionPresentation(input: {
  provider: UnifiedProvider | "claude" | undefined;
  directory?: string;
  sessionID?: string;
  sessionKey?: string;
  assistantLabel?: string;
}): UnifiedProjectedSessionPresentation | null {
  const { assistantLabel, directory, provider, sessionID, sessionKey } = input;
  const state = useUnifiedRuntimeStore.getState();
  if (provider === "codex" && sessionKey) {
    const session = state.codexSessions[sessionKey];
    if (!session) {
      return null;
    }
    const presentation = projectCodexSessionPresentation(session.messages, session.isStreaming);
    return {
      ...presentation,
      latestActivity: null,
      placeholderTimestamp: session.messages.at(-1)?.timestamp ?? 0,
    };
  }
  if (provider === "claude-chat" && sessionKey) {
    const session = state.claudeChatSessions[sessionKey];
    if (!session) {
      return null;
    }
    return projectClaudeChatProjectedSessionPresentation(session.messages, session.isStreaming);
  }
  if (provider === "opencode" && directory && sessionID) {
    const runtime = state.opencodeSessions[buildOpencodeKey(directory, sessionID)];
    const unifiedStatus = buildOpencodeSessionStatus(
      directory,
      sessionID,
      state.activeWorkspaceDirectory === directory && state.activeSessionID === sessionID,
      sessionKey ?? `${directory}::${sessionID}`,
    );
    const effectiveSessionStatus =
      runtime?.runtimeSnapshot?.sessionStatus ??
      (unifiedStatus.busy ? ({ type: "busy" } as SessionStatus) : undefined);
    return projectOpencodeSessionPresentation({
      messages: runtime?.messages ?? [],
      sessionDiff: runtime?.runtimeSnapshot?.sessionDiff ?? [],
      sessionStatus: effectiveSessionStatus,
      executionLedger: runtime?.runtimeSnapshot?.executionLedger.records ?? [],
      changeProvenance: runtime?.runtimeSnapshot?.changeProvenance.records ?? [],
      assistantLabel,
      workspaceDirectory: directory,
    });
  }
  return null;
}

export function selectPendingPermissionDockData(input: {
  provider: UnifiedProvider | "claude" | undefined;
  directory?: string;
  sessionID?: string;
  sessionKey?: string;
  permissionMode?: string;
}): UnifiedPermissionDockData | null {
  const { directory, permissionMode, provider, sessionID, sessionKey } = input;
  const state = useUnifiedRuntimeStore.getState();
  if (provider === "codex" && sessionKey) {
    const request = state.codexSessions[sessionKey]?.pendingApproval;
    if (!request || permissionMode === "yolo-write") {
      return null;
    }
    const filePattern = formatPendingApprovalFiles(request.changes);
    return buildPermissionDockData({
      provider: "codex",
      requestId: request.id,
      description:
        filePattern === undefined && request.method.includes("fileChange")
          ? `${describeApprovalRequest(request)} Codex did not include the target file list yet.`
          : describeApprovalRequest(request),
      filePattern,
      command: request.command,
    });
  }
  if (provider === "claude-chat" && sessionKey) {
    const request = state.claudeChatSessions[sessionKey]?.pendingApproval;
    if (!request || permissionMode === "yolo-write") {
      return null;
    }
    return buildPermissionDockData({
      provider: "claude-chat",
      requestId: request.id,
      description: request.reason,
      command: request.command ? [request.command] : undefined,
    });
  }
  if (provider === "opencode" && directory && sessionID) {
    const runtime = state.opencodeSessions[buildOpencodeKey(directory, sessionID)]?.runtimeSnapshot;
    const projectData = state.projectDataByDirectory[directory];
    const request =
      runtime?.permissions.find((candidate) => candidate.sessionID === sessionID) ??
      projectData?.permissions.find((candidate) => candidate.sessionID === sessionID);
    if (!request) {
      return null;
    }
    return buildPermissionDockData({
      provider: "opencode",
      requestId: request.id,
      description: request.permission ?? "Permission requested",
      filePattern: request.patterns?.[0],
    });
  }
  return null;
}

export function selectPendingQuestionDockData(input: {
  provider: UnifiedProvider | "claude" | undefined;
  directory?: string;
  sessionID?: string;
  sessionKey?: string;
}): UnifiedQuestionDockData | null {
  const { directory, provider, sessionID, sessionKey } = input;
  const state = useUnifiedRuntimeStore.getState();
  if (provider === "codex" && sessionKey) {
    const request = state.codexSessions[sessionKey]?.pendingUserInput;
    if (!request) {
      return null;
    }
    return buildQuestionDockData({
      provider: "codex",
      requestId: request.id,
      questions: [
        {
          id: request.itemId || "user-input-q",
          text: request.message || "The agent is requesting your input.",
        },
      ],
    });
  }
  if (provider === "claude-chat" && sessionKey) {
    const request = state.claudeChatSessions[sessionKey]?.pendingUserInput;
    if (!request) {
      return null;
    }
    return buildQuestionDockData({
      provider: "claude-chat",
      requestId: request.id,
      questions: [
        {
          id: request.elicitationId ?? request.id,
          header: request.server,
          text: request.message,
          options: request.options,
        },
      ],
    });
  }
  if (provider === "opencode" && directory && sessionID) {
    const runtime = state.opencodeSessions[buildOpencodeKey(directory, sessionID)]?.runtimeSnapshot;
    const projectData = state.projectDataByDirectory[directory];
    const request =
      runtime?.questions.find((candidate) => candidate.sessionID === sessionID) ??
      projectData?.questions.find((candidate) => candidate.sessionID === sessionID);
    if (!request) {
      return null;
    }
    return buildQuestionDockData({
      provider: "opencode",
      requestId: request.id,
      questions: (request.questions ?? []).map((question, index) => ({
        id: `${request.id}-q${index}`,
        header: question.header,
        text: question.question,
        options: question.options?.map((option) => ({ label: option.label, value: option.label })),
        multiSelect: question.multiple,
      })),
    });
  }
  return null;
}

export function selectPendingPlanDockData(input: {
  provider: UnifiedProvider | "claude" | undefined;
  sessionKey?: string;
}): UnifiedPlanDockData | null {
  const { provider, sessionKey } = input;
  const state = useUnifiedRuntimeStore.getState();
  if (provider === "codex" && sessionKey) {
    const session = state.codexSessions[sessionKey];
    if (session && session.planItems.length > 0 && !session.isStreaming) {
      return buildPlanDockData({ label: "Plan ready for review" });
    }
  }
  return null;
}

export function selectActiveComposerPresentation(input: {
  provider: UnifiedProvider | "claude" | undefined;
  directory?: string;
  sessionID?: string;
  sessionKey?: string;
  sending: boolean;
}): UnifiedComposerState {
  const { directory, provider, sending, sessionID, sessionKey } = input;
  const status =
    provider === "codex" && sessionKey
      ? buildCodexSessionStatus(sessionKey, true)
      : provider === "claude-chat" && sessionKey
        ? buildClaudeChatSessionStatus(sessionKey, true)
      : provider === "claude" && sessionKey
        ? buildClaudeSessionStatus(sessionKey, true)
        : provider === "opencode" && directory && sessionID
          ? buildOpencodeSessionStatus(directory, sessionID, true, sessionKey ?? `${directory}::${sessionID}`)
          : null;
  const pending = selectActivePendingActionSurface({ provider, directory, sessionID, sessionKey });
  return buildComposerPresentation({
    status,
    sending,
    pending,
  });
}
