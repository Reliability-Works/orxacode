import { useCallback } from 'react'
import type { Dispatch, MouseEvent as ReactMouseEvent, MutableRefObject, SetStateAction } from 'react'
import type { ProjectBootstrap, SessionMessageBundle } from '@shared/ipc'
import type { TerminalTab } from '../components/TerminalPanel'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'
import {
  clampContextMenuPosition,
  loadOpencodeRuntimeSnapshot,
  type ContextMenuState,
  type SidebarMode,
} from './useWorkspaceState-shared'
import type { SetMessages, SetProjectData, UnifiedRuntimeState } from './useWorkspaceState-store'
import { useWorkspaceSelectionActions } from './useWorkspaceSelectionActions'
import { useWorkspaceSessionCreation } from './useWorkspaceSessionCreation'

type UseWorkspaceStateSessionLifecycleArgs = {
  activeProjectDir?: string
  setStatusLine: (status: string) => void
  setTerminalTabs: (tabs: TerminalTab[]) => void
  setActiveTerminalId: (id: string | undefined) => void
  setTerminalOpen: (open: boolean) => void
  onCleanupEmptySession?: (directory: string, sessionID: string) => void | Promise<void>
  mergeProjectData?: (project: ProjectBootstrap) => ProjectBootstrap
  shouldDeleteRemoteEmptySession?: (directory: string, sessionID: string) => boolean
  shouldSkipRuntimeSessionLoad?: (directory: string, sessionID: string) => boolean
  getRuntimeState: () => UnifiedRuntimeState
  setSidebarMode: (mode: SidebarMode) => void
  setContextMenu: (value: ContextMenuState) => void
  setPinnedSessions: Dispatch<SetStateAction<Record<string, string[]>>>
  emptySessionIds: MutableRefObject<Map<string, string>>
  persistedEmptySessionIds: MutableRefObject<Map<string, string>>
  rememberEmptySession: (sessionID: string, directory: string) => void
  forgetEmptySession: (sessionID: string) => void
  setActiveProjectDir: (directory: string | undefined) => void
  setActiveSessionID: (sessionID: string | undefined) => void
  setPendingSessionId: (sessionID: string | undefined) => void
  setProjectData: SetProjectData
  setProjectDataForDirectory: (directory: string, data: ProjectBootstrap) => void
  removeOpencodeSession: (directory: string, sessionID: string) => void
  setWorkspaceMeta: (directory: string, meta: { lastUpdatedAt?: number; lastOpenedAt?: number }) => void
  setMessages: SetMessages
  setOpencodeMessages: (directory: string, sessionID: string, messages: SessionMessageBundle[]) => void
  setCollapsedProjects: (
    updater:
      | Record<string, boolean>
      | ((current: Record<string, boolean>) => Record<string, boolean>)
  ) => void
  refreshProject: (directory: string, skipMessageLoad?: boolean) => Promise<ProjectBootstrap>
  startResponsePolling: (directory: string, sessionID: string) => void
  stopResponsePolling: () => void
  applyRuntimeSnapshot: (
    directory: string,
    sessionID: string,
    runtime: Awaited<ReturnType<typeof loadOpencodeRuntimeSnapshot>>,
    mergePersisted?: boolean
  ) => SessionMessageBundle[]
}

type EmptyLifecycleArgs = Pick<
  UseWorkspaceStateSessionLifecycleArgs,
  | 'getRuntimeState'
  | 'onCleanupEmptySession'
  | 'shouldDeleteRemoteEmptySession'
  | 'emptySessionIds'
  | 'persistedEmptySessionIds'
  | 'forgetEmptySession'
  | 'setProjectDataForDirectory'
  | 'setProjectData'
  | 'removeOpencodeSession'
  | 'setActiveSessionID'
  | 'setMessages'
  | 'setPendingSessionId'
>

function useEmptySessionLifecycle({ getRuntimeState, onCleanupEmptySession, shouldDeleteRemoteEmptySession, emptySessionIds, persistedEmptySessionIds, forgetEmptySession, setProjectDataForDirectory, setProjectData, removeOpencodeSession, setActiveSessionID, setMessages, setPendingSessionId }: EmptyLifecycleArgs) {
  const finalizeEmptySessionCleanup = useCallback(async (directory: string, sessionID: string) => {
      forgetEmptySession(sessionID)
      const state = getRuntimeState()
      const cachedProject = state.projectDataByDirectory[directory]
      if (cachedProject?.sessions.some(session => session.id === sessionID)) {
        const nextSessionStatus = { ...cachedProject.sessionStatus }
        delete nextSessionStatus[sessionID]
        const nextProject = {
          ...cachedProject,
          sessions: cachedProject.sessions.filter(session => session.id !== sessionID),
          sessionStatus: nextSessionStatus,
        }
        setProjectDataForDirectory(directory, nextProject)
        if (state.activeWorkspaceDirectory === directory) {
          setProjectData(nextProject)
        }
      }
      removeOpencodeSession(directory, sessionID)
      if (state.activeWorkspaceDirectory === directory && state.activeSessionID === sessionID) {
        setActiveSessionID(undefined)
        setMessages([])
      }
      if (useUnifiedRuntimeStore.getState().pendingSessionId === sessionID) {
        setPendingSessionId(undefined)
      }
      await onCleanupEmptySession?.(directory, sessionID)
    }, [forgetEmptySession, getRuntimeState, onCleanupEmptySession, removeOpencodeSession, setActiveSessionID, setMessages, setPendingSessionId, setProjectData, setProjectDataForDirectory])

  const cleanupEmptySession = useCallback(
    async (sessionID: string | undefined) => {
      if (!sessionID) return
      const directory =
        emptySessionIds.current.get(sessionID) ?? persistedEmptySessionIds.current.get(sessionID)
      if (!directory) return
      await finalizeEmptySessionCleanup(directory, sessionID)
      if (shouldDeleteRemoteEmptySession?.(directory, sessionID) !== false) {
        await window.orxa.opencode.deleteSession(directory, sessionID).catch(() => undefined)
      }
    },
    [emptySessionIds, finalizeEmptySessionCleanup, persistedEmptySessionIds, shouldDeleteRemoteEmptySession]
  )

  const cleanupPersistedEmptySessions = useCallback(async () => {
    const trackedSessions = [...persistedEmptySessionIds.current.entries()]
    for (const [sessionID, directory] of trackedSessions) {
      try {
        if (shouldDeleteRemoteEmptySession?.(directory, sessionID) !== false) {
          await window.orxa.opencode.deleteSession(directory, sessionID)
        }
        await finalizeEmptySessionCleanup(directory, sessionID)
      } catch {
        // Keep the persisted marker so startup can retry next time.
      }
    }
  }, [finalizeEmptySessionCleanup, persistedEmptySessionIds, shouldDeleteRemoteEmptySession])

  const markSessionUsed = useCallback(
    (sessionID: string) => {
      forgetEmptySession(sessionID)
    },
    [forgetEmptySession]
  )

  return {
    cleanupEmptySession,
    cleanupPersistedEmptySessions,
    markSessionUsed,
  }
}

function useWorkspaceContextMenus({
  setPinnedSessions,
  setContextMenu,
}: Pick<UseWorkspaceStateSessionLifecycleArgs, 'setPinnedSessions' | 'setContextMenu'>) {
  const togglePinSession = useCallback(
    (directory: string, sessionID: string) => {
      setPinnedSessions(current => {
        const existing = new Set(current[directory] ?? [])
        if (existing.has(sessionID)) {
          existing.delete(sessionID)
        } else {
          existing.add(sessionID)
        }
        return { ...current, [directory]: [...existing] }
      })
    },
    [setPinnedSessions]
  )

  const openProjectContextMenu = useCallback(
    (event: ReactMouseEvent, directory: string, label: string) => {
      event.preventDefault()
      const point = clampContextMenuPosition(event.clientX, event.clientY)
      setContextMenu({ kind: 'project', x: point.x, y: point.y, directory, label })
    },
    [setContextMenu]
  )

  const openSessionContextMenu = useCallback(
    (event: ReactMouseEvent, directory: string, sessionID: string, title: string) => {
      event.preventDefault()
      event.stopPropagation()
      const point = clampContextMenuPosition(event.clientX, event.clientY)
      setContextMenu({ kind: 'session', x: point.x, y: point.y, directory, sessionID, title })
    },
    [setContextMenu]
  )

  return {
    togglePinSession,
    openProjectContextMenu,
    openSessionContextMenu,
  }
}

export function useWorkspaceStateSessionLifecycle(args: UseWorkspaceStateSessionLifecycleArgs) {
  const empty = useEmptySessionLifecycle(args)
  const selection = useWorkspaceSelectionActions({
    setStatusLine: args.setStatusLine,
    setTerminalTabs: args.setTerminalTabs,
    setActiveTerminalId: args.setActiveTerminalId,
    setTerminalOpen: args.setTerminalOpen,
    mergeProjectData: args.mergeProjectData,
    shouldSkipRuntimeSessionLoad: args.shouldSkipRuntimeSessionLoad,
    getRuntimeState: args.getRuntimeState,
    setSidebarMode: args.setSidebarMode,
    setCollapsedProjects: args.setCollapsedProjects,
    setActiveProjectDir: args.setActiveProjectDir,
    setActiveSessionID: args.setActiveSessionID,
    setPendingSessionId: args.setPendingSessionId,
    setProjectData: args.setProjectData,
    setProjectDataForDirectory: args.setProjectDataForDirectory,
    setWorkspaceMeta: args.setWorkspaceMeta,
    setOpencodeMessages: args.setOpencodeMessages,
    cleanupEmptySession: empty.cleanupEmptySession,
    applyRuntimeSnapshot: args.applyRuntimeSnapshot,
  })
  const createSession = useWorkspaceSessionCreation({
    activeProjectDir: args.activeProjectDir,
    setStatusLine: args.setStatusLine,
    getRuntimeState: args.getRuntimeState,
    rememberEmptySession: args.rememberEmptySession,
    setActiveProjectDir: args.setActiveProjectDir,
    setActiveSessionID: args.setActiveSessionID,
    setPendingSessionId: args.setPendingSessionId,
    setMessages: args.setMessages,
    refreshProject: args.refreshProject,
    startResponsePolling: args.startResponsePolling,
    stopResponsePolling: args.stopResponsePolling,
    applyRuntimeSnapshot: args.applyRuntimeSnapshot,
    selectProject: selection.selectProject,
    cleanupEmptySession: empty.cleanupEmptySession,
  })
  const menus = useWorkspaceContextMenus({
    setPinnedSessions: args.setPinnedSessions,
    setContextMenu: args.setContextMenu,
  })

  return {
    cleanupPersistedEmptySessions: empty.cleanupPersistedEmptySessions,
    createSession,
    markSessionUsed: empty.markSessionUsed,
    openProjectContextMenu: menus.openProjectContextMenu,
    openSessionContextMenu: menus.openSessionContextMenu,
    openWorkspaceDashboard: selection.openWorkspaceDashboard,
    selectProject: selection.selectProject,
    selectSession: selection.selectSession,
    togglePinSession: menus.togglePinSession,
    trackEmptySession: args.rememberEmptySession,
  }
}
