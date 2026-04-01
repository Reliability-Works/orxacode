import type { ProjectBootstrap } from '@shared/ipc'
import { makeUnifiedSessionKey, type UnifiedClaudeChatSessionRuntime } from './unified-runtime'
import { readPersistedValue, writePersistedValue } from '../lib/persistence'
import type {
  CachedSessionEntry,
  UnifiedClaudeSessionRuntime,
  UnifiedRuntimeStoreState,
} from './unified-runtime-store-types'
import type { UnifiedTurnTokenSample } from './unified-runtime'

export const SESSION_READ_TIMESTAMPS_KEY = 'orxa:sessionReadTimestamps:v2'
export const COLLAPSED_PROJECTS_KEY = 'orxa:collapsedProjects:v1'
export const CACHED_PROJECT_SESSIONS_KEY = 'orxa:cachedProjectSessions:v1'

export function readCachedProjectSessions(): Record<string, CachedSessionEntry[]> {
  try {
    const raw = readPersistedValue(CACHED_PROJECT_SESSIONS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, CachedSessionEntry[]>)
      : {}
  } catch {
    return {}
  }
}

export function persistProjectSessions(
  directory: string,
  sessions: Array<{
    id: string
    title?: string
    slug: string
    time: { created: number; updated: number; archived?: number }
  }>
) {
  try {
    const existing = readCachedProjectSessions()
    const lightweight = sessions.map(session => ({
      id: session.id,
      title: session.title,
      slug: session.slug,
      time: {
        created: session.time.created,
        updated: session.time.updated,
        archived: session.time.archived,
      },
    }))
    existing[directory] = lightweight
    writePersistedValue(CACHED_PROJECT_SESSIONS_KEY, JSON.stringify(existing))
  } catch {
    // Best-effort persistence only.
  }
}

export function hydrateProjectDataFromCache(): Record<string, ProjectBootstrap> {
  const cached = readCachedProjectSessions()
  const result: Record<string, ProjectBootstrap> = {}
  for (const [directory, sessions] of Object.entries(cached)) {
    if (!sessions || sessions.length === 0) continue
    result[directory] = {
      directory,
      path: { cwd: directory } as unknown as ProjectBootstrap['path'],
      sessions: sessions as unknown as ProjectBootstrap['sessions'],
      sessionStatus: {},
      providers: { providers: [] } as unknown as ProjectBootstrap['providers'],
      agents: [],
      config: {} as unknown as ProjectBootstrap['config'],
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    }
  }
  return result
}

export function readJsonRecord(key: string) {
  if (typeof window === 'undefined') {
    return {}
  }
  try {
    const raw = readPersistedValue(key)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function debouncePersist(key: string, value: Record<string, unknown>) {
  if (typeof window === 'undefined') {
    return
  }
  window.clearTimeout(
    (debouncePersist as unknown as { timers?: Record<string, number> }).timers?.[key]
  )
  const timers = ((debouncePersist as unknown as { timers?: Record<string, number> }).timers ??= {})
  timers[key] = window.setTimeout(() => {
    try {
      writePersistedValue(key, JSON.stringify(value))
    } catch {
      // Ignore storage failures.
    }
  }, 220)
}

export function buildOpencodeKey(directory: string, sessionID: string) {
  return makeUnifiedSessionKey('opencode', directory, sessionID)
}

export function ensureCodexSession(
  state: UnifiedRuntimeStoreState,
  sessionKey: string,
  directory = ''
) {
  const existing = state.codexSessions[sessionKey]
  if (existing) {
    return existing
  }
  return {
    key: sessionKey,
    directory,
    connectionStatus: 'disconnected',
    thread: null,
    runtimeSnapshot: null,
    messages: [],
    pendingApproval: null,
    pendingUserInput: null,
    isStreaming: false,
    planItems: [],
    observedTokenTotal: 0,
    turnTokenTotals: [],
    dismissedPlanIds: [],
    subagents: [],
    activeSubagentThreadId: null,
  } satisfies UnifiedRuntimeStoreState['codexSessions'][string]
}

export function ensureClaudeSession(
  state: UnifiedRuntimeStoreState,
  sessionKey: string,
  directory = ''
): UnifiedClaudeSessionRuntime {
  const existing = state.claudeSessions[sessionKey]
  if (existing) {
    return existing
  }
  return {
    key: sessionKey,
    directory,
    busy: false,
    awaiting: false,
    activityAt: 0,
  }
}

export function ensureClaudeChatSession(
  state: UnifiedRuntimeStoreState,
  sessionKey: string,
  directory = ''
): UnifiedClaudeChatSessionRuntime {
  const existing = state.claudeChatSessions[sessionKey]
  if (existing) {
    return existing
  }
  return {
    key: sessionKey,
    directory,
    connectionStatus: 'disconnected',
    providerThreadId: null,
    activeTurnId: null,
    messages: [],
    historyMessages: [],
    pendingApproval: null,
    pendingUserInput: null,
    isStreaming: false,
    lastError: undefined,
    observedTokenTotal: 0,
    turnTokenTotals: [],
    subagents: [],
  }
}

export function upsertTurnTokenSample(
  samples: UnifiedTurnTokenSample[],
  turnId: string,
  total: number,
  timestamp: number
) {
  const normalizedTurnId = turnId.trim()
  if (!normalizedTurnId || !Number.isFinite(total) || total <= 0) {
    return {
      samples,
      observedTokenTotal: samples.reduce((sum, sample) => sum + sample.total, 0),
    }
  }

  const nextSamples = [...samples]
  const existingIndex = nextSamples.findIndex(sample => sample.turnId === normalizedTurnId)
  if (existingIndex >= 0) {
    nextSamples[existingIndex] = {
      turnId: normalizedTurnId,
      total,
      timestamp,
    }
  } else {
    nextSamples.push({
      turnId: normalizedTurnId,
      total,
      timestamp,
    })
  }
  nextSamples.sort((left, right) => left.timestamp - right.timestamp)
  return {
    samples: nextSamples,
    observedTokenTotal: nextSamples.reduce((sum, sample) => sum + sample.total, 0),
  }
}
