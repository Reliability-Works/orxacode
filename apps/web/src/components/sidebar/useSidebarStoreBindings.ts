/**
 * useSidebarStoreBindings — aggregates all store subscriptions and action handles
 * needed by the Sidebar, reducing the main component function line count.
 */

import { useShallow } from 'zustand/react/shallow'
import { ThreadId } from '@orxa-code/contracts'
import { useLocation, useNavigate, useParams } from '@tanstack/react-router'
import { isElectron } from '../../env'
import { isLinuxPlatform } from '../../lib/utils'
import { useStore } from '../../store'
import { useUiStateStore } from '../../uiStateStore'
import { useComposerDraftStore } from '../../composerDraftStore'
import { useHandleNewThread } from '../../hooks/useHandleNewThread'
import { useThreadActions } from '../../hooks/useThreadActions'
import { useTerminalStateStore } from '../../terminalStateStore'
import { useThreadSelectionStore } from '../../threadSelectionStore'
import { useSettings, useUpdateSettings } from '~/hooks/useSettings'
import { useServerKeybindings } from '../../rpc/serverState'

export function useSidebarStoreBindings() {
  const projects = useStore(store => store.projects)
  const serverThreads = useStore(store => store.threads)

  const { projectExpandedById, projectOrder, threadLastVisitedAtById, pinnedThreadIds } = useUiStateStore(
    useShallow(store => ({
      projectExpandedById: store.projectExpandedById,
      projectOrder: store.projectOrder,
      threadLastVisitedAtById: store.threadLastVisitedAtById,
      pinnedThreadIds: store.pinnedThreadIds,
    }))
  )

  const markThreadUnread = useUiStateStore(store => store.markThreadUnread)
  const toggleProject = useUiStateStore(store => store.toggleProject)
  const reorderProjects = useUiStateStore(store => store.reorderProjects)
  const clearComposerDraftForThread = useComposerDraftStore(store => store.clearDraftThread)
  const getDraftThreadByProjectId = useComposerDraftStore(store => store.getDraftThreadByProjectId)
  const terminalStateByThreadId = useTerminalStateStore(state => state.terminalStateByThreadId)
  const clearProjectDraftThreadId = useComposerDraftStore(store => store.clearProjectDraftThreadId)

  const navigate = useNavigate()
  const pathname = useLocation({ select: loc => loc.pathname })
  const appSettings = useSettings()
  const { updateSettings } = useUpdateSettings()
  const { handleNewThread } = useHandleNewThread()
  const { archiveThread, deleteThread } = useThreadActions()

  const routeThreadId = useParams({
    strict: false,
    select: params => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  })

  const keybindings = useServerKeybindings()
  const selectedThreadIds = useThreadSelectionStore(s => s.selectedThreadIds)
  const toggleThreadSelection = useThreadSelectionStore(s => s.toggleThread)
  const rangeSelectTo = useThreadSelectionStore(s => s.rangeSelectTo)
  const clearSelection = useThreadSelectionStore(s => s.clearSelection)
  const removeFromSelection = useThreadSelectionStore(s => s.removeFromSelection)
  const setSelectionAnchor = useThreadSelectionStore(s => s.setAnchor)

  const isLinuxDesktop = isElectron && isLinuxPlatform(navigator.platform)
  const shouldBrowseForProjectImmediately = isElectron && !isLinuxDesktop

  return {
    projects,
    serverThreads,
    projectExpandedById,
    projectOrder,
    threadLastVisitedAtById,
    pinnedThreadIds,
    markThreadUnread,
    toggleProject,
    reorderProjects,
    clearComposerDraftForThread,
    getDraftThreadByProjectId,
    terminalStateByThreadId,
    clearProjectDraftThreadId,
    navigate,
    pathname,
    appSettings,
    updateSettings,
    handleNewThread,
    archiveThread,
    deleteThread,
    routeThreadId,
    keybindings,
    selectedThreadIds,
    toggleThreadSelection,
    rangeSelectTo,
    clearSelection,
    removeFromSelection,
    setSelectionAnchor,
    shouldBrowseForProjectImmediately,
  }
}
