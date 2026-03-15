import { useCallback, useEffect, useRef, useState } from "react";
import type { CodexApprovalRequest, CodexNotification, CodexState, CodexThread } from "@shared/ipc";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CodexMessageRole = "user" | "assistant";

export interface CodexMessage {
  id: string;
  role: CodexMessageRole;
  content: string;
  timestamp: number;
}

export interface CodexSessionState {
  connectionStatus: CodexState["status"];
  serverInfo?: CodexState["serverInfo"];
  thread: CodexThread | null;
  messages: CodexMessage[];
  pendingApproval: CodexApprovalRequest | null;
  isStreaming: boolean;
  lastError?: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCodexSession(directory: string) {
  const [connectionStatus, setConnectionStatus] = useState<CodexState["status"]>("disconnected");
  const [serverInfo, setServerInfo] = useState<CodexState["serverInfo"]>();
  const [thread, setThread] = useState<CodexThread | null>(null);
  const [messages, setMessages] = useState<CodexMessage[]>([]);
  const [pendingApproval, setPendingApproval] = useState<CodexApprovalRequest | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastError, setLastError] = useState<string>();

  // Track the current assistant message being streamed
  const streamingItemIdRef = useRef<string | null>(null);
  const messageIdCounter = useRef(0);

  // ------------------------------------------------------------------
  // Event subscription
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!window.orxa?.events) return;

    const unsubscribe = window.orxa.events.subscribe((event) => {
      if (event.type === "codex.state") {
        const state = event.payload as CodexState;
        setConnectionStatus(state.status);
        setServerInfo(state.serverInfo);
        if (state.lastError) setLastError(state.lastError);
      }

      if (event.type === "codex.approval") {
        setPendingApproval(event.payload as CodexApprovalRequest);
      }

      if (event.type === "codex.notification") {
        const notification = event.payload as CodexNotification;
        handleNotification(notification);
      }
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------
  // Notification handler
  // ------------------------------------------------------------------
  const handleNotification = useCallback((notification: CodexNotification) => {
    const { method, params } = notification;

    switch (method) {
      case "turn/started":
        setIsStreaming(true);
        streamingItemIdRef.current = null;
        break;

      case "turn/completed":
        setIsStreaming(false);
        streamingItemIdRef.current = null;
        break;

      case "item/started": {
        const item = params.item as { type: string; id: string; content?: Array<{ type: string; text?: string }> };
        if (item.type === "agentMessage") {
          streamingItemIdRef.current = item.id;
          const msgId = `codex-assistant-${messageIdCounter.current++}`;
          setMessages((prev) => [
            ...prev,
            { id: msgId, role: "assistant", content: "", timestamp: Date.now() },
          ]);
        }
        break;
      }

      case "item/agentMessage/delta": {
        const delta = params.delta as string;
        if (delta) {
          setMessages((prev) => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            if (last.role !== "assistant") return prev;
            return [...prev.slice(0, -1), { ...last, content: last.content + delta }];
          });
        }
        break;
      }

      case "item/completed": {
        const item = params.item as { type: string; id: string; command?: string; aggregatedOutput?: string; exitCode?: number };
        if (item.type === "commandExecution" && item.aggregatedOutput) {
          const msgId = `codex-cmd-${messageIdCounter.current++}`;
          const summary = `\`\`\`\n$ ${item.command ?? "command"}\n${item.aggregatedOutput}\n\`\`\`\n(exit ${item.exitCode ?? "?"})`;
          setMessages((prev) => [
            ...prev,
            { id: msgId, role: "assistant", content: summary, timestamp: Date.now() },
          ]);
        }
        if (item.id === streamingItemIdRef.current) {
          streamingItemIdRef.current = null;
        }
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
  }, []);

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
        streamingItemIdRef.current = null;
      } catch (err) {
        setLastError(err instanceof Error ? err.message : String(err));
      }
    },
    [directory],
  );

  const sendMessage = useCallback(
    async (prompt: string) => {
      if (!window.orxa?.codex || !thread) return;

      const userMsgId = `codex-user-${messageIdCounter.current++}`;
      setMessages((prev) => [
        ...prev,
        { id: userMsgId, role: "user", content: prompt, timestamp: Date.now() },
      ]);

      try {
        await window.orxa.codex.startTurn(thread.id, prompt, directory);
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

  return {
    connectionStatus,
    serverInfo,
    thread,
    messages,
    pendingApproval,
    isStreaming,
    lastError,
    connect,
    disconnect,
    startThread,
    sendMessage,
    approveAction,
    denyAction,
  };
}
