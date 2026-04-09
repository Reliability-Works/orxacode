import { ChevronRightIcon, SquarePenIcon } from 'lucide-react'
import type { ProjectId, ThreadId } from '@orxa-code/contracts'
import type { GitStatusResult } from '@orxa-code/contracts'
import type { ThreadTerminalState } from '../../terminalStateStore.logic'
import { selectThreadTerminalState } from '../../terminalStateStore'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/tooltip'
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '../ui/sidebar'
import { ProjectFavicon } from '../ProjectFavicon'
import {
  resolveSidebarNewThreadEnvMode,
  resolveThreadRowClassName,
  type ThreadStatusPill,
} from '../Sidebar.logic'
import {
  ThreadRow,
  ThreadStatusLabel,
  type ThreadRowProps,
  type SidebarThreadSnapshot,
} from './ThreadRow'
import { prStatusIndicator, terminalStatusFromRunningIds } from './threadRowUtils'
import { type SortableProjectHandleProps } from './SidebarHelpers'

import type { Project } from '../../types'
import type { DraftThreadEnvMode } from '../../composerDraftStore'

export type SidebarProjectSnapshot = Project & {
  expanded: boolean
}

// ---------------------------------------------------------------------------
// Rendered project shape (computed by parent, consumed here)
// ---------------------------------------------------------------------------

export interface RenderedProjectData {
  hasHiddenThreads: boolean
  hiddenThreadStatus: ThreadStatusPill | null
  orderedProjectThreadIds: readonly ThreadId[]
  project: SidebarProjectSnapshot
  projectStatus: ThreadStatusPill | null
  projectThreads: SidebarThreadSnapshot[]
  threadStatuses: Map<ThreadId, ThreadStatusPill | null>
  renderedThreads: SidebarThreadSnapshot[]
  showEmptyThreadState: boolean
  shouldShowThreadPanel: boolean
  isThreadListExpanded: boolean
}

export interface RenderedPinnedThreadData {
  thread: SidebarThreadSnapshot
  orderedProjectThreadIds: readonly ThreadId[]
  threadStatus: ThreadStatusPill | null
}

/** Raw PR shape matching GitStatusResult['pr'] — stored per-thread by parent. */
export type ThreadPr = GitStatusResult['pr']

// ---------------------------------------------------------------------------
// ProjectItem props
// ---------------------------------------------------------------------------

export interface ProjectItemProps {
  renderedProject: RenderedProjectData
  dragHandleProps: SortableProjectHandleProps | null

  // -- Navigation state --
  routeThreadId: ThreadId | null

  // -- Selection --
  selectedThreadIds: ReadonlySet<ThreadId>

  // -- Jump labels --
  threadJumpLabelById: Map<ThreadId, string>

  // -- Terminal state --
  terminalStateByThreadId: Record<ThreadId, ThreadTerminalState>

  // -- PR status (raw data, converted per-row) --
  prByThreadId: Map<ThreadId, ThreadPr | null>

  // -- Archive confirmation --
  confirmingArchiveThreadId: ThreadId | null

  // -- App settings --
  defaultThreadEnvMode: import('../Sidebar.logic').SidebarNewThreadEnvMode

  // -- Callbacks --
  onNewThread: (projectId: ProjectId, options?: { envMode?: DraftThreadEnvMode }) => void
  onProjectTitleClick: (event: React.MouseEvent<HTMLButtonElement>, projectId: ProjectId) => void
  onProjectTitleKeyDown: (
    event: React.KeyboardEvent<HTMLButtonElement>,
    projectId: ProjectId
  ) => void
  onProjectContextMenu: (projectId: ProjectId, position: { x: number; y: number }) => void
  onExpandThreadList: (projectId: ProjectId) => void
  onCollapseThreadList: (projectId: ProjectId) => void
  attachThreadListAutoAnimateRef: (node: HTMLElement | null) => void

  // -- Thread-row callbacks (passed through to each ThreadRow) --
  getThreadRowProps: (
    thread: SidebarThreadSnapshot
  ) => Omit<
    ThreadRowProps,
    | 'thread'
    | 'isActive'
    | 'isSelected'
    | 'jumpLabel'
    | 'isThreadRunning'
    | 'threadStatus'
    | 'prStatus'
    | 'terminalStatus'
    | 'isConfirmingArchive'
    | 'orderedProjectThreadIds'
    | 'rowClassName'
  >

  // -- Drag --
  isManualProjectSorting: boolean

  // -- Shortcut label --
  newThreadShortcutLabel: string | null
}

// ---------------------------------------------------------------------------
// ProjectStatusIcon — chevron or status dot for project header
// ---------------------------------------------------------------------------

function ProjectStatusIcon({
  expanded,
  projectStatus,
}: {
  expanded: boolean
  projectStatus: ThreadStatusPill | null
}) {
  if (!expanded && projectStatus) {
    return (
      <span
        aria-hidden="true"
        title={projectStatus.label}
        className={`-ml-0.5 relative inline-flex size-3.5 shrink-0 items-center justify-center ${projectStatus.colorClass}`}
      >
        <span className="absolute inset-0 flex items-center justify-center transition-opacity duration-150 group-hover/project-header:opacity-0">
          <span
            className={`size-[9px] rounded-full ${projectStatus.dotClass} ${projectStatus.pulse ? 'animate-pulse' : ''}`}
          />
        </span>
        <ChevronRightIcon className="absolute inset-0 m-auto size-3.5 text-muted-foreground/70 opacity-0 transition-opacity duration-150 group-hover/project-header:opacity-100" />
      </span>
    )
  }
  return (
    <ChevronRightIcon
      className={`-ml-0.5 size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
    />
  )
}

// ---------------------------------------------------------------------------
// ProjectHeader — title button + new thread action
// ---------------------------------------------------------------------------

interface ProjectHeaderProps {
  project: SidebarProjectSnapshot
  projectStatus: ThreadStatusPill | null
  dragHandleProps: SortableProjectHandleProps | null
  isManualProjectSorting: boolean
  defaultThreadEnvMode: ProjectItemProps['defaultThreadEnvMode']
  newThreadShortcutLabel: string | null
  onProjectTitleClick: ProjectItemProps['onProjectTitleClick']
  onProjectTitleKeyDown: ProjectItemProps['onProjectTitleKeyDown']
  onProjectContextMenu: ProjectItemProps['onProjectContextMenu']
  onNewThread: ProjectItemProps['onNewThread']
}

function ProjectHeader({
  project,
  projectStatus,
  dragHandleProps,
  isManualProjectSorting,
  defaultThreadEnvMode,
  newThreadShortcutLabel,
  onProjectTitleClick,
  onProjectTitleKeyDown,
  onProjectContextMenu,
  onNewThread,
}: ProjectHeaderProps) {
  return (
    <div className="group/project-header relative">
      <SidebarMenuButton
        ref={isManualProjectSorting ? dragHandleProps?.setActivatorNodeRef : undefined}
        size="sm"
        className={`gap-2 px-2 py-1.5 text-left hover:bg-accent group-hover/project-header:bg-accent group-hover/project-header:text-sidebar-accent-foreground ${isManualProjectSorting ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
        {...(isManualProjectSorting && dragHandleProps ? dragHandleProps.attributes : {})}
        {...(isManualProjectSorting && dragHandleProps ? dragHandleProps.listeners : {})}
        onPointerDownCapture={() => {
          /* Delegated to parent via onPointerDownCapture on wrapper */
        }}
        onClick={event => onProjectTitleClick(event, project.id)}
        onKeyDown={event => onProjectTitleKeyDown(event, project.id)}
        onContextMenu={event => {
          event.preventDefault()
          void onProjectContextMenu(project.id, { x: event.clientX, y: event.clientY })
        }}
      >
        <ProjectStatusIcon expanded={project.expanded} projectStatus={projectStatus} />
        <ProjectFavicon cwd={project.cwd} />
        <span className="flex-1 truncate text-xs font-medium text-foreground/90">
          {project.name}
        </span>
      </SidebarMenuButton>
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuAction
              render={
                <button
                  type="button"
                  aria-label={`Create new thread in ${project.name}`}
                  data-testid="new-thread-button"
                />
              }
              showOnHover
              className="top-1 right-1.5 size-5 rounded-md p-0 text-muted-foreground/70 hover:bg-secondary hover:text-foreground"
              onClick={event => {
                event.preventDefault()
                event.stopPropagation()
                void onNewThread(project.id, {
                  envMode: resolveSidebarNewThreadEnvMode({ defaultEnvMode: defaultThreadEnvMode }),
                })
              }}
            >
              <SquarePenIcon className="size-3.5" />
            </SidebarMenuAction>
          }
        />
        <TooltipPopup side="top">
          {newThreadShortcutLabel ? `New thread (${newThreadShortcutLabel})` : 'New thread'}
        </TooltipPopup>
      </Tooltip>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ProjectThreadList — thread list panel
// ---------------------------------------------------------------------------

interface ProjectThreadListProps {
  renderedProject: RenderedProjectData
  routeThreadId: ThreadId | null
  selectedThreadIds: ReadonlySet<ThreadId>
  threadJumpLabelById: Map<ThreadId, string>
  terminalStateByThreadId: Record<ThreadId, ThreadTerminalState>
  prByThreadId: Map<ThreadId, ThreadPr | null>
  confirmingArchiveThreadId: ThreadId | null
  attachThreadListAutoAnimateRef: (node: HTMLElement | null) => void
  getThreadRowProps: ProjectItemProps['getThreadRowProps']
  onExpandThreadList: (projectId: ProjectId) => void
  onCollapseThreadList: (projectId: ProjectId) => void
}

function renderThreadRowItem(
  thread: SidebarThreadSnapshot,
  opts: Pick<
    ProjectThreadListProps,
    | 'routeThreadId'
    | 'selectedThreadIds'
    | 'threadJumpLabelById'
    | 'terminalStateByThreadId'
    | 'prByThreadId'
    | 'confirmingArchiveThreadId'
    | 'getThreadRowProps'
  > & {
    threadStatuses: Map<ThreadId, ThreadStatusPill | null>
    orderedProjectThreadIds: readonly ThreadId[]
  }
) {
  const isActive = opts.routeThreadId === thread.id
  const isSelected = opts.selectedThreadIds.has(thread.id)
  const jumpLabel = opts.threadJumpLabelById.get(thread.id) ?? null
  const isThreadRunning =
    thread.session?.status === 'running' && thread.session.activeTurnId != null
  const status = opts.threadStatuses.get(thread.id) ?? null
  const pr = prStatusIndicator(opts.prByThreadId.get(thread.id) ?? null)
  const termStatus = terminalStatusFromRunningIds(
    selectThreadTerminalState(opts.terminalStateByThreadId, thread.id).runningTerminalIds
  )
  const isConfirmingArchive = opts.confirmingArchiveThreadId === thread.id && !isThreadRunning
  return (
    <ThreadRow
      key={thread.id}
      thread={thread}
      isActive={isActive}
      isSelected={isSelected}
      jumpLabel={jumpLabel}
      isThreadRunning={isThreadRunning}
      threadStatus={status}
      prStatus={pr}
      terminalStatus={termStatus}
      isConfirmingArchive={isConfirmingArchive}
      orderedProjectThreadIds={opts.orderedProjectThreadIds}
      rowClassName={resolveThreadRowClassName({ isActive, isSelected })}
      {...opts.getThreadRowProps(thread)}
    />
  )
}

function ThreadListExpandButton({
  onClick,
  hiddenThreadStatus,
}: {
  onClick: () => void
  hiddenThreadStatus: Parameters<typeof ThreadStatusLabel>[0]['status'] | null
}) {
  return (
    <SidebarMenuSubItem className="w-full">
      <SidebarMenuSubButton
        render={<button type="button" />}
        data-thread-selection-safe
        size="sm"
        className="h-6 w-full translate-x-0 justify-start px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
        onClick={onClick}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {hiddenThreadStatus && <ThreadStatusLabel status={hiddenThreadStatus} compact />}
          <span>Show more</span>
        </span>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  )
}

function ThreadListCollapseButton({ onClick }: { onClick: () => void }) {
  return (
    <SidebarMenuSubItem className="w-full">
      <SidebarMenuSubButton
        render={<button type="button" />}
        data-thread-selection-safe
        size="sm"
        className="h-6 w-full translate-x-0 justify-start px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
        onClick={onClick}
      >
        <span>Show less</span>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  )
}

function ProjectThreadList({
  renderedProject,
  routeThreadId,
  selectedThreadIds,
  threadJumpLabelById,
  terminalStateByThreadId,
  prByThreadId,
  confirmingArchiveThreadId,
  attachThreadListAutoAnimateRef,
  getThreadRowProps,
  onExpandThreadList,
  onCollapseThreadList,
}: ProjectThreadListProps) {
  const {
    hasHiddenThreads,
    hiddenThreadStatus,
    orderedProjectThreadIds,
    project,
    threadStatuses,
    renderedThreads,
    showEmptyThreadState,
    shouldShowThreadPanel,
    isThreadListExpanded,
  } = renderedProject
  const rowOpts = {
    routeThreadId,
    selectedThreadIds,
    threadJumpLabelById,
    terminalStateByThreadId,
    prByThreadId,
    confirmingArchiveThreadId,
    getThreadRowProps,
    threadStatuses,
    orderedProjectThreadIds,
  }
  const showExpand = project.expanded && hasHiddenThreads && !isThreadListExpanded
  const showCollapse = project.expanded && hasHiddenThreads && isThreadListExpanded

  return (
    <SidebarMenuSub
      ref={attachThreadListAutoAnimateRef}
      className="mx-1 my-0 w-full translate-x-0 gap-0.5 overflow-hidden px-1.5 py-0"
    >
      {shouldShowThreadPanel && showEmptyThreadState ? (
        <SidebarMenuSubItem className="w-full" data-thread-selection-safe>
          <div
            data-thread-selection-safe
            className="flex h-6 w-full translate-x-0 items-center px-2 text-left text-[10px] text-muted-foreground/60"
          >
            <span>No threads yet</span>
          </div>
        </SidebarMenuSubItem>
      ) : null}
      {shouldShowThreadPanel && renderedThreads.map(thread => renderThreadRowItem(thread, rowOpts))}
      {showExpand && (
        <ThreadListExpandButton
          onClick={() => {
            onExpandThreadList(project.id)
          }}
          hiddenThreadStatus={hiddenThreadStatus}
        />
      )}
      {showCollapse && (
        <ThreadListCollapseButton
          onClick={() => {
            onCollapseThreadList(project.id)
          }}
        />
      )}
    </SidebarMenuSub>
  )
}

// ---------------------------------------------------------------------------
// ProjectItem component
// ---------------------------------------------------------------------------

export function ProjectItem({
  renderedProject,
  dragHandleProps,
  routeThreadId,
  selectedThreadIds,
  threadJumpLabelById,
  terminalStateByThreadId,
  prByThreadId,
  confirmingArchiveThreadId,
  defaultThreadEnvMode,
  onNewThread,
  onProjectTitleClick,
  onProjectTitleKeyDown,
  onProjectContextMenu,
  onExpandThreadList,
  onCollapseThreadList,
  attachThreadListAutoAnimateRef,
  getThreadRowProps,
  isManualProjectSorting,
  newThreadShortcutLabel,
}: ProjectItemProps) {
  const { project, projectStatus } = renderedProject
  return (
    <>
      <ProjectHeader
        project={project}
        projectStatus={projectStatus}
        dragHandleProps={dragHandleProps}
        isManualProjectSorting={isManualProjectSorting}
        defaultThreadEnvMode={defaultThreadEnvMode}
        newThreadShortcutLabel={newThreadShortcutLabel}
        onProjectTitleClick={onProjectTitleClick}
        onProjectTitleKeyDown={onProjectTitleKeyDown}
        onProjectContextMenu={onProjectContextMenu}
        onNewThread={onNewThread}
      />
      <ProjectThreadList
        renderedProject={renderedProject}
        routeThreadId={routeThreadId}
        selectedThreadIds={selectedThreadIds}
        threadJumpLabelById={threadJumpLabelById}
        terminalStateByThreadId={terminalStateByThreadId}
        prByThreadId={prByThreadId}
        confirmingArchiveThreadId={confirmingArchiveThreadId}
        attachThreadListAutoAnimateRef={attachThreadListAutoAnimateRef}
        getThreadRowProps={getThreadRowProps}
        onExpandThreadList={onExpandThreadList}
        onCollapseThreadList={onCollapseThreadList}
      />
    </>
  )
}
