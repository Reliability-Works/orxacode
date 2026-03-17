import type { CodexThread } from "@shared/ipc";
import type { CodexMessageItem } from "./useCodexSession";

export interface PersistedCodexState {
  messages: CodexMessageItem[];
  thread: CodexThread | null;
  isStreaming: boolean;
  messageIdCounter: number;
}

const persistedSessions = new Map<string, PersistedCodexState>();

export function getPersistedCodexState(directory: string): PersistedCodexState {
  const existing = persistedSessions.get(directory);
  if (existing) {
    return existing;
  }
  const fresh: PersistedCodexState = { messages: [], thread: null, isStreaming: false, messageIdCounter: 0 };
  persistedSessions.set(directory, fresh);
  return fresh;
}

export function setPersistedCodexState(directory: string, next: PersistedCodexState) {
  persistedSessions.set(directory, next);
}
