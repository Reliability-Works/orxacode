import type { SessionMessageBundle } from '@shared/ipc'
import { createPersistedSessionStore } from './persisted-session-storage'

export interface PersistedOpencodeState {
  messages: SessionMessageBundle[]
}

const persistedSessions = createPersistedSessionStore<PersistedOpencodeState>({
  storagePrefix: 'orxa:opencodeSession:v1',
  createDefault: () => ({ messages: [] }),
})

export function getPersistedOpencodeState(sessionKey: string): PersistedOpencodeState {
  // Check pending (debounced) writes first — they're more recent than what's on disk
  const pending = pendingWrites.get(sessionKey)
  if (pending) return pending
  return persistedSessions.get(sessionKey)
}

const persistTimers: Record<string, number> = {}
const pendingWrites = new Map<string, PersistedOpencodeState>()

/**
 * Debounced persistence write. During streaming, snapshot updates fire on every
 * delta — writing synchronously to SQLite on each would block the main thread.
 * We debounce at 500ms so writes batch up during active streaming but still
 * persist promptly once the turn slows down or completes.
 */
export function setPersistedOpencodeState(sessionKey: string, next: PersistedOpencodeState) {
  pendingWrites.set(sessionKey, next)
  if (typeof window === 'undefined') {
    persistedSessions.set(sessionKey, next)
    return
  }
  window.clearTimeout(persistTimers[sessionKey])
  persistTimers[sessionKey] = window.setTimeout(() => {
    const latest = pendingWrites.get(sessionKey)
    if (latest) {
      persistedSessions.set(sessionKey, latest)
      pendingWrites.delete(sessionKey)
    }
  }, 500)
}

export function clearPersistedOpencodeState(sessionKey: string) {
  persistedSessions.clear(sessionKey)
}

/**
 * Merge messages from the server with locally persisted messages.
 * Server messages are authoritative for messages it returns, but local
 * persistence may contain more recent messages that the server hasn't
 * flushed yet. We merge by ID, preferring server versions for duplicates,
 * and keeping any local-only messages that the server didn't return.
 */
export function mergeOpencodeMessages(
  serverMessages: SessionMessageBundle[],
  persistedMessages: SessionMessageBundle[]
): SessionMessageBundle[] {
  if (persistedMessages.length === 0) return serverMessages
  if (serverMessages.length === 0) return persistedMessages

  const serverIds = new Set(serverMessages.map(m => m.info.id))
  // Keep any persisted messages the server didn't return (local-only / recent)
  const localOnly = persistedMessages.filter(m => !serverIds.has(m.info.id))

  if (localOnly.length === 0) return serverMessages

  // Merge and sort by creation time
  const merged = [...serverMessages, ...localOnly]
  merged.sort((a, b) => {
    const timeA =
      typeof a.info.time.created === 'string'
        ? new Date(a.info.time.created).getTime()
        : a.info.time.created
    const timeB =
      typeof b.info.time.created === 'string'
        ? new Date(b.info.time.created).getTime()
        : b.info.time.created
    return timeA - timeB
  })
  return merged
}

export function resetPersistedOpencodeStateForTests() {
  persistedSessions.resetForTests()
}
