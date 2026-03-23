import type { ClaudeChatHistoryMessage } from "@shared/ipc";
import type { ClaudeChatMessageItem, ClaudeChatSubagentState } from "./useClaudeChatSession";

export interface PersistedClaudeChatState {
  providerThreadId: string | null;
  messages: ClaudeChatMessageItem[];
  historyMessages: ClaudeChatHistoryMessage[];
  isStreaming: boolean;
  messageIdCounter: number;
  subagents: ClaudeChatSubagentState[];
}

const persistedSessions = new Map<string, PersistedClaudeChatState>();

export function getPersistedClaudeChatState(sessionKey: string): PersistedClaudeChatState {
  const existing = persistedSessions.get(sessionKey);
  if (existing) {
    return existing;
  }
  const fresh: PersistedClaudeChatState = {
    providerThreadId: null,
    messages: [],
    historyMessages: [],
    isStreaming: false,
    messageIdCounter: 0,
    subagents: [],
  };
  persistedSessions.set(sessionKey, fresh);
  return fresh;
}

export function setPersistedClaudeChatState(sessionKey: string, next: PersistedClaudeChatState) {
  persistedSessions.set(sessionKey, next);
}

export function clearPersistedClaudeChatState(sessionKey: string) {
  persistedSessions.delete(sessionKey);
}
