import type { UnifiedRuntimeStoreState, UnifiedRuntimeStoreSet } from './unified-runtime-store-types'
import {
  buildOpencodeKey,
  CACHED_PROJECT_SESSIONS_KEY,
  COLLAPSED_PROJECTS_KEY,
  debouncePersist,
  hydrateProjectDataFromCache,
  persistProjectSessions,
  readCachedProjectSessions,
  readJsonRecord,
  SESSION_READ_TIMESTAMPS_KEY,
} from './unified-runtime-store-helpers'
import { writePersistedValue } from '../lib/persistence'
import { clearPersistedOpencodeState, setPersistedOpencodeState } from '../hooks/opencode-session-storage'
import type { ProjectBootstrap } from '@shared/ipc'

type UnifiedRuntimeBaseState = Pick<
  UnifiedRuntimeStoreState,
  | 'activeWorkspaceDirectory'
  | 'activeSessionID'
  | 'pendingSessionId'
  | 'activeProvider'
  | 'projectDataByDirectory'
  | 'workspaceMetaByDirectory'
  | 'opencodeSessions'
  | 'codexSessions'
  | 'claudeChatSessions'
  | 'claudeSessions'
  | 'sessionReadTimestamps'
  | 'sessionAbortRequestedAt'
  | 'collapsedProjects'
>

export function createUnifiedRuntimeBaseState(): UnifiedRuntimeBaseState {
  return {
    activeWorkspaceDirectory: undefined,
    activeSessionID: undefined,
    pendingSessionId: undefined,
    activeProvider: undefined,
    projectDataByDirectory: hydrateProjectDataFromCache(),
    workspaceMetaByDirectory: {},
    opencodeSessions: {},
    codexSessions: {},
    claudeChatSessions: {},
    claudeSessions: {},
    sessionReadTimestamps: Object.fromEntries(
      Object.entries(readJsonRecord(SESSION_READ_TIMESTAMPS_KEY)).filter(
        ([, value]) => typeof value === 'number'
      )
    ) as Record<string, number>,
    sessionAbortRequestedAt: {},
    collapsedProjects: Object.fromEntries(
      Object.entries(readJsonRecord(COLLAPSED_PROJECTS_KEY)).filter(
        ([, value]) => typeof value === 'boolean'
      )
    ) as Record<string, boolean>,
  }
}

type UnifiedRuntimeBaseActions = Pick<
  UnifiedRuntimeStoreState,
  | 'setActiveWorkspaceDirectory'
  | 'setActiveSession'
  | 'setPendingSessionId'
  | 'setProjectData'
  | 'removeProjectData'
  | 'setWorkspaceMeta'
  | 'setOpencodeMessages'
  | 'setOpencodeRuntimeSnapshot'
  | 'setOpencodeTodoItems'
  | 'removeOpencodeSession'
  | 'setCollapsedProject'
  | 'replaceCollapsedProjects'
  | 'setSessionReadAt'
  | 'clearSessionReadAt'
  | 'markSessionAbortRequestedAt'
>

function removeCachedProjectSessions(directory: string) {
  try {
    const cached = readCachedProjectSessions()
    delete cached[directory]
    writePersistedValue(CACHED_PROJECT_SESSIONS_KEY, JSON.stringify(cached))
  } catch {
    /* best-effort */
  }
}

function mergeWorkspaceMeta(
  projectMeta: Record<string, UnifiedRuntimeStoreState['workspaceMetaByDirectory'][string]>,
  directory: string,
  meta: Partial<UnifiedRuntimeStoreState['workspaceMetaByDirectory'][string]>
) {
  const existing = projectMeta[directory] ?? { lastOpenedAt: 0, lastUpdatedAt: 0 }
  return {
    ...projectMeta,
    [directory]: {
      ...existing,
      ...meta,
    },
  }
}

function updateOpencodeSessionState(
  state: UnifiedRuntimeStoreState,
  directory: string,
  sessionID: string,
  update: Partial<UnifiedRuntimeStoreState['opencodeSessions'][string]>
) {
  const key = buildOpencodeKey(directory, sessionID)
  const existing = state.opencodeSessions[key]
  return {
    ...state.opencodeSessions,
    [key]: {
      key,
      directory,
      sessionID,
      runtimeSnapshot: existing?.runtimeSnapshot ?? null,
      messages: existing?.messages ?? [],
      todoItems: existing?.todoItems ?? [],
      ...update,
    },
  }
}

export function createUnifiedRuntimeBaseActions(set: UnifiedRuntimeStoreSet): UnifiedRuntimeBaseActions {
  return {
    setActiveWorkspaceDirectory: directory => set({ activeWorkspaceDirectory: directory }),
    setActiveSession: (sessionID, provider) =>
      set({ activeSessionID: sessionID, activeProvider: provider }),
    setPendingSessionId: sessionID => set({ pendingSessionId: sessionID }),
    setProjectData: (directory, project: ProjectBootstrap) =>
      set(state => {
        persistProjectSessions(directory, project.sessions)
        return {
          projectDataByDirectory: { ...state.projectDataByDirectory, [directory]: project },
        }
      }),
    removeProjectData: directory =>
      set(state => {
        const next = { ...state.projectDataByDirectory }
        delete next[directory]
        removeCachedProjectSessions(directory)
        return { projectDataByDirectory: next }
      }),
    setWorkspaceMeta: (directory, meta) =>
      set(state => ({
        workspaceMetaByDirectory: mergeWorkspaceMeta(state.workspaceMetaByDirectory, directory, meta),
      })),
    setOpencodeMessages: (directory, sessionID, messages) =>
      set(state => {
        setPersistedOpencodeState(buildOpencodeKey(directory, sessionID), { messages })
        return {
          opencodeSessions: updateOpencodeSessionState(state, directory, sessionID, { messages }),
        }
      }),
    setOpencodeRuntimeSnapshot: (directory, sessionID, snapshot) =>
      set(state => {
        setPersistedOpencodeState(buildOpencodeKey(directory, sessionID), {
          messages: snapshot.messages,
        })
        return {
          opencodeSessions: updateOpencodeSessionState(state, directory, sessionID, {
            runtimeSnapshot: snapshot,
            messages: snapshot.messages,
          }),
        }
      }),
    setOpencodeTodoItems: (directory, sessionID, items) =>
      set(state => ({
        opencodeSessions: updateOpencodeSessionState(state, directory, sessionID, {
          todoItems: items,
        }),
      })),
    removeOpencodeSession: (directory, sessionID) =>
      set(state => {
        const key = buildOpencodeKey(directory, sessionID)
        const next = { ...state.opencodeSessions }
        delete next[key]
        clearPersistedOpencodeState(key)
        return { opencodeSessions: next }
      }),
    setCollapsedProject: (directory, collapsed) =>
      set(state => {
        const next = { ...state.collapsedProjects, [directory]: collapsed }
        debouncePersist(COLLAPSED_PROJECTS_KEY, next)
        return { collapsedProjects: next }
      }),
    replaceCollapsedProjects: next =>
      set(() => {
        debouncePersist(COLLAPSED_PROJECTS_KEY, next)
        return { collapsedProjects: next }
      }),
    setSessionReadAt: (sessionKey, timestamp) =>
      set(state => {
        const next = { ...state.sessionReadTimestamps, [sessionKey]: timestamp }
        debouncePersist(SESSION_READ_TIMESTAMPS_KEY, next)
        return { sessionReadTimestamps: next }
      }),
    clearSessionReadAt: sessionKey =>
      set(state => {
        if (!(sessionKey in state.sessionReadTimestamps)) {
          return state
        }
        const next = { ...state.sessionReadTimestamps }
        delete next[sessionKey]
        debouncePersist(SESSION_READ_TIMESTAMPS_KEY, next)
        return { sessionReadTimestamps: next }
      }),
    markSessionAbortRequestedAt: (sessionKey, timestamp) =>
      set(state => ({
        sessionAbortRequestedAt: { ...state.sessionAbortRequestedAt, [sessionKey]: timestamp },
      })),
  }
}
