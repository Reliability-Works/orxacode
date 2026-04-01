import type { CodexThread } from '@shared/ipc'
import type { CodexMessageItem } from './codex-session-types'
import { createPersistedSessionStore } from './persisted-session-storage'

export interface PersistedCodexState {
  messages: CodexMessageItem[]
  thread: CodexThread | null
  isStreaming: boolean
  messageIdCounter: number
}

const persistedSessions = createPersistedSessionStore<PersistedCodexState>({
  storagePrefix: 'orxa:codexSession:v1',
  createDefault: () => ({ messages: [], thread: null, isStreaming: false, messageIdCounter: 0 }),
  hydrate: value => ({ ...value, isStreaming: false }),
})

export function getPersistedCodexState(sessionKey: string): PersistedCodexState {
  return persistedSessions.get(sessionKey)
}

export function setPersistedCodexState(sessionKey: string, next: PersistedCodexState) {
  persistedSessions.set(sessionKey, next)
}

export function clearPersistedCodexState(sessionKey: string) {
  persistedSessions.clear(sessionKey)
}

export function resetPersistedCodexStateForTests() {
  persistedSessions.resetForTests()
}
