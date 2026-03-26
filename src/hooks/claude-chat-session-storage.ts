import type { ClaudeChatHistoryMessage } from "@shared/ipc";
import type { ClaudeChatMessageItem, ClaudeChatSubagentState } from "./useClaudeChatSession";
import { createPersistedSessionStore } from "./persisted-session-storage";

export interface PersistedClaudeChatState {
  messages: ClaudeChatMessageItem[];
  historyMessages: ClaudeChatHistoryMessage[];
  isStreaming: boolean;
  messageIdCounter: number;
  subagents: ClaudeChatSubagentState[];
}

const persistedSessions = createPersistedSessionStore<PersistedClaudeChatState>({
  storagePrefix: "orxa:claudeChatSession:v1",
  createDefault: () => ({
    messages: [],
    historyMessages: [],
    isStreaming: false,
    messageIdCounter: 0,
    subagents: [],
  }),
  hydrate: (value) => ({
    messages: Array.isArray(value.messages) ? value.messages : [],
    historyMessages: Array.isArray(value.historyMessages) ? value.historyMessages : [],
    isStreaming: false,
    messageIdCounter: typeof value.messageIdCounter === "number" ? value.messageIdCounter : 0,
    subagents: Array.isArray(value.subagents) ? value.subagents : [],
  }),
});

export function getPersistedClaudeChatState(sessionKey: string): PersistedClaudeChatState {
  return persistedSessions.get(sessionKey);
}

export function setPersistedClaudeChatState(sessionKey: string, next: PersistedClaudeChatState) {
  persistedSessions.set(sessionKey, next);
}

export function clearPersistedClaudeChatState(sessionKey: string) {
  persistedSessions.clear(sessionKey);
}

export function resetPersistedClaudeChatStateForTests() {
  persistedSessions.resetForTests();
}
