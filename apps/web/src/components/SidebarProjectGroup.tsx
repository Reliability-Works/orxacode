import type React from 'react'
import type { CollisionDetection, DragEndEvent } from '@dnd-kit/core'
import type { ThreadId } from '@orxa-code/contracts'
import type { Project } from '../types'
import type { SidebarProjectSortOrder, SidebarThreadSortOrder } from '@orxa-code/contracts/settings'
import { Tooltip, TooltipPopup, TooltipTrigger } from './ui/tooltip'
import { SidebarGroup } from './ui/sidebar'
import { PlusIcon } from 'lucide-react'
import { ProjectSortMenu } from './sidebar/SidebarHelpers'
import type { SortableProjectHandleProps } from './sidebar/SidebarHelpers'
import { ProjectItem } from './sidebar/ProjectItem'
import type {
  ProjectItemProps,
  RenderedPinnedThreadData,
  RenderedProjectData,
  ThreadPr,
} from './sidebar/ProjectItem'
import type { ThreadTerminalState } from '../terminalStateStore.logic'
import {
  AddProjectForm,
  SidebarDndProjectList,
  SidebarStaticProjectList,
  type AddProjectFormProps,
} from './SidebarProjectList'

export interface SidebarProjectGroupSharedProps {
  getThreadRowProps: ProjectItemProps['getThreadRowProps']
  routeThreadId: ThreadId | null
  selectedThreadIds: ReadonlySet<ThreadId>
  threadJumpLabelById: Map<ThreadId, string>
  terminalStateByThreadId: Record<ThreadId, ThreadTerminalState>
  prByThreadId: Map<ThreadId, ThreadPr | null>
  confirmingArchiveThreadId: ThreadId | null
  getProjectItemProps: () => {
    dragHandleProps: SortableProjectHandleProps | null
    projectItemProps: Omit<Parameters<typeof ProjectItem>[0], 'renderedProject' | 'dragHandleProps'>
  }
  projectDnDSensors: ReturnType<typeof import('@dnd-kit/core').useSensors>
  projectCollisionDetection: CollisionDetection
  onProjectDragStart: () => void
  onProjectDragEnd: (event: DragEndEvent) => void
  onProjectDragCancel: () => void
  attachProjectListAutoAnimateRef: (node: HTMLElement | null) => void
}

export interface SidebarProjectGroupProps extends SidebarProjectGroupSharedProps {
  projects: Project[]
  renderedPinnedThreads: RenderedPinnedThreadData[]
  renderedProjects: RenderedProjectData[]
  isManualProjectSorting: boolean
  shouldShowProjectPathEntry: boolean
  appSettings: {
    sidebarProjectSortOrder: SidebarProjectSortOrder
    sidebarThreadSortOrder: SidebarThreadSortOrder
  }
  onUpdateProjectSortOrder: (sortOrder: string) => void
  onUpdateThreadSortOrder: (sortOrder: string) => void
  onStartAddProject: () => void
  addFormProps: AddProjectFormProps
}

function SidebarProjectGroupHeader(props: {
  shouldShowProjectPathEntry: boolean
  appSettings: SidebarProjectGroupProps['appSettings']
  onUpdateProjectSortOrder: SidebarProjectGroupProps['onUpdateProjectSortOrder']
  onUpdateThreadSortOrder: SidebarProjectGroupProps['onUpdateThreadSortOrder']
  onStartAddProject: SidebarProjectGroupProps['onStartAddProject']
}) {
  return (
    <div className="mb-1 flex items-center justify-between pl-2 pr-1.5">
      <span className="text-mini font-medium uppercase tracking-wider text-muted-foreground/60">
        Projects
      </span>
      <div className="flex items-center gap-1">
        <ProjectSortMenu
          projectSortOrder={props.appSettings.sidebarProjectSortOrder}
          threadSortOrder={props.appSettings.sidebarThreadSortOrder}
          onProjectSortOrderChange={props.onUpdateProjectSortOrder}
          onThreadSortOrderChange={props.onUpdateThreadSortOrder}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={props.shouldShowProjectPathEntry ? 'Cancel add project' : 'Add project'}
                aria-pressed={props.shouldShowProjectPathEntry}
                className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                onClick={props.onStartAddProject}
              />
            }
          >
            <PlusIcon
              className={`size-3.5 transition-transform duration-150 ${props.shouldShowProjectPathEntry ? 'rotate-45' : 'rotate-0'}`}
            />
          </TooltipTrigger>
          <TooltipPopup side="right">
            {props.shouldShowProjectPathEntry ? 'Cancel add project' : 'Add project'}
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  )
}

function SidebarProjectGroupList(
  props: Omit<
    SidebarProjectGroupProps,
    | 'projects'
    | 'shouldShowProjectPathEntry'
    | 'appSettings'
    | 'onUpdateProjectSortOrder'
    | 'onUpdateThreadSortOrder'
    | 'onStartAddProject'
    | 'addFormProps'
  >
) {
  const sharedListProps = {
    renderedPinnedThreads: props.renderedPinnedThreads,
    renderedProjects: props.renderedProjects,
    getProjectItemProps: props.getProjectItemProps,
    getThreadRowProps: props.getThreadRowProps,
    routeThreadId: props.routeThreadId,
    selectedThreadIds: props.selectedThreadIds,
    threadJumpLabelById: props.threadJumpLabelById,
    terminalStateByThreadId: props.terminalStateByThreadId,
    prByThreadId: props.prByThreadId,
    confirmingArchiveThreadId: props.confirmingArchiveThreadId,
  }

  return props.isManualProjectSorting ? (
    <SidebarDndProjectList
      {...sharedListProps}
      projectDnDSensors={props.projectDnDSensors}
      projectCollisionDetection={props.projectCollisionDetection}
      onProjectDragStart={props.onProjectDragStart}
      onProjectDragEnd={props.onProjectDragEnd}
      onProjectDragCancel={props.onProjectDragCancel}
    />
  ) : (
    <SidebarStaticProjectList
      {...sharedListProps}
      attachProjectListAutoAnimateRef={props.attachProjectListAutoAnimateRef}
    />
  )
}

export function SidebarProjectGroup(props: SidebarProjectGroupProps) {
  return (
    <SidebarGroup className="px-2 py-2">
      <SidebarProjectGroupHeader
        shouldShowProjectPathEntry={props.shouldShowProjectPathEntry}
        appSettings={props.appSettings}
        onUpdateProjectSortOrder={props.onUpdateProjectSortOrder}
        onUpdateThreadSortOrder={props.onUpdateThreadSortOrder}
        onStartAddProject={props.onStartAddProject}
      />
      {props.shouldShowProjectPathEntry && <AddProjectForm {...props.addFormProps} />}
      <SidebarProjectGroupList {...props} />
      {props.projects.length === 0 && !props.shouldShowProjectPathEntry ? (
        <div className="px-2 pt-4 text-center text-xs text-muted-foreground/60">
          No projects yet
        </div>
      ) : null}
    </SidebarGroup>
  )
}
