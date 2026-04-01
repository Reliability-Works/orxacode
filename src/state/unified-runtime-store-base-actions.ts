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
  | 'workspaceRootByDirectory'
  | 'worktreesByWorkspace'
  | 'selectedWorktreeByWorkspace'
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
    workspaceRootByDirectory: {},
    worktreesByWorkspace: {},
    selectedWorktreeByWorkspace: {},
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
  | 'replaceWorkspaceDirectoryAssociations'
  | 'setWorkspaceRootForDirectory'
  | 'setWorkspaceWorktrees'
  | 'setSelectedWorkspaceWorktree'
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

type UnifiedRuntimeProjectActions = Pick<
  UnifiedRuntimeBaseActions,
  | 'setActiveWorkspaceDirectory'
  | 'setActiveSession'
  | 'setPendingSessionId'
  | 'setProjectData'
  | 'removeProjectData'
  | 'replaceWorkspaceDirectoryAssociations'
  | 'setWorkspaceRootForDirectory'
  | 'setWorkspaceWorktrees'
  | 'setSelectedWorkspaceWorktree'
  | 'setWorkspaceMeta'
>

type UnifiedRuntimeOpencodeActions = Pick<
  UnifiedRuntimeBaseActions,
  | 'setOpencodeMessages'
  | 'setOpencodeRuntimeSnapshot'
  | 'setOpencodeTodoItems'
  | 'removeOpencodeSession'
>

type UnifiedRuntimeUiActions = Pick<
  UnifiedRuntimeBaseActions,
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

function mergeWorkspaceDirectoryAssociations(
  current: Record<string, string>,
  workspaceRoot: string,
  directories: string[]
) {
  const next = { ...current }
  for (const [directory, root] of Object.entries(next)) {
    if (root === workspaceRoot && !directories.includes(directory)) {
      delete next[directory]
    }
  }
  for (const directory of directories) {
    next[directory] = workspaceRoot
  }
  return next
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
    ...createUnifiedRuntimeProjectActions(set),
    ...createUnifiedRuntimeOpencodeActions(set),
    ...createUnifiedRuntimeUiActions(set),
  }
}

function createUnifiedRuntimeProjectActions(
  set: UnifiedRuntimeStoreSet
): UnifiedRuntimeProjectActions {
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
    replaceWorkspaceDirectoryAssociations: (workspaceRoot, directories) =>
      set(state => ({
        workspaceRootByDirectory: mergeWorkspaceDirectoryAssociations(
          state.workspaceRootByDirectory,
          workspaceRoot,
          directories
        ),
      })),
    setWorkspaceRootForDirectory: (directory, workspaceRoot) =>
      set(state => {
        const next = { ...state.workspaceRootByDirectory }
        if (!workspaceRoot) {
          delete next[directory]
        } else {
          next[directory] = workspaceRoot
        }
        return { workspaceRootByDirectory: next }
      }),
    setWorkspaceWorktrees: (workspaceRoot, worktrees) =>
      set(state => ({
        worktreesByWorkspace: { ...state.worktreesByWorkspace, [workspaceRoot]: worktrees },
      })),
    setSelectedWorkspaceWorktree: (workspaceRoot, directory) =>
      set(state => {
        const next = { ...state.selectedWorktreeByWorkspace }
        if (!directory) {
          delete next[workspaceRoot]
        } else {
          next[workspaceRoot] = directory
        }
        return { selectedWorktreeByWorkspace: next }
      }),
    setWorkspaceMeta: (directory, meta) =>
      set(state => ({
        workspaceMetaByDirectory: mergeWorkspaceMeta(
          state.workspaceMetaByDirectory,
          directory,
          meta
        ),
      })),
  }
}

function createUnifiedRuntimeOpencodeActions(
  set: UnifiedRuntimeStoreSet
): UnifiedRuntimeOpencodeActions {
  return {
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
  }
}

function createUnifiedRuntimeUiActions(
  set: UnifiedRuntimeStoreSet
): UnifiedRuntimeUiActions {
  return {
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
