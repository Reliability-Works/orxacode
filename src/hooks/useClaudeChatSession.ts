import { useCallback, useEffect, useState } from "react";
import type { ClaudeChatAttachment, ClaudeChatHistoryMessage, ClaudeChatModelEntry } from "@shared/ipc";
import type { ExploreEntry } from "../lib/explore-utils";
import type { ModelOption } from "../lib/models";
import { useUnifiedRuntimeStore } from "../state/unified-runtime-store";
import { clearPersistedClaudeChatState, getPersistedClaudeChatState, setPersistedClaudeChatState } from "./claude-chat-session-storage";

export interface ClaudeChatSubagentState {
  id: string;
  name: string;
  role?: string;
  status: "thinking" | "awaiting_instruction" | "completed" | "idle";
  statusText: string;
  prompt?: string;
  taskText?: string;
  sessionID?: string;
}

export type ClaudeChatMessageItem =
  | { id: string; kind: "message"; role: "user" | "assistant"; content: string; timestamp: number }
  | { id: string; kind: "thinking"; summary?: string; content?: string; timestamp: number }
  | { id: string; kind: "status"; label: string; timestamp: number }
  | {
      id: string;
      kind: "explore";
      source?: "main" | "delegated";
      status: "exploring" | "explored";
      entries: ExploreEntry[];
      timestamp: number;
    }
  | {
      id: string;
      kind: "tool";
      source?: "main" | "delegated";
      title: string;
      toolType: string;
      status: "running" | "completed" | "error";
      command?: string;
      output?: string;
      error?: string;
      timestamp: number;
    }
  | { id: string; kind: "notice"; label: string; detail?: string; tone?: "info" | "error"; timestamp: number };

function nextClaudeMessageId(sessionKey: string) {
  const persisted = getPersistedClaudeChatState(sessionKey);
  const nextCounter = persisted.messageIdCounter + 1;
  setPersistedClaudeChatState(sessionKey, { ...persisted, messageIdCounter: nextCounter });
  return `claude-msg-${nextCounter}`;
}

function toClaudeModelOptions(models: ClaudeChatModelEntry[]): ModelOption[] {
  return models.map((model) => ({
    key: `claude-chat/${model.id}`,
    providerID: "claude-chat",
    modelID: model.id,
    providerName: "Claude",
    modelName: model.name,
    variants: [],
  }));
}

function ensureThinkingRow(messages: ClaudeChatMessageItem[], turnId: string, timestamp: number): ClaudeChatMessageItem[] {
  const thinkingId = `thinking:${turnId}`;
  if (messages.some((item) => item.id === thinkingId)) {
    return messages;
  }
  return [...messages, { id: thinkingId, kind: "thinking", summary: "", content: "", timestamp }];
}

function removeThinkingRow(messages: ClaudeChatMessageItem[], turnId: string): ClaudeChatMessageItem[] {
  const thinkingId = `thinking:${turnId}`;
  return messages.filter((item) => item.id !== thinkingId);
}

function assistantMessageIdForTurn(turnId: string, fallbackId: string) {
  return turnId.trim() ? `assistant:${turnId}` : fallbackId;
}

function createAssistantMessage(id: string, content: string, timestamp: number): ClaudeChatMessageItem {
  return {
    id,
    kind: "message",
    role: "assistant",
    content,
    timestamp,
  };
}

function upsertAssistantMessage(messages: ClaudeChatMessageItem[], id: string, content: string, timestamp: number, streaming: boolean) {
  const index = messages.findIndex((item) => item.id === id && item.kind === "message" && item.role === "assistant");
  const next = [...messages];
  if (index >= 0) {
    next[index] = createAssistantMessage(id, content, timestamp);
    return next;
  }
  return [...messages, createAssistantMessage(id, streaming ? `${content}` : content, timestamp)];
}

function appendAssistantDelta(messages: ClaudeChatMessageItem[], id: string, content: string, timestamp: number) {
  const index = messages.findIndex((item) => item.id === id && item.kind === "message" && item.role === "assistant");
  const next = [...messages];
  if (index >= 0) {
    const current = next[index];
    if (current?.kind === "message" && current.role === "assistant") {
      next[index] = { ...current, content: `${current.content}${content}`, timestamp };
      return next;
    }
  }
  return [...messages, createAssistantMessage(id, content, timestamp)];
}

const CLAUDE_READ_ONLY_TOOL_NAMES = new Set([
  "read",
  "grep",
  "glob",
  "find",
  "ls",
  "search",
  "websearch",
  "view",
  "list",
  "tree",
]);

function compactClaudeExploreLabel(value: string, fallback: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.length > 96 ? `${normalized.slice(0, 93).trimEnd()}...` : normalized;
}

function pickClaudeExploreKind(toolName: string | undefined, text: string) {
  const normalizedTool = toolName?.trim().toLowerCase() ?? "";
  const normalizedText = text.trim().toLowerCase();
  if (
    normalizedTool === "grep" ||
    normalizedTool === "glob" ||
    normalizedTool === "find" ||
    normalizedTool === "search" ||
    normalizedTool === "websearch" ||
    /\b(search|grep|glob|find|look up|locate)\b/.test(normalizedText)
  ) {
    return "search" as const;
  }
  if (
    normalizedTool === "ls" ||
    normalizedTool === "list" ||
    normalizedTool === "tree" ||
    /\b(list|scan|browse|enumerate|inventory)\b/.test(normalizedText)
  ) {
    return "list" as const;
  }
  if (
    normalizedTool === "read" ||
    normalizedTool === "view" ||
    /\b(read|inspect|investigat|review|check|trace|audit|examine|look into)\b/.test(normalizedText)
  ) {
    return "read" as const;
  }
  return "run" as const;
}

function isClaudeExploreCandidate(input: {
  toolName?: string;
  description?: string;
  summary?: string;
  taskType?: string;
}) {
  const normalizedTool = input.toolName?.trim().toLowerCase() ?? "";
  if (normalizedTool && CLAUDE_READ_ONLY_TOOL_NAMES.has(normalizedTool)) {
    return true;
  }
  const normalizedTaskType = input.taskType?.trim().toLowerCase() ?? "";
  if (normalizedTaskType.includes("research") || normalizedTaskType.includes("explor")) {
    return true;
  }
  const combined = `${input.summary ?? ""} ${input.description ?? ""}`.trim().toLowerCase();
  if (!combined) {
    return false;
  }
  return /\b(explor\w*|inspect\w*|investigat\w*|review\w*|search\w*|find\w*|read\w*|scan\w*|check\w*|trace\w*|audit\w*)\b|\blook into\b/.test(combined);
}

function buildClaudeExploreEntry(input: {
  id: string;
  toolName?: string;
  description?: string;
  summary?: string;
  taskType?: string;
  status: ExploreEntry["status"];
}) {
  const labelSource = input.summary?.trim() || input.description?.trim() || input.toolName?.trim() || "Explore";
  return {
    id: input.id,
    kind: pickClaudeExploreKind(input.toolName, labelSource),
    label: compactClaudeExploreLabel(labelSource, "Explore"),
    detail: input.toolName?.trim() && input.toolName.trim() !== labelSource.trim() ? input.toolName.trim() : undefined,
    status: input.status,
  } satisfies ExploreEntry;
}

function upsertExploreRow(
  messages: ClaudeChatMessageItem[],
  rowId: string,
  entry: ExploreEntry,
  timestamp: number,
  status: "exploring" | "explored",
  source: "main" | "delegated",
) {
  const index = messages.findIndex((item) => item.id === rowId && item.kind === "explore");
  if (index >= 0) {
    const current = messages[index];
    if (current?.kind === "explore") {
      const next = [...messages];
      next[index] = {
        ...current,
        source,
        status,
        timestamp,
        entries: current.entries.some((candidate) => candidate.id === entry.id)
          ? current.entries.map((candidate) => (candidate.id === entry.id ? entry : candidate))
          : [...current.entries, entry],
      };
      return next;
    }
  }
  return [...messages, { id: rowId, kind: "explore" as const, source, status, entries: [entry], timestamp }];
}

function upsertClaudeTool(
  messages: ClaudeChatMessageItem[],
  toolItem: Extract<ClaudeChatMessageItem, { kind: "tool" }>,
) {
  const existing = messages.findIndex((item) => item.id === toolItem.id && item.kind === "tool");
  if (existing >= 0) {
    const next = [...messages];
    next[existing] = toolItem;
    return next;
  }
  return [...messages, toolItem];
}

export function useClaudeChatSession(directory: string, sessionKey: string) {
  const runtime = useUnifiedRuntimeStore((state) => state.claudeChatSessions[sessionKey] ?? null);
  const initClaudeChatSession = useUnifiedRuntimeStore((state) => state.initClaudeChatSession);
  const setClaudeChatConnectionState = useUnifiedRuntimeStore((state) => state.setClaudeChatConnectionState);
  const setClaudeChatProviderThreadId = useUnifiedRuntimeStore((state) => state.setClaudeChatProviderThreadId);
  const replaceClaudeChatMessages = useUnifiedRuntimeStore((state) => state.replaceClaudeChatMessages);
  const updateClaudeChatMessages = useUnifiedRuntimeStore((state) => state.updateClaudeChatMessages);
  const setClaudeChatPendingApproval = useUnifiedRuntimeStore((state) => state.setClaudeChatPendingApproval);
  const setClaudeChatPendingUserInput = useUnifiedRuntimeStore((state) => state.setClaudeChatPendingUserInput);
  const setClaudeChatStreaming = useUnifiedRuntimeStore((state) => state.setClaudeChatStreaming);
  const setClaudeChatHistoryMessages = useUnifiedRuntimeStore((state) => state.setClaudeChatHistoryMessages);
  const setClaudeChatSubagents = useUnifiedRuntimeStore((state) => state.setClaudeChatSubagents);
  const removeClaudeChatSession = useUnifiedRuntimeStore((state) => state.removeClaudeChatSession);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);

  useEffect(() => {
    initClaudeChatSession(sessionKey, directory);
    const persisted = getPersistedClaudeChatState(sessionKey);
    if (persisted.providerThreadId) {
      setClaudeChatProviderThreadId(sessionKey, persisted.providerThreadId);
    }
    if (persisted.messages.length > 0) {
      replaceClaudeChatMessages(sessionKey, persisted.messages);
      setClaudeChatStreaming(sessionKey, persisted.isStreaming);
      setClaudeChatHistoryMessages(sessionKey, persisted.historyMessages);
      setClaudeChatSubagents(sessionKey, persisted.subagents);
    }
  }, [
    directory,
    initClaudeChatSession,
    replaceClaudeChatMessages,
    sessionKey,
    setClaudeChatHistoryMessages,
    setClaudeChatProviderThreadId,
    setClaudeChatStreaming,
    setClaudeChatSubagents,
  ]);

  useEffect(() => {
    const persistedProviderThreadId = getPersistedClaudeChatState(sessionKey).providerThreadId?.trim();
    if (!persistedProviderThreadId) {
      return;
    }
    void window.orxa.claudeChat.restoreSession(sessionKey, directory, persistedProviderThreadId).catch(() => undefined);
  }, [directory, sessionKey]);

  useEffect(() => {
    if (!runtime) {
      return;
    }
    setPersistedClaudeChatState(sessionKey, {
      providerThreadId: runtime.providerThreadId,
      messages: runtime.messages,
      historyMessages: runtime.historyMessages,
      isStreaming: runtime.isStreaming,
      messageIdCounter: getPersistedClaudeChatState(sessionKey).messageIdCounter,
      subagents: runtime.subagents,
    });
  }, [runtime, sessionKey]);

  useEffect(() => {
    let cancelled = false;
    void window.orxa.claudeChat.listModels().then((models) => {
      if (!cancelled) {
        setModelOptions(toClaudeModelOptions(models));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = window.orxa.events.subscribe((event) => {
      if (event.type === "claude-chat.state" && event.payload.sessionKey === sessionKey) {
        setClaudeChatConnectionState(
          sessionKey,
          event.payload.status,
          event.payload.providerThreadId,
          event.payload.activeTurnId,
          event.payload.lastError,
        );
        return;
      }
      if (event.type === "claude-chat.approval" && event.payload.sessionKey === sessionKey) {
        setClaudeChatPendingApproval(sessionKey, event.payload);
        return;
      }
      if (event.type === "claude-chat.userInput" && event.payload.sessionKey === sessionKey) {
        setClaudeChatPendingUserInput(sessionKey, event.payload);
        return;
      }
      if (event.type !== "claude-chat.notification" || event.payload.sessionKey !== sessionKey) {
        return;
      }
      const { method, params } = event.payload;
      if (method === "thread/started") {
        const providerThreadId = typeof params.providerThreadId === "string" ? params.providerThreadId : undefined;
        const taskId = typeof params.taskId === "string" ? params.taskId : undefined;
        const isSubagent = params.isSubagent === true;
        if (!isSubagent && providerThreadId) {
          setClaudeChatProviderThreadId(sessionKey, providerThreadId);
        }
        if (isSubagent && providerThreadId && taskId) {
          setClaudeChatSubagents(sessionKey, (previous) => previous.map((agent) =>
            agent.id === taskId ? { ...agent, sessionID: providerThreadId } : agent,
          ));
        }
        return;
      }
      if (method === "turn/started") {
        const turnId = typeof params.turnId === "string" ? params.turnId : "";
        const timestamp = typeof params.timestamp === "number" ? params.timestamp : Date.now();
        updateClaudeChatMessages(sessionKey, (messages) => ensureThinkingRow(messages, turnId, timestamp));
        setClaudeChatStreaming(sessionKey, true);
        return;
      }
      if (method === "thinking/stopped") {
        const turnId = typeof params.turnId === "string" ? params.turnId : "";
        updateClaudeChatMessages(sessionKey, (messages) => removeThinkingRow(messages, turnId));
        return;
      }
      if (method === "assistant/partial") {
        const turnId = typeof params.turnId === "string" ? params.turnId : "";
        const fallbackId = typeof params.id === "string" ? params.id : nextClaudeMessageId(sessionKey);
        const id = assistantMessageIdForTurn(turnId, fallbackId);
        const timestamp = typeof params.timestamp === "number" ? params.timestamp : Date.now();
        const content = typeof params.content === "string" ? params.content : "";
        updateClaudeChatMessages(sessionKey, (messages) => appendAssistantDelta(messages, id, content, timestamp));
        setClaudeChatStreaming(sessionKey, true);
        return;
      }
      if (method === "assistant/message") {
        const turnId = typeof params.turnId === "string" ? params.turnId : "";
        const fallbackId = typeof params.id === "string" ? params.id : nextClaudeMessageId(sessionKey);
        const id = assistantMessageIdForTurn(turnId, fallbackId);
        const timestamp = typeof params.timestamp === "number" ? params.timestamp : Date.now();
        const content = typeof params.content === "string" ? params.content : "";
        updateClaudeChatMessages(sessionKey, (messages) => upsertAssistantMessage(messages, id, content, timestamp, false));
        return;
      }
      if (method === "tool/progress") {
        const id = typeof params.id === "string" ? params.id : nextClaudeMessageId(sessionKey);
        const toolName = typeof params.toolName === "string" ? params.toolName : "Tool";
        const taskId = typeof params.taskId === "string" ? params.taskId : "";
        const timestamp = typeof params.timestamp === "number" ? params.timestamp : Date.now();
        const source = taskId ? "delegated" as const : "main" as const;
        if (isClaudeExploreCandidate({ toolName })) {
          const entry = buildClaudeExploreEntry({
            id,
            toolName,
            status: "running",
          });
          updateClaudeChatMessages(sessionKey, (messages) => upsertExploreRow(messages, `explore:${id}`, entry, timestamp, "exploring", source));
          return;
        }
        updateClaudeChatMessages(sessionKey, (messages) => {
          const toolItem: ClaudeChatMessageItem = {
            id,
            kind: "tool",
            source,
            title: toolName,
            toolType: toolName,
            status: "running",
            output: typeof params.elapsedTimeSeconds === "number" ? `Running for ${params.elapsedTimeSeconds.toFixed(1)}s` : undefined,
            timestamp,
          };
          return upsertClaudeTool(messages, toolItem);
        });
        return;
      }
      if (method === "tool/completed") {
        const id = typeof params.id === "string" ? params.id : nextClaudeMessageId(sessionKey);
        const timestamp = typeof params.timestamp === "number" ? params.timestamp : Date.now();
        const toolName = typeof params.toolName === "string" ? params.toolName : "Tool call";
        const summary = typeof params.summary === "string" ? params.summary : undefined;
        const taskId = typeof params.taskId === "string" ? params.taskId : "";
        const source = taskId ? "delegated" as const : "main" as const;
        if (isClaudeExploreCandidate({ toolName, summary })) {
          const entry = buildClaudeExploreEntry({
            id,
            toolName,
            summary,
            status: "completed",
          });
          updateClaudeChatMessages(sessionKey, (messages) => upsertExploreRow(messages, `explore:${id}`, entry, timestamp, "explored", source));
          return;
        }
        updateClaudeChatMessages(sessionKey, (messages) => {
          const toolItem: ClaudeChatMessageItem = {
            id,
            kind: "tool",
            source,
            title: toolName,
            toolType: toolName,
            status: "completed",
            output: summary,
            timestamp,
          };
          return upsertClaudeTool(messages, toolItem);
        });
        return;
      }
      if (method === "task/started") {
        const taskId = typeof params.taskId === "string" ? params.taskId : nextClaudeMessageId(sessionKey);
        const description = typeof params.description === "string" ? params.description : "Subagent task";
        const prompt = typeof params.prompt === "string" ? params.prompt : undefined;
        const taskType = typeof params.taskType === "string" ? params.taskType : undefined;
        setClaudeChatSubagents(sessionKey, (previous) => [
          ...previous.filter((agent) => agent.id !== taskId),
          {
            id: taskId,
            name: taskType ? taskType.replace(/[_-]/g, " ") : "subagent",
            role: taskType ? taskType.replace(/[_-]/g, " ") : "worker",
            status: "thinking",
            statusText: "is running",
            prompt,
            taskText: description,
          },
        ]);
        if (isClaudeExploreCandidate({ description, taskType })) {
          const timestamp = typeof params.timestamp === "number" ? params.timestamp : Date.now();
          const entry = buildClaudeExploreEntry({
            id: taskId,
            description,
            summary: prompt,
            taskType,
            status: "running",
          });
          updateClaudeChatMessages(sessionKey, (messages) => upsertExploreRow(messages, `task:${taskId}`, entry, timestamp, "exploring", "delegated"));
        }
        return;
      }
      if (method === "task/progress") {
        const taskId = typeof params.taskId === "string" ? params.taskId : "";
        const description = typeof params.description === "string" ? params.description : undefined;
        const summary = typeof params.summary === "string" ? params.summary : undefined;
        const lastToolName = typeof params.lastToolName === "string" ? params.lastToolName : undefined;
        setClaudeChatSubagents(sessionKey, (previous) => previous.map((agent) =>
          agent.id === taskId
            ? {
                ...agent,
                status: "thinking",
                statusText: summary || description || "is running",
              }
            : agent,
        ));
        if (taskId && isClaudeExploreCandidate({ description, summary, toolName: lastToolName })) {
          const timestamp = typeof params.timestamp === "number" ? params.timestamp : Date.now();
          const entry = buildClaudeExploreEntry({
            id: taskId,
            toolName: lastToolName,
            description,
            summary,
            status: "running",
          });
          updateClaudeChatMessages(sessionKey, (messages) => upsertExploreRow(messages, `task:${taskId}`, entry, timestamp, "exploring", "delegated"));
        }
        return;
      }
      if (method === "task/completed") {
        const taskId = typeof params.taskId === "string" ? params.taskId : "";
        const summary = typeof params.summary === "string" ? params.summary : undefined;
        setClaudeChatSubagents(sessionKey, (previous) => previous.map((agent) =>
          agent.id === taskId
            ? {
                ...agent,
                status: "completed",
                statusText: "completed",
              }
            : agent,
        ));
        if (taskId && isClaudeExploreCandidate({ summary })) {
          const timestamp = typeof params.timestamp === "number" ? params.timestamp : Date.now();
          const status = typeof params.status === "string" && params.status !== "completed" ? "error" as const : "completed" as const;
          const entry = buildClaudeExploreEntry({
            id: taskId,
            summary,
            status,
          });
          updateClaudeChatMessages(sessionKey, (messages) => upsertExploreRow(messages, `task:${taskId}`, entry, timestamp, "explored", "delegated"));
        }
        return;
      }
      if (method === "turn/completed") {
        const turnId = typeof params.turnId === "string" ? params.turnId : "";
        updateClaudeChatMessages(sessionKey, (messages) => removeThinkingRow(messages, turnId));
        setClaudeChatStreaming(sessionKey, false);
        setClaudeChatPendingApproval(sessionKey, null);
        setClaudeChatPendingUserInput(sessionKey, null);
        return;
      }
      if (method === "turn/error") {
        const turnId = typeof params.turnId === "string" ? params.turnId : "";
        const timestamp = typeof params.timestamp === "number" ? params.timestamp : Date.now();
        const message = typeof params.message === "string" ? params.message : "Claude turn failed.";
        updateClaudeChatMessages(sessionKey, (messages) => [
          ...removeThinkingRow(messages, turnId),
          { id: nextClaudeMessageId(sessionKey), kind: "notice", label: "Claude error", detail: message, tone: "error", timestamp },
        ]);
        setClaudeChatStreaming(sessionKey, false);
        return;
      }
      if (method === "result") {
        setClaudeChatStreaming(sessionKey, false);
      }
    });
    return unsubscribe;
  }, [
    sessionKey,
    setClaudeChatConnectionState,
    setClaudeChatHistoryMessages,
    setClaudeChatPendingApproval,
    setClaudeChatPendingUserInput,
    setClaudeChatProviderThreadId,
    setClaudeChatStreaming,
    setClaudeChatSubagents,
    updateClaudeChatMessages,
  ]);

  const startTurn = useCallback(async (
    prompt: string,
    options?: {
      model?: string;
      permissionMode?: string;
      effort?: "low" | "medium" | "high" | "max" | "ultrathink";
      fastMode?: boolean;
      thinking?: boolean;
      attachments?: ClaudeChatAttachment[];
      displayPrompt?: string;
    },
  ) => {
    const timestamp = Date.now();
    const userId = nextClaudeMessageId(sessionKey);
    const displayPrompt = options?.displayPrompt ?? prompt;
    const resumeSessionId = runtime?.providerThreadId ?? getPersistedClaudeChatState(sessionKey).providerThreadId ?? undefined;
    const turnOptions = { ...(options ?? {}) };
    delete (turnOptions as { displayPrompt?: string }).displayPrompt;
    updateClaudeChatMessages(sessionKey, (messages) => [
      ...messages,
      {
        id: userId,
        kind: "message",
        role: "user",
        content: displayPrompt,
        timestamp,
      },
    ]);
    await window.orxa.claudeChat.startTurn(sessionKey, directory, prompt, {
      cwd: directory,
      ...(resumeSessionId ? { resumeSessionId } : {}),
      ...turnOptions,
    });
  }, [directory, runtime?.providerThreadId, sessionKey, updateClaudeChatMessages]);

  const interruptTurn = useCallback(async () => {
    await window.orxa.claudeChat.interruptTurn(sessionKey);
  }, [sessionKey]);

  const approveAction = useCallback(async (requestId: string, decision: "accept" | "acceptForSession" | "decline" | "cancel") => {
    await window.orxa.claudeChat.approve(requestId, decision);
    setClaudeChatPendingApproval(sessionKey, null);
  }, [sessionKey, setClaudeChatPendingApproval]);

  const respondToUserInput = useCallback(async (requestId: string, response: string) => {
    await window.orxa.claudeChat.respondToUserInput(requestId, response);
    setClaudeChatPendingUserInput(sessionKey, null);
  }, [sessionKey, setClaudeChatPendingUserInput]);

  const archiveSession = useCallback(async () => {
    await window.orxa.claudeChat.archiveSession(sessionKey);
    clearPersistedClaudeChatState(sessionKey);
    removeClaudeChatSession(sessionKey);
  }, [removeClaudeChatSession, sessionKey]);

  const archiveProviderSession = useCallback(async (providerThreadId: string) => {
    await window.orxa.claudeChat.archiveProviderSession(providerThreadId, directory);
  }, [directory]);

  const loadSubagentMessages = useCallback(async (providerThreadId: string): Promise<ClaudeChatHistoryMessage[]> => {
    const messages = await window.orxa.claudeChat.getSessionMessages(providerThreadId, directory);
    return messages;
  }, [directory]);

  return {
    connectionStatus: runtime?.connectionStatus ?? "disconnected",
    providerThreadId: runtime?.providerThreadId ?? null,
    messages: runtime?.messages ?? [],
    pendingApproval: runtime?.pendingApproval ?? null,
    pendingUserInput: runtime?.pendingUserInput ?? null,
    isStreaming: runtime?.isStreaming ?? false,
    lastError: runtime?.lastError,
    subagents: runtime?.subagents ?? [],
    modelOptions,
    startTurn,
    interruptTurn,
    approveAction,
    respondToUserInput,
    archiveSession,
    archiveProviderSession,
    loadSubagentMessages,
  };
}
