/**
 * useSidebarCallbackFactories — builds `getThreadRowProps` and `getProjectItemProps`
 * callback factories for the Sidebar component tree.
 */

import { useCallback } from 'react'
import type { ThreadId, ProjectId } from '@orxa-code/contracts'
import type { SidebarThreadSnapshot } from './ThreadRow'
import type { SortableProjectHandleProps } from './SidebarHelpers'
import type { DraftThreadEnvMode } from '../../composerDraftStore'
import type { SidebarThreadActionsReturn } from './useSidebarThreadActions'
import type { SidebarProjectActionsReturn } from './useSidebarProjectActions'
import type { ThreadPr } from './ProjectItem'
import { useSidebarInteractionState } from './useSidebarInteractionState'
import { useSidebar } from '../ui/sidebar.shared'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CallbackFactoriesParams {
  threadActions: SidebarThreadActionsReturn
  projectActions: Pick<
    SidebarProjectActionsReturn,
    | 'handleProjectTitleClick'
    | 'handleProjectTitleKeyDown'
    | 'handleProjectContextMenu'
    | 'attachThreadListAutoAnimateRef'
  >
  keyboardNavThreadJumpLabelById: Map<ThreadId, string>
  terminalStateByThreadId: Record<
    ThreadId,
    import('../../terminalStateStore.logic').ThreadTerminalState
  >
  prByThreadId: Map<ThreadId, ThreadPr | null>
  routeThreadId: ThreadId | null
  selectedThreadIds: ReadonlySet<ThreadId>
  clearSelection: () => void
  expandThreadListForProject: (projectId: ProjectId) => void
  collapseThreadListForProject: (projectId: ProjectId) => void
  isManualProjectSorting: boolean
  newThreadShortcutLabel: string | null
  handleNewThread: (projectId: ProjectId, options?: { envMode?: DraftThreadEnvMode }) => void
  defaultThreadEnvMode: import('../Sidebar.logic').SidebarNewThreadEnvMode
  confirmThreadArchive: boolean | undefined
  showThreadJumpHints: boolean
  setParentThreadExpanded: (threadId: ThreadId, expanded: boolean) => void
}

// ---------------------------------------------------------------------------
// Sub-hooks
// ---------------------------------------------------------------------------

interface ThreadRowPropsHookParams {
  threadActions: SidebarThreadActionsReturn
  confirmingArchiveThreadId: ThreadId | null
  setConfirmingArchiveThreadId: ReturnType<
    typeof useSidebarInteractionState
  >['setConfirmingArchiveThreadId']
  confirmArchiveButtonRefs: ReturnType<
    typeof useSidebarInteractionState
  >['confirmArchiveButtonRefs']
  selectedThreadIds: ReadonlySet<ThreadId>
  clearSelection: () => void
  confirmThreadArchive: boolean | undefined
  openPrLink: ReturnType<typeof useSidebarInteractionState>['openPrLink']
  showThreadJumpHints: boolean
  setParentThreadExpanded: (threadId: ThreadId, expanded: boolean) => void
}

function useGetThreadRowProps(params: ThreadRowPropsHookParams) {
  const {
    threadActions,
    confirmingArchiveThreadId,
    setConfirmingArchiveThreadId,
    confirmArchiveButtonRefs,
    selectedThreadIds,
    clearSelection,
    confirmThreadArchive,
    openPrLink,
    showThreadJumpHints,
    setParentThreadExpanded,
  } = params
  return useCallback(
    (thread: SidebarThreadSnapshot) => ({
      onThreadClick: threadActions.handleThreadClick,
      onToggleChildren: setParentThreadExpanded,
      onThreadNavigate: threadActions.navigateToThread,
      onThreadContextMenu: threadActions.handleThreadContextMenu,
      onMultiSelectContextMenu: threadActions.handleMultiSelectContextMenu,
      onOpenPrLink: openPrLink,
      rename: {
        isRenaming: threadActions.renamingThreadId === thread.id,
        title: threadActions.renamingTitle,
        onTitleChange: threadActions.setRenamingTitle,
        onCommit: threadActions.commitRename,
        onCancel: threadActions.cancelRename,
        inputRef: threadActions.renamingInputRef,
        committedRef: threadActions.renamingCommittedRef,
      },
      archive: {
        isConfirming:
          confirmingArchiveThreadId === thread.id &&
          !(thread.session?.status === 'running' && thread.session.activeTurnId != null),
        onConfirmingChange: setConfirmingArchiveThreadId,
        buttonRefs: confirmArchiveButtonRefs,
        onAttempt: threadActions.attemptArchiveThread,
        confirmThreadArchive: confirmThreadArchive ?? false,
      },
      showThreadJumpHints,
      selectedThreadIds,
      clearSelection,
    }),
    [
      threadActions,
      confirmingArchiveThreadId,
      setConfirmingArchiveThreadId,
      confirmArchiveButtonRefs,
      selectedThreadIds,
      clearSelection,
      confirmThreadArchive,
      openPrLink,
      showThreadJumpHints,
      setParentThreadExpanded,
    ]
  )
}

interface ProjectItemPropsHookParams extends Pick<
  CallbackFactoriesParams,
  | 'projectActions'
  | 'keyboardNavThreadJumpLabelById'
  | 'terminalStateByThreadId'
  | 'prByThreadId'
  | 'routeThreadId'
  | 'selectedThreadIds'
  | 'expandThreadListForProject'
  | 'collapseThreadListForProject'
  | 'isManualProjectSorting'
  | 'newThreadShortcutLabel'
  | 'handleNewThread'
  | 'defaultThreadEnvMode'
> {
  confirmingArchiveThreadId: ThreadId | null
  getThreadRowProps: ReturnType<typeof useGetThreadRowProps>
}

function useGetProjectItemProps(params: ProjectItemPropsHookParams) {
  const {
    projectActions,
    keyboardNavThreadJumpLabelById,
    terminalStateByThreadId,
    prByThreadId,
    routeThreadId,
    selectedThreadIds,
    expandThreadListForProject,
    collapseThreadListForProject,
    isManualProjectSorting,
    newThreadShortcutLabel,
    handleNewThread,
    defaultThreadEnvMode,
    confirmingArchiveThreadId,
    getThreadRowProps,
  } = params
  return useCallback(
    () => ({
      dragHandleProps: null as SortableProjectHandleProps | null,
      projectItemProps: {
        routeThreadId: routeThreadId ?? null,
        selectedThreadIds,
        threadJumpLabelById: keyboardNavThreadJumpLabelById,
        terminalStateByThreadId,
        prByThreadId,
        confirmingArchiveThreadId,
        defaultThreadEnvMode,
        onNewThread: handleNewThread,
        onProjectTitleClick: projectActions.handleProjectTitleClick,
        onProjectTitleKeyDown: projectActions.handleProjectTitleKeyDown,
        onProjectContextMenu: projectActions.handleProjectContextMenu,
        onExpandThreadList: expandThreadListForProject,
        onCollapseThreadList: collapseThreadListForProject,
        attachThreadListAutoAnimateRef: projectActions.attachThreadListAutoAnimateRef,
        getThreadRowProps,
        isManualProjectSorting,
        newThreadShortcutLabel,
      },
    }),
    [
      routeThreadId,
      selectedThreadIds,
      keyboardNavThreadJumpLabelById,
      terminalStateByThreadId,
      prByThreadId,
      confirmingArchiveThreadId,
      defaultThreadEnvMode,
      handleNewThread,
      projectActions,
      expandThreadListForProject,
      collapseThreadListForProject,
      getThreadRowProps,
      isManualProjectSorting,
      newThreadShortcutLabel,
    ]
  )
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSidebarCallbackFactories(params: CallbackFactoriesParams) {
  const { selectedThreadIds, clearSelection } = params
  const { isMobile, setOpenMobile } = useSidebar()
  const {
    confirmingArchiveThreadId,
    setConfirmingArchiveThreadId,
    confirmArchiveButtonRefs,
    openPrLink,
  } = useSidebarInteractionState({ selectedThreadIds, clearSelection })

  const closeMobileSidebar = useCallback(() => {
    if (!isMobile) return
    setOpenMobile(false)
  }, [isMobile, setOpenMobile])

  const getThreadRowProps = useGetThreadRowProps({
    threadActions: {
      ...params.threadActions,
      handleThreadClick: (event, threadId, orderedProjectThreadIds) => {
        const isMac = navigator.platform.toLowerCase().includes('mac')
        const isModClick = isMac ? event.metaKey : event.ctrlKey
        if (!isModClick && !event.shiftKey) closeMobileSidebar()
        params.threadActions.handleThreadClick(event, threadId, orderedProjectThreadIds)
      },
      navigateToThread: threadId => {
        closeMobileSidebar()
        params.threadActions.navigateToThread(threadId)
      },
    },
    confirmingArchiveThreadId,
    setConfirmingArchiveThreadId,
    confirmArchiveButtonRefs,
    selectedThreadIds,
    clearSelection,
    confirmThreadArchive: params.confirmThreadArchive,
    openPrLink,
    showThreadJumpHints: params.showThreadJumpHints,
    setParentThreadExpanded: params.setParentThreadExpanded,
  })

  const getProjectItemProps = useGetProjectItemProps({
    projectActions: params.projectActions,
    keyboardNavThreadJumpLabelById: params.keyboardNavThreadJumpLabelById,
    terminalStateByThreadId: params.terminalStateByThreadId,
    prByThreadId: params.prByThreadId,
    routeThreadId: params.routeThreadId,
    selectedThreadIds,
    expandThreadListForProject: params.expandThreadListForProject,
    collapseThreadListForProject: params.collapseThreadListForProject,
    isManualProjectSorting: params.isManualProjectSorting,
    newThreadShortcutLabel: params.newThreadShortcutLabel,
    handleNewThread: params.handleNewThread,
    defaultThreadEnvMode: params.defaultThreadEnvMode,
    confirmingArchiveThreadId,
    getThreadRowProps,
  })

  return { getThreadRowProps, getProjectItemProps, confirmingArchiveThreadId }
}
