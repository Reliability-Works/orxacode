/**
 * SidebarBody — presentational return surface extracted from Sidebar().
 *
 * Receives all computed data and callbacks as props and renders the full
 * sidebar DOM tree.  Keeps Sidebar.tsx focused on orchestration (hook calls
 * + wiring).
 */

import { LayoutDashboardIcon, PlugZapIcon, TriangleAlertIcon, ZapIcon } from 'lucide-react'
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
import { cn } from '~/lib/utils'
import { SettingsSidebarNav } from './settings/SettingsSidebarNav'
import { ScrollArea } from './ui/scroll-area'
import { useSidebar } from './ui/sidebar.shared'
import type { SortableProjectHandleProps } from './sidebar/SidebarHelpers'
import { ProjectItem } from './sidebar/ProjectItem'
import type {
  ProjectItemProps,
  RenderedPinnedThreadData,
  RenderedProjectData,
  ThreadPr,
} from './sidebar/ProjectItem'
import type { ThreadId } from '@orxa-code/contracts'
import type { ThreadTerminalState } from '../terminalStateStore.logic'
import { type AddProjectFormProps } from './SidebarProjectList'
import { SidebarProjectGroup, type SidebarProjectGroupProps } from './SidebarProjectGroup'
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
  onDesktopUpdateButtonClick: (anchor?: HTMLElement | null) => void

  // -- Projects --
  projects: Project[]
  renderedPinnedThreads: RenderedPinnedThreadData[]
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

  // -- Pinned thread rendering --
  getThreadRowProps: ProjectItemProps['getThreadRowProps']
  routeThreadId: ThreadId | null
  selectedThreadIds: ReadonlySet<ThreadId>
  threadJumpLabelById: Map<ThreadId, string>
  terminalStateByThreadId: Record<ThreadId, ThreadTerminalState>
  prByThreadId: Map<ThreadId, ThreadPr | null>
  confirmingArchiveThreadId: ThreadId | null

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
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            className={cn(
              'gap-2 px-2 py-1.5',
              pathname === '/plugins'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground/70 hover:bg-accent hover:text-foreground'
            )}
            onClick={() => void navigate({ to: '/plugins' })}
          >
            <PlugZapIcon className="size-3.5" />
            <span className="text-xs">Plugins</span>
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

function SidebarProjectSection(props: SidebarMainViewProps) {
  return (
    <SidebarMainContent
      showArm64IntelBuildWarning={props.showArm64IntelBuildWarning}
      arm64IntelBuildWarningDescription={props.arm64IntelBuildWarningDescription}
      desktopUpdateButtonAction={props.desktopUpdateButtonAction}
      desktopUpdateButtonDisabled={props.desktopUpdateButtonDisabled}
      onDesktopUpdateButtonClick={props.onDesktopUpdateButtonClick}
      projects={props.projects}
      renderedPinnedThreads={props.renderedPinnedThreads}
      renderedProjects={props.renderedProjects}
      isManualProjectSorting={props.isManualProjectSorting}
      shouldShowProjectPathEntry={props.shouldShowProjectPathEntry}
      appSettings={props.appSettings}
      onUpdateProjectSortOrder={props.onUpdateProjectSortOrder}
      onUpdateThreadSortOrder={props.onUpdateThreadSortOrder}
      onStartAddProject={props.onStartAddProject}
      getThreadRowProps={props.getThreadRowProps}
      routeThreadId={props.routeThreadId}
      selectedThreadIds={props.selectedThreadIds}
      threadJumpLabelById={props.threadJumpLabelById}
      terminalStateByThreadId={props.terminalStateByThreadId}
      prByThreadId={props.prByThreadId}
      confirmingArchiveThreadId={props.confirmingArchiveThreadId}
      getProjectItemProps={props.getProjectItemProps}
      projectDnDSensors={props.projectDnDSensors}
      projectCollisionDetection={props.projectCollisionDetection}
      onProjectDragStart={props.onProjectDragStart}
      onProjectDragEnd={props.onProjectDragEnd}
      onProjectDragCancel={props.onProjectDragCancel}
      attachProjectListAutoAnimateRef={props.attachProjectListAutoAnimateRef}
      addFormProps={buildAddFormProps(props)}
    />
  )
}

function SidebarMainView(props: SidebarMainViewProps) {
  const { isMobile } = useSidebar()
  return (
    <>
      <SidebarContent className="gap-0">
        {!isMobile ? <SidebarTopNav pathname={props.pathname} /> : null}
        {!isMobile ? <SidebarSeparator /> : null}
        <SidebarProjectSection {...props} />
      </SidebarContent>
      {!isMobile ? <SidebarSeparator /> : null}
      {!isMobile ? (
        <SidebarMainFooter
          desktopUpdateState={props.desktopUpdateState}
          onNavigateToSettings={props.onNavigateToSettings}
          onUpdateAction={props.onDesktopUpdateButtonClick}
        />
      ) : null}
    </>
  )
}

function SidebarMobileThreadsView(props: SidebarMainViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-sidebar text-sidebar-foreground">
      <div className="border-b border-sidebar-border px-4 py-3">
        <div className="text-sm font-medium text-sidebar-foreground">Threads</div>
      </div>
      <ScrollArea hideScrollbars scrollFade className="min-h-0 flex-1">
        <div className="px-2 py-2">
          <SidebarProjectSection {...props} />
        </div>
      </ScrollArea>
    </div>
  )
}

function SidebarMainContent(
  props: SidebarProjectGroupProps & {
    showArm64IntelBuildWarning: boolean
    arm64IntelBuildWarningDescription: string | null
    desktopUpdateButtonAction: 'download' | 'install' | 'none'
    desktopUpdateButtonDisabled: boolean
    onDesktopUpdateButtonClick: () => void
  }
) {
  return (
    <>
      {props.showArm64IntelBuildWarning && props.arm64IntelBuildWarningDescription ? (
        <SidebarArm64Warning
          description={props.arm64IntelBuildWarningDescription}
          buttonAction={props.desktopUpdateButtonAction}
          buttonDisabled={props.desktopUpdateButtonDisabled}
          onButtonClick={props.onDesktopUpdateButtonClick}
        />
      ) : null}
      <SidebarProjectGroup {...props} />
    </>
  )
}

// ---------------------------------------------------------------------------
// SidebarBody component
// ---------------------------------------------------------------------------

export function SidebarBody({ isOnSettings, pathname, ...rest }: SidebarBodyProps) {
  const { isMobile } = useSidebar()
  return (
    <>
      {!isMobile ? (
        <SidebarHeader
          aria-hidden="true"
          className={isElectron ? 'drag-region h-[52px] p-0' : 'h-[52px] p-0'}
        />
      ) : null}
      {isOnSettings ? (
        <SettingsSidebarNav pathname={pathname} />
      ) : isMobile ? (
        <SidebarMobileThreadsView pathname={pathname} {...rest} />
      ) : (
        <SidebarMainView pathname={pathname} {...rest} />
      )}
    </>
  )
}
