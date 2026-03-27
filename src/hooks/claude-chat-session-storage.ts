import type { ClaudeChatHistoryMessage } from "@shared/ipc";
import type { ClaudeChatMessageItem, ClaudeChatSubagentState } from "./useClaudeChatSession";
import { createPersistedSessionStore } from "./persisted-session-storage";
import { readPersistedValue, writePersistedValue } from "../lib/persistence";

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

function claudeChatSessionStorageKey(sessionKey: string) {
  return `orxa:claudeChatSession:v1:${sessionKey}`;
}

export function getPersistedClaudeChatState(sessionKey: string): PersistedClaudeChatState {
  return persistedSessions.get(sessionKey);
}

export function setPersistedClaudeChatState(sessionKey: string, next: PersistedClaudeChatState) {
  // Preserve a legacy resume cursor until the main-process migration path
  // explicitly clears it. Otherwise opening a legacy Claude chat session can
  // erase the only persisted provider session id before the first resumed turn.
  const raw = readPersistedValue(claudeChatSessionStorageKey(sessionKey));
  persistedSessions.set(sessionKey, next);
  if (!raw) {
    return;
  }
  try {
    const parsed = JSON.parse(raw) as { providerThreadId?: unknown };
    const providerThreadId = typeof parsed.providerThreadId === "string" ? parsed.providerThreadId.trim() : "";
    if (!providerThreadId) {
      return;
    }
    writePersistedValue(
      claudeChatSessionStorageKey(sessionKey),
      JSON.stringify({ ...next, providerThreadId }),
    );
  } catch {
    // Ignore malformed legacy persistence blobs.
  }
}

export function clearPersistedClaudeChatState(sessionKey: string) {
  persistedSessions.clear(sessionKey);
}

export function resetPersistedClaudeChatStateForTests() {
  persistedSessions.resetForTests();
}
