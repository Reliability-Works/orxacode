import { useCallback, useEffect, useState } from "react";
import type { ClaudeChatAttachment, ClaudeChatHistoryMessage, ClaudeChatModelEntry } from "@shared/ipc";
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
      kind: "tool";
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
    if (persisted.messages.length > 0) {
      replaceClaudeChatMessages(sessionKey, persisted.messages);
      setClaudeChatStreaming(sessionKey, persisted.isStreaming);
      setClaudeChatHistoryMessages(sessionKey, persisted.historyMessages);
      setClaudeChatSubagents(sessionKey, persisted.subagents);
      if (persisted.providerThreadId) {
        setClaudeChatProviderThreadId(sessionKey, persisted.providerThreadId);
      }
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
        updateClaudeChatMessages(sessionKey, (messages) =>
          appendAssistantDelta(removeThinkingRow(messages, turnId), id, content, timestamp),
        );
        setClaudeChatStreaming(sessionKey, true);
        return;
      }
      if (method === "assistant/message") {
        const turnId = typeof params.turnId === "string" ? params.turnId : "";
        const fallbackId = typeof params.id === "string" ? params.id : nextClaudeMessageId(sessionKey);
        const id = assistantMessageIdForTurn(turnId, fallbackId);
        const timestamp = typeof params.timestamp === "number" ? params.timestamp : Date.now();
        const content = typeof params.content === "string" ? params.content : "";
        updateClaudeChatMessages(sessionKey, (messages) =>
          upsertAssistantMessage(removeThinkingRow(messages, turnId), id, content, timestamp, false),
        );
        return;
      }
      if (method === "tool/progress") {
        const id = typeof params.id === "string" ? params.id : nextClaudeMessageId(sessionKey);
        const toolName = typeof params.toolName === "string" ? params.toolName : "Tool";
        const timestamp = typeof params.timestamp === "number" ? params.timestamp : Date.now();
        updateClaudeChatMessages(sessionKey, (messages) => {
          const existing = messages.findIndex((item) => item.id === id && item.kind === "tool");
          const next = [...messages];
          const toolItem: ClaudeChatMessageItem = {
            id,
            kind: "tool",
            title: toolName,
            toolType: toolName,
            status: "running",
            output: typeof params.elapsedTimeSeconds === "number" ? `Running for ${params.elapsedTimeSeconds.toFixed(1)}s` : undefined,
            timestamp,
          };
          if (existing >= 0) {
            next[existing] = toolItem;
            return next;
          }
          return [...messages, toolItem];
        });
        return;
      }
      if (method === "tool/completed") {
        const id = typeof params.id === "string" ? params.id : nextClaudeMessageId(sessionKey);
        const timestamp = typeof params.timestamp === "number" ? params.timestamp : Date.now();
        updateClaudeChatMessages(sessionKey, (messages) => {
          const existing = messages.findIndex((item) => item.id === id && item.kind === "tool");
          const next = [...messages];
          const toolItem: ClaudeChatMessageItem = {
            id,
            kind: "tool",
            title: typeof params.toolName === "string" ? params.toolName : "Tool call",
            toolType: typeof params.toolName === "string" ? params.toolName : "tool",
            status: "completed",
            output: typeof params.summary === "string" ? params.summary : undefined,
            timestamp,
          };
          if (existing >= 0) {
            next[existing] = toolItem;
            return next;
          }
          return [...messages, toolItem];
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
        return;
      }
      if (method === "task/progress") {
        const taskId = typeof params.taskId === "string" ? params.taskId : "";
        const description = typeof params.description === "string" ? params.description : undefined;
        const summary = typeof params.summary === "string" ? params.summary : undefined;
        setClaudeChatSubagents(sessionKey, (previous) => previous.map((agent) =>
          agent.id === taskId
            ? {
                ...agent,
                status: "thinking",
                statusText: summary || description || "is running",
              }
            : agent,
        ));
        return;
      }
      if (method === "task/completed") {
        const taskId = typeof params.taskId === "string" ? params.taskId : "";
        setClaudeChatSubagents(sessionKey, (previous) => previous.map((agent) =>
          agent.id === taskId
            ? {
                ...agent,
                status: "completed",
                statusText: "completed",
              }
            : agent,
        ));
        return;
      }
      if (method === "turn/completed") {
        setClaudeChatStreaming(sessionKey, false);
        setClaudeChatPendingApproval(sessionKey, null);
        setClaudeChatPendingUserInput(sessionKey, null);
        return;
      }
      if (method === "turn/error") {
        const timestamp = typeof params.timestamp === "number" ? params.timestamp : Date.now();
        const message = typeof params.message === "string" ? params.message : "Claude turn failed.";
        updateClaudeChatMessages(sessionKey, (messages) => [
          ...messages,
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
    await window.orxa.claudeChat.startTurn(sessionKey, directory, prompt, { cwd: directory, ...turnOptions });
  }, [directory, sessionKey, updateClaudeChatMessages]);

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
