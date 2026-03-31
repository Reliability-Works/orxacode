import { useCallback } from 'react'
import type { ProjectBootstrap, SessionMessageBundle } from '@shared/ipc'
import type { TerminalTab } from '../components/TerminalPanel'
import { makeUnifiedSessionKey } from '../state/unified-runtime'
import type { UnifiedProvider } from '../state/unified-runtime'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'
import { getPersistedOpencodeState } from './opencode-session-storage'
import { useWorkspaceStateLocal } from './useWorkspaceState-local'
import { useWorkspaceStateProjectSync } from './useWorkspaceStateProjectSync'
import { EMPTY_MESSAGE_BUNDLES, EMPTY_WORKSPACE_SESSIONS_KEY } from './useWorkspaceState-shared'
import { useWorkspaceStateSessionLifecycle } from './useWorkspaceStateSessionLifecycle'
import { useWorkspaceStateStore } from './useWorkspaceState-store'

export { EMPTY_WORKSPACE_SESSIONS_KEY }

export type UseWorkspaceStateOptions = {
  setStatusLine: (status: string) => void
  terminalTabIds: string[]
  setTerminalTabs: (tabs: TerminalTab[]) => void
  setActiveTerminalId: (id: string | undefined) => void
  setTerminalOpen: (open: boolean) => void
  scheduleGitRefresh?: (delayMs?: number) => void
  onCleanupEmptySession?: (directory: string, sessionID: string) => void | Promise<void>
  mergeProjectData?: (project: ProjectBootstrap) => ProjectBootstrap
  shouldDeleteRemoteEmptySession?: (directory: string, sessionID: string) => boolean
  shouldSkipRuntimeSessionLoad?: (directory: string, sessionID: string) => boolean
}

function useActiveOpencodeMessages(activeProjectDir?: string, activeSessionID?: string) {
  return useUnifiedRuntimeStore(state => {
    if (!activeProjectDir || !activeSessionID) {
      return EMPTY_MESSAGE_BUNDLES
    }
    const key = makeUnifiedSessionKey('opencode', activeProjectDir, activeSessionID)
    const storeMessages = state.opencodeSessions[key]?.messages
    if (storeMessages && storeMessages.length > 0) {
      return storeMessages
    }
    const persisted = getPersistedOpencodeState(key)
    return persisted.messages.length > 0 ? persisted.messages : EMPTY_MESSAGE_BUNDLES
  })
}

function useWorkspaceStateBridges({
  mergeProjectData,
  replaceCollapsedProjects,
  setActiveSession,
  setOpencodeMessages,
  setProjectDataForDirectory,
}: {
  mergeProjectData?: (project: ProjectBootstrap) => ProjectBootstrap
  replaceCollapsedProjects: (next: Record<string, boolean>) => void
  setActiveSession: (sessionID: string | undefined, provider?: UnifiedProvider) => void
  setOpencodeMessages: (directory: string, sessionID: string, messages: SessionMessageBundle[]) => void
  setProjectDataForDirectory: (directory: string, data: ProjectBootstrap) => void
}) {
  const getRuntimeState = useCallback(() => useUnifiedRuntimeStore.getState(), [])

  const setProjectData = useCallback(
    (next: ProjectBootstrap | null) => {
      if (!next) return
      const merged = mergeProjectData ? mergeProjectData(next) : next
      setProjectDataForDirectory(merged.directory, merged)
    },
    [mergeProjectData, setProjectDataForDirectory]
  )

  const setActiveSessionID = useCallback(
    (sessionID: string | undefined) => {
      // Provider identity is derived elsewhere from session metadata. Do not
      // misclassify every session selection as OpenCode at the store boundary.
      setActiveSession(sessionID, undefined)
    },
    [setActiveSession]
  )

  const setMessages = useCallback(
    (next: SessionMessageBundle[]) => {
      const state = getRuntimeState()
      if (state.activeWorkspaceDirectory && state.activeSessionID) {
        setOpencodeMessages(state.activeWorkspaceDirectory, state.activeSessionID, next)
      }
    },
    [getRuntimeState, setOpencodeMessages]
  )

  const setCollapsedProjects = useCallback(
    (
      updater:
        | Record<string, boolean>
        | ((current: Record<string, boolean>) => Record<string, boolean>)
    ) => {
      const current = useUnifiedRuntimeStore.getState().collapsedProjects
      replaceCollapsedProjects(typeof updater === 'function' ? updater(current) : updater)
    },
    [replaceCollapsedProjects]
  )

  return {
    getRuntimeState,
    setProjectData,
    setActiveSessionID,
    setMessages,
    setCollapsedProjects,
  }
}

export function useWorkspaceState(options: UseWorkspaceStateOptions) {
  const local = useWorkspaceStateLocal()
  const store = useWorkspaceStateStore()
  const messages = useActiveOpencodeMessages(store.activeProjectDir, store.activeSessionID)
  const bridges = useWorkspaceStateBridges({
    mergeProjectData: options.mergeProjectData,
    replaceCollapsedProjects: store.replaceCollapsedProjects,
    setActiveSession: store.setActiveSession,
    setOpencodeMessages: store.setOpencodeMessages,
    setProjectDataForDirectory: store.setProjectDataForDirectory,
  })

  const projectSync = useWorkspaceStateProjectSync({
    activeProjectDir: store.activeProjectDir,
    activeSessionID: store.activeSessionID,
    terminalTabIds: options.terminalTabIds,
    setStatusLine: options.setStatusLine,
    setTerminalTabs: options.setTerminalTabs,
    setActiveTerminalId: options.setActiveTerminalId,
    mergeProjectData: options.mergeProjectData,
    getRuntimeState: bridges.getRuntimeState,
    setProjectData: bridges.setProjectData,
    setProjectDataForDirectory: store.setProjectDataForDirectory,
    setWorkspaceMeta: store.setWorkspaceMeta,
    setOpencodeRuntimeSnapshot: store.setOpencodeRuntimeSnapshot,
    setOpencodeTodoItems: store.setOpencodeTodoItems,
    setActiveSessionID: bridges.setActiveSessionID,
    setMessages: bridges.setMessages,
  })

  const lifecycle = useWorkspaceStateSessionLifecycle({
    activeProjectDir: store.activeProjectDir,
    setStatusLine: options.setStatusLine,
    setTerminalTabs: options.setTerminalTabs,
    setActiveTerminalId: options.setActiveTerminalId,
    setTerminalOpen: options.setTerminalOpen,
    onCleanupEmptySession: options.onCleanupEmptySession,
    mergeProjectData: options.mergeProjectData,
    shouldDeleteRemoteEmptySession: options.shouldDeleteRemoteEmptySession,
    shouldSkipRuntimeSessionLoad: options.shouldSkipRuntimeSessionLoad,
    getRuntimeState: bridges.getRuntimeState,
    setSidebarMode: local.setSidebarMode,
    setContextMenu: local.setContextMenu,
    setPinnedSessions: local.setPinnedSessions,
    emptySessionIds: local.emptySessionIds,
    persistedEmptySessionIds: local.persistedEmptySessionIds,
    rememberEmptySession: local.rememberEmptySession,
    forgetEmptySession: local.forgetEmptySession,
    setActiveProjectDir: store.setActiveProjectDir,
    setActiveSessionID: bridges.setActiveSessionID,
    setPendingSessionId: store.setPendingSessionId,
    setProjectData: bridges.setProjectData,
    setProjectDataForDirectory: store.setProjectDataForDirectory,
    removeOpencodeSession: store.removeOpencodeSession,
    setWorkspaceMeta: store.setWorkspaceMeta,
    setMessages: bridges.setMessages,
    setOpencodeMessages: store.setOpencodeMessages,
    setCollapsedProjects: bridges.setCollapsedProjects,
    refreshProject: projectSync.refreshProject,
    startResponsePolling: projectSync.startResponsePolling,
    stopResponsePolling: projectSync.stopResponsePolling,
    applyRuntimeSnapshot: projectSync.applyRuntimeSnapshot,
  })

  return {
    sidebarMode: local.sidebarMode,
    setSidebarMode: local.setSidebarMode,
    activeProjectDir: store.activeProjectDir,
    setActiveProjectDir: store.setActiveProjectDir,
    projectData: store.projectData,
    setProjectData: bridges.setProjectData,
    activeSessionID: store.activeSessionID,
    setActiveSessionID: bridges.setActiveSessionID,
    pendingSessionId: store.pendingSessionId,
    clearPendingSession: () => store.setPendingSessionId(undefined),
    messages,
    setMessages: bridges.setMessages,
    contextMenu: local.contextMenu,
    setContextMenu: local.setContextMenu,
    pinnedSessions: local.pinnedSessions,
    setPinnedSessions: local.setPinnedSessions,
    collapsedProjects: store.collapsedProjects,
    setCollapsedProjects: bridges.setCollapsedProjects,
    refreshProject: projectSync.refreshProject,
    selectProject: lifecycle.selectProject,
    openWorkspaceDashboard: lifecycle.openWorkspaceDashboard,
    refreshMessages: projectSync.refreshMessages,
    selectSession: lifecycle.selectSession,
    createSession: lifecycle.createSession,
    applyOpencodeStreamEvent: projectSync.applyOpencodeStreamEvent,
    queueRefresh: projectSync.queueRefresh,
    startResponsePolling: projectSync.startResponsePolling,
    stopResponsePolling: projectSync.stopResponsePolling,
    togglePinSession: lifecycle.togglePinSession,
    openProjectContextMenu: lifecycle.openProjectContextMenu,
    openSessionContextMenu: lifecycle.openSessionContextMenu,
    markSessionUsed: lifecycle.markSessionUsed,
    trackEmptySession: lifecycle.trackEmptySession,
    cleanupPersistedEmptySessions: lifecycle.cleanupPersistedEmptySessions,
  }
}
