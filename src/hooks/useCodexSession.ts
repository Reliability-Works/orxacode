import { startTransition, useCallback, useEffect, useMemo, useRef } from "react";
import type { CodexApprovalRequest, CodexNotification, CodexState, CodexThread, CodexUserInputRequest } from "@shared/ipc";
import type { TodoItem } from "../components/chat/TodoDock";
import { getPersistedCodexState, setPersistedCodexState } from "./codex-session-storage";
import {
  appendAssistantDeltaToLastMessage,
  appendDeltaToMappedItem,
  parseMarkdownPlan,
  parseStructuredPlan,
} from "./codex-session-message-reducers";
import { nextMessageID, resetStreamingBookkeeping } from "./codex-session-streaming";
import type { ExploreEntry } from "../lib/explore-utils";
import {
  cleanCommandText,
  commandToExploreEntry,
  fileReadToExploreEntry,
  isReadOnlyCommand,
  webSearchToExploreEntry,
  mcpToolCallToExploreEntry,
} from "../lib/explore-utils";
import { parseGitDiffOutput, parseGitStatusOutput, type GitDiffFile, type GitStatusFile } from "../lib/git-diff";
import { useUnifiedRuntimeStore } from "../state/unified-runtime-store";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function normalizeSubagentKind(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]/g, "_");
  if (normalized.startsWith("subagent_")) {
    return normalized.slice("subagent_".length);
  }
  if (normalized.startsWith("sub_agent_")) {
    return normalized.slice("sub_agent_".length);
  }
  return normalized;
}

function normalizeSubagentDisplayRole(value: string | null | undefined) {
  const normalized = normalizeSubagentKind(value ?? "");
  if (!normalized || normalized === "vscode" || normalized === "editor" || normalized === "codex") {
    return undefined;
  }
  return normalized.replace(/_/g, " ");
}

function getSubagentKind(source: unknown): string | null {
  if (typeof source === "string") {
    const normalized = normalizeSubagentKind(source);
    return normalized || null;
  }

  const record = asRecord(source);
  if (!record) {
    return null;
  }

  const subAgentRaw = record.subAgent ?? record.sub_agent ?? record.subagent;
  if (typeof subAgentRaw === "string") {
    const normalized = normalizeSubagentKind(subAgentRaw);
    return normalized || null;
  }

  const subAgentRecord = asRecord(subAgentRaw);
  if (!subAgentRecord) {
    return null;
  }

  const explicitKind = asString(
    subAgentRecord.kind ??
      subAgentRecord.type ??
      subAgentRecord.name ??
      subAgentRecord.id,
  );
  if (explicitKind) {
    const normalized = normalizeSubagentKind(explicitKind);
    return normalized || null;
  }

  const candidateKeys = Object.keys(subAgentRecord).filter(
    (key) =>
      key !== "thread_spawn" &&
      key !== "threadSpawn" &&
      key !== "nickname" &&
      key !== "agentNickname" &&
      key !== "agent_nickname" &&
      key !== "role" &&
      key !== "agentRole" &&
      key !== "agent_role" &&
      key !== "parentThreadId" &&
      key !== "parent_thread_id" &&
      key !== "depth",
  );
  if (candidateKeys.length !== 1) {
    return null;
  }
  const normalized = normalizeSubagentKind(candidateKeys[0] ?? "");
  return normalized || null;
}

function extractSubagentMeta(source: unknown) {
  const sourceRecord = asRecord(source);
  const subAgentRecord = asRecord(sourceRecord?.subAgent ?? sourceRecord?.sub_agent ?? sourceRecord?.subagent);
  if (!subAgentRecord) {
    const kind = getSubagentKind(source);
    if (!kind) {
      return null;
    }
    return {
      kind,
      nickname: undefined,
      role: normalizeSubagentDisplayRole(kind) ?? "worker",
    };
  }
  const kind = getSubagentKind(source);
  const nickname =
    asString(subAgentRecord?.nickname ?? subAgentRecord?.agentNickname ?? subAgentRecord?.agent_nickname).trim() ||
    undefined;
  const explicitRole = normalizeSubagentDisplayRole(
    asString(subAgentRecord?.role ?? subAgentRecord?.agentRole ?? subAgentRecord?.agent_role).trim() || null,
  );
  const role = explicitRole ?? (kind ? normalizeSubagentDisplayRole(kind) : undefined) ?? "worker";

  return { kind, nickname, role };
}

function readTurnId(params: Record<string, unknown>) {
  return (
    asString(params.turnId ?? params.turn_id).trim() ||
    asString(asRecord(params.turn)?.id).trim() ||
    null
  );
}

function readThreadId(params: Record<string, unknown>) {
  return (
    asString(params.threadId ?? params.thread_id).trim() ||
    asString(asRecord(params.thread)?.id).trim() ||
    null
  );
}

function normalizeCommandText(value: unknown) {
  if (Array.isArray(value)) {
    const first = asString(value[0]).trim();
    const second = asString(value[1]).trim();
    const third = asString(value[2]).trim();
    if (/(?:^|\/)(?:zsh|bash|sh)$/.test(first) && (second === "-lc" || second === "-c") && third) {
      return third;
    }
    return value
      .map((entry) => asString(entry).trim())
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  return asString(value).trim();
}

function normalizeWorkspaceRelativePath(rawPath: string, workspaceDirectory: string) {
  const normalizedPath = rawPath.trim().replace(/\\/g, "/");
  const normalizedWorkspace = workspaceDirectory.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  if (!normalizedPath || !normalizedWorkspace) {
    return normalizedPath;
  }
  if (normalizedPath === normalizedWorkspace) {
    return ".";
  }
  if (normalizedPath.startsWith(`${normalizedWorkspace}/`)) {
    return normalizedPath.slice(normalizedWorkspace.length + 1);
  }
  return normalizedPath;
}

const HIDDEN_SUBAGENT_KINDS = new Set(["memory_consolidation"]);

function getParentThreadIdFromSource(source: unknown): string | null {
  const sourceRecord = asRecord(source);
  if (!sourceRecord) {
    return null;
  }
  const subAgent = asRecord(sourceRecord.subAgent ?? sourceRecord.sub_agent ?? sourceRecord.subagent);
  if (!subAgent) {
    return null;
  }
  const threadSpawn = asRecord(subAgent.thread_spawn ?? subAgent.threadSpawn);
  if (!threadSpawn) {
    return null;
  }
  return (
    asString(threadSpawn.parent_thread_id ?? threadSpawn.parentThreadId).trim() ||
    null
  );
}

function getParentThreadIdFromThread(thread: Record<string, unknown>): string | null {
  return (
    getParentThreadIdFromSource(thread.source) ||
    asString(
      thread.parentThreadId ??
      thread.parent_thread_id ??
      thread.parentId ??
      thread.parent_id ??
      thread.senderThreadId ??
      thread.sender_thread_id,
    ).trim() ||
    null
  );
}

function getNotificationThreadId(
  method: string,
  params: Record<string, unknown>,
  itemThreadIds: Map<string, string>,
  turnThreadIds: Map<string, string>,
): string | null {
  const itemRecord = asRecord(params.item);
  const turnRecord = asRecord(params.turn);
  const threadRecord = asRecord(params.thread);
  const itemId = asString(params.itemId ?? itemRecord?.id).trim();
  const turnId = asString(params.turnId ?? turnRecord?.id).trim();
  const directThreadId =
    asString(params.threadId ?? params.thread_id).trim() ||
    asString(threadRecord?.id).trim() ||
    asString(turnRecord?.threadId ?? turnRecord?.thread_id).trim() ||
    asString(itemRecord?.threadId ?? itemRecord?.thread_id).trim();

  if (directThreadId) {
    return directThreadId;
  }
  if (itemId && itemThreadIds.has(itemId)) {
    return itemThreadIds.get(itemId) ?? null;
  }
  if (turnId && turnThreadIds.has(turnId)) {
    return turnThreadIds.get(turnId) ?? null;
  }
  if (method === "thread/name/updated") {
    return asString(params.threadId ?? params.thread_id ?? threadRecord?.id).trim() || null;
  }
  return null;
}

function isHiddenSubagentSource(source: unknown) {
  const kind = getSubagentKind(source);
  if (!kind) {
    return false;
  }
  return HIDDEN_SUBAGENT_KINDS.has(kind);
}

function normalizeThreadStatusType(status: unknown) {
  if (!status || typeof status !== "object" || Array.isArray(status)) {
    return "";
  }
  const record = status as Record<string, unknown>;
  const typeRaw = record.type ?? record.statusType ?? record.status_type;
  if (typeof typeRaw !== "string") {
    return "";
  }
  return typeRaw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, "");
}

function getResumedActiveTurnId(thread: Record<string, unknown>): string | null {
  const explicitTurnId =
    asString(thread.activeTurnId ?? thread.active_turn_id).trim() ||
    asString(asRecord(thread.activeTurn ?? thread.active_turn ?? thread.currentTurn ?? thread.current_turn)?.id).trim();
  if (explicitTurnId) {
    return explicitTurnId;
  }
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = asRecord(turns[index]);
    if (!turn) {
      continue;
    }
    const status = asString(turn.status ?? turn.turnStatus ?? turn.turn_status)
      .trim()
      .toLowerCase()
      .replace(/[\s_-]/g, "");
    if (
      status === "inprogress" ||
      status === "running" ||
      status === "processing" ||
      status === "pending" ||
      status === "started" ||
      status === "queued" ||
      status === "waiting" ||
      status === "blocked" ||
      status === "needsinput" ||
      status === "requiresaction" ||
      status === "awaitinginput" ||
      status === "waitingforinput"
    ) {
      return asString(turn.id ?? turn.turnId ?? turn.turn_id).trim() || null;
    }
  }
  return null;
}

function toSubagentStatus(thread: Record<string, unknown>): Pick<SubagentInfo, "status" | "statusText"> {
  const statusType = normalizeThreadStatusType(thread.status);
  const activeTurnId = getResumedActiveTurnId(thread);
  if (
    statusType.includes("await") ||
    statusType.includes("input") ||
    statusType.includes("question") ||
    statusType.includes("response")
  ) {
    return { status: "awaiting_instruction", statusText: "awaiting input" };
  }
  if (activeTurnId) {
    return { status: "thinking", statusText: "is thinking" };
  }
  if (
    statusType === "completed" ||
    statusType === "done" ||
    statusType === "finished"
  ) {
    return { status: "completed", statusText: "completed" };
  }
  return { status: "idle", statusText: "idle" };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CodexMessageRole = "user" | "assistant";

/** @deprecated Use CodexMessageItem instead */
export interface CodexMessage {
  id: string;
  role: CodexMessageRole;
  content: string;
  timestamp: number;
}

/** Tracked subagent info for background agents panel */
export interface SubagentInfo {
  threadId: string;
  nickname: string;
  role: string;
  status: "thinking" | "awaiting_instruction" | "completed" | "idle";
  statusText: string;
  spawnedAt: number;
}

/** Agent color palette for distinct agent name colors */
const AGENT_COLORS = ["#22C55E", "#F97316", "#3B82F6", "#A855F7", "#06B6D4", "#EC4899"] as const;
export function agentColor(index: number): string {
  return AGENT_COLORS[index % AGENT_COLORS.length];
}

/** Stable color derived from a threadId string (consistent across UI surfaces) */
export function agentColorForId(threadId: string): string {
  let hash = 0;
  for (let i = 0; i < threadId.length; i++) {
    hash = ((hash << 5) - hash + threadId.charCodeAt(i)) | 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

export type CodexMessageItem =
  | { id: string; kind: "message"; role: "user" | "assistant"; content: string; timestamp: number }
  | { id: string; kind: "status"; label: string; timestamp: number }
  | {
      id: string;
      kind: "tool";
      toolType: string;
      title: string;
      command?: string;
      output?: string;
      status: "running" | "completed" | "error";
      exitCode?: number;
      durationMs?: number;
      timestamp: number;
      /** Collab metadata for subagent task items */
      collabSender?: { threadId: string; nickname?: string; role?: string };
      collabReceivers?: Array<{ threadId: string; nickname?: string; role?: string }>;
      collabStatuses?: Array<{ threadId: string; nickname?: string; role?: string; status: string }>;
    }
  | {
      id: string;
      kind: "diff";
      path: string;
      type: string;
      status: "running" | "completed" | "error";
      diff?: string;
      insertions?: number;
      deletions?: number;
      timestamp: number;
    }
  | { id: string; kind: "thinking"; timestamp: number }
  | { id: string; kind: "reasoning"; content: string; summary: string; timestamp: number }
  | {
      id: string;
      kind: "context";
      toolType: string;
      title: string;
      detail?: string;
      status: "running" | "completed" | "error";
      timestamp: number;
    }
  | { id: string; kind: "compaction"; timestamp: number }
  | {
      id: string;
      kind: "explore";
      status: "exploring" | "explored";
      entries: ExploreEntry[];
      timestamp: number;
    };

export interface CodexSessionState {
  connectionStatus: CodexState["status"];
  serverInfo?: CodexState["serverInfo"];
  thread: CodexThread | null;
  messages: CodexMessageItem[];
  pendingApproval: CodexApprovalRequest | null;
  pendingUserInput: CodexUserInputRequest | null;
  isStreaming: boolean;
  lastError?: string;
  threadName?: string;
  planItems: TodoItem[];
}

type GitDiffSnapshotEntry = {
  path: string;
  oldPath?: string;
  type: string;
  insertions: number;
  deletions: number;
  diff: string;
};

type CommandDiffBaseline = {
  snapshot: Map<string, GitDiffSnapshotEntry>;
  statusSnapshot: Map<string, GitStatusFile>;
  dirtyContents: Map<string, string | null>;
};

const COMMAND_DIFF_CONTENT_BASELINE_LIMIT = 24;
const COMMAND_DIFF_POLL_INTERVAL_MS = 850;

type FileChangeDescriptor = {
  path: string;
  type: string;
  diff?: string;
  insertions?: number;
  deletions?: number;
};

type GitSnapshotLookup = {
  diffByPath: Map<string, GitDiffSnapshotEntry>;
  statusByPath: Map<string, GitStatusFile>;
};

function toGitSnapshotEntry(file: GitDiffFile): GitDiffSnapshotEntry {
  return {
    path: file.path,
    oldPath: file.oldPath,
    type: file.status,
    insertions: file.added,
    deletions: file.removed,
    diff: file.diffLines.join("\n"),
  };
}

function captureGitDiffSnapshot(files: GitDiffFile[]) {
  return new Map(files.map((file) => [file.key, toGitSnapshotEntry(file)]));
}

function captureGitStatusSnapshot(files: GitStatusFile[]) {
  return new Map(files.map((file) => [file.key, file]));
}

function isSameGitDiffSnapshotEntry(left: GitDiffSnapshotEntry | undefined, right: GitDiffSnapshotEntry) {
  if (!left) {
    return false;
  }
  return (
    left.path === right.path &&
    left.type === right.type &&
    left.insertions === right.insertions &&
    left.deletions === right.deletions &&
    left.diff === right.diff
  );
}

function isSameGitStatusSnapshotEntry(left: GitStatusFile | undefined, right: GitStatusFile) {
  if (!left) {
    return false;
  }
  return (
    left.path === right.path &&
    left.oldPath === right.oldPath &&
    left.status === right.status
  );
}

function splitLinesPreserveFinalNewline(value: string | null) {
  if (value == null) {
    return [];
  }
  const normalized = value.replace(/\r\n/g, "\n");
  if (!normalized) {
    return [];
  }
  return normalized.endsWith("\n")
    ? normalized.slice(0, -1).split("\n")
    : normalized.split("\n");
}

function buildSyntheticCommandDiff(path: string, beforeContent: string | null, afterContent: string | null) {
  const beforeLines = splitLinesPreserveFinalNewline(beforeContent);
  const afterLines = splitLinesPreserveFinalNewline(afterContent);

  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let beforeSuffix = beforeLines.length - 1;
  let afterSuffix = afterLines.length - 1;
  while (
    beforeSuffix >= prefix &&
    afterSuffix >= prefix &&
    beforeLines[beforeSuffix] === afterLines[afterSuffix]
  ) {
    beforeSuffix -= 1;
    afterSuffix -= 1;
  }

  const removedLines = beforeLines.slice(prefix, beforeSuffix + 1);
  const addedLines = afterLines.slice(prefix, afterSuffix + 1);
  const type =
    beforeContent == null ? "added" : afterContent == null ? "deleted" : "modified";

  if (removedLines.length === 0 && addedLines.length === 0) {
    return {
      type,
      diff: "",
      insertions: 0,
      deletions: 0,
    };
  }

  const oldStart = removedLines.length === 0 ? prefix : prefix + 1;
  const newStart = addedLines.length === 0 ? prefix : prefix + 1;
  const diffLines = [
    `diff --git a/${path} b/${path}`,
    `--- ${beforeContent == null ? "/dev/null" : `a/${path}`}`,
    `+++ ${afterContent == null ? "/dev/null" : `b/${path}`}`,
    `@@ -${oldStart},${removedLines.length} +${newStart},${addedLines.length} @@`,
    ...removedLines.map((line) => `-${line}`),
    ...addedLines.map((line) => `+${line}`),
  ];

  return {
    type,
    diff: diffLines.join("\n"),
    insertions: addedLines.length,
    deletions: removedLines.length,
  };
}

function looksLikeUnifiedDiff(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return false;
  }
  return (
    trimmed.startsWith("diff --git ") ||
    trimmed.includes("\n@@ ") ||
    trimmed.startsWith("@@ ") ||
    trimmed.includes("\n--- ") ||
    trimmed.includes("\n+++ ") ||
    trimmed.startsWith("--- ") ||
    trimmed.startsWith("+++ ")
  );
}

function normalizeFileChangeType(value: unknown) {
  const normalized = asString(value).trim().toLowerCase();
  if (normalized === "add" || normalized === "added" || normalized === "create" || normalized === "created") {
    return "added";
  }
  if (normalized === "delete" || normalized === "deleted" || normalized === "remove" || normalized === "removed") {
    return "deleted";
  }
  if (normalized === "rename" || normalized === "renamed" || normalized === "move" || normalized === "moved") {
    return "renamed";
  }
  return "modified";
}

function parseFileChangeSummary(output: string | undefined) {
  if (!output) {
    return [];
  }
  const descriptors: FileChangeDescriptor[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^([AMDR])\s+(.+)$/);
    if (!match) {
      continue;
    }
    const code = match[1] ?? "M";
    const path = match[2]?.trim();
    if (!path) {
      continue;
    }
    descriptors.push({
      path,
      type: code === "A" ? "added" : code === "D" ? "deleted" : code === "R" ? "renamed" : "modified",
    });
  }
  return descriptors;
}

function extractFileChangeDescriptors(item: {
  path?: string;
  changeType?: string;
  insertions?: number;
  deletions?: number;
  changes?: unknown;
  aggregatedOutput?: string;
}, existingDiff?: string): FileChangeDescriptor[] {
  const rawChanges = Array.isArray(item.changes) ? item.changes : [];
  const fromChanges = rawChanges
    .map((change) => {
      const record = asRecord(change);
      const path = asString(record?.path).trim();
      if (!path) {
        return null;
      }
      const diff = asString(record?.diff).trim();
      const insertions = typeof record?.insertions === "number" ? record.insertions : undefined;
      const deletions = typeof record?.deletions === "number" ? record.deletions : undefined;
      return {
        path,
        type: normalizeFileChangeType(record?.kind ?? record?.type ?? item.changeType),
        diff: looksLikeUnifiedDiff(diff) ? diff : undefined,
        insertions,
        deletions,
      } satisfies FileChangeDescriptor;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  if (fromChanges.length > 0) {
    return fromChanges;
  }

  const fallbackPath = asString(item.path).trim();
  if (fallbackPath) {
    return [{
      path: fallbackPath,
      type: normalizeFileChangeType(item.changeType),
      diff: looksLikeUnifiedDiff(existingDiff) ? existingDiff : undefined,
      insertions: item.insertions,
      deletions: item.deletions,
    }];
  }

  return parseFileChangeSummary(item.aggregatedOutput);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCodexSession(
  directory: string,
  sessionKey: string,
  codexOptions?: { codexPath?: string; codexArgs?: string },
) {
  const persisted = getPersistedCodexState(sessionKey);
  const subagentThreadIds = useRef(new Set<string>());
  const codexRuntime = useUnifiedRuntimeStore((state) => state.codexSessions[sessionKey] ?? null);
  const initCodexSession = useUnifiedRuntimeStore((state) => state.initCodexSession);
  const setCodexConnectionState = useUnifiedRuntimeStore((state) => state.setCodexConnectionState);
  const setCodexThread = useUnifiedRuntimeStore((state) => state.setCodexThread);
  const replaceCodexMessages = useUnifiedRuntimeStore((state) => state.replaceCodexMessages);
  const updateCodexMessages = useUnifiedRuntimeStore((state) => state.updateCodexMessages);
  const setCodexPendingApproval = useUnifiedRuntimeStore((state) => state.setCodexPendingApproval);
  const setCodexPendingUserInput = useUnifiedRuntimeStore((state) => state.setCodexPendingUserInput);
  const setCodexStreaming = useUnifiedRuntimeStore((state) => state.setCodexStreaming);
  const setCodexThreadName = useUnifiedRuntimeStore((state) => state.setCodexThreadName);
  const setCodexPlanItems = useUnifiedRuntimeStore((state) => state.setCodexPlanItems);
  const setCodexDismissedPlanIds = useUnifiedRuntimeStore((state) => state.setCodexDismissedPlanIds);
  const setCodexSubagents = useUnifiedRuntimeStore((state) => state.setCodexSubagents);
  const setCodexActiveSubagentThreadId = useUnifiedRuntimeStore((state) => state.setCodexActiveSubagentThreadId);
  const setCodexRuntimeSnapshot = useUnifiedRuntimeStore((state) => state.setCodexRuntimeSnapshot);

  const connectionStatus = codexRuntime?.connectionStatus ?? "disconnected";
  const serverInfo = codexRuntime?.serverInfo;
  const thread = codexRuntime?.thread ?? persisted.thread;
  const messages = codexRuntime?.messages ?? persisted.messages;
  const pendingApproval = codexRuntime?.pendingApproval ?? null;
  const pendingUserInput = codexRuntime?.pendingUserInput ?? null;
  const isStreaming = codexRuntime?.isStreaming ?? persisted.isStreaming;
  const lastError = codexRuntime?.lastError;
  const threadName = codexRuntime?.threadName;
  const planItems = codexRuntime?.planItems ?? [];
  const dismissedPlanIds = useMemo(() => new Set(codexRuntime?.dismissedPlanIds ?? []), [codexRuntime?.dismissedPlanIds]);
  const subagents = codexRuntime?.subagents ?? [];
  const activeSubagentThreadId = codexRuntime?.activeSubagentThreadId ?? null;

  // Track the current assistant message being streamed
  const streamingItemIdRef = useRef<string | null>(null);
  // Track the thinking item id so we can remove it on turn/completed
  const thinkingItemIdRef = useRef<string | null>(null);
  const messageIdCounter = useRef(persisted.messageIdCounter);
  // Map codex item IDs to our message IDs for delta matching
  const codexItemToMsgId = useRef(new Map<string, string>());
  // Map codex item IDs to the explore group message ID they belong to
  const codexItemToExploreGroupId = useRef(new Map<string, string>());
  // Track the active explore group so we can append to it even when non-explore items are inserted between
  const activeExploreGroupIdRef = useRef<string | null>(null);
  // Track the single reasoning message for the current turn (only one visible at a time)
  const currentReasoningIdRef = useRef<string | null>(null);
  // Track active turn for interrupt
  const activeTurnIdRef = useRef<string | null>(null);
  const pendingInterruptRef = useRef(false);
  const interruptRequestedRef = useRef(false);
  const latestPlanUpdateIdRef = useRef<string | null>(null);
  const itemThreadIdsRef = useRef(new Map<string, string>());
  const turnThreadIdsRef = useRef(new Map<string, string>());
  const commandDiffSnapshotsRef = useRef(new Map<string, Promise<CommandDiffBaseline | null>>());
  const commandDiffPollTimersRef = useRef(new Map<string, number>());

  const getCurrentCodexRuntime = useCallback(
    () => useUnifiedRuntimeStore.getState().codexSessions[sessionKey] ?? null,
    [sessionKey],
  );

  const updateMessages = useCallback(
    (updater: (previous: CodexMessageItem[]) => CodexMessageItem[], priority: "normal" | "deferred" = "normal") => {
      if (priority === "deferred") {
        startTransition(() => {
          updateCodexMessages(sessionKey, updater);
        });
        return;
      }
      updateCodexMessages(sessionKey, updater);
    },
    [sessionKey, updateCodexMessages],
  );

  const setMessagesState = useCallback(
    (next: CodexMessageItem[] | ((previous: CodexMessageItem[]) => CodexMessageItem[])) => {
      if (typeof next === "function") {
        updateCodexMessages(sessionKey, next);
        return;
      }
      replaceCodexMessages(sessionKey, next);
    },
    [replaceCodexMessages, sessionKey, updateCodexMessages],
  );

  const setThreadState = useCallback((next: CodexThread | null) => {
    setCodexThread(sessionKey, next);
  }, [sessionKey, setCodexThread]);

  const setPendingApprovalState = useCallback((next: CodexApprovalRequest | null) => {
    setCodexPendingApproval(sessionKey, next);
  }, [sessionKey, setCodexPendingApproval]);

  const setPendingUserInputState = useCallback((next: CodexUserInputRequest | null) => {
    setCodexPendingUserInput(sessionKey, next);
  }, [sessionKey, setCodexPendingUserInput]);

  const setStreamingState = useCallback((next: boolean) => {
    setCodexStreaming(sessionKey, next);
  }, [sessionKey, setCodexStreaming]);

  const setThreadNameState = useCallback((next: string | undefined) => {
    setCodexThreadName(sessionKey, next);
  }, [sessionKey, setCodexThreadName]);

  const setPlanItemsState = useCallback((next: TodoItem[]) => {
    setCodexPlanItems(sessionKey, next);
  }, [sessionKey, setCodexPlanItems]);

  const setDismissedPlanIdsState = useCallback((next: Set<string> | ((previous: Set<string>) => Set<string>)) => {
    const previous = new Set(useUnifiedRuntimeStore.getState().codexSessions[sessionKey]?.dismissedPlanIds ?? []);
    const resolved = typeof next === "function" ? next(previous) : next;
    setCodexDismissedPlanIds(sessionKey, [...resolved]);
  }, [sessionKey, setCodexDismissedPlanIds]);

  const setSubagentsState = useCallback((next: SubagentInfo[] | ((previous: SubagentInfo[]) => SubagentInfo[])) => {
    const previous = useUnifiedRuntimeStore.getState().codexSessions[sessionKey]?.subagents ?? [];
    const resolved = typeof next === "function" ? next(previous) : next;
    setCodexSubagents(sessionKey, resolved);
  }, [sessionKey, setCodexSubagents]);

  const setActiveSubagentThreadIdState = useCallback((next: string | null | ((previous: string | null) => string | null)) => {
    const previous = useUnifiedRuntimeStore.getState().codexSessions[sessionKey]?.activeSubagentThreadId ?? null;
    const resolved = typeof next === "function" ? next(previous) : next;
    setCodexActiveSubagentThreadId(sessionKey, resolved);
  }, [sessionKey, setCodexActiveSubagentThreadId]);

  const setConnectionState = useCallback(
    (status: CodexState["status"], nextServerInfo?: CodexState["serverInfo"], nextLastError?: string) => {
      setCodexConnectionState(sessionKey, status, nextServerInfo, nextLastError);
    },
    [sessionKey, setCodexConnectionState],
  );

  const recordLastError = useCallback(
    (error: unknown, statusOverride?: CodexState["status"]) => {
      const currentRuntime = useUnifiedRuntimeStore.getState().codexSessions[sessionKey];
      setCodexConnectionState(
        sessionKey,
        statusOverride ?? currentRuntime?.connectionStatus ?? "error",
        currentRuntime?.serverInfo,
        error instanceof Error ? error.message : String(error),
      );
    },
    [sessionKey, setCodexConnectionState],
  );

  useEffect(() => {
    initCodexSession(sessionKey, directory);
  }, [directory, initCodexSession, sessionKey]);

  useEffect(() => {
    setPersistedCodexState(sessionKey, {
      messages,
      thread,
      isStreaming,
      messageIdCounter: messageIdCounter.current,
    });
  }, [isStreaming, messages, sessionKey, thread]);

  // Ensure persistence on unmount (refs capture latest values)
  useEffect(() => {
    const pollTimers = commandDiffPollTimersRef.current;
    return () => {
      for (const timerId of pollTimers.values()) {
        window.clearTimeout(timerId);
      }
      pollTimers.clear();
      const runtime = getCurrentCodexRuntime();
      setPersistedCodexState(sessionKey, {
        messages: runtime?.messages ?? [],
        thread: runtime?.thread ?? null,
        isStreaming: runtime?.isStreaming ?? false,
        messageIdCounter: messageIdCounter.current,
      });
    };
  }, [getCurrentCodexRuntime, sessionKey]);

  // ------------------------------------------------------------------
  // Helper: find and update a message by its internal msg ID
  // ------------------------------------------------------------------
  const appendToItemField = useCallback(
    (codexItemId: string, field: "content" | "output" | "diff" | "summary", delta: string) => {
      const msgId = codexItemToMsgId.current.get(codexItemId);
      if (!msgId) return;
      updateMessages((prev) => appendDeltaToMappedItem(prev, msgId, field, delta), "deferred");
    },
    [updateMessages],
  );

  const readProjectFileContent = useCallback(async (relativePath: string) => {
    if (!window.orxa?.opencode) {
      return null;
    }
    try {
      const document = await window.orxa.opencode.readProjectFile(directory, relativePath);
      return document.binary ? null : document.content;
    } catch {
      return null;
    }
  }, [directory]);

  const captureCommandDiffSnapshot = useCallback(async () => {
    if (!window.orxa?.opencode) {
      return null;
    }
    try {
      const [diffOutput, statusOutput] = await Promise.all([
        window.orxa.opencode.gitDiff(directory),
        window.orxa.opencode.gitStatus?.(directory) ?? Promise.resolve(""),
      ]);
      const snapshot = captureGitDiffSnapshot(parseGitDiffOutput(diffOutput).files);
      const statusSnapshot = captureGitStatusSnapshot(parseGitStatusOutput(statusOutput).files);
      const dirtyContents = new Map<string, string | null>();
      const dirtyPaths = [...new Set([
        ...[...snapshot.values()].map((entry) => entry.path),
        ...[...statusSnapshot.values()].map((entry) => entry.path),
      ])];
      await Promise.all(
        dirtyPaths.slice(0, COMMAND_DIFF_CONTENT_BASELINE_LIMIT).map(async (path) => {
          dirtyContents.set(path, await readProjectFileContent(path));
        }),
      );
      return { snapshot, statusSnapshot, dirtyContents };
    } catch {
      return null;
    }
  }, [directory, readProjectFileContent]);

  const attributeCommandFileChanges = useCallback(
    async (
      codexItemId: string,
      anchorMessageId?: string,
      options?: { status?: "running" | "completed"; clearBaseline?: boolean },
    ) => {
      if (!window.orxa?.opencode) {
        commandDiffSnapshotsRef.current.delete(codexItemId);
        return;
      }
      const baselinePromise = commandDiffSnapshotsRef.current.get(codexItemId);
      const baseline = baselinePromise ? await baselinePromise.catch(() => null) : null;
      if (!baseline) {
        if (options?.clearBaseline) {
          commandDiffSnapshotsRef.current.delete(codexItemId);
        }
        return;
      }

      try {
        const [diffOutput, statusOutput] = await Promise.all([
          window.orxa.opencode.gitDiff(directory),
          window.orxa.opencode.gitStatus?.(directory) ?? Promise.resolve(""),
        ]);
        const current = captureGitDiffSnapshot(parseGitDiffOutput(diffOutput).files);
        const currentStatus = captureGitStatusSnapshot(parseGitStatusOutput(statusOutput).files);
        const changedEntries = [...new Set([...current.keys(), ...currentStatus.keys()])]
          .map((key) => ({
            key,
            diffEntry: current.get(key),
            statusEntry: currentStatus.get(key),
          }))
          .filter(({ key, diffEntry, statusEntry }) => {
            if (statusEntry && !isSameGitStatusSnapshotEntry(baseline.statusSnapshot.get(key), statusEntry)) {
              return true;
            }
            if (diffEntry && !isSameGitDiffSnapshotEntry(baseline.snapshot.get(key), diffEntry)) {
              return true;
            }
            return false;
          });
        if (changedEntries.length === 0) {
          updateMessages((prev) => prev.filter((message) => !message.id.startsWith(`${codexItemId}:git-diff:`)), "deferred");
          if (options?.clearBaseline) {
            commandDiffSnapshotsRef.current.delete(codexItemId);
          }
          return;
        }
        const attributedEntries = await Promise.all(
          changedEntries.map(async ({ key, diffEntry, statusEntry }) => {
            const resolvedPath = statusEntry?.path ?? diffEntry?.path ?? key;
            const beforeContent = baseline.dirtyContents.get(resolvedPath);
            if (beforeContent !== undefined) {
              const afterContent = statusEntry?.status === "deleted" ? null : await readProjectFileContent(resolvedPath);
              const isolated = buildSyntheticCommandDiff(resolvedPath, beforeContent, afterContent);
              return {
                path: resolvedPath,
                type: isolated.type,
                diff: isolated.diff || undefined,
                insertions: isolated.insertions,
                deletions: isolated.deletions,
              };
            }
            if (diffEntry) {
              return {
                path: diffEntry.path,
                type: diffEntry.type,
                diff: diffEntry.diff || undefined,
                insertions: diffEntry.insertions,
                deletions: diffEntry.deletions,
              };
            }
            const afterContent = statusEntry?.status === "deleted" ? null : await readProjectFileContent(resolvedPath);
            const isolated = buildSyntheticCommandDiff(resolvedPath, null, afterContent);
            return {
              path: resolvedPath,
              type: statusEntry?.status ?? isolated.type,
              diff: isolated.diff || undefined,
              insertions: isolated.insertions,
              deletions: isolated.deletions,
            };
          }),
        );
        updateMessages((prev) => {
          const status = options?.status ?? "completed";
          const attributed = attributedEntries.map((entry, index) => ({
            id: `${codexItemId}:git-diff:${entry.path}:${index}`,
            kind: "diff" as const,
            path: normalizeWorkspaceRelativePath(entry.path, directory),
            type: entry.type,
            status,
            diff: entry.diff,
            insertions: entry.insertions,
            deletions: entry.deletions,
            timestamp: Date.now(),
          }));
          const withoutPrevious = prev.filter((message) => !message.id.startsWith(`${codexItemId}:git-diff:`));
          if (!anchorMessageId) {
            return [...withoutPrevious, ...attributed];
          }
          const anchorIndex = withoutPrevious.findIndex((message) => message.id === anchorMessageId);
          if (anchorIndex < 0) {
            return [...withoutPrevious, ...attributed];
          }
          const next = [...withoutPrevious];
          next.splice(anchorIndex + 1, 0, ...attributed);
          return next;
        }, "deferred");
      } catch {
        // Best-effort only.
      } finally {
        if (options?.clearBaseline) {
          commandDiffSnapshotsRef.current.delete(codexItemId);
        }
      }
    },
    [directory, readProjectFileContent, updateMessages],
  );

  const enrichFileChangeDescriptors = useCallback(
    async (descriptors: FileChangeDescriptor[]) => {
      if (!window.orxa?.opencode || descriptors.length === 0) {
        return descriptors;
      }

      const needsEnrichment = descriptors.some((descriptor) =>
        !looksLikeUnifiedDiff(descriptor.diff) ||
        descriptor.insertions === undefined ||
        descriptor.deletions === undefined,
      );
      if (!needsEnrichment) {
        return descriptors;
      }

      try {
        const [diffOutput, statusOutput] = await Promise.all([
          window.orxa.opencode.gitDiff(directory),
          window.orxa.opencode.gitStatus?.(directory) ?? Promise.resolve(""),
        ]);
        const diffSnapshot = captureGitDiffSnapshot(parseGitDiffOutput(diffOutput).files);
        const statusSnapshot = captureGitStatusSnapshot(parseGitStatusOutput(statusOutput).files);
        const lookup: GitSnapshotLookup = {
          diffByPath: new Map<string, GitDiffSnapshotEntry>(),
          statusByPath: new Map<string, GitStatusFile>(),
        };

        for (const entry of diffSnapshot.values()) {
          const normalizedPath = normalizeWorkspaceRelativePath(entry.path, directory);
          lookup.diffByPath.set(normalizedPath, entry);
          if (entry.oldPath) {
            lookup.diffByPath.set(normalizeWorkspaceRelativePath(entry.oldPath, directory), entry);
          }
        }

        for (const entry of statusSnapshot.values()) {
          const normalizedPath = normalizeWorkspaceRelativePath(entry.path, directory);
          lookup.statusByPath.set(normalizedPath, entry);
          if (entry.oldPath) {
            lookup.statusByPath.set(normalizeWorkspaceRelativePath(entry.oldPath, directory), entry);
          }
        }

        return Promise.all(descriptors.map(async (descriptor) => {
          if (
            looksLikeUnifiedDiff(descriptor.diff) &&
            descriptor.insertions !== undefined &&
            descriptor.deletions !== undefined
          ) {
            return descriptor;
          }

          const normalizedPath = normalizeWorkspaceRelativePath(descriptor.path, directory);
          const diffEntry = lookup.diffByPath.get(normalizedPath);
          if (diffEntry) {
            return {
              ...descriptor,
              type: descriptor.type || diffEntry.type,
              diff: looksLikeUnifiedDiff(descriptor.diff) ? descriptor.diff : diffEntry.diff || undefined,
              insertions: descriptor.insertions ?? diffEntry.insertions,
              deletions: descriptor.deletions ?? diffEntry.deletions,
            };
          }

          const statusEntry = lookup.statusByPath.get(normalizedPath);
          if (!statusEntry) {
            return descriptor;
          }

          if (statusEntry.status === "added") {
            const afterContent = await readProjectFileContent(normalizedPath);
            const synthetic = buildSyntheticCommandDiff(normalizedPath, null, afterContent);
            return {
              ...descriptor,
              type: descriptor.type || synthetic.type,
              diff: looksLikeUnifiedDiff(descriptor.diff) ? descriptor.diff : synthetic.diff || undefined,
              insertions: descriptor.insertions ?? synthetic.insertions,
              deletions: descriptor.deletions ?? synthetic.deletions,
            };
          }

          return {
            ...descriptor,
            type: descriptor.type || statusEntry.status,
          };
        }));
      } catch {
        return descriptors;
      }
    },
    [directory, readProjectFileContent],
  );

  const stopCommandDiffPolling = useCallback((codexItemId: string) => {
    const timerId = commandDiffPollTimersRef.current.get(codexItemId);
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      commandDiffPollTimersRef.current.delete(codexItemId);
    }
  }, []);

  const startCommandDiffPolling = useCallback((codexItemId: string, anchorMessageId?: string) => {
    stopCommandDiffPolling(codexItemId);
    const tick = () => {
      void attributeCommandFileChanges(codexItemId, anchorMessageId, { status: "running" })
        .finally(() => {
          if (!commandDiffPollTimersRef.current.has(codexItemId)) {
            return;
          }
          const nextTimer = window.setTimeout(tick, COMMAND_DIFF_POLL_INTERVAL_MS);
          commandDiffPollTimersRef.current.set(codexItemId, nextTimer);
        });
    };
    const firstTimer = window.setTimeout(tick, COMMAND_DIFF_POLL_INTERVAL_MS);
    commandDiffPollTimersRef.current.set(codexItemId, firstTimer);
  }, [attributeCommandFileChanges, stopCommandDiffPolling]);

  // ------------------------------------------------------------------
  // Notification handler
  // ------------------------------------------------------------------
  const handleNotification = useCallback((notification: CodexNotification) => {
    const { method, params } = notification;

    switch (method) {
      case "turn/started": {
        const turnId = readTurnId(params);
        if (pendingInterruptRef.current || interruptRequestedRef.current) {
          pendingInterruptRef.current = false;
          activeTurnIdRef.current = turnId;
          const currentThreadId = getCurrentCodexRuntime()?.thread?.id;
          if (currentThreadId && turnId && window.orxa?.codex) {
            void window.orxa.codex.interruptThreadTree(currentThreadId, turnId).catch((error) => {
              recordLastError(error);
            });
          }
          return;
        }
        setStreamingState(true);
        streamingItemIdRef.current = null;
        activeExploreGroupIdRef.current = null;
        // Track turn ID for interrupt
        activeTurnIdRef.current = turnId;
        // Reset reasoning ref for new turn (previous reasoning stays in chat as expandable)
        currentReasoningIdRef.current = null;
        thinkingItemIdRef.current = null;
        // Insert a single reasoning placeholder for this turn
        const thinkingId = nextMessageID("codex-reasoning", messageIdCounter);
        thinkingItemIdRef.current = thinkingId;
        currentReasoningIdRef.current = thinkingId;
        setMessagesState((prev) => [
          ...prev,
          { id: thinkingId, kind: "reasoning", content: "", summary: "", timestamp: Date.now() },
        ]);
        break;
      }

      case "turn/completed": {
        pendingInterruptRef.current = false;
        interruptRequestedRef.current = false;
        setStreamingState(false);
        streamingItemIdRef.current = null;
        activeTurnIdRef.current = null;
        // Keep reasoning if it has content (expandable); remove if empty placeholder
        const tId = currentReasoningIdRef.current;
        currentReasoningIdRef.current = null;
        thinkingItemIdRef.current = null;
        activeExploreGroupIdRef.current = null;
        setMessagesState((prev) => {
          let result = prev;
          // Remove reasoning only if it has no content (empty placeholder)
          if (tId) {
            const item = prev.find((m) => m.id === tId);
            if (item && item.kind === "reasoning" && !item.content && !item.summary) {
              result = prev.filter((m) => m.id !== tId);
            }
          }
          // Close ALL exploring groups
          const hasExploring = result.some((m) => m.kind === "explore" && m.status === "exploring");
          if (hasExploring) {
            result = (result === prev ? [...prev] : result).map((m) =>
              m.kind === "explore" && m.status === "exploring"
                ? { ...m, status: "explored" as const }
                : m,
            );
          }
          return result;
        });
        break;
      }

      // ── Plan mode ──────────────────────────────────────────────────
      case "turn/plan/updated": {
        const plan = params.plan as unknown;
        const explanation = params.explanation as unknown;
        let items: TodoItem[] = [];

        if (Array.isArray(plan) && plan.length > 0) {
          items = parseStructuredPlan(plan);
        } else if (typeof plan === "string" && plan.trim()) {
          items = parseMarkdownPlan(plan);
        } else if (typeof explanation === "string" && explanation.trim()) {
          items = parseMarkdownPlan(explanation);
        }

        if (items.length > 0) {
          setPlanItemsState(items);
          setMessagesState((prev) => {
            const existingId = latestPlanUpdateIdRef.current;
            const nextId = existingId ?? nextMessageID("codex-plan-update", messageIdCounter);
            latestPlanUpdateIdRef.current = nextId;
            const withoutExisting = existingId ? prev.filter((message) => message.id !== existingId) : prev;
            return [...withoutExisting, { id: nextId, kind: "status", label: "Updated task list", timestamp: Date.now() }];
          });
        }

        // Also try to extract from the last assistant message if plan items are still empty
        // (some backends stream the plan as regular text, not structured)
        break;
      }

      // ── Subagent thread detection ──────────────────────────────────
      case "thread/started": {
        const threadMeta = params.thread as {
          id?: string;
          source?: unknown;
          kind?: string;
        } | undefined;
        const sourceMeta = extractSubagentMeta(threadMeta?.source);
        const parentThreadId = getParentThreadIdFromSource(threadMeta?.source);
        if (threadMeta?.id && sourceMeta && parentThreadId && getCurrentCodexRuntime()?.thread?.id === parentThreadId) {
          subagentThreadIds.current.add(threadMeta.id);
          setSubagentsState((prev) => {
            // Don't duplicate
            if (prev.some((a) => a.threadId === threadMeta.id)) return prev;
            return [
              ...prev,
              {
                threadId: threadMeta.id!,
                nickname: sourceMeta.nickname ?? `Agent-${prev.length + 1}`,
                role: sourceMeta.role ?? "worker",
                status: "thinking",
                statusText: "is thinking",
                spawnedAt: Date.now(),
              },
            ];
          });
        }
        break;
      }

      // ── Thread name ────────────────────────────────────────────────
      case "thread/name/updated": {
        const name = params.threadName as string | undefined;
        if (name) {
          setThreadNameState(name);
        }
        break;
      }

      case "item/started": {
        const item = params.item as {
          type: string;
          id: string;
          content?: Array<{ type: string; text?: string }>;
          path?: string;
          query?: string;
          toolName?: string;
          name?: string;
          command?: string;
          changeType?: string;
        };

        if (interruptRequestedRef.current) {
          break;
        }

        if (
          item.type === "agentMessage" ||
          item.type === "commandExecution" ||
          item.type === "fileChange" ||
          item.type === "plan" ||
          item.type === "reasoning"
        ) {
          setStreamingState(true);
        }

        if (item.type === "agentMessage") {
          streamingItemIdRef.current = item.id;
          const msgId = nextMessageID("codex-assistant", messageIdCounter);
          codexItemToMsgId.current.set(item.id, msgId);
          activeExploreGroupIdRef.current = null;
          // Close all exploration groups but keep the single per-turn reasoning row alive.
          setMessagesState((prev) => {
            const result = prev.map((m) =>
              m.kind === "explore" && m.status === "exploring"
                ? { ...m, status: "explored" as const }
                : m,
            );
            result.push({ id: msgId, kind: "message", role: "assistant", content: "", timestamp: Date.now() });
            return result;
          });
        }

        if (item.type === "reasoning") {
          // Always reuse the single reasoning row for this turn — never create duplicates.
          // If the reasoning row was removed by agentMessage, re-create it.
          if (currentReasoningIdRef.current) {
            codexItemToMsgId.current.set(item.id, currentReasoningIdRef.current);
          } else {
            const msgId = nextMessageID("codex-reasoning", messageIdCounter);
            codexItemToMsgId.current.set(item.id, msgId);
            currentReasoningIdRef.current = msgId;
            setMessagesState((prev) => [
              ...prev,
              { id: msgId, kind: "reasoning", content: "", summary: "", timestamp: Date.now() },
            ]);
          }
        }

        if (item.type === "commandExecution") {
          const rawCommand = normalizeCommandText(item.command);
          if (rawCommand && !isReadOnlyCommand(rawCommand)) {
            commandDiffSnapshotsRef.current.set(item.id, captureCommandDiffSnapshot());
            startCommandDiffPolling(item.id);
          }
          const exploreEntry = rawCommand ? commandToExploreEntry(item.id, rawCommand, "running") : null;
          if (exploreEntry) {
            updateMessages((prev) => {
              const activeGroupId = activeExploreGroupIdRef.current;
              if (activeGroupId) {
                const groupIndex = prev.findIndex((message) => message.id === activeGroupId);
                if (groupIndex >= 0 && prev[groupIndex]?.kind === "explore") {
                  codexItemToExploreGroupId.current.set(item.id, activeGroupId);
                  const next = [...prev];
                  next[groupIndex] = {
                    ...(prev[groupIndex] as typeof prev[number] & { kind: "explore" }),
                    entries: [
                      ...(prev[groupIndex] as typeof prev[number] & { kind: "explore" }).entries,
                      exploreEntry,
                    ],
                  };
                  return next;
                }
              }
              const groupId = nextMessageID("codex-explore", messageIdCounter);
              activeExploreGroupIdRef.current = groupId;
              codexItemToExploreGroupId.current.set(item.id, groupId);
              return [
                ...prev,
                {
                  id: groupId,
                  kind: "explore" as const,
                  status: "exploring" as const,
                  entries: [exploreEntry],
                  timestamp: Date.now(),
                },
              ];
            });
          } else {
            const msgId = nextMessageID("codex-cmd", messageIdCounter);
            codexItemToMsgId.current.set(item.id, msgId);
            updateMessages((prev) => [
              ...prev,
              {
                id: msgId,
                kind: "tool",
                toolType: "commandExecution",
                title: rawCommand ? `$ ${rawCommand.slice(0, 60)}` : "Running command...",
                command: rawCommand || undefined,
                output: "",
                status: "running",
                timestamp: Date.now(),
              },
            ]);
          }
        }

        if (item.type === "fileChange") {
          const msgId = nextMessageID("codex-diff", messageIdCounter);
          codexItemToMsgId.current.set(item.id, msgId);
          updateMessages((prev) => [
            ...prev,
            {
              id: msgId,
              kind: "diff",
              path: item.path ?? "",
              type: item.changeType ?? "modified",
              status: "running",
              diff: "",
              timestamp: Date.now(),
            },
          ]);
        }

        if (item.type === "fileRead") {
          const entry = fileReadToExploreEntry(item.id, item.path ?? "file", "running");
          updateMessages((prev) => {
            const activeGroupId = activeExploreGroupIdRef.current;
            if (activeGroupId) {
              const gIdx = prev.findIndex((m) => m.id === activeGroupId);
              if (gIdx >= 0 && prev[gIdx].kind === "explore") {
                codexItemToExploreGroupId.current.set(item.id, activeGroupId);
                const next = [...prev];
                next[gIdx] = { ...(prev[gIdx] as typeof prev[number] & { kind: "explore" }), entries: [...(prev[gIdx] as typeof prev[number] & { kind: "explore" }).entries, entry] };
                return next;
              }
            }
            const groupId = nextMessageID("codex-explore", messageIdCounter);
            activeExploreGroupIdRef.current = groupId;
            codexItemToExploreGroupId.current.set(item.id, groupId);
            return [...prev, { id: groupId, kind: "explore" as const, status: "exploring" as const, entries: [entry], timestamp: Date.now() }];
          });
        }

        if (item.type === "webSearch") {
          const entry = webSearchToExploreEntry(item.id, (item.query as string) ?? "search", "running");
          updateMessages((prev) => {
            const activeGroupId = activeExploreGroupIdRef.current;
            if (activeGroupId) {
              const gIdx = prev.findIndex((m) => m.id === activeGroupId);
              if (gIdx >= 0 && prev[gIdx].kind === "explore") {
                codexItemToExploreGroupId.current.set(item.id, activeGroupId);
                const next = [...prev];
                next[gIdx] = { ...(prev[gIdx] as typeof prev[number] & { kind: "explore" }), entries: [...(prev[gIdx] as typeof prev[number] & { kind: "explore" }).entries, entry] };
                return next;
              }
            }
            const groupId = nextMessageID("codex-explore", messageIdCounter);
            activeExploreGroupIdRef.current = groupId;
            codexItemToExploreGroupId.current.set(item.id, groupId);
            return [...prev, { id: groupId, kind: "explore" as const, status: "exploring" as const, entries: [entry], timestamp: Date.now(),
              },
            ];
          });
        }

        if (item.type === "mcpToolCall") {
          const entry = mcpToolCallToExploreEntry(item.id, item.toolName ?? item.name ?? "mcp tool", "running");
          updateMessages((prev) => {
            const activeGroupId = activeExploreGroupIdRef.current;
            if (activeGroupId) {
              const gIdx = prev.findIndex((m) => m.id === activeGroupId);
              if (gIdx >= 0 && prev[gIdx].kind === "explore") {
                codexItemToExploreGroupId.current.set(item.id, activeGroupId);
                const next = [...prev];
                next[gIdx] = { ...(prev[gIdx] as typeof prev[number] & { kind: "explore" }), entries: [...(prev[gIdx] as typeof prev[number] & { kind: "explore" }).entries, entry] };
                return next;
              }
            }
            const groupId = nextMessageID("codex-explore", messageIdCounter);
            activeExploreGroupIdRef.current = groupId;
            codexItemToExploreGroupId.current.set(item.id, groupId);
            return [...prev, { id: groupId, kind: "explore" as const, status: "exploring" as const, entries: [entry], timestamp: Date.now() }];
          });
        }

        if (item.type === "plan") {
          const msgId = nextMessageID("codex-plan", messageIdCounter);
          codexItemToMsgId.current.set(item.id, msgId);
          updateMessages((prev) => [
            ...prev,
            {
              id: msgId,
              kind: "tool",
              toolType: "plan",
              title: "Plan",
              output: "",
              status: "running",
              timestamp: Date.now(),
            },
          ]);
        }

        if (item.type === "contextCompaction") {
          const msgId = nextMessageID("codex-compaction", messageIdCounter);
          codexItemToMsgId.current.set(item.id, msgId);
          updateMessages((prev) => [
            ...prev,
            { id: msgId, kind: "compaction", timestamp: Date.now() },
          ]);
        }

        if (item.type === "collabToolCall" || item.type === "collabAgentToolCall") {
          const collabItem = item as {
            type: string; id: string;
            name?: string; toolName?: string; title?: string;
            collabSender?: { threadId: string; nickname?: string; role?: string };
            collabReceiver?: { threadId: string; nickname?: string; role?: string };
            collabReceivers?: Array<{ threadId: string; nickname?: string; role?: string }>;
            collabStatuses?: Array<{ threadId: string; nickname?: string; role?: string; status: string }>;
          };
          const receivers = collabItem.collabReceivers ?? (collabItem.collabReceiver ? [collabItem.collabReceiver] : undefined);

          // Update subagent statuses from collab metadata
          if (collabItem.collabStatuses) {
            setSubagentsState((prev) => {
              let next = prev;
              for (const cs of collabItem.collabStatuses!) {
                const idx = next.findIndex((a) => a.threadId === cs.threadId);
                if (idx >= 0) {
                  if (next === prev) next = [...prev];
                  const statusText = cs.status || "is thinking";
                  next[idx] = {
                    ...next[idx],
                    nickname: cs.nickname ?? next[idx].nickname,
                    role: cs.role ?? next[idx].role,
                    status: statusText.includes("await") ? "awaiting_instruction" : "thinking",
                    statusText,
                  };
                } else if (cs.threadId && cs.nickname) {
                  // New agent discovered via status
                  if (next === prev) next = [...prev];
                  subagentThreadIds.current.add(cs.threadId);
                  next.push({
                    threadId: cs.threadId,
                    nickname: cs.nickname,
                    role: cs.role ?? "worker",
                    status: "thinking",
                    statusText: cs.status || "is thinking",
                    spawnedAt: Date.now(),
                  });
                }
              }
              return next;
            });
          }

          // Track new agents from receivers
          if (receivers) {
            for (const r of receivers) {
              if (r.threadId && !subagentThreadIds.current.has(r.threadId)) {
                subagentThreadIds.current.add(r.threadId);
                setSubagentsState((prev) => {
                  if (prev.some((a) => a.threadId === r.threadId)) return prev;
                  return [...prev, {
                    threadId: r.threadId,
                    nickname: r.nickname ?? `Agent-${prev.length + 1}`,
                    role: r.role ?? "worker",
                    status: "thinking",
                    statusText: "is thinking",
                    spawnedAt: Date.now(),
                  }];
                });
              }
            }
          }
        }

        break;
      }

      // ── Streaming deltas ───────────────────────────────────────────
      case "item/agentMessage/delta": {
        const delta = params.delta as string;
        const codexItemId = params.itemId as string;
        if (delta) {
          if (interruptRequestedRef.current) {
            break;
          }
          setStreamingState(true);
          if (codexItemId) {
            // Use ID-based append so interleaved tool items don't cause truncation
            appendToItemField(codexItemId, "content", delta);
          } else {
            // Fallback to position-based append when no item ID is available
            updateMessages((prev) => appendAssistantDeltaToLastMessage(prev, delta), "deferred");
          }
        }
        break;
      }

      case "item/commandExecution/outputDelta": {
        const delta = params.delta as string;
        const codexItemId = params.itemId as string;
        if (delta && codexItemId) {
          if (interruptRequestedRef.current) {
            break;
          }
          setStreamingState(true);
          appendToItemField(codexItemId, "output", delta);
        }
        break;
      }

      case "item/fileChange/outputDelta": {
        const delta = params.delta as string;
        const codexItemId = params.itemId as string;
        if (delta && codexItemId) {
          if (interruptRequestedRef.current) {
            break;
          }
          setStreamingState(true);
          const msgId = codexItemToMsgId.current.get(codexItemId);
          const existingDiff = msgId
            ? (getCurrentCodexRuntime()?.messages ?? []).find((message) => message.id === msgId && message.kind === "diff")
            : undefined;
          if (looksLikeUnifiedDiff(delta) || (existingDiff?.kind === "diff" && Boolean(existingDiff.diff))) {
            appendToItemField(codexItemId, "diff", delta);
          }
        }
        break;
      }

      case "item/reasoning/textDelta": {
        const delta = params.delta as string;
        const codexItemId = params.itemId as string;
        if (delta && codexItemId) {
          if (interruptRequestedRef.current) {
            break;
          }
          setStreamingState(true);
          appendToItemField(codexItemId, "content", delta);
        }
        break;
      }

      case "item/reasoning/summaryTextDelta": {
        const delta = params.delta as string;
        const codexItemId = params.itemId as string;
        if (delta && codexItemId) {
          if (interruptRequestedRef.current) {
            break;
          }
          setStreamingState(true);
          appendToItemField(codexItemId, "summary", delta);
        }
        break;
      }

      case "item/plan/delta": {
        const delta = params.delta as string;
        const codexItemId = params.itemId as string;
        if (delta && codexItemId) {
          if (interruptRequestedRef.current) {
            break;
          }
          setStreamingState(true);
          appendToItemField(codexItemId, "output", delta);
        }
        break;
      }

      case "item/completed": {
        const item = params.item as {
          type: string;
          id: string;
          command?: string;
          aggregatedOutput?: string;
          exitCode?: number;
          path?: string;
          insertions?: number;
          deletions?: number;
          changeType?: string;
          durationMs?: number;
          changes?: unknown;
        };

        // Check if we already have a running item for this codex id (created in item/started)
        const existingMsgId = codexItemToMsgId.current.get(item.id);

        if (item.type === "commandExecution") {
          const exploreGroupId = codexItemToExploreGroupId.current.get(item.id);
          const rawCommand = normalizeCommandText(item.command);
          const anchorMessageId = existingMsgId;
          const readOnly = rawCommand.length > 0 ? (commandToExploreEntry("_check", rawCommand, "completed") !== null) : false;

          if (exploreGroupId) {
            codexItemToExploreGroupId.current.delete(item.id);
            if (readOnly) {
              // Keep in explore group; update label + status
              const finalStatus: ExploreEntry["status"] = (item.exitCode === 0 || item.exitCode === undefined) ? "completed" : "error";
              const cleaned = rawCommand.length > 0 ? cleanCommandText(rawCommand) : "Command";
              const cleanedLabel = cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned;
              setMessagesState((prev) => {
                const gIdx = prev.findIndex((m) => m.id === exploreGroupId);
                if (gIdx < 0) return prev;
                const group = prev[gIdx];
                if (group.kind !== "explore") return prev;
                const updatedEntries = group.entries.map((e) =>
                  e.id === item.id ? { ...e, label: cleanedLabel, status: finalStatus } : e,
                );
                const allDone = updatedEntries.every((e) => e.status === "completed" || e.status === "error");
                const next = [...prev];
                next[gIdx] = { ...group, entries: updatedEntries, status: allDone ? "explored" : "exploring" };
                return next;
              });
            } else {
              // Non-read-only: remove from explore group and add a ToolCallCard instead
              setMessagesState((prev) => {
                const gIdx = prev.findIndex((m) => m.id === exploreGroupId);
                let base = prev;
                if (gIdx >= 0) {
                  const group = prev[gIdx];
                  if (group.kind === "explore") {
                    const filteredEntries = group.entries.filter((e) => e.id !== item.id);
                    if (filteredEntries.length === 0) {
                      // Remove the whole group if now empty
                      base = prev.filter((m) => m.id !== exploreGroupId);
                    } else {
                      base = [...prev];
                      base[gIdx] = { ...group, entries: filteredEntries };
                    }
                  }
                }
                const msgId = nextMessageID("codex-cmd", messageIdCounter);
                return [
                  ...base,
                  {
                    id: msgId,
                    kind: "tool" as const,
                    toolType: "commandExecution",
                    title: rawCommand ? `$ ${rawCommand.slice(0, 60)}` : "Command",
                    command: rawCommand || undefined,
                    output: item.aggregatedOutput,
                    status: (item.exitCode === 0 || item.exitCode === undefined) ? "completed" : "error",
                    exitCode: item.exitCode,
                    durationMs: item.durationMs,
                    timestamp: Date.now(),
                  },
                ];
              });
            }
          } else if (existingMsgId) {
            // Update existing tool card (placed at item/started without explore group)
            setMessagesState((prev) => {
              const idx = prev.findIndex((m) => m.id === existingMsgId);
              if (idx < 0) return prev;
              const existing = prev[idx];
              if (existing.kind !== "tool") return prev;
              const next = [...prev];
              next[idx] = {
                ...existing,
                title: rawCommand ? `$ ${rawCommand.slice(0, 60)}` : existing.title,
                command: rawCommand || existing.command,
                output: item.aggregatedOutput ?? existing.output,
                status: item.exitCode === 0 || item.exitCode === undefined ? "completed" : "error",
                exitCode: item.exitCode,
                durationMs: item.durationMs,
              };
              return next;
            });
          } else {
            // Fallback: no started event — add as explore or tool based on command
            const fallbackEntry = rawCommand
              ? commandToExploreEntry(`fallback-${Date.now()}`, rawCommand, (item.exitCode === 0 || item.exitCode === undefined) ? "completed" : "error")
              : null;
            if (fallbackEntry) {
              setMessagesState((prev) => {
                const last = prev[prev.length - 1];
                if (last && last.kind === "explore") {
                  const next = [...prev];
                  next[next.length - 1] = { ...last, entries: [...last.entries, fallbackEntry] };
                  return next;
                }
                const groupId = nextMessageID("codex-explore", messageIdCounter);
                return [
                  ...prev,
                  { id: groupId, kind: "explore" as const, status: "explored" as const, entries: [fallbackEntry], timestamp: Date.now() },
                ];
              });
            } else {
              const msgId = nextMessageID("codex-cmd", messageIdCounter);
              setMessagesState((prev) => [
                ...prev,
                {
                  id: msgId,
                  kind: "tool",
                  toolType: "commandExecution",
                  title: rawCommand ? `$ ${rawCommand.slice(0, 60)}` : "Command",
                  command: rawCommand || undefined,
                  output: item.aggregatedOutput,
                  status: item.exitCode === 0 || item.exitCode === undefined ? "completed" : "error",
                  exitCode: item.exitCode,
                  timestamp: Date.now(),
                },
              ]);
            }
          }
          if (rawCommand && !isReadOnlyCommand(rawCommand)) {
            stopCommandDiffPolling(item.id);
            window.setTimeout(() => {
              void attributeCommandFileChanges(item.id, anchorMessageId, {
                status: "completed",
                clearBaseline: true,
              });
            }, 40);
          }
        }

        if (item.type === "fileChange") {
          const existingDiffItem =
            existingMsgId
              ? (getCurrentCodexRuntime()?.messages ?? []).find((message) => message.id === existingMsgId && message.kind === "diff")
              : undefined;
          const rawDescriptors = extractFileChangeDescriptors(item, existingDiffItem?.kind === "diff" ? existingDiffItem.diff : undefined);
          const fallbackDescriptors = rawDescriptors.length > 0
            ? rawDescriptors
            : [{
                path: item.path!,
                type: item.changeType ?? "modified",
                diff: undefined,
                insertions: item.insertions,
                deletions: item.deletions,
              } satisfies FileChangeDescriptor];

          void enrichFileChangeDescriptors(fallbackDescriptors).then((descriptors) => {
            if (existingMsgId && descriptors.length <= 1) {
              const descriptor = descriptors[0];
              setMessagesState((prev) => {
                const idx = prev.findIndex((m) => m.id === existingMsgId);
                if (idx < 0) return prev;
                const existing = prev[idx];
                if (existing.kind !== "diff") return prev;
                const next = [...prev];
                next[idx] = {
                  ...existing,
                  path: normalizeWorkspaceRelativePath(descriptor?.path ?? item.path!, directory),
                  type: descriptor?.type ?? item.changeType ?? existing.type,
                  status: item.exitCode === 0 || item.exitCode === undefined ? "completed" : "error",
                  diff: descriptor?.diff ?? existing.diff,
                  insertions: descriptor?.insertions ?? item.insertions ?? existing.insertions,
                  deletions: descriptor?.deletions ?? item.deletions ?? existing.deletions,
                };
                return next;
              });
              return;
            }

            if (existingMsgId && descriptors.length > 1) {
              setMessagesState((prev) => {
                const idx = prev.findIndex((m) => m.id === existingMsgId);
                if (idx < 0) return prev;
                const next = [...prev];
                next.splice(idx, 1, ...descriptors.map((descriptor, descriptorIndex) => ({
                  id: `${item.id}:change:${descriptor.path}:${descriptorIndex}`,
                  kind: "diff" as const,
                  path: normalizeWorkspaceRelativePath(descriptor.path, directory),
                  type: descriptor.type,
                  status: item.exitCode === 0 || item.exitCode === undefined ? "completed" as const : "error" as const,
                  diff: descriptor.diff,
                  insertions: descriptor.insertions,
                  deletions: descriptor.deletions,
                  timestamp: Date.now(),
                })));
                return next;
              });
              return;
            }

            setMessagesState((prev) => [
              ...prev,
              ...descriptors.map((descriptor, descriptorIndex) => ({
                id: `${item.id}:change:${descriptor.path}:${descriptorIndex}`,
                kind: "diff" as const,
                path: normalizeWorkspaceRelativePath(descriptor.path, directory),
                type: descriptor.type,
                status: item.exitCode === 0 || item.exitCode === undefined ? "completed" as const : "error" as const,
                diff: descriptor.diff,
                insertions: descriptor.insertions,
                deletions: descriptor.deletions,
                timestamp: Date.now(),
              })),
            ]);
          });
        }

        // Update status on completed context/tool items (now inside explore groups)
        if (
          item.type === "fileRead" ||
          item.type === "webSearch" ||
          item.type === "mcpToolCall"
        ) {
          const exploreGroupId = codexItemToExploreGroupId.current.get(item.id);
          if (exploreGroupId) {
            setMessagesState((prev) => {
              const gIdx = prev.findIndex((m) => m.id === exploreGroupId);
              if (gIdx < 0) return prev;
              const group = prev[gIdx];
              if (group.kind !== "explore") return prev;
              const updatedEntries = group.entries.map((e) =>
                e.id === item.id ? { ...e, status: "completed" as const } : e,
              );
              const allDone = updatedEntries.every((e) => e.status === "completed" || e.status === "error");
              const next = [...prev];
              next[gIdx] = {
                ...group,
                entries: updatedEntries,
                status: allDone ? "explored" : "exploring",
              };
              return next;
            });
            codexItemToExploreGroupId.current.delete(item.id);
          }
        }

        if (
          item.type === "plan" ||
          item.type === "collabToolCall" ||
          item.type === "collabAgentToolCall"
        ) {
          if (existingMsgId) {
            setMessagesState((prev) => {
              const idx = prev.findIndex((m) => m.id === existingMsgId);
              if (idx < 0) return prev;
              const existing = prev[idx];
              if (existing.kind !== "tool") return prev;
              const next = [...prev];
              next[idx] = { ...existing, status: "completed" };
              return next;
            });
          }
        }

        if (item.id === streamingItemIdRef.current) {
          streamingItemIdRef.current = null;
        }

        // Clean up the item mapping
        codexItemToMsgId.current.delete(item.id);
        break;
      }

      case "thread/status/changed": {
        const status = params.status as { type: string } | undefined;
        const statusThreadId = readThreadId(params) ?? undefined;
        if (
          status?.type === "idle" &&
          statusThreadId &&
          getCurrentCodexRuntime()?.thread?.id === statusThreadId &&
          !activeTurnIdRef.current
        ) {
          interruptRequestedRef.current = false;
          setStreamingState(false);
        }
        break;
      }

      default:
        // Unhandled notification — no-op
        break;
    }
  }, [
    appendToItemField,
    attributeCommandFileChanges,
    captureCommandDiffSnapshot,
    directory,
    enrichFileChangeDescriptors,
    getCurrentCodexRuntime,
    recordLastError,
    setMessagesState,
    setPlanItemsState,
    setStreamingState,
    startCommandDiffPolling,
    setSubagentsState,
    setThreadNameState,
    stopCommandDiffPolling,
    updateMessages,
  ]);

  // ------------------------------------------------------------------
  // Event subscription
  // Uses a mounted ref to avoid setState on unmounted components.
  // The notification handler writes to persisted state via normal setState paths.
  // ------------------------------------------------------------------
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    const persistedState = getPersistedCodexState(sessionKey);
    setMessagesState(persistedState.messages);
    setThreadState(persistedState.thread);
    setStreamingState(persistedState.isStreaming);
    setPendingApprovalState(null);
    setPendingUserInputState(null);
    setSubagentsState([]);
    setActiveSubagentThreadIdState(null);
    setPlanItemsState([]);
    setThreadNameState(undefined);
    subagentThreadIds.current.clear();
    activeTurnIdRef.current = null;
    interruptRequestedRef.current = false;
    currentReasoningIdRef.current = null;
    thinkingItemIdRef.current = null;
    activeExploreGroupIdRef.current = null;
    latestPlanUpdateIdRef.current = null;
    messageIdCounter.current = persistedState.messageIdCounter;
    pendingInterruptRef.current = false;
    commandDiffSnapshotsRef.current.clear();
    itemThreadIdsRef.current.clear();
    turnThreadIdsRef.current.clear();

    if (!window.orxa?.events) {
      return;
    }

    const unsubscribe = window.orxa.events.subscribe((event) => {
      if (!isMounted.current) {
        return;
      }

      if (event.type === "codex.state") {
        const state = event.payload as CodexState;
        setConnectionState(state.status, state.serverInfo, state.lastError);
      }

      if (event.type === "codex.approval") {
        const approval = event.payload as CodexApprovalRequest;
        const currentThreadId = getCurrentCodexRuntime()?.thread?.id;
        if (!approval.threadId || !currentThreadId || approval.threadId === currentThreadId) {
          setPendingApprovalState(approval);
        }
      }

      if (event.type === "codex.userInput") {
        const input = event.payload as CodexUserInputRequest;
        const currentThreadId = getCurrentCodexRuntime()?.thread?.id;
        if (!input.threadId || !currentThreadId || input.threadId === currentThreadId) {
          setPendingUserInputState(input);
        }
      }

      if (event.type === "codex.notification") {
        const notification = event.payload as CodexNotification;
        const notificationParams =
          notification.params && typeof notification.params === "object" && !Array.isArray(notification.params)
            ? (notification.params as Record<string, unknown>)
            : {};

        const notificationThreadId = getNotificationThreadId(
          notification.method,
          notificationParams,
          itemThreadIdsRef.current,
          turnThreadIdsRef.current,
        );
        const activeThreadId = getCurrentCodexRuntime()?.thread?.id ?? null;
        const couldBelongToActiveThreadWithoutExplicitId =
          !!activeThreadId &&
          !notificationThreadId &&
          (notification.method.startsWith("turn/") ||
            notification.method.startsWith("item/") ||
            notification.method === "thread/status/changed");
        const isKnownTrackedThread =
          !!notificationThreadId &&
          (notificationThreadId === activeThreadId || subagentThreadIds.current.has(notificationThreadId));
        const isChildThreadStartForActiveParent =
          notification.method === "thread/started" &&
          getParentThreadIdFromSource(asRecord(notificationParams.thread)?.source) === activeThreadId;

        if (!isKnownTrackedThread && !isChildThreadStartForActiveParent && !couldBelongToActiveThreadWithoutExplicitId) {
          return;
        }

        const itemId = asString(notificationParams.itemId ?? asRecord(notificationParams.item)?.id).trim();
        const turnId = asString(notificationParams.turnId ?? asRecord(notificationParams.turn)?.id).trim();
        if ((notification.method === "item/started" || notification.method === "item/completed") && itemId && notificationThreadId) {
          itemThreadIdsRef.current.set(itemId, notificationThreadId);
          if (notification.method === "item/completed") {
            itemThreadIdsRef.current.delete(itemId);
          }
        }
        if ((notification.method === "turn/started" || notification.method === "turn/completed") && turnId && notificationThreadId) {
          turnThreadIdsRef.current.set(turnId, notificationThreadId);
          if (notification.method === "turn/completed") {
            turnThreadIdsRef.current.delete(turnId);
          }
        }
        if (
          notificationThreadId &&
          (notification.method === "thread/archived" || notification.method === "thread/closed")
        ) {
          subagentThreadIds.current.delete(notificationThreadId);
          setActiveSubagentThreadIdState((current) => (current === notificationThreadId ? null : current));
          setSubagentsState((previous) => previous.filter((agent) => agent.threadId !== notificationThreadId));
        }

        handleNotification(notification);
      }
    });

    return () => {
      isMounted.current = false;
      unsubscribe();
    };
  }, [
    getCurrentCodexRuntime,
    handleNotification,
    setConnectionState,
    sessionKey,
    setActiveSubagentThreadIdState,
    setMessagesState,
    setPendingApprovalState,
    setPendingUserInputState,
    setPlanItemsState,
    setStreamingState,
    setSubagentsState,
    setThreadNameState,
    setThreadState,
  ]);

  const syncCodexThreadRuntime = useCallback(async () => {
    const currentThreadId = getCurrentCodexRuntime()?.thread?.id;
    if (!window.orxa?.codex || !currentThreadId) {
      return;
    }

    try {
      const runtime = await window.orxa.codex.getThreadRuntime(currentThreadId);
      const currentThread = runtime.thread ?? null;
      const currentThreadRecord = currentThread ? (currentThread as unknown as Record<string, unknown>) : null;

      if (currentThreadRecord) {
        const resumedTurnId = getResumedActiveTurnId(currentThreadRecord);
        if (resumedTurnId) {
          activeTurnIdRef.current = resumedTurnId;
          if (pendingInterruptRef.current || interruptRequestedRef.current) {
            pendingInterruptRef.current = false;
            void window.orxa.codex.interruptThreadTree(currentThreadId, resumedTurnId).catch((error) => {
              recordLastError(error);
            });
            return;
          }
          setStreamingState(true);
        } else if (!pendingInterruptRef.current && normalizeThreadStatusType(currentThreadRecord.status) === "idle") {
          activeTurnIdRef.current = null;
          interruptRequestedRef.current = false;
          setStreamingState(false);
        }
      }

      const parentThreadId = currentThreadId;
      const childThreads = (runtime.childThreads ?? [])
        .map((candidate) => candidate as unknown as Record<string, unknown>)
        .filter((candidate) => {
          const threadId = asString(candidate.id).trim();
          if (!threadId || threadId === parentThreadId || isHiddenSubagentSource(candidate.source)) {
            return false;
          }
          return getParentThreadIdFromThread(candidate) === parentThreadId;
        });

      setCodexRuntimeSnapshot(sessionKey, {
        thread: currentThread ?? null,
        childThreads: childThreads as unknown as CodexThread[],
      });

      setSubagentsState((previous) => {
        if (childThreads.length === 0) {
          subagentThreadIds.current.clear();
          return [];
        }
        const childThreadIds = new Set(
          childThreads
            .map((candidate) => asString(candidate.id).trim())
            .filter(Boolean),
        );
        subagentThreadIds.current = childThreadIds;
        const previousById = new Map(previous.map((agent) => [agent.threadId, agent]));
        return childThreads.map((candidate, index) => {
          const threadId = asString(candidate.id).trim();
          const existing = previousById.get(threadId);
          const meta = extractSubagentMeta(candidate.source);
          const status = toSubagentStatus(candidate);
          const preview = asString(candidate.preview ?? candidate.name).trim();
          const fallbackName = preview || `Agent-${index + 1}`;
          return {
            threadId,
            nickname: existing?.nickname ?? meta?.nickname ?? fallbackName,
            role: existing?.role ?? meta?.role ?? "worker",
            status: status.status,
            statusText: status.statusText,
            spawnedAt: existing?.spawnedAt ?? Date.now(),
          };
        });
      });
    } catch {
      // Polling Codex thread runtime is best-effort only.
    }
  }, [getCurrentCodexRuntime, recordLastError, sessionKey, setCodexRuntimeSnapshot, setStreamingState, setSubagentsState]);

  useEffect(() => {
    if (!thread?.id || (!isStreaming && subagents.length === 0 && !pendingInterruptRef.current)) {
      return;
    }

    void syncCodexThreadRuntime();
    const timer = window.setInterval(() => {
      void syncCodexThreadRuntime();
    }, 1500);

    return () => {
      window.clearInterval(timer);
    };
  }, [isStreaming, subagents.length, syncCodexThreadRuntime, thread?.id]);

  // Derive subagent messages reactively from current messages
  const subagentMessages = useMemo(() => {
    if (!activeSubagentThreadId) return [];
    return messages.filter((m) => {
      if (m.kind !== "tool" || m.toolType !== "task") return false;
      const receivers = m.collabReceivers;
      const sender = m.collabSender;
      if (receivers?.some((r) => r.threadId === activeSubagentThreadId)) return true;
      if (sender?.threadId === activeSubagentThreadId) return true;
      return false;
    });
  }, [messages, activeSubagentThreadId]);

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------
  const connect = useCallback(async () => {
    if (!window.orxa?.codex) {
      setConnectionState("error", serverInfo, "Codex bridge not available");
      return;
    }
    try {
      const state = await window.orxa.codex.start(directory, codexOptions);
      setConnectionState(state.status, state.serverInfo, state.lastError);
    } catch (err) {
      recordLastError(err, "error");
    }
  }, [codexOptions, directory, recordLastError, serverInfo, setConnectionState]);

  const disconnect = useCallback(async () => {
    if (!window.orxa?.codex) return;
    try {
      await window.orxa.codex.stop();
    } catch {
      // ignore
    }
    setConnectionState("disconnected");
    setThreadState(null);
    setMessagesState([]);
    setStreamingState(false);
  }, [setConnectionState, setMessagesState, setStreamingState, setThreadState]);

  const startThread = useCallback(
    async (options?: { model?: string; title?: string; approvalPolicy?: string; sandbox?: string }) => {
      if (!window.orxa?.codex) return;
      try {
        const t = await window.orxa.codex.startThread({
          cwd: directory,
          model: options?.model,
          title: options?.title,
          approvalPolicy: options?.approvalPolicy,
          sandbox: options?.sandbox,
        });
        setThreadState(t);
        setMessagesState([]);
        setStreamingState(false);
        resetStreamingBookkeeping({
          streamingItemIdRef,
          thinkingItemIdRef,
          activeTurnIdRef,
          codexItemToMsgId,
        });
        codexItemToExploreGroupId.current.clear();
        activeExploreGroupIdRef.current = null;
        currentReasoningIdRef.current = null;
        latestPlanUpdateIdRef.current = null;
        setPlanItemsState([]);
        setThreadNameState(undefined);
        setSubagentsState([]);
        setActiveSubagentThreadIdState(null);
        subagentThreadIds.current.clear();
        pendingInterruptRef.current = false;
        interruptRequestedRef.current = false;
        commandDiffSnapshotsRef.current.clear();
      } catch (err) {
        recordLastError(err);
      }
    },
    [
      directory,
      recordLastError,
      setActiveSubagentThreadIdState,
      setMessagesState,
      setPlanItemsState,
      setStreamingState,
      setSubagentsState,
      setThreadNameState,
      setThreadState,
    ],
  );

  const sendMessage = useCallback(
    async (prompt: string, options?: { model?: string; effort?: string; collaborationMode?: string }) => {
      if (!window.orxa?.codex || !thread) return;

      const userMsgId = `codex-user-${messageIdCounter.current++}`;
      setMessagesState((prev) => [
        ...prev,
        { id: userMsgId, kind: "message", role: "user", content: prompt, timestamp: Date.now() },
      ]);

      try {
        await window.orxa.codex.startTurn(thread.id, prompt, directory, options?.model, options?.effort, options?.collaborationMode);
      } catch (err) {
        recordLastError(err);
      }
    },
    [directory, recordLastError, setMessagesState, thread],
  );

  const approveAction = useCallback(
    async (decision: string) => {
      if (!window.orxa?.codex || !pendingApproval) return;
      try {
        await window.orxa.codex.approve(pendingApproval.id, decision);
        setPendingApprovalState(null);
      } catch (err) {
        recordLastError(err);
      }
    },
    [pendingApproval, recordLastError, setPendingApprovalState],
  );

  const denyAction = useCallback(async () => {
    if (!window.orxa?.codex || !pendingApproval) return;
    try {
      await window.orxa.codex.deny(pendingApproval.id);
      setPendingApprovalState(null);
    } catch (err) {
      recordLastError(err);
    }
  }, [pendingApproval, recordLastError, setPendingApprovalState]);

  // Respond to user input request
  const respondToUserInput = useCallback(
    async (response: string) => {
      if (!window.orxa?.codex || !pendingUserInput) return;
      try {
        await window.orxa.codex.respondToUserInput(pendingUserInput.id, response);
        setPendingUserInputState(null);
      } catch (err) {
        recordLastError(err);
      }
    },
    [pendingUserInput, recordLastError, setPendingUserInputState],
  );

  const rejectUserInput = useCallback(async () => {
    if (!window.orxa?.codex || !pendingUserInput) return;
    try {
      // Respond with empty string to indicate rejection
      await window.orxa.codex.respondToUserInput(pendingUserInput.id, "");
      setPendingUserInputState(null);
    } catch (err) {
      recordLastError(err);
    }
  }, [pendingUserInput, recordLastError, setPendingUserInputState]);

  // Interrupt the current turn
  const interruptTurn = useCallback(async () => {
    if (!window.orxa?.codex || !thread) return;
    // Capture turn ID before clearing it
    const turnId = activeTurnIdRef.current;
    interruptRequestedRef.current = true;
    if (!turnId) {
      pendingInterruptRef.current = true;
    }
    // Optimistically update UI immediately so stop feels responsive
    setStreamingState(false);
    activeTurnIdRef.current = null;
    // Remove thinking indicator if present
    const tId = thinkingItemIdRef.current;
    thinkingItemIdRef.current = null;
    updateMessages((prev) =>
      prev.filter((message) => {
        if (tId && message.id === tId) {
          return false;
        }
        return !(message.kind === "reasoning" && !message.content && !message.summary);
      }),
    );
    try {
      await window.orxa.codex.interruptThreadTree(thread.id, turnId ?? "pending");
    } catch (err) {
      recordLastError(err);
    }
  }, [recordLastError, setStreamingState, thread, updateMessages]);

  // Plan acceptance: switch to default mode and send implementation prompt
  // Sending a message adds a user message which naturally hides the overlay (user msg follows plan item)
  const acceptPlan = useCallback(async (planItemId?: string) => {
    if (planItemId) {
      setDismissedPlanIdsState((prev) => new Set([...prev, planItemId]));
    }
    await sendMessage("Implement this plan.", { model: undefined });
  }, [sendMessage, setDismissedPlanIdsState]);

  // Check if a thread is a subagent thread
  const isSubagentThread = useCallback((threadId: string) => {
    return subagentThreadIds.current.has(threadId);
  }, []);

  // Plan modification: stay in plan mode, send changes
  // Sending a message adds a user message which naturally hides the overlay (user msg follows plan item)
  const submitPlanChanges = useCallback(async (changes: string, planItemId?: string) => {
    if (planItemId) {
      setDismissedPlanIdsState((prev) => new Set([...prev, planItemId]));
    }
    await sendMessage(`Update the plan with these changes:\n\n${changes}`, { model: undefined });
  }, [sendMessage, setDismissedPlanIdsState]);

  // Dismiss plan without accepting or modifying
  const dismissPlan = useCallback((planItemId?: string) => {
    if (planItemId) {
      setDismissedPlanIdsState((prev) => new Set([...prev, planItemId]));
    }
  }, [setDismissedPlanIdsState]);

  // Subagent thread navigation
  const openSubagentThread = useCallback((threadId: string) => {
    setActiveSubagentThreadIdState(threadId);
  }, [setActiveSubagentThreadIdState]);

  const closeSubagentThread = useCallback(() => {
    setActiveSubagentThreadIdState(null);
  }, [setActiveSubagentThreadIdState]);

  return {
    connectionStatus,
    serverInfo,
    thread,
    messages,
    pendingApproval,
    pendingUserInput,
    isStreaming,
    lastError,
    threadName,
    planItems,
    dismissedPlanIds,
    subagents,
    activeSubagentThreadId,
    subagentMessages,
    connect,
    disconnect,
    startThread,
    sendMessage,
    approveAction,
    denyAction,
    respondToUserInput,
    rejectUserInput,
    interruptTurn,
    acceptPlan,
    submitPlanChanges,
    dismissPlan,
    isSubagentThread,
    openSubagentThread,
    closeSubagentThread,
  };
}
