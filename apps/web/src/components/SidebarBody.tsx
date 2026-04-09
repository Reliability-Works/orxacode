/**
 * SidebarBody — presentational return surface extracted from Sidebar().
 *
 * Receives all computed data and callbacks as props and renders the full
 * sidebar DOM tree.  Keeps Sidebar.tsx focused on orchestration (hook calls
 * + wiring).
 */

import { LayoutDashboardIcon, PlusIcon, TriangleAlertIcon, ZapIcon } from 'lucide-react'
import type React from 'react'
import { useNavigate } from '@tanstack/react-router'
import { type CollisionDetection, type DragEndEvent } from '@dnd-kit/core'
import type { DesktopUpdateState } from '@orxa-code/contracts'
import { isElectron } from '../env'
import type { Project } from '../types'
import type { SidebarProjectSortOrder, SidebarThreadSortOrder } from '@orxa-code/contracts/settings'
import {
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarSeparator,
} from './ui/sidebar'
import { Alert, AlertAction, AlertDescription, AlertTitle } from './ui/alert'
import { Button } from './ui/button'
import { Tooltip, TooltipPopup, TooltipTrigger } from './ui/tooltip'
import { cn } from '~/lib/utils'
import { SettingsSidebarNav } from './settings/SettingsSidebarNav'
import { ProjectSortMenu } from './sidebar/SidebarHelpers'
import type { SortableProjectHandleProps } from './sidebar/SidebarHelpers'
import { ProjectItem } from './sidebar/ProjectItem'
import type { RenderedProjectData } from './sidebar/ProjectItem'
import {
  AddProjectForm,
  SidebarDndProjectList,
  SidebarStaticProjectList,
  type AddProjectFormProps,
} from './SidebarProjectList'
import { SidebarMainFooter } from './sidebar/SidebarFooterActions'

// ---------------------------------------------------------------------------
// Sub-components still defined in Sidebar.tsx and re-exported
// ---------------------------------------------------------------------------

/** Tiny brand badge rendered in the sidebar header. */
export function AppBrandMark() {
  return (
    <span
      aria-label="Orxa"
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-[5px] bg-foreground/90 text-[9px] font-semibold leading-none text-background"
    >
      O
    </span>
  )
}

// ---------------------------------------------------------------------------
// SidebarBody props
// ---------------------------------------------------------------------------

export interface SidebarBodyProps {
  isOnSettings: boolean
  pathname: string

  // -- Desktop / platform --
  shouldShowProjectPathEntry: boolean

  // -- Desktop update --
  showArm64IntelBuildWarning: boolean
  arm64IntelBuildWarningDescription: string | null
  desktopUpdateState: DesktopUpdateState | null
  desktopUpdateButtonAction: 'download' | 'install' | 'none'
  desktopUpdateButtonDisabled: boolean
  onDesktopUpdateButtonClick: () => void

  // -- Projects --
  projects: Project[]
  renderedProjects: RenderedProjectData[]
  isManualProjectSorting: boolean

  // -- Settings --
  appSettings: {
    sidebarProjectSortOrder: SidebarProjectSortOrder
    sidebarThreadSortOrder: SidebarThreadSortOrder
  }
  onUpdateProjectSortOrder: (sortOrder: string) => void
  onUpdateThreadSortOrder: (sortOrder: string) => void

  // -- Add-project UI --
  newCwd: string
  isPickingFolder: boolean
  isAddingProject: boolean
  addProjectError: string | null
  addProjectInputRef: React.RefObject<HTMLInputElement | null>
  canAddProject: boolean
  onNewCwdChange: (value: string) => void
  onAddProject: () => void
  onStartAddProject: () => void
  onPickFolder: () => void
  onAddProjectKeyDown: (event: React.KeyboardEvent) => void

  // -- Navigation --
  onNavigateToSettings: () => void

  // -- Callbacks passed through to ProjectItem --
  getProjectItemProps: () => {
    dragHandleProps: SortableProjectHandleProps | null
    projectItemProps: Omit<Parameters<typeof ProjectItem>[0], 'renderedProject' | 'dragHandleProps'>
  }

  // -- DnD --
  projectDnDSensors: ReturnType<typeof import('@dnd-kit/core').useSensors>
  projectCollisionDetection: CollisionDetection
  onProjectDragStart: () => void
  onProjectDragEnd: (event: DragEndEvent) => void
  onProjectDragCancel: () => void

  // -- Auto-animate --
  attachProjectListAutoAnimateRef: (node: HTMLElement | null) => void
}

// ---------------------------------------------------------------------------
// SidebarProjectGroup — the project section content
// ---------------------------------------------------------------------------

interface SidebarProjectGroupProps {
  projects: Project[]
  renderedProjects: RenderedProjectData[]
  isManualProjectSorting: boolean
  shouldShowProjectPathEntry: boolean
  appSettings: SidebarBodyProps['appSettings']
  onUpdateProjectSortOrder: SidebarBodyProps['onUpdateProjectSortOrder']
  onUpdateThreadSortOrder: SidebarBodyProps['onUpdateThreadSortOrder']
  onStartAddProject: SidebarBodyProps['onStartAddProject']
  getProjectItemProps: SidebarBodyProps['getProjectItemProps']
  projectDnDSensors: SidebarBodyProps['projectDnDSensors']
  projectCollisionDetection: SidebarBodyProps['projectCollisionDetection']
  onProjectDragStart: SidebarBodyProps['onProjectDragStart']
  onProjectDragEnd: SidebarBodyProps['onProjectDragEnd']
  onProjectDragCancel: SidebarBodyProps['onProjectDragCancel']
  attachProjectListAutoAnimateRef: SidebarBodyProps['attachProjectListAutoAnimateRef']
  addFormProps: AddProjectFormProps
}

interface SidebarProjectGroupHeaderProps {
  shouldShowProjectPathEntry: boolean
  appSettings: SidebarBodyProps['appSettings']
  onUpdateProjectSortOrder: SidebarBodyProps['onUpdateProjectSortOrder']
  onUpdateThreadSortOrder: SidebarBodyProps['onUpdateThreadSortOrder']
  onStartAddProject: SidebarBodyProps['onStartAddProject']
}

function SidebarProjectGroupHeader({
  shouldShowProjectPathEntry,
  appSettings,
  onUpdateProjectSortOrder,
  onUpdateThreadSortOrder,
  onStartAddProject,
}: SidebarProjectGroupHeaderProps) {
  return (
    <div className="mb-1 flex items-center justify-between pl-2 pr-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
        Projects
      </span>
      <div className="flex items-center gap-1">
        <ProjectSortMenu
          projectSortOrder={appSettings.sidebarProjectSortOrder}
          threadSortOrder={appSettings.sidebarThreadSortOrder}
          onProjectSortOrderChange={onUpdateProjectSortOrder}
          onThreadSortOrderChange={onUpdateThreadSortOrder}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={shouldShowProjectPathEntry ? 'Cancel add project' : 'Add project'}
                aria-pressed={shouldShowProjectPathEntry}
                className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                onClick={onStartAddProject}
              />
            }
          >
            <PlusIcon
              className={`size-3.5 transition-transform duration-150 ${shouldShowProjectPathEntry ? 'rotate-45' : 'rotate-0'}`}
            />
          </TooltipTrigger>
          <TooltipPopup side="right">
            {shouldShowProjectPathEntry ? 'Cancel add project' : 'Add project'}
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  )
}

function SidebarProjectGroup({
  projects,
  renderedProjects,
  isManualProjectSorting,
  shouldShowProjectPathEntry,
  appSettings,
  onUpdateProjectSortOrder,
  onUpdateThreadSortOrder,
  onStartAddProject,
  getProjectItemProps,
  projectDnDSensors,
  projectCollisionDetection,
  onProjectDragStart,
  onProjectDragEnd,
  onProjectDragCancel,
  attachProjectListAutoAnimateRef,
  addFormProps,
}: SidebarProjectGroupProps) {
  return (
    <SidebarGroup className="px-2 py-2">
      <SidebarProjectGroupHeader
        shouldShowProjectPathEntry={shouldShowProjectPathEntry}
        appSettings={appSettings}
        onUpdateProjectSortOrder={onUpdateProjectSortOrder}
        onUpdateThreadSortOrder={onUpdateThreadSortOrder}
        onStartAddProject={onStartAddProject}
      />
      {shouldShowProjectPathEntry && <AddProjectForm {...addFormProps} />}

      {isManualProjectSorting ? (
        <SidebarDndProjectList
          renderedProjects={renderedProjects}
          getProjectItemProps={getProjectItemProps}
          projectDnDSensors={projectDnDSensors}
          projectCollisionDetection={projectCollisionDetection}
          onProjectDragStart={onProjectDragStart}
          onProjectDragEnd={onProjectDragEnd}
          onProjectDragCancel={onProjectDragCancel}
        />
      ) : (
        <SidebarStaticProjectList
          renderedProjects={renderedProjects}
          getProjectItemProps={getProjectItemProps}
          attachProjectListAutoAnimateRef={attachProjectListAutoAnimateRef}
        />
      )}

      {projects.length === 0 && !shouldShowProjectPathEntry && (
        <div className="px-2 pt-4 text-center text-xs text-muted-foreground/60">
          No projects yet
        </div>
      )}
    </SidebarGroup>
  )
}

// ---------------------------------------------------------------------------
// SidebarArm64Warning — ARM/Intel build alert
// ---------------------------------------------------------------------------

function SidebarArm64Warning({
  description,
  buttonAction,
  buttonDisabled,
  onButtonClick,
}: {
  description: string
  buttonAction: 'download' | 'install' | 'none'
  buttonDisabled: boolean
  onButtonClick: () => void
}) {
  return (
    <SidebarGroup className="px-2 pt-2 pb-0">
      <Alert variant="warning" className="rounded-2xl border-warning/40 bg-warning/8">
        <TriangleAlertIcon />
        <AlertTitle>Intel build on Apple Silicon</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
        {buttonAction !== 'none' ? (
          <AlertAction>
            <Button size="xs" variant="outline" disabled={buttonDisabled} onClick={onButtonClick}>
              {buttonAction === 'download' ? 'Download ARM build' : 'Install ARM build'}
            </Button>
          </AlertAction>
        ) : null}
      </Alert>
    </SidebarGroup>
  )
}

// ---------------------------------------------------------------------------
// SidebarMainView — non-settings main project/thread content
// ---------------------------------------------------------------------------

type SidebarMainViewProps = Omit<SidebarBodyProps, 'isOnSettings'>

function SidebarTopNav({ pathname }: { pathname: string }) {
  const navigate = useNavigate()
  return (
    <SidebarGroup className="px-2 pb-1 pt-2">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            className={cn(
              'gap-2 px-2 py-1.5',
              pathname === '/dashboard'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground/70 hover:bg-accent hover:text-foreground'
            )}
            onClick={() => void navigate({ to: '/dashboard' })}
          >
            <LayoutDashboardIcon className="size-3.5" />
            <span className="text-xs">Dashboard</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            className={cn(
              'gap-2 px-2 py-1.5',
              pathname === '/skills'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground/70 hover:bg-accent hover:text-foreground'
            )}
            onClick={() => void navigate({ to: '/skills' })}
          >
            <ZapIcon className="size-3.5" />
            <span className="text-xs">Skills</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}

function buildAddFormProps(p: SidebarMainViewProps): AddProjectFormProps {
  return {
    isPickingFolder: p.isPickingFolder,
    isAddingProject: p.isAddingProject,
    addProjectError: p.addProjectError,
    addProjectInputRef: p.addProjectInputRef,
    canAddProject: p.canAddProject,
    newCwd: p.newCwd,
    onNewCwdChange: p.onNewCwdChange,
    onPickFolder: p.onPickFolder,
    onAddProject: p.onAddProject,
    onAddProjectKeyDown: p.onAddProjectKeyDown,
  }
}

function SidebarMainView(props: SidebarMainViewProps) {
  const {
    pathname,
    shouldShowProjectPathEntry,
    showArm64IntelBuildWarning,
    arm64IntelBuildWarningDescription,
    desktopUpdateState,
    desktopUpdateButtonAction,
    desktopUpdateButtonDisabled,
    onDesktopUpdateButtonClick,
    projects,
    renderedProjects,
    isManualProjectSorting,
    appSettings,
    onUpdateProjectSortOrder,
    onUpdateThreadSortOrder,
    onStartAddProject,
    onNavigateToSettings,
    getProjectItemProps,
    projectDnDSensors,
    projectCollisionDetection,
    onProjectDragStart,
    onProjectDragEnd,
    onProjectDragCancel,
    attachProjectListAutoAnimateRef,
  } = props
  const addFormProps = buildAddFormProps(props)
  return (
    <>
      <SidebarContent className="gap-0">
        <SidebarTopNav pathname={pathname} />
        <SidebarSeparator />
        {showArm64IntelBuildWarning && arm64IntelBuildWarningDescription ? (
          <SidebarArm64Warning
            description={arm64IntelBuildWarningDescription}
            buttonAction={desktopUpdateButtonAction}
            buttonDisabled={desktopUpdateButtonDisabled}
            onButtonClick={onDesktopUpdateButtonClick}
          />
        ) : null}
        <SidebarProjectGroup
          projects={projects}
          renderedProjects={renderedProjects}
          isManualProjectSorting={isManualProjectSorting}
          shouldShowProjectPathEntry={shouldShowProjectPathEntry}
          appSettings={appSettings}
          onUpdateProjectSortOrder={onUpdateProjectSortOrder}
          onUpdateThreadSortOrder={onUpdateThreadSortOrder}
          onStartAddProject={onStartAddProject}
          getProjectItemProps={getProjectItemProps}
          projectDnDSensors={projectDnDSensors}
          projectCollisionDetection={projectCollisionDetection}
          onProjectDragStart={onProjectDragStart}
          onProjectDragEnd={onProjectDragEnd}
          onProjectDragCancel={onProjectDragCancel}
          attachProjectListAutoAnimateRef={attachProjectListAutoAnimateRef}
          addFormProps={addFormProps}
        />
      </SidebarContent>
      <SidebarSeparator />
      <SidebarMainFooter
        desktopUpdateState={desktopUpdateState}
        onNavigateToSettings={onNavigateToSettings}
        onUpdateAction={onDesktopUpdateButtonClick}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// SidebarBody component
// ---------------------------------------------------------------------------

export function SidebarBody({ isOnSettings, pathname, ...rest }: SidebarBodyProps) {
  return (
    <>
      {/* Empty spacer that reserves room for the fixed AppTopLeftBar so
          sidebar content never slides under the toggle + wordmark. */}
      <SidebarHeader
        aria-hidden="true"
        className={isElectron ? 'drag-region h-[52px] p-0' : 'h-[52px] p-0'}
      />
      {isOnSettings ? (
        <SettingsSidebarNav pathname={pathname} />
      ) : (
        <SidebarMainView pathname={pathname} {...rest} />
      )}
    </>
  )
}
