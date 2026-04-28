/**
 * Sidebar — main navigation panel (thin orchestrator after decomposition).
 *
 * Extracted modules:
 * - `sidebar/ThreadRow.tsx`                  — thread-row rendering + status helpers
 * - `sidebar/ProjectItem.tsx`                — project-item rendering (uses ThreadRow)
 * - `sidebar/SidebarHelpers.tsx`             — ProjectSortMenu, SortableProjectItem
 * - `sidebar/useSidebarStoreBindings.ts`     — all store subscriptions
 * - `sidebar/useSidebarWiring.ts`            — hook wiring (derived data, actions, callbacks)
 * - `sidebar/useSidebarRenderedProjects.ts`  — per-project render data computation
 * - `sidebar/useSidebarCallbackFactories.ts` — getThreadRowProps / getProjectItemProps factories
 * - `Sidebar.hooks.ts`                       — custom hooks (callbacks, effects, derived data)
 * - `SidebarBody.tsx`                        — presentational return surface
 */

import { useEffect, useState } from 'react'
import type { ProjectId, ThreadId } from '@orxa-code/contracts'
import {
  type SidebarProjectSortOrder,
  type SidebarThreadSortOrder,
} from '@orxa-code/contracts/settings'
import { useSidebarStoreBindings } from './sidebar/useSidebarStoreBindings'
import { useSidebarWiring } from './sidebar/useSidebarWiring'
import { SidebarBody, type SidebarBodyProps } from './SidebarBody'
import { NewSessionModal } from './session'
import { useUiStateStore } from '../uiStateStore'

// -- Re-exports for external consumers --

export type { SidebarThreadSnapshot } from './sidebar/ThreadRow'
export type { SidebarProjectSnapshot } from './sidebar/ProjectItem'

// -- Types --

export type FullSidebarProjectSnapshot = import('../types').Project & {
  expanded: boolean
}

function buildSidebarBodyProps(
  s: ReturnType<typeof useSidebarStoreBindings>,
  w: ReturnType<typeof useSidebarWiring>
): SidebarBodyProps {
  return {
    isOnSettings: s.pathname.startsWith('/settings'),
    pathname: s.pathname,
    shouldShowProjectPathEntry:
      w.projectActions.addingProject && !s.shouldBrowseForProjectImmediately,
    showArm64IntelBuildWarning: w.desktopUpdate.showArm64IntelBuildWarning,
    arm64IntelBuildWarningDescription: w.desktopUpdate.arm64IntelBuildWarningDescription,
    desktopUpdateState: w.desktopUpdate.desktopUpdateState,
    desktopUpdateButtonAction: w.desktopUpdate.desktopUpdateButtonAction,
    desktopUpdateButtonDisabled: w.desktopUpdate.desktopUpdateButtonDisabled,
    onDesktopUpdateButtonClick: w.desktopUpdate.handleDesktopUpdateButtonClick,
    bootstrapComplete: s.bootstrapComplete,
    projects: s.projects,
    renderedPinnedThreads: w.renderedPinnedThreads,
    renderedProjects: w.renderedProjects,
    isManualProjectSorting: w.isManualProjectSorting,
    appSettings: {
      sidebarProjectSortOrder: s.appSettings.sidebarProjectSortOrder as SidebarProjectSortOrder,
      sidebarThreadSortOrder: s.appSettings.sidebarThreadSortOrder as SidebarThreadSortOrder,
    },
    onUpdateProjectSortOrder: (sortOrder: string) => {
      s.updateSettings({ sidebarProjectSortOrder: sortOrder as SidebarProjectSortOrder })
    },
    onUpdateThreadSortOrder: (sortOrder: string) => {
      s.updateSettings({ sidebarThreadSortOrder: sortOrder as SidebarThreadSortOrder })
    },
    newCwd: w.projectActions.newCwd,
    isPickingFolder: w.projectActions.isPickingFolder,
    isAddingProject: w.projectActions.isAddingProject,
    addProjectError: w.projectActions.addProjectError,
    addProjectInputRef: w.projectActions.addProjectInputRef,
    canAddProject: w.projectActions.canAddProject,
    onNewCwdChange: w.projectActions.setNewCwd,
    onAddProject: w.projectActions.handleAddProject,
    onStartAddProject: w.projectActions.handleStartAddProject,
    onPickFolder: w.projectActions.handlePickFolder,
    onAddProjectKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') w.projectActions.handleAddProject()
      if (e.key === 'Escape') {
        w.projectActions.setAddingProject(false)
        w.projectActions.setAddProjectError(null)
      }
    },
    onNavigateToSettings: () => void s.navigate({ to: '/settings' }),
    getThreadRowProps: w.getThreadRowProps,
    routeThreadId: s.routeThreadId,
    selectedThreadIds: s.selectedThreadIds,
    threadJumpLabelById: w.threadJumpLabelById,
    terminalStateByThreadId: s.terminalStateByThreadId,
    prByThreadId: w.prByThreadId,
    confirmingDeleteThreadId: w.confirmingDeleteThreadId,
    getProjectItemProps: w.getProjectItemProps,
    projectDnDSensors: w.projectActions.projectDnDSensors,
    projectCollisionDetection: w.projectActions.projectCollisionDetection,
    onProjectDragStart: w.projectActions.handleProjectDragStart,
    onProjectDragEnd: w.projectActions.handleProjectDragEnd,
    onProjectDragCancel: w.projectActions.handleProjectDragCancel,
    attachProjectListAutoAnimateRef: w.projectActions.attachProjectListAutoAnimateRef,
  }
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default function Sidebar() {
  const [modalOpen, setModalOpen] = useState(false)
  const [modalProjectId, setModalProjectId] = useState<ProjectId | null>(null)
  const [modalPrimaryThreadId, setModalPrimaryThreadId] = useState<ThreadId | null>(null)
  const pendingNewSessionModalRequest = useUiStateStore(
    store => store.pendingNewSessionModalRequest
  )
  const clearPendingNewSessionModal = useUiStateStore(store => store.clearPendingNewSessionModal)
  const s = useSidebarStoreBindings()
  const sWithModal: typeof s = {
    ...s,
    handleNewThread: projectId => {
      setModalProjectId(projectId)
      setModalOpen(true)
      return Promise.resolve()
    },
  }
  const w = useSidebarWiring(sWithModal)

  function handleCloseModal() {
    setModalOpen(false)
    setModalProjectId(null)
    setModalPrimaryThreadId(null)
  }

  useEffect(() => {
    if (!pendingNewSessionModalRequest) {
      return
    }
    setModalProjectId(pendingNewSessionModalRequest.projectId)
    setModalPrimaryThreadId(
      pendingNewSessionModalRequest.mode === 'split-secondary'
        ? (pendingNewSessionModalRequest.primaryThreadId ?? null)
        : null
    )
    setModalOpen(true)
    clearPendingNewSessionModal()
  }, [clearPendingNewSessionModal, pendingNewSessionModalRequest])

  const bodyProps = buildSidebarBodyProps(s, w)

  return (
    <>
      {modalOpen ? (
        <NewSessionModal
          open
          onClose={handleCloseModal}
          projectId={modalProjectId}
          {...(modalPrimaryThreadId
            ? {
                onCreated: async threadId => {
                  await s.navigate({
                    to: '/$threadId',
                    params: { threadId: modalPrimaryThreadId },
                    search: previous => ({
                      ...previous,
                      split: '1',
                      secondaryThreadId: threadId,
                      focusedPane: 'secondary',
                      maximizedPane: undefined,
                    }),
                    replace: true,
                  })
                },
              }
            : {})}
        />
      ) : null}
      <SidebarBody {...bodyProps} />
    </>
  )
}

// ── Re-exports ──────────────────────────────────────────────────────

export { ProjectSortMenu, SortableProjectItem } from './sidebar/SidebarHelpers'
export { AppBrandMark } from './SidebarBody'
