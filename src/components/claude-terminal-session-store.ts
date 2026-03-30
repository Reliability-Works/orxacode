import { readPersistedValue, writePersistedValue } from '../lib/persistence'
import { consumeClaudeStartupChunk } from '../lib/claude-terminal-startup'

export type PermissionMode = 'pending' | 'standard' | 'full'

export type PersistedSession = {
  processId: string
  storageKey: string
  directory: string
  mode: string
  outputChunks: string[]
  startupBuffer: string[]
  startupReady: boolean
  exited: boolean
  exitCode: number | null
  backgroundUnsubscribe: (() => void) | null
  listeners: Set<
    (event: { type: 'output'; chunk: string } | { type: 'closed'; exitCode: number | null }) => void
  >
}

const sessionPermissionModes = new Map<string, PermissionMode>()
export const persistedSessions = new Map<string, PersistedSession>()
const pendingSessionCreates = new Map<string, Promise<PersistedSession>>()

function getStorageKey(directory: string): string {
  return `claude-permission-mode:${directory}`
}

export function getStoredPermissionMode(directory: string): PermissionMode | null {
  try {
    const stored = readPersistedValue(getStorageKey(directory))
    if (stored === 'standard' || stored === 'full') return stored
  } catch {
    // localStorage may not be available
  }
  return null
}

export function storePermissionMode(directory: string, mode: 'standard' | 'full'): void {
  try {
    writePersistedValue(getStorageKey(directory), mode)
  } catch {
    // localStorage may not be available
  }
}

function resetClaudeTerminalPaneStateForTests() {
  sessionPermissionModes.clear()
  pendingSessionCreates.clear()
  persistedSessions.forEach(session => {
    session.backgroundUnsubscribe?.()
  })
  persistedSessions.clear()
}

if (typeof globalThis !== 'undefined') {
  ;(
    globalThis as typeof globalThis & {
      __resetClaudeTerminalPaneStateForTests?: () => void
    }
  ).__resetClaudeTerminalPaneStateForTests = resetClaudeTerminalPaneStateForTests
}

export function getSessionPermissionMode(sessionStorageKey: string) {
  return sessionPermissionModes.get(sessionStorageKey)
}

export function setSessionPermissionMode(sessionStorageKey: string, mode: Exclude<PermissionMode, 'pending'>) {
  sessionPermissionModes.set(sessionStorageKey, mode)
}

export function sessionKey(sessionStorageKey: string, mode: string, tabId?: string): string {
  if (tabId) return `${sessionStorageKey}::${mode}::${tabId}`
  return `${sessionStorageKey}::${mode}`
}

export function clearPendingClaudeSessionCreate(storageKey: string) {
  pendingSessionCreates.delete(storageKey)
}

export async function getOrCreateClaudeSession(
  storageKey: string,
  directory: string,
  mode: 'standard' | 'full',
  cols: number,
  rows: number
) {
  const existing = persistedSessions.get(storageKey)
  if (existing && !existing.exited) {
    return existing
  }
  if (existing?.backgroundUnsubscribe) {
    existing.backgroundUnsubscribe()
  }
  if (existing) {
    persistedSessions.delete(storageKey)
  }

  const pending = pendingSessionCreates.get(storageKey)
  if (pending) {
    return pending
  }
  if (!window.orxa?.claudeTerminal) {
    throw new Error('Claude terminal bridge not available')
  }

  const createPromise = window.orxa.claudeTerminal
    .create(directory, mode, cols, rows)
    .then(async result => {
      const envPrefix = 'env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY'
      const claudeCmd = mode === 'full' ? 'claude --dangerously-skip-permissions' : 'claude'
      const session: PersistedSession = {
        processId: result.processId,
        storageKey,
        directory,
        mode,
        outputChunks: [],
        startupBuffer: [],
        startupReady: false,
        exited: false,
        exitCode: null,
        backgroundUnsubscribe: null,
        listeners: new Set(),
      }

      if (window.orxa?.events) {
        session.backgroundUnsubscribe = window.orxa.events.subscribe(event => {
          if (
            event.type === 'pty.output' &&
            event.payload.ptyID === session.processId &&
            event.payload.directory === directory
          ) {
            const next = consumeClaudeStartupChunk(
              session.startupBuffer,
              event.payload.chunk as string,
              session.startupReady
            )
            session.startupReady = next.startupReady
            session.startupBuffer = next.startupBuffer
            const displayChunk = next.displayChunk
            if (displayChunk) {
              session.outputChunks.push(displayChunk)
              session.listeners.forEach(listener => listener({ type: 'output', chunk: displayChunk }))
            }
          }
          if (
            event.type === 'pty.closed' &&
            event.payload.ptyID === session.processId &&
            event.payload.directory === directory
          ) {
            session.exited = true
            session.exitCode = null
            session.listeners.forEach(listener => listener({ type: 'closed', exitCode: session.exitCode }))
          }
        })
      }

      await window.orxa.claudeTerminal.write(result.processId, `exec ${envPrefix} ${claudeCmd}\n`)
      persistedSessions.set(storageKey, session)
      pendingSessionCreates.delete(storageKey)
      return session
    })
    .catch(error => {
      pendingSessionCreates.delete(storageKey)
      throw error
    })

  pendingSessionCreates.set(storageKey, createPromise)
  return createPromise
}
