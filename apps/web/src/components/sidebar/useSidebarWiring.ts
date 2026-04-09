/**
 * useSidebarWiring — wires store bindings into all action/render hooks,
 * returning everything needed to render <SidebarBody>.
 */

import {
  type SidebarProjectSortOrder,
  type SidebarThreadSortOrder,
} from '@orxa-code/contracts/settings'
import { useThreadJumpHintVisibility } from '../Sidebar.logic'
import { shortcutLabelForCommand } from '../../keybindings'
import {
  useSidebarDerivedData,
  useSidebarThreadActions,
  useSidebarProjectActions,
  useSidebarKeyboardNav,
  useSidebarDesktopUpdate,
} from '../Sidebar.hooks'
import { useSidebarRenderedProjects } from './useSidebarRenderedProjects'
import { useSidebarCallbackFactories } from './useSidebarCallbackFactories'
import type { useSidebarStoreBindings } from './useSidebarStoreBindings'

type StoreBindings = ReturnType<typeof useSidebarStoreBindings>

// ---------------------------------------------------------------------------
// Core actions sub-hook (derived data + thread/project actions)
// ---------------------------------------------------------------------------

function useSidebarCoreActions(s: StoreBindings) {
  const derived = useSidebarDerivedData({
    projects: s.projects,
    serverThreads: s.serverThreads,
    projectOrder: s.projectOrder,
    projectExpandedById: s.projectExpandedById,
    threadLastVisitedAtById: s.threadLastVisitedAtById,
    routeThreadId: s.routeThreadId,
    terminalStateByThreadId: s.terminalStateByThreadId,
  })

  const threadActions = useSidebarThreadActions({
    navigate: s.navigate,
    threads: derived.threads,
    projectCwdById: derived.projectCwdById,
    appSettings: {
      confirmThreadDelete: s.appSettings.confirmThreadDelete ?? false,
      confirmThreadArchive: s.appSettings.confirmThreadArchive,
    },
    archiveThread: s.archiveThread,
    deleteThread: s.deleteThread,
    markThreadUnread: s.markThreadUnread,
    selectedThreadIds: s.selectedThreadIds,
    clearSelection: s.clearSelection,
    toggleThreadSelection: s.toggleThreadSelection,
    rangeSelectTo: s.rangeSelectTo,
    removeFromSelection: s.removeFromSelection,
    setSelectionAnchor: s.setSelectionAnchor,
  })

  const projectActions = useSidebarProjectActions({
    projects: s.projects,
    threads: derived.threads,
    sidebarProjects: derived.sidebarProjects,
    appSettings: {
      sidebarProjectSortOrder: s.appSettings.sidebarProjectSortOrder,
      sidebarThreadSortOrder: s.appSettings.sidebarThreadSortOrder,
      defaultThreadEnvMode: s.appSettings.defaultThreadEnvMode,
      confirmThreadDelete: s.appSettings.confirmThreadDelete,
    },
    handleNewThread: s.handleNewThread,
    reorderProjects: s.reorderProjects,
    toggleProject: s.toggleProject,
    navigate: s.navigate,
    selectedThreadIds: s.selectedThreadIds,
    clearSelection: s.clearSelection,
    getDraftThreadByProjectId: s.getDraftThreadByProjectId,
    clearComposerDraftForThread: s.clearComposerDraftForThread,
    clearProjectDraftThreadId: s.clearProjectDraftThreadId,
    copyPathToClipboard: threadActions.copyPathToClipboard,
  })

  return { derived, threadActions, projectActions }
}

// ---------------------------------------------------------------------------
// Rendered + keyboard-nav sub-hook
// ---------------------------------------------------------------------------

function useSidebarRenderedAndKeyboardNav(
  s: StoreBindings,
  core: ReturnType<typeof useSidebarCoreActions>
) {
  const { derived, threadActions } = core
  const rendered = useSidebarRenderedProjects({
    sidebarProjects: derived.sidebarProjects,
    threads: derived.threads,
    pinnedThreadIds: s.pinnedThreadIds,
    routeThreadId: s.routeThreadId,
    sidebarProjectSortOrder: s.appSettings.sidebarProjectSortOrder as SidebarProjectSortOrder,
    sidebarThreadSortOrder: s.appSettings.sidebarThreadSortOrder as SidebarThreadSortOrder,
  })

  const { showThreadJumpHints, updateThreadJumpHintsVisibility } = useThreadJumpHintVisibility()

  const keyboardNav = useSidebarKeyboardNav({
    keybindings: s.keybindings,
    platform: navigator.platform,
    routeTerminalOpen: derived.routeTerminalOpen,
    routeThreadId: s.routeThreadId,
    renderedProjects: rendered.renderedProjects.map(rp => ({
      shouldShowThreadPanel: rp.shouldShowThreadPanel,
      renderedThreads: rp.renderedThreads.map(t => ({ id: t.id })),
    })),
    navigateToThread: threadActions.navigateToThread,
    updateThreadJumpHintsVisibility,
  })

  return { rendered, keyboardNav, showThreadJumpHints }
}

export function useSidebarWiring(s: StoreBindings) {
  const core = useSidebarCoreActions(s)
  const { derived, threadActions, projectActions } = core
  const { rendered, keyboardNav, showThreadJumpHints } = useSidebarRenderedAndKeyboardNav(s, core)

  const desktopUpdate = useSidebarDesktopUpdate()
  const newThreadShortcutLabel =
    shortcutLabelForCommand(s.keybindings, 'chat.newLocal', derived.sidebarShortcutLabelOptions) ??
    shortcutLabelForCommand(s.keybindings, 'chat.new', derived.sidebarShortcutLabelOptions)
  const { getProjectItemProps, getThreadRowProps, confirmingArchiveThreadId } =
    useSidebarCallbackFactories({
    threadActions,
    projectActions,
    keyboardNavThreadJumpLabelById: keyboardNav.threadJumpLabelById,
    terminalStateByThreadId: s.terminalStateByThreadId,
    prByThreadId: derived.prByThreadId,
    routeThreadId: s.routeThreadId,
    selectedThreadIds: s.selectedThreadIds,
    clearSelection: s.clearSelection,
    expandThreadListForProject: rendered.expandThreadListForProject,
    collapseThreadListForProject: rendered.collapseThreadListForProject,
    isManualProjectSorting: rendered.isManualProjectSorting,
    newThreadShortcutLabel,
    handleNewThread: s.handleNewThread,
    defaultThreadEnvMode: s.appSettings.defaultThreadEnvMode,
    confirmThreadArchive: s.appSettings.confirmThreadArchive,
    showThreadJumpHints,
    })

  return {
    projectActions,
    renderedProjects: rendered.renderedProjects,
    renderedPinnedThreads: rendered.renderedPinnedThreads,
    isManualProjectSorting: rendered.isManualProjectSorting,
    desktopUpdate,
    threadJumpLabelById: keyboardNav.threadJumpLabelById,
    prByThreadId: derived.prByThreadId,
    confirmingArchiveThreadId,
    getThreadRowProps,
    getProjectItemProps,
  }
}
