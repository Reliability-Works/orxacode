/**
 * useSidebarProjectActions — project CRUD / DnD / add-project actions.
 *
 * This file is a thin composer over sub-hooks living in sibling files:
 * useSidebarAddProject, useSidebarProjectDnD, useSidebarProjectTitleHandlers.
 */

import { useCallback, useRef, type PointerEvent } from 'react'
import { ProjectId, ThreadId } from '@orxa-code/contracts'
import { isElectron } from '../../env'
import { isLinuxPlatform } from '../../lib/utils'
import { execProjectContextMenu } from './projectActionHelpers'
import { useSidebarAddProject, type AddProjectState } from './useSidebarAddProject'
import { useSidebarProjectDnD } from './useSidebarProjectDnD'
import { useSidebarProjectTitleHandlers } from './useSidebarProjectTitleHandlers'
import type { SidebarThreadSnapshot } from './ThreadRow'
import type { Project } from '../../types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SidebarProjectActionsReturn extends AddProjectState {
  addProjectFromPath: (rawCwd: string) => Promise<void>
  handleAddProject: () => void
  handlePickFolder: () => Promise<void>
  handleStartAddProject: () => void
  focusMostRecentThreadForProject: (projectId: ProjectId) => void
  handleProjectContextMenu: (
    projectId: ProjectId,
    position: { x: number; y: number }
  ) => Promise<void>
  handleProjectDragStart: () => void
  handleProjectDragEnd: (event: import('@dnd-kit/core').DragEndEvent) => void
  handleProjectDragCancel: () => void
  handleProjectTitleClick: (
    event: React.MouseEvent<HTMLButtonElement>,
    projectId: ProjectId
  ) => void
  handleProjectTitleKeyDown: (
    event: React.KeyboardEvent<HTMLButtonElement>,
    projectId: ProjectId
  ) => void
  handleProjectTitlePointerDownCapture: (event: PointerEvent<HTMLButtonElement>) => void
  canAddProject: boolean
  dragInProgressRef: React.MutableRefObject<boolean>
  suppressProjectClickAfterDragRef: React.MutableRefObject<boolean>
  suppressProjectClickForContextMenuRef: React.MutableRefObject<boolean>
  projectDnDSensors: ReturnType<typeof import('@dnd-kit/core').useSensors>
  projectCollisionDetection: import('@dnd-kit/core').CollisionDetection
  attachProjectListAutoAnimateRef: (node: HTMLElement | null) => void
  attachThreadListAutoAnimateRef: (node: HTMLElement | null) => void
}

export interface SidebarProjectActionsParams {
  projects: Project[]
  threads: SidebarThreadSnapshot[]
  sidebarProjects: Array<Project & { expanded: boolean }>
  appSettings: {
    sidebarProjectSortOrder: string
    sidebarThreadSortOrder: string
    confirmThreadDelete?: boolean
  }
  reorderProjects: (activeId: ProjectId, overId: ProjectId) => void
  toggleProject: (projectId: ProjectId) => void
  navigate: ReturnType<typeof import('@tanstack/react-router').useNavigate>
  selectedThreadIds: ReadonlySet<ThreadId>
  clearSelection: () => void
  getDraftThreadByProjectId: (projectId: ProjectId) => { threadId: ThreadId } | null
  clearComposerDraftForThread: (threadId: ThreadId) => void
  clearProjectDraftThreadId: (projectId: ProjectId) => void
  copyPathToClipboard: (path: string, ctx: { path: string }) => void
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

function useProjectContextMenuHandler(
  params: Pick<
    SidebarProjectActionsParams,
    | 'projects'
    | 'threads'
    | 'copyPathToClipboard'
    | 'getDraftThreadByProjectId'
    | 'clearComposerDraftForThread'
    | 'clearProjectDraftThreadId'
  >
) {
  const {
    projects,
    threads,
    copyPathToClipboard,
    getDraftThreadByProjectId,
    clearComposerDraftForThread,
    clearProjectDraftThreadId,
  } = params
  return useCallback(
    async (projectId: ProjectId, position: { x: number; y: number }) => {
      await execProjectContextMenu({
        projectId,
        position,
        projects,
        threads,
        copyPathToClipboard,
        getDraftThreadByProjectId,
        clearComposerDraftForThread,
        clearProjectDraftThreadId,
      })
    },
    [
      clearComposerDraftForThread,
      clearProjectDraftThreadId,
      copyPathToClipboard,
      getDraftThreadByProjectId,
      projects,
      threads,
    ]
  )
}

export function useSidebarProjectActions(
  params: SidebarProjectActionsParams
): SidebarProjectActionsReturn {
  const isLinuxDesktop = isElectron && isLinuxPlatform(navigator.platform)
  const shouldBrowseForProjectImmediately = isElectron && !isLinuxDesktop
  const dragInProgressRef = useRef(false)
  const suppressProjectClickAfterDragRef = useRef(false)
  const suppressProjectClickForContextMenuRef = useRef(false)

  const addProject = useSidebarAddProject({
    projects: params.projects,
    appSettings: params.appSettings,
    navigate: params.navigate,
    threads: params.threads,
    shouldBrowseForProjectImmediately,
  })

  const handleProjectContextMenu = useProjectContextMenuHandler(params)

  const titleHandlers = useSidebarProjectTitleHandlers({
    toggleProject: params.toggleProject,
    selectedThreadIds: params.selectedThreadIds,
    clearSelection: params.clearSelection,
    dragInProgressRef,
    suppressProjectClickAfterDragRef,
    suppressProjectClickForContextMenuRef,
  })

  const dnd = useSidebarProjectDnD({
    appSettings: params.appSettings,
    sidebarProjects: params.sidebarProjects,
    reorderProjects: params.reorderProjects,
    dragInProgressRef,
    suppressProjectClickAfterDragRef,
  })

  return {
    ...addProject,
    handleProjectContextMenu,
    ...titleHandlers,
    dragInProgressRef,
    suppressProjectClickAfterDragRef,
    suppressProjectClickForContextMenuRef,
    ...dnd,
  }
}
