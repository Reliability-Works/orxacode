import { useEffect, type MutableRefObject } from "react";
import type { CodexThread } from "@shared/ipc";
import type { TodoItem } from "../components/chat/TodoDock";
import { getPersistedCodexState, setPersistedCodexState } from "./codex-session-storage";
import type { CodexMessageItem } from "./useCodexSession";
import type { SubagentInfo } from "./codex-subagent-helpers";

type UseCodexSessionPersistenceInput = {
  directory: string;
  sessionKey: string;
  messages: CodexMessageItem[];
  thread: CodexThread | null;
  isStreaming: boolean;
  messageIdCounterRef: MutableRefObject<number>;
  commandDiffPollTimersRef: MutableRefObject<Map<string, number>>;
  initCodexSession: (sessionKey: string, directory: string) => void;
  getCurrentCodexRuntime: () => {
    messages: CodexMessageItem[];
    thread: CodexThread | null;
    isStreaming: boolean;
  } | null;
};

export function useCodexSessionPersistence({
  directory,
  sessionKey,
  messages,
  thread,
  isStreaming,
  messageIdCounterRef,
  commandDiffPollTimersRef,
  initCodexSession,
  getCurrentCodexRuntime,
}: UseCodexSessionPersistenceInput) {
  useEffect(() => {
    initCodexSession(sessionKey, directory);
  }, [directory, initCodexSession, sessionKey]);

  useEffect(() => {
    setPersistedCodexState(sessionKey, {
      messages,
      thread,
      isStreaming,
      messageIdCounter: messageIdCounterRef.current,
    });
  }, [isStreaming, messageIdCounterRef, messages, sessionKey, thread]);

  useEffect(() => {
    const pollTimers = commandDiffPollTimersRef.current;
    const readMessageIdCounter = () => messageIdCounterRef.current;
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
        messageIdCounter: readMessageIdCounter(),
      });
    };
  }, [commandDiffPollTimersRef, getCurrentCodexRuntime, messageIdCounterRef, sessionKey]);
}

export function hydratePersistedCodexSession(
  sessionKey: string,
  input: {
    setMessagesState: (messages: CodexMessageItem[]) => void;
    setThreadState: (thread: CodexThread | null) => void;
    setStreamingState: (isStreaming: boolean) => void;
    setPendingApprovalState: (next: null) => void;
    setPendingUserInputState: (next: null) => void;
    setSubagentsState: (next: SubagentInfo[]) => void;
    setActiveSubagentThreadIdState: (next: null) => void;
    setPlanItemsState: (next: TodoItem[]) => void;
    setThreadNameState: (next: undefined) => void;
    resetRefs: (persistedMessageIdCounter: number) => void;
  },
) {
  const persistedState = getPersistedCodexState(sessionKey);
  const inferredThreadId = persistedState.thread?.id || inferCodexThreadIdFromSessionKey(sessionKey);
  input.setMessagesState(persistedState.messages);
  input.setThreadState(
    persistedState.thread ?? (inferredThreadId
      ? {
          id: inferredThreadId,
          preview: "",
          modelProvider: "",
          createdAt: 0,
          ephemeral: true,
        }
      : null),
  );
  input.setStreamingState(persistedState.isStreaming);
  input.setPendingApprovalState(null);
  input.setPendingUserInputState(null);
  input.setSubagentsState([]);
  input.setActiveSubagentThreadIdState(null);
  input.setPlanItemsState([]);
  input.setThreadNameState(undefined);
  input.resetRefs(persistedState.messageIdCounter);
}

function inferCodexThreadIdFromSessionKey(sessionKey: string) {
  const prefix = "codex::";
  if (!sessionKey.startsWith(prefix)) {
    return null;
  }
  const remainder = sessionKey.slice(prefix.length);
  const separatorIndex = remainder.lastIndexOf("::");
  if (separatorIndex < 0) {
    return null;
  }
  const threadId = remainder.slice(separatorIndex + 2).trim();
  return threadId || null;
}
