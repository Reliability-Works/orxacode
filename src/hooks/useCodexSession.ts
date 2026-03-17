import { useCallback, useEffect, useRef, useState } from "react";
import type { CodexApprovalRequest, CodexNotification, CodexState, CodexThread, CodexUserInputRequest } from "@shared/ipc";
import type { TodoItem } from "../components/chat/TodoDock";
import { getPersistedCodexState, setPersistedCodexState } from "./codex-session-storage";
import {
  appendAssistantDeltaToLastMessage,
  appendDeltaToMappedItem,
  parseMarkdownPlan,
  parseStructuredPlan,
  removeMessageByID,
} from "./codex-session-message-reducers";
import { nextMessageID, resetStreamingBookkeeping } from "./codex-session-streaming";

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

export type CodexMessageItem =
  | { id: string; kind: "message"; role: "user" | "assistant"; content: string; timestamp: number }
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
  | { id: string; kind: "compaction"; timestamp: number };

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

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCodexSession(directory: string) {
  const persisted = getPersistedCodexState(directory);
  const [connectionStatus, setConnectionStatus] = useState<CodexState["status"]>("disconnected");
  const [serverInfo, setServerInfo] = useState<CodexState["serverInfo"]>();
  const [thread, setThread] = useState<CodexThread | null>(persisted.thread);
  const [messages, setMessages] = useState<CodexMessageItem[]>(persisted.messages);
  const [pendingApproval, setPendingApproval] = useState<CodexApprovalRequest | null>(null);
  const [pendingUserInput, setPendingUserInput] = useState<CodexUserInputRequest | null>(null);
  const [isStreaming, setIsStreaming] = useState(persisted.isStreaming);
  const [lastError, setLastError] = useState<string>();
  const [threadName, setThreadName] = useState<string>();
  const [planItems, setPlanItems] = useState<TodoItem[]>([]);
  const [planReady, setPlanReady] = useState(false);
  const hadPlanUpdate = useRef(false);

  // Subagent thread detection & tracking
  const subagentThreadIds = useRef(new Set<string>());
  const [subagents, setSubagents] = useState<SubagentInfo[]>([]);
  const [activeSubagentThreadId, setActiveSubagentThreadId] = useState<string | null>(null);
  const [subagentMessages, setSubagentMessages] = useState<CodexMessageItem[]>([]);

  // Track the current assistant message being streamed
  const streamingItemIdRef = useRef<string | null>(null);
  // Track the thinking item id so we can remove it on turn/completed
  const thinkingItemIdRef = useRef<string | null>(null);
  const messageIdCounter = useRef(persisted.messageIdCounter);
  // Map codex item IDs to our message IDs for delta matching
  const codexItemToMsgId = useRef(new Map<string, string>());
  // Track active turn for interrupt
  const activeTurnIdRef = useRef<string | null>(null);

  // Persist state changes back to module-level storage (sync on every change + unmount)
  const messagesRef = useRef(messages);
  const threadRef = useRef(thread);
  const isStreamingRef = useRef(isStreaming);
  messagesRef.current = messages;
  threadRef.current = thread;
  isStreamingRef.current = isStreaming;

  useEffect(() => {
    setPersistedCodexState(directory, {
      messages,
      thread,
      isStreaming,
      messageIdCounter: messageIdCounter.current,
    });
  }, [directory, messages, thread, isStreaming]);

  // Ensure persistence on unmount (refs capture latest values)
  useEffect(() => {
    return () => {
      setPersistedCodexState(directory, {
        messages: messagesRef.current,
        thread: threadRef.current,
        isStreaming: isStreamingRef.current,
        messageIdCounter: messageIdCounter.current,
      });
    };
  }, [directory]);

  // ------------------------------------------------------------------
  // Event subscription
  // Uses a mounted ref to avoid setState on unmounted components.
  // The handleNotification callback writes to persisted store via
  // setMessages which syncs to the store in the persist effect.
  // ------------------------------------------------------------------
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    // On remount, re-sync from persisted state (events may have arrived while unmounted)
    const p = getPersistedCodexState(directory);
    setMessages(p.messages);
    setThread(p.thread);
    setIsStreaming(p.isStreaming);
    messageIdCounter.current = p.messageIdCounter;

    if (!window.orxa?.events) return;

    const unsubscribe = window.orxa.events.subscribe((event) => {
      if (!isMounted.current) return;

      if (event.type === "codex.state") {
        const state = event.payload as CodexState;
        setConnectionStatus(state.status);
        setServerInfo(state.serverInfo);
        if (state.lastError) setLastError(state.lastError);
      }

      if (event.type === "codex.approval") {
        setPendingApproval(event.payload as CodexApprovalRequest);
      }

      if (event.type === "codex.userInput") {
        setPendingUserInput(event.payload as CodexUserInputRequest);
      }

      if (event.type === "codex.notification") {
        const notification = event.payload as CodexNotification;
        handleNotificationRef.current(notification);
      }
    });

    return () => {
      isMounted.current = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------
  // Helper: find and update a message by its internal msg ID
  // ------------------------------------------------------------------
  const appendToItemField = useCallback(
    (codexItemId: string, field: "content" | "output" | "diff" | "summary", delta: string) => {
      const msgId = codexItemToMsgId.current.get(codexItemId);
      if (!msgId) return;
      setMessages((prev) => appendDeltaToMappedItem(prev, msgId, field, delta));
    },
    [],
  );

  // ------------------------------------------------------------------
  // Notification handler
  // ------------------------------------------------------------------
  const handleNotificationRef = useRef<(notification: CodexNotification) => void>(() => {});
  const handleNotification = useCallback((notification: CodexNotification) => {
    const { method, params } = notification;

    switch (method) {
      case "turn/started": {
        setIsStreaming(true);
        setPlanReady(false);
        streamingItemIdRef.current = null;
        // Track turn ID for interrupt
        const turn = params.turn as { id?: string } | undefined;
        activeTurnIdRef.current = turn?.id ?? null;
        // Insert a thinking indicator
        const thinkingId = nextMessageID("codex-thinking", messageIdCounter);
        thinkingItemIdRef.current = thinkingId;
        setMessages((prev) => [
          ...prev,
          { id: thinkingId, kind: "thinking", timestamp: Date.now() },
        ]);
        break;
      }

      case "turn/completed": {
        setIsStreaming(false);
        streamingItemIdRef.current = null;
        activeTurnIdRef.current = null;
        // Remove the thinking indicator
        const tId = thinkingItemIdRef.current;
        thinkingItemIdRef.current = null;
        if (tId) {
          setMessages((prev) => removeMessageByID(prev, tId));
        }
        // If plan items were updated during this turn, the plan is ready for user review
        if (hadPlanUpdate.current) {
          hadPlanUpdate.current = false;
          // If planItems are still empty, try extracting from the last assistant message
          setPlanItems((currentItems) => {
            if (currentItems.length > 0 && currentItems.some((i) => i.content.trim().length > 0)) {
              return currentItems;
            }
            // Find last assistant message with content
            const lastMsg = [...messages].reverse().find(
              (m) => m.kind === "message" && m.role === "assistant" && m.content.trim().length > 0,
            );
            if (!lastMsg || lastMsg.kind !== "message") return currentItems;
            const lines = lastMsg.content.split("\n")
              .map((l: string) => l.trim())
              .filter((l: string) => l.startsWith("- ") || l.startsWith("* ") || /^\d+[.)]\s/.test(l));
            if (lines.length === 0) return currentItems;
            return lines.map((line: string, i: number) => ({
              id: `plan-msg-${i}`,
              content: line.replace(/^\s*[-*]\s*/, "").replace(/^\d+[.)]\s*/, "").trim(),
              status: "pending" as const,
            }));
          });
          setPlanReady(true);
        }
        break;
      }

      // ── Plan mode ──────────────────────────────────────────────────
      case "turn/plan/updated": {
        hadPlanUpdate.current = true;
        const plan = params.plan as unknown;
        const explanation = params.explanation as unknown;

        if (Array.isArray(plan) && plan.length > 0) {
          const items = parseStructuredPlan(plan);
          setPlanItems(items);
        } else if (typeof plan === "string" && plan.trim()) {
          const items = parseMarkdownPlan(plan);
          if (items.length > 0) setPlanItems(items);
        } else if (typeof explanation === "string" && explanation.trim()) {
          const items = parseMarkdownPlan(explanation);
          if (items.length > 0) setPlanItems(items);
        }

        // Also try to extract from the last assistant message if plan items are still empty
        // (some backends stream the plan as regular text, not structured)
        break;
      }

      // ── Subagent thread detection ──────────────────────────────────
      case "thread/started": {
        const threadMeta = params.thread as {
          id?: string;
          source?: { subAgent?: { nickname?: string; role?: string; task?: string } };
          kind?: string;
        } | undefined;
        if (threadMeta?.id && threadMeta?.source?.subAgent) {
          subagentThreadIds.current.add(threadMeta.id);
          const sa = threadMeta.source.subAgent;
          setSubagents((prev) => {
            // Don't duplicate
            if (prev.some((a) => a.threadId === threadMeta.id)) return prev;
            return [
              ...prev,
              {
                threadId: threadMeta.id!,
                nickname: sa.nickname ?? `Agent-${prev.length + 1}`,
                role: sa.role ?? "worker",
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
          setThreadName(name);
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
        };

        if (item.type === "agentMessage") {
          streamingItemIdRef.current = item.id;
          const msgId = nextMessageID("codex-assistant", messageIdCounter);
          codexItemToMsgId.current.set(item.id, msgId);
          // Remove thinking item when the real message starts arriving
          const tId = thinkingItemIdRef.current;
          thinkingItemIdRef.current = null;
          setMessages((prev) => {
            const filtered = tId ? prev.filter((m) => m.id !== tId) : prev;
            return [
              ...filtered,
              { id: msgId, kind: "message", role: "assistant", content: "", timestamp: Date.now() },
            ];
          });
        }

        if (item.type === "commandExecution") {
          const msgId = nextMessageID("codex-cmd", messageIdCounter);
          codexItemToMsgId.current.set(item.id, msgId);
          setMessages((prev) => [
            ...prev,
            {
              id: msgId,
              kind: "tool",
              toolType: "commandExecution",
              title: "Command",
              output: "",
              status: "running",
              timestamp: Date.now(),
            },
          ]);
        }

        if (item.type === "fileChange") {
          const msgId = nextMessageID("codex-diff", messageIdCounter);
          codexItemToMsgId.current.set(item.id, msgId);
          setMessages((prev) => [
            ...prev,
            {
              id: msgId,
              kind: "diff",
              path: item.path ?? "",
              type: "modified",
              diff: "",
              timestamp: Date.now(),
            },
          ]);
        }

        if (item.type === "reasoning") {
          const msgId = nextMessageID("codex-reasoning", messageIdCounter);
          codexItemToMsgId.current.set(item.id, msgId);
          setMessages((prev) => [
            ...prev,
            {
              id: msgId,
              kind: "reasoning",
              content: "",
              summary: "",
              timestamp: Date.now(),
            },
          ]);
        }

        if (item.type === "fileRead") {
          const msgId = nextMessageID("codex-ctx", messageIdCounter);
          codexItemToMsgId.current.set(item.id, msgId);
          setMessages((prev) => [
            ...prev,
            {
              id: msgId,
              kind: "context",
              toolType: "read",
              title: item.path ?? "file",
              status: "running",
              timestamp: Date.now(),
            },
          ]);
        }

        if (item.type === "webSearch") {
          const msgId = nextMessageID("codex-ctx", messageIdCounter);
          codexItemToMsgId.current.set(item.id, msgId);
          setMessages((prev) => [
            ...prev,
            {
              id: msgId,
              kind: "context",
              toolType: "search",
              title: (item.query as string) ?? "search",
              status: "running",
              timestamp: Date.now(),
            },
          ]);
        }

        if (item.type === "mcpToolCall") {
          const msgId = nextMessageID("codex-ctx", messageIdCounter);
          codexItemToMsgId.current.set(item.id, msgId);
          setMessages((prev) => [
            ...prev,
            {
              id: msgId,
              kind: "context",
              toolType: "mcp",
              title: item.toolName ?? item.name ?? "mcp tool",
              status: "running",
              timestamp: Date.now(),
            },
          ]);
        }

        if (item.type === "plan") {
          const msgId = nextMessageID("codex-plan", messageIdCounter);
          codexItemToMsgId.current.set(item.id, msgId);
          setMessages((prev) => [
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
          setMessages((prev) => [
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
          const msgId = nextMessageID("codex-task", messageIdCounter);
          codexItemToMsgId.current.set(item.id, msgId);
          const receivers = collabItem.collabReceivers ?? (collabItem.collabReceiver ? [collabItem.collabReceiver] : undefined);
          setMessages((prev) => [
            ...prev,
            {
              id: msgId,
              kind: "tool",
              toolType: "task",
              title: collabItem.title ?? collabItem.name ?? collabItem.toolName ?? "Task",
              output: "",
              status: "running",
              timestamp: Date.now(),
              collabSender: collabItem.collabSender,
              collabReceivers: receivers,
              collabStatuses: collabItem.collabStatuses,
            },
          ]);

          // Update subagent statuses from collab metadata
          if (collabItem.collabStatuses) {
            setSubagents((prev) => {
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
                setSubagents((prev) => {
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
        if (delta) {
          setMessages((prev) => appendAssistantDeltaToLastMessage(prev, delta));
        }
        break;
      }

      case "item/commandExecution/outputDelta": {
        const delta = params.delta as string;
        const codexItemId = params.itemId as string;
        if (delta && codexItemId) {
          appendToItemField(codexItemId, "output", delta);
        }
        break;
      }

      case "item/fileChange/outputDelta": {
        const delta = params.delta as string;
        const codexItemId = params.itemId as string;
        if (delta && codexItemId) {
          appendToItemField(codexItemId, "diff", delta);
        }
        break;
      }

      case "item/reasoning/textDelta": {
        const delta = params.delta as string;
        const codexItemId = params.itemId as string;
        if (delta && codexItemId) {
          appendToItemField(codexItemId, "content", delta);
        }
        break;
      }

      case "item/reasoning/summaryTextDelta": {
        const delta = params.delta as string;
        const codexItemId = params.itemId as string;
        if (delta && codexItemId) {
          appendToItemField(codexItemId, "summary", delta);
        }
        break;
      }

      case "item/plan/delta": {
        const delta = params.delta as string;
        const codexItemId = params.itemId as string;
        if (delta && codexItemId) {
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
        };

        // Check if we already have a running item for this codex id (created in item/started)
        const existingMsgId = codexItemToMsgId.current.get(item.id);

        if (item.type === "commandExecution") {
          if (existingMsgId) {
            // Update the existing running item with final data
            setMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === existingMsgId);
              if (idx < 0) return prev;
              const existing = prev[idx];
              if (existing.kind !== "tool") return prev;
              const next = [...prev];
              next[idx] = {
                ...existing,
                title: item.command ? `$ ${item.command.slice(0, 60)}` : existing.title,
                command: item.command ?? existing.command,
                output: item.aggregatedOutput ?? existing.output,
                status: item.exitCode === 0 || item.exitCode === undefined ? "completed" : "error",
                exitCode: item.exitCode,
                durationMs: item.durationMs,
              };
              return next;
            });
          } else {
            // Fallback: no started event was seen — add a completed item directly
            const msgId = nextMessageID("codex-cmd", messageIdCounter);
            setMessages((prev) => [
              ...prev,
              {
                id: msgId,
                kind: "tool",
                toolType: "commandExecution",
                title: item.command ? `$ ${item.command.slice(0, 60)}` : "Command",
                command: item.command,
                output: item.aggregatedOutput,
                status: item.exitCode === 0 || item.exitCode === undefined ? "completed" : "error",
                exitCode: item.exitCode,
                timestamp: Date.now(),
              },
            ]);
          }
        }

        if (item.type === "fileChange" && item.path) {
          if (existingMsgId) {
            setMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === existingMsgId);
              if (idx < 0) return prev;
              const existing = prev[idx];
              if (existing.kind !== "diff") return prev;
              const next = [...prev];
              next[idx] = {
                ...existing,
                path: item.path!,
                type: item.changeType ?? existing.type,
                insertions: item.insertions ?? existing.insertions,
                deletions: item.deletions ?? existing.deletions,
              };
              return next;
            });
          } else {
            const msgId = nextMessageID("codex-diff", messageIdCounter);
            setMessages((prev) => [
              ...prev,
              {
                id: msgId,
                kind: "diff",
                path: item.path!,
                type: item.changeType ?? "modified",
                insertions: item.insertions,
                deletions: item.deletions,
                timestamp: Date.now(),
              },
            ]);
          }
        }

        // Update status on completed context/tool items
        if (
          item.type === "fileRead" ||
          item.type === "webSearch" ||
          item.type === "mcpToolCall"
        ) {
          if (existingMsgId) {
            setMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === existingMsgId);
              if (idx < 0) return prev;
              const existing = prev[idx];
              if (existing.kind !== "context") return prev;
              const next = [...prev];
              next[idx] = { ...existing, status: "completed" };
              return next;
            });
          }
        }

        if (
          item.type === "plan" ||
          item.type === "collabToolCall" ||
          item.type === "collabAgentToolCall"
        ) {
          if (existingMsgId) {
            setMessages((prev) => {
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
        if (status?.type === "idle") {
          setIsStreaming(false);
        }
        break;
      }

      default:
        // Unhandled notification — no-op
        break;
    }
  }, [appendToItemField, messages]);
  handleNotificationRef.current = handleNotification;

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------
  const connect = useCallback(async () => {
    if (!window.orxa?.codex) {
      setLastError("Codex bridge not available");
      return;
    }
    try {
      const state = await window.orxa.codex.start(directory);
      setConnectionStatus(state.status);
      setServerInfo(state.serverInfo);
      if (state.lastError) setLastError(state.lastError);
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
      setConnectionStatus("error");
    }
  }, [directory]);

  const disconnect = useCallback(async () => {
    if (!window.orxa?.codex) return;
    try {
      await window.orxa.codex.stop();
    } catch {
      // ignore
    }
    setConnectionStatus("disconnected");
    setThread(null);
    setMessages([]);
    setIsStreaming(false);
  }, []);

  const startThread = useCallback(
    async (options?: { model?: string; title?: string }) => {
      if (!window.orxa?.codex) return;
      try {
        const t = await window.orxa.codex.startThread({
          cwd: directory,
          model: options?.model,
          title: options?.title,
        });
        setThread(t);
        setMessages([]);
        setIsStreaming(false);
        resetStreamingBookkeeping({
          streamingItemIdRef,
          thinkingItemIdRef,
          activeTurnIdRef,
          codexItemToMsgId,
        });
        setPlanItems([]);
        setThreadName(undefined);
      } catch (err) {
        setLastError(err instanceof Error ? err.message : String(err));
      }
    },
    [directory],
  );

  const sendMessage = useCallback(
    async (prompt: string, options?: { model?: string; effort?: string; collaborationMode?: string }) => {
      if (!window.orxa?.codex || !thread) return;

      const userMsgId = `codex-user-${messageIdCounter.current++}`;
      setMessages((prev) => [
        ...prev,
        { id: userMsgId, kind: "message", role: "user", content: prompt, timestamp: Date.now() },
      ]);

      try {
        await window.orxa.codex.startTurn(thread.id, prompt, directory, options?.model, options?.effort, options?.collaborationMode);
      } catch (err) {
        setLastError(err instanceof Error ? err.message : String(err));
      }
    },
    [thread, directory],
  );

  const approveAction = useCallback(
    async (decision: string) => {
      if (!window.orxa?.codex || !pendingApproval) return;
      try {
        await window.orxa.codex.approve(pendingApproval.id, decision);
        setPendingApproval(null);
      } catch (err) {
        setLastError(err instanceof Error ? err.message : String(err));
      }
    },
    [pendingApproval],
  );

  const denyAction = useCallback(async () => {
    if (!window.orxa?.codex || !pendingApproval) return;
    try {
      await window.orxa.codex.deny(pendingApproval.id);
      setPendingApproval(null);
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
    }
  }, [pendingApproval]);

  // Respond to user input request
  const respondToUserInput = useCallback(
    async (response: string) => {
      if (!window.orxa?.codex || !pendingUserInput) return;
      try {
        await window.orxa.codex.respondToUserInput(pendingUserInput.id, response);
        setPendingUserInput(null);
      } catch (err) {
        setLastError(err instanceof Error ? err.message : String(err));
      }
    },
    [pendingUserInput],
  );

  const rejectUserInput = useCallback(async () => {
    if (!window.orxa?.codex || !pendingUserInput) return;
    try {
      // Respond with empty string to indicate rejection
      await window.orxa.codex.respondToUserInput(pendingUserInput.id, "");
      setPendingUserInput(null);
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
    }
  }, [pendingUserInput]);

  // Interrupt the current turn
  const interruptTurn = useCallback(async () => {
    if (!window.orxa?.codex || !thread || !activeTurnIdRef.current) return;
    try {
      await window.orxa.codex.interruptTurn(thread.id, activeTurnIdRef.current);
      setIsStreaming(false);
      activeTurnIdRef.current = null;
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
    }
  }, [thread]);

  // Plan acceptance: switch to default mode and send implementation prompt
  const acceptPlan = useCallback(async () => {
    setPlanReady(false);
    await sendMessage("Implement this plan.", { model: undefined });
  }, [sendMessage]);

  // Check if a thread is a subagent thread
  const isSubagentThread = useCallback((threadId: string) => {
    return subagentThreadIds.current.has(threadId);
  }, []);

  // Plan modification: stay in plan mode, send changes
  const submitPlanChanges = useCallback(async (changes: string) => {
    setPlanReady(false);
    await sendMessage(`Update the plan with these changes:\n\n${changes}`, { model: undefined });
  }, [sendMessage]);

  // Dismiss plan without accepting or modifying
  const dismissPlan = useCallback(() => {
    setPlanReady(false);
  }, []);

  // Subagent thread navigation — gather messages related to this agent
  const openSubagentThread = useCallback((threadId: string) => {
    setActiveSubagentThreadId(threadId);
    // Filter messages that reference this subagent via collab metadata
    const related = messagesRef.current.filter((m) => {
      if (m.kind !== "tool" || m.toolType !== "task") return false;
      const receivers = m.collabReceivers;
      const sender = m.collabSender;
      if (receivers?.some((r) => r.threadId === threadId)) return true;
      if (sender?.threadId === threadId) return true;
      return false;
    });
    setSubagentMessages(related);
  }, []);

  const closeSubagentThread = useCallback(() => {
    setActiveSubagentThreadId(null);
    setSubagentMessages([]);
  }, []);

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
    planReady,
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
