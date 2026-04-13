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

function useSidebarUiBindings() {
  const state = useUiStateStore(
    useShallow(store => ({
      projectExpandedById: store.projectExpandedById,
      projectOrder: store.projectOrder,
      threadLastVisitedAtById: store.threadLastVisitedAtById,
      pinnedThreadIds: store.pinnedThreadIds,
      expandedParentThreadIds: store.expandedParentThreadIds,
    }))
  )

  return {
    ...state,
    markThreadUnread: useUiStateStore(store => store.markThreadUnread),
    toggleProject: useUiStateStore(store => store.toggleProject),
    setParentThreadExpanded: useUiStateStore(store => store.setParentThreadExpanded),
    reorderProjects: useUiStateStore(store => store.reorderProjects),
  }
}

function useThreadSelectionBindings() {
  return {
    selectedThreadIds: useThreadSelectionStore(s => s.selectedThreadIds),
    toggleThreadSelection: useThreadSelectionStore(s => s.toggleThread),
    rangeSelectTo: useThreadSelectionStore(s => s.rangeSelectTo),
    clearSelection: useThreadSelectionStore(s => s.clearSelection),
    removeFromSelection: useThreadSelectionStore(s => s.removeFromSelection),
    setSelectionAnchor: useThreadSelectionStore(s => s.setAnchor),
  }
}

export function useSidebarStoreBindings() {
  const bootstrapComplete = useStore(store => store.bootstrapComplete)
  const projects = useStore(store => store.projects)
  const serverThreads = useStore(store => store.threads)
  const uiBindings = useSidebarUiBindings()
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
  const selectionBindings = useThreadSelectionBindings()

  const isLinuxDesktop = isElectron && isLinuxPlatform(navigator.platform)
  const shouldBrowseForProjectImmediately = isElectron && !isLinuxDesktop

  return {
    bootstrapComplete,
    projects,
    serverThreads,
    ...uiBindings,
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
    ...selectionBindings,
    shouldBrowseForProjectImmediately,
  }
}
