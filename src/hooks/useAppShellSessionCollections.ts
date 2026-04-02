import { useCallback, useMemo } from 'react'
import type { ProjectBootstrap } from '@shared/ipc'
import {
  selectSidebarSessionPresentation,
  useUnifiedRuntimeStore,
} from '../state/unified-runtime-store'
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

type SidebarTrackedSession = {
  id: string
  directory: string
  updatedAt: number
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

function resolveWorkspaceRoot(directory: string, workspaceRootByDirectory: Record<string, string>) {
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
    const ids = new Set([
      ...(next[workspaceRoot] ?? []),
      ...(hiddenSessionIDsByProject[directory] ?? []),
    ])
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

function buildTrackedSidebarSessions(
  cachedSessionsByProject: Record<string, WorkspaceDetailSessionEntry[]>
): SidebarTrackedSession[] {
  const next = new Map<string, SidebarTrackedSession>()
  for (const sessions of Object.values(cachedSessionsByProject)) {
    for (const session of sessions) {
      const key = `${session.directory}::${session.id}`
      next.set(key, {
        id: session.id,
        directory: session.directory,
        updatedAt: session.time.updated,
      })
    }
  }
  return [...next.values()]
}

function buildSidebarIndicatorSignal({
  activeProjectDir,
  activeSessionID,
  getSessionType,
  normalizePresentationProvider,
  trackedSessions,
}: {
  activeProjectDir?: string
  activeSessionID?: string
  getSessionType: (sessionID: string, directory?: string) => string | undefined
  normalizePresentationProvider: (
    sessionType: string | undefined
  ) => 'opencode' | 'codex' | 'claude' | 'claude-chat' | undefined
  trackedSessions: SidebarTrackedSession[]
}) {
  return trackedSessions
    .map(session => {
      const provider = normalizePresentationProvider(getSessionType(session.id, session.directory))
      if (!provider) {
        return `${session.directory}::${session.id}:none:idle`
      }
      const presentation = selectSidebarSessionPresentation({
        provider,
        directory: session.directory,
        sessionID: session.id,
        updatedAt: session.updatedAt,
        isActive: activeProjectDir === session.directory && activeSessionID === session.id,
        sessionKey: `${session.directory}::${session.id}`,
      })
      return `${session.directory}::${session.id}:${presentation.indicator}:${presentation.statusType}`
    })
    .join('|')
}

function useSidebarSessionIndicators({
  activeProjectDir,
  activeSessionID,
  sidebarIndicatorSignal,
  getSessionType,
  normalizePresentationProvider,
}: {
  activeProjectDir?: string
  activeSessionID?: string
  sidebarIndicatorSignal: string
  getSessionType: (sessionID: string, directory?: string) => string | undefined
  normalizePresentationProvider: (
    sessionType: string | undefined
  ) => 'opencode' | 'codex' | 'claude' | 'claude-chat' | undefined
}) {
  const getSessionStatusType = useCallback(
    (sessionID: string, directory?: string) => {
      void sidebarIndicatorSignal
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
      getSessionType,
      normalizePresentationProvider,
      sidebarIndicatorSignal,
    ]
  )

  const getSessionIndicator = useCallback(
    (sessionID: string, directory: string, updatedAt: number) => {
      void sidebarIndicatorSignal
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
      getSessionType,
      normalizePresentationProvider,
      sidebarIndicatorSignal,
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
  projectData,
  projectDataByDirectory,
  activeProjectDir,
  activeSessionID,
  projectCacheVersion,
  pinnedSessions,
  archivedBackgroundAgentIds,
  hiddenBackgroundSessionIdsByProject,
  backgroundSessionDescriptors,
  getSessionType,
  normalizePresentationProvider,
}: UseAppShellSessionCollectionsInput) {
  const workspaceRootByDirectory = useUnifiedRuntimeStore(state => state.workspaceRootByDirectory)

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

  const trackedSidebarSessions = useMemo(
    () => buildTrackedSidebarSessions(cachedSessionsByProject),
    [cachedSessionsByProject]
  )

  const sidebarIndicatorSignal = useUnifiedRuntimeStore(
    useCallback(
      () =>
        buildSidebarIndicatorSignal({
          activeProjectDir,
          activeSessionID,
          getSessionType,
          normalizePresentationProvider,
          trackedSessions: trackedSidebarSessions,
        }),
      [
        activeProjectDir,
        activeSessionID,
        getSessionType,
        normalizePresentationProvider,
        trackedSidebarSessions,
      ]
    )
  )

  const { getSessionIndicator, getSessionStatusType } = useSidebarSessionIndicators({
    activeProjectDir,
    activeSessionID,
    sidebarIndicatorSignal,
    getSessionType,
    normalizePresentationProvider,
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
