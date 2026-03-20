import type { CodexThread } from "@shared/ipc";
import type { CodexMessageItem } from "./useCodexSession";

export interface PersistedCodexState {
  messages: CodexMessageItem[];
  thread: CodexThread | null;
  isStreaming: boolean;
  messageIdCounter: number;
}

const persistedSessions = new Map<string, PersistedCodexState>();

export function getPersistedCodexState(sessionKey: string): PersistedCodexState {
  const existing = persistedSessions.get(sessionKey);
  if (existing) {
    return existing;
  }
  const fresh: PersistedCodexState = { messages: [], thread: null, isStreaming: false, messageIdCounter: 0 };
  persistedSessions.set(sessionKey, fresh);
  return fresh;
}

export function setPersistedCodexState(sessionKey: string, next: PersistedCodexState) {
  persistedSessions.set(sessionKey, next);
}

export function clearPersistedCodexState(sessionKey: string) {
  persistedSessions.delete(sessionKey);
}
