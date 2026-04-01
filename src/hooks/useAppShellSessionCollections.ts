import { useCallback, useMemo } from 'react'
import type { ProjectBootstrap } from '@shared/ipc'
import { selectSidebarSessionPresentation, useUnifiedRuntimeStore } from '../state/unified-runtime-store'
import type { BackgroundSessionDescriptor } from '../lib/background-session-descriptors'

type SessionListEntry = {
  id: string
  title?: string
  slug: string
  time: { created: number; updated: number }
}

export type WorkspaceDetailSessionEntry = SessionListEntry & {
  directory: string
}

type UseAppShellSessionCollectionsInput = {
  projectData?: ProjectBootstrap
  projectDataByDirectory: Record<string, ProjectBootstrap>
  activeProjectDir?: string
  activeSessionID?: string
  projectCacheVersion: number
  pinnedSessions: Record<string, string[]>
  archivedBackgroundAgentIds: Record<string, string[]>
  hiddenBackgroundSessionIdsByProject: Record<string, string[]>
  backgroundSessionDescriptors: BackgroundSessionDescriptor[]
  getSessionType: (sessionID: string, directory?: string) => string | undefined
  normalizePresentationProvider: (
    sessionType: string | undefined
  ) => 'opencode' | 'codex' | 'claude' | 'claude-chat' | undefined
}

function extractBackgroundSessionID(descriptor: BackgroundSessionDescriptor) {
  if (descriptor.sessionID) {
    return descriptor.sessionID
  }
  const sessionStorageKey = descriptor.sessionStorageKey
  if (!sessionStorageKey || !sessionStorageKey.includes('::')) {
    return undefined
  }
  return sessionStorageKey.split('::').at(-1)
}

function buildLiveBackgroundSessionIDsByProject(
  backgroundSessionDescriptors: BackgroundSessionDescriptor[]
) {
  const next: Record<string, string[]> = {}
  for (const descriptor of backgroundSessionDescriptors) {
    const sessionID = extractBackgroundSessionID(descriptor)
    if (!sessionID) {
      continue
    }
    const hiddenIds = new Set(next[descriptor.directory] ?? [])
    hiddenIds.add(sessionID)
    next[descriptor.directory] = [...hiddenIds]
  }
  return next
}

function mergeHiddenSessionIDsByProject({
  archivedBackgroundAgentIds,
  hiddenBackgroundSessionIdsByProject,
  liveBackgroundSessionIDsByProject,
}: {
  archivedBackgroundAgentIds: Record<string, string[]>
  hiddenBackgroundSessionIdsByProject: Record<string, string[]>
  liveBackgroundSessionIDsByProject: Record<string, string[]>
}) {
  const projects = new Set([
    ...Object.keys(archivedBackgroundAgentIds),
    ...Object.keys(hiddenBackgroundSessionIdsByProject),
    ...Object.keys(liveBackgroundSessionIDsByProject),
  ])
  const next: Record<string, string[]> = {}
  for (const directory of projects) {
    const ids = new Set([
      ...(archivedBackgroundAgentIds[directory] ?? []),
      ...(hiddenBackgroundSessionIdsByProject[directory] ?? []),
      ...(liveBackgroundSessionIDsByProject[directory] ?? []),
    ])
    next[directory] = [...ids]
  }
  return next
}

function resolveWorkspaceRoot(
  directory: string,
  workspaceRootByDirectory: Record<string, string>
) {
  return workspaceRootByDirectory[directory] ?? directory
}

function mergeProjectsForSessionCollections(
  projectData: ProjectBootstrap | undefined,
  projectDataByDirectory: Record<string, ProjectBootstrap>
) {
  const merged = { ...projectDataByDirectory }
  if (projectData?.directory) {
    merged[projectData.directory] = projectData
  }
  return merged
}

function sortWorkspaceSessionEntries(
  entries: WorkspaceDetailSessionEntry[],
  activeProjectDir: string | undefined
) {
  return [...entries].sort((left, right) => {
    if (left.directory !== right.directory) {
      if (left.directory === activeProjectDir) return -1
      if (right.directory === activeProjectDir) return 1
    }
    return right.time.updated - left.time.updated
  })
}

function upsertWorkspaceSessionEntry({
  entriesBySessionId,
  session,
  directory,
  workspaceRoot,
}: {
  entriesBySessionId: Map<string, WorkspaceDetailSessionEntry>
  session: {
    id: string
    title?: string
    slug: string
    time: { created: number; updated: number }
    directory?: string
  }
  directory: string
  workspaceRoot: string
}) {
  const resolvedDirectory = session.directory ?? directory
  const nextEntry: WorkspaceDetailSessionEntry = {
    id: session.id,
    title: session.title,
    slug: session.slug,
    time: session.time,
    directory: resolvedDirectory,
  }
  const existing = entriesBySessionId.get(session.id)
  if (!existing) {
    entriesBySessionId.set(session.id, nextEntry)
    return
  }

  const preferNextDirectory =
    existing.directory === workspaceRoot && resolvedDirectory !== workspaceRoot
  const preferNextTimestamp = nextEntry.time.updated >= existing.time.updated
  if (preferNextDirectory || preferNextTimestamp) {
    entriesBySessionId.set(session.id, nextEntry)
  }
}

function buildSidebarSessionsByRoot({
  activeProjectDir,
  hiddenSessionIDsByProject,
  projectData,
  projectDataByDirectory,
  workspaceRootByDirectory,
}: {
  activeProjectDir?: string
  hiddenSessionIDsByProject: Record<string, string[]>
  projectData?: ProjectBootstrap
  projectDataByDirectory: Record<string, ProjectBootstrap>
  workspaceRootByDirectory: Record<string, string>
}) {
  const mergedProjects = mergeProjectsForSessionCollections(projectData, projectDataByDirectory)
  const sessionsByRoot = new Map<string, Map<string, WorkspaceDetailSessionEntry>>()
  for (const [directory, data] of Object.entries(mergedProjects)) {
    const workspaceRoot = resolveWorkspaceRoot(directory, workspaceRootByDirectory)
    const hiddenSessionIDs = new Set(hiddenSessionIDsByProject[directory] ?? [])
    const entriesBySessionId =
      sessionsByRoot.get(workspaceRoot) ?? new Map<string, WorkspaceDetailSessionEntry>()
    for (const session of data.sessions.filter(
      session => !session.time.archived && !hiddenSessionIDs.has(session.id)
    )) {
      upsertWorkspaceSessionEntry({
        entriesBySessionId,
        session,
        directory,
        workspaceRoot,
      })
    }
    sessionsByRoot.set(workspaceRoot, entriesBySessionId)
  }
  return Object.fromEntries(
    [...sessionsByRoot.entries()].map(([workspaceRoot, entriesBySessionId]) => [
      workspaceRoot,
      sortWorkspaceSessionEntries([...entriesBySessionId.values()], activeProjectDir),
    ])
  )
}

function buildHiddenSessionIDsByRoot({
  hiddenSessionIDsByProject,
  projectData,
  projectDataByDirectory,
  workspaceRootByDirectory,
}: {
  hiddenSessionIDsByProject: Record<string, string[]>
  projectData?: ProjectBootstrap
  projectDataByDirectory: Record<string, ProjectBootstrap>
  workspaceRootByDirectory: Record<string, string>
}) {
  const mergedProjects = mergeProjectsForSessionCollections(projectData, projectDataByDirectory)
  const next: Record<string, string[]> = {}
  for (const directory of Object.keys(mergedProjects)) {
    const workspaceRoot = resolveWorkspaceRoot(directory, workspaceRootByDirectory)
    const ids = new Set([...(next[workspaceRoot] ?? []), ...(hiddenSessionIDsByProject[directory] ?? [])])
    next[workspaceRoot] = [...ids]
  }
  return next
}

function buildWorkspaceDetailSessions({
  activeProjectDir,
  hiddenSessionIDsByProject,
  projectData,
  projectDataByDirectory,
  workspaceDetailDirectory,
  workspaceRootByDirectory,
}: {
  activeProjectDir?: string
  hiddenSessionIDsByProject: Record<string, string[]>
  projectData?: ProjectBootstrap
  projectDataByDirectory: Record<string, ProjectBootstrap>
  workspaceDetailDirectory?: string
  workspaceRootByDirectory: Record<string, string>
}) {
  if (!workspaceDetailDirectory) {
    return []
  }
  const mergedProjects = mergeProjectsForSessionCollections(projectData, projectDataByDirectory)
  const entriesBySessionId = new Map<string, WorkspaceDetailSessionEntry>()
  for (const [directory, data] of Object.entries(mergedProjects)) {
    const resolvedWorkspaceRoot = resolveWorkspaceRoot(directory, workspaceRootByDirectory)
    if (resolvedWorkspaceRoot !== workspaceDetailDirectory) {
      continue
    }
    const hiddenSessionIDs = new Set(hiddenSessionIDsByProject[directory] ?? [])
    for (const session of data.sessions.filter(
      session => !session.time.archived && !hiddenSessionIDs.has(session.id)
    )) {
      upsertWorkspaceSessionEntry({
        entriesBySessionId,
        session,
        directory,
        workspaceRoot: resolvedWorkspaceRoot,
      })
    }
  }
  return sortWorkspaceSessionEntries([...entriesBySessionId.values()], activeProjectDir)
}

function useSidebarSessionIndicators({
  activeProjectDir,
  activeSessionID,
  claudeChatSessions,
  claudeSessions,
  codexSessions,
  getSessionType,
  normalizePresentationProvider,
  opencodeSessions,
  sessionReadTimestamps,
  storeProjects,
}: {
  activeProjectDir?: string
  activeSessionID?: string
  claudeChatSessions: ReturnType<typeof useUnifiedRuntimeStore.getState>['claudeChatSessions']
  claudeSessions: ReturnType<typeof useUnifiedRuntimeStore.getState>['claudeSessions']
  codexSessions: ReturnType<typeof useUnifiedRuntimeStore.getState>['codexSessions']
  getSessionType: (sessionID: string, directory?: string) => string | undefined
  normalizePresentationProvider: (
    sessionType: string | undefined
  ) => 'opencode' | 'codex' | 'claude' | 'claude-chat' | undefined
  opencodeSessions: ReturnType<typeof useUnifiedRuntimeStore.getState>['opencodeSessions']
  sessionReadTimestamps: ReturnType<typeof useUnifiedRuntimeStore.getState>['sessionReadTimestamps']
  storeProjects: ReturnType<typeof useUnifiedRuntimeStore.getState>['projectDataByDirectory']
}) {
  const getSessionStatusType = useCallback(
    (sessionID: string, directory?: string) => {
      void opencodeSessions
      void codexSessions
      void claudeChatSessions
      void claudeSessions
      void sessionReadTimestamps
      void storeProjects
      if (!directory) {
        return 'idle'
      }
      const sessionType = getSessionType(sessionID, directory)
      const provider = normalizePresentationProvider(sessionType)
      if (!provider) {
        return 'idle'
      }
      return selectSidebarSessionPresentation({
        provider,
        directory,
        sessionID,
        updatedAt: 0,
        isActive: activeProjectDir === directory && activeSessionID === sessionID,
        sessionKey: `${directory}::${sessionID}`,
      }).statusType
    },
    [
      activeProjectDir,
      activeSessionID,
      claudeChatSessions,
      claudeSessions,
      codexSessions,
      getSessionType,
      normalizePresentationProvider,
      opencodeSessions,
      sessionReadTimestamps,
      storeProjects,
    ]
  )

  const getSessionIndicator = useCallback(
    (sessionID: string, directory: string, updatedAt: number) => {
      void opencodeSessions
      void codexSessions
      void claudeChatSessions
      void claudeSessions
      void sessionReadTimestamps
      void storeProjects
      const sessionType = getSessionType(sessionID, directory)
      const provider = normalizePresentationProvider(sessionType)
      if (!provider) {
        return 'none' as const
      }
      return selectSidebarSessionPresentation({
        provider,
        directory,
        sessionID,
        updatedAt,
        isActive: activeProjectDir === directory && activeSessionID === sessionID,
        sessionKey: `${directory}::${sessionID}`,
      }).indicator
    },
    [
      activeProjectDir,
      activeSessionID,
      claudeChatSessions,
      claudeSessions,
      codexSessions,
      getSessionType,
      normalizePresentationProvider,
      opencodeSessions,
      sessionReadTimestamps,
      storeProjects,
    ]
  )

  return { getSessionIndicator, getSessionStatusType }
}

function useDerivedSessionCollections({
  activeProjectDir,
  hiddenSessionIDsByProject,
  pinnedSessions,
  projectCacheVersion,
  projectData,
  projectDataByDirectory,
  workspaceRootByDirectory,
}: {
  activeProjectDir?: string
  hiddenSessionIDsByProject: Record<string, string[]>
  pinnedSessions: Record<string, string[]>
  projectCacheVersion: number
  projectData?: ProjectBootstrap
  projectDataByDirectory: Record<string, ProjectBootstrap>
  workspaceRootByDirectory: Record<string, string>
}) {
  const sidebarSessionsByRoot = useMemo(
    () =>
      buildSidebarSessionsByRoot({
        activeProjectDir,
        hiddenSessionIDsByProject,
        projectData,
        projectDataByDirectory,
        workspaceRootByDirectory,
      }),
    [
      activeProjectDir,
      hiddenSessionIDsByProject,
      projectData,
      projectDataByDirectory,
      workspaceRootByDirectory,
    ]
  )

  const hiddenSessionIDsBySidebarProject = useMemo(
    () =>
      buildHiddenSessionIDsByRoot({
        hiddenSessionIDsByProject,
        projectData,
        projectDataByDirectory,
        workspaceRootByDirectory,
      }),
    [hiddenSessionIDsByProject, projectData, projectDataByDirectory, workspaceRootByDirectory]
  )

  const sessions = useMemo(() => {
    const activeWorkspaceRoot = activeProjectDir
      ? resolveWorkspaceRoot(activeProjectDir, workspaceRootByDirectory)
      : undefined
    if (!activeWorkspaceRoot) {
      return []
    }
    const pinned = new Set(pinnedSessions[activeWorkspaceRoot] ?? [])
    return [...(sidebarSessionsByRoot[activeWorkspaceRoot] ?? [])].sort((a, b) => {
      const aPinned = pinned.has(a.id) ? 1 : 0
      const bPinned = pinned.has(b.id) ? 1 : 0
      if (aPinned !== bPinned) {
        return bPinned - aPinned
      }
      return b.time.updated - a.time.updated
    })
  }, [activeProjectDir, pinnedSessions, sidebarSessionsByRoot, workspaceRootByDirectory])

  const cachedSessionsByProject = useMemo(() => {
    void projectCacheVersion
    return sidebarSessionsByRoot
  }, [projectCacheVersion, sidebarSessionsByRoot])

  const workspaceDetailDirectory = useMemo(() => {
    if (!activeProjectDir) {
      return undefined
    }
    return workspaceRootByDirectory[activeProjectDir] ?? activeProjectDir
  }, [activeProjectDir, workspaceRootByDirectory])

  const workspaceDetailSessions = useMemo(
    () =>
      buildWorkspaceDetailSessions({
        activeProjectDir,
        hiddenSessionIDsByProject,
        projectData,
        projectDataByDirectory,
        workspaceDetailDirectory,
        workspaceRootByDirectory,
      }),
    [
      activeProjectDir,
      hiddenSessionIDsByProject,
      projectData,
      projectDataByDirectory,
      workspaceDetailDirectory,
      workspaceRootByDirectory,
    ]
  )

  return {
    cachedSessionsByProject,
    hiddenSessionIDsBySidebarProject,
    sessions,
    workspaceDetailDirectory,
    workspaceDetailSessions,
  }
}

export function useAppShellSessionCollections({
  projectData, projectDataByDirectory, activeProjectDir, activeSessionID, projectCacheVersion,
  pinnedSessions, archivedBackgroundAgentIds, hiddenBackgroundSessionIdsByProject,
  backgroundSessionDescriptors, getSessionType, normalizePresentationProvider,
}: UseAppShellSessionCollectionsInput) {
  const opencodeSessions = useUnifiedRuntimeStore(state => state.opencodeSessions), codexSessions = useUnifiedRuntimeStore(state => state.codexSessions), claudeChatSessions = useUnifiedRuntimeStore(state => state.claudeChatSessions)
  const claudeSessions = useUnifiedRuntimeStore(state => state.claudeSessions)
  const workspaceRootByDirectory = useUnifiedRuntimeStore(state => state.workspaceRootByDirectory)
  const sessionReadTimestamps = useUnifiedRuntimeStore(state => state.sessionReadTimestamps), storeProjects = useUnifiedRuntimeStore(state => state.projectDataByDirectory)

  const liveBackgroundSessionIDsByProject = useMemo(() => {
    return buildLiveBackgroundSessionIDsByProject(backgroundSessionDescriptors)
  }, [backgroundSessionDescriptors])

  const hiddenSessionIDsByProject = useMemo(() => {
    return mergeHiddenSessionIDsByProject({
      archivedBackgroundAgentIds,
      hiddenBackgroundSessionIdsByProject,
      liveBackgroundSessionIDsByProject,
    })
  }, [
    archivedBackgroundAgentIds,
    hiddenBackgroundSessionIdsByProject,
      liveBackgroundSessionIDsByProject,
    ])
  const {
    sessions,
    cachedSessionsByProject,
    hiddenSessionIDsBySidebarProject,
    workspaceDetailDirectory,
    workspaceDetailSessions,
  } = useDerivedSessionCollections({
    activeProjectDir,
    hiddenSessionIDsByProject,
    pinnedSessions,
    projectCacheVersion,
    projectData,
    projectDataByDirectory,
    workspaceRootByDirectory,
  })

  const { getSessionIndicator, getSessionStatusType } = useSidebarSessionIndicators({
    activeProjectDir,
    activeSessionID,
    claudeChatSessions,
    claudeSessions,
    codexSessions,
    getSessionType,
    normalizePresentationProvider,
    opencodeSessions,
    sessionReadTimestamps,
    storeProjects,
  })

  return {
    hiddenSessionIDsByProject: hiddenSessionIDsBySidebarProject,
    sessions,
    cachedSessionsByProject,
    workspaceDetailDirectory,
    workspaceDetailSessions,
    getSessionStatusType,
    getSessionIndicator,
  }
}
