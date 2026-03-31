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

export function useAppShellSessionCollections({
  projectData, projectDataByDirectory, activeProjectDir, activeSessionID, projectCacheVersion,
  pinnedSessions, archivedBackgroundAgentIds, hiddenBackgroundSessionIdsByProject,
  backgroundSessionDescriptors, getSessionType, normalizePresentationProvider,
}: UseAppShellSessionCollectionsInput) {
  const opencodeSessions = useUnifiedRuntimeStore(state => state.opencodeSessions), codexSessions = useUnifiedRuntimeStore(state => state.codexSessions), claudeChatSessions = useUnifiedRuntimeStore(state => state.claudeChatSessions)
  const claudeSessions = useUnifiedRuntimeStore(state => state.claudeSessions)
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

  const sessions = useMemo(() => {
    if (!projectData) {
      return []
    }
    const pinned = new Set(pinnedSessions[projectData.directory] ?? [])
    const hiddenSessionIDs = new Set(hiddenSessionIDsByProject[projectData.directory] ?? [])
    return [...projectData.sessions]
      .filter(item => !item.time.archived && !hiddenSessionIDs.has(item.id))
      .sort((a, b) => {
        const aPinned = pinned.has(a.id) ? 1 : 0
        const bPinned = pinned.has(b.id) ? 1 : 0
        if (aPinned !== bPinned) {
          return bPinned - aPinned
        }
        return b.time.updated - a.time.updated
      })
  }, [hiddenSessionIDsByProject, pinnedSessions, projectData])

  const cachedSessionsByProject = useMemo(() => {
    void projectCacheVersion
    const result: Record<string, SessionListEntry[]> = {}
    for (const [directory, data] of Object.entries(projectDataByDirectory)) {
      if (directory === activeProjectDir) {
        continue
      }
      const hiddenSessionIDs = new Set(hiddenSessionIDsByProject[directory] ?? [])
      result[directory] = [...data.sessions].filter(session => !session.time.archived && !hiddenSessionIDs.has(session.id)).sort((a, b) => b.time.updated - a.time.updated)
    }
    return result
  }, [activeProjectDir, hiddenSessionIDsByProject, projectCacheVersion, projectDataByDirectory])

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

  return { hiddenSessionIDsByProject, sessions, cachedSessionsByProject, getSessionStatusType, getSessionIndicator }
}
