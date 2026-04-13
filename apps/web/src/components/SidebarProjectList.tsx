/**
 * SidebarProjectList — presentational sub-components for SidebarBody.
 *
 * Extracted from SidebarBody.tsx to keep that file under the max-lines limit.
 * Owns the add-project form and the DnD / static project list renderers.
 */

import { FolderIcon, PinIcon } from 'lucide-react'
import type { ThreadId } from '@orxa-code/contracts'
import { DndContext, type CollisionDetection, type DragEndEvent } from '@dnd-kit/core'
import { restrictToVerticalAxis, restrictToFirstScrollableAncestor } from '@dnd-kit/modifiers'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { isElectron } from '../env'
import { SidebarMenu, SidebarMenuItem, SidebarMenuSub } from './ui/sidebar'
import { SortableProjectItem } from './sidebar/SidebarHelpers'
import type { SortableProjectHandleProps } from './sidebar/SidebarHelpers'
import { ProjectItem } from './sidebar/ProjectItem'
import type {
  ProjectItemProps,
  RenderedPinnedThreadData,
  RenderedProjectData,
} from './sidebar/ProjectItem'
import { ThreadRow } from './sidebar/ThreadRow'
import { resolveThreadRowClassName } from './Sidebar.logic'
import { prStatusIndicator, terminalStatusFromRunningIds } from './sidebar/threadRowUtils'
import { selectThreadTerminalState } from '../terminalStateStore'
import type { ThreadTerminalState } from '../terminalStateStore.logic'

// ---------------------------------------------------------------------------
// AddProjectForm — add-project path entry UI
// ---------------------------------------------------------------------------

export interface AddProjectFormProps {
  isPickingFolder: boolean
  isAddingProject: boolean
  addProjectError: string | null
  addProjectInputRef: React.RefObject<HTMLInputElement | null>
  canAddProject: boolean
  newCwd: string
  onNewCwdChange: (value: string) => void
  onPickFolder: () => void
  onAddProject: () => void
  onAddProjectKeyDown: (event: React.KeyboardEvent) => void
}

export function AddProjectForm({
  isPickingFolder,
  isAddingProject,
  addProjectError,
  addProjectInputRef,
  canAddProject,
  newCwd,
  onNewCwdChange,
  onPickFolder,
  onAddProject,
  onAddProjectKeyDown,
}: AddProjectFormProps) {
  return (
    <div className="mb-2 px-1">
      {isElectron && (
        <button
          type="button"
          className="mb-1.5 flex w-full items-center justify-center gap-2 rounded-md border border-border bg-secondary py-1.5 text-xs text-foreground/80 transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => void onPickFolder()}
          disabled={isPickingFolder || isAddingProject}
        >
          <FolderIcon className="size-3.5" />
          {isPickingFolder ? 'Picking folder...' : 'Browse for folder'}
        </button>
      )}
      <div className="flex gap-1.5">
        <input
          ref={addProjectInputRef}
          className={`min-w-0 flex-1 rounded-md border bg-secondary px-2 py-1 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none ${addProjectError ? 'border-red-500/70 focus:border-red-500' : 'border-border focus:border-ring'}`}
          placeholder="/path/to/project"
          value={newCwd}
          onChange={event => {
            onNewCwdChange(event.target.value)
          }}
          onKeyDown={onAddProjectKeyDown}
          autoFocus
        />
        <button
          type="button"
          className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 disabled:opacity-60"
          onClick={onAddProject}
          disabled={!canAddProject}
        >
          {isAddingProject ? 'Adding...' : 'Add'}
        </button>
      </div>
      {addProjectError && (
        <p className="mt-1 px-0.5 text-caption leading-tight text-red-400">{addProjectError}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Project list renderers
// ---------------------------------------------------------------------------

type GetProjectItemProps = () => {
  dragHandleProps: SortableProjectHandleProps | null
  projectItemProps: Omit<Parameters<typeof ProjectItem>[0], 'renderedProject' | 'dragHandleProps'>
}

export interface SidebarProjectListProps {
  renderedPinnedThreads: RenderedPinnedThreadData[]
  renderedProjects: RenderedProjectData[]
  getProjectItemProps: GetProjectItemProps
  getThreadRowProps: ProjectItemProps['getThreadRowProps']
  routeThreadId: ThreadId | null
  selectedThreadIds: ReadonlySet<ThreadId>
  threadJumpLabelById: Map<ThreadId, string>
  terminalStateByThreadId: Record<ThreadId, ThreadTerminalState>
  prByThreadId: Map<ThreadId, import('./sidebar/ProjectItem').ThreadPr | null>
  confirmingArchiveThreadId: ThreadId | null
  projectDnDSensors: ReturnType<typeof import('@dnd-kit/core').useSensors>
  projectCollisionDetection: CollisionDetection
  onProjectDragStart: () => void
  onProjectDragEnd: (event: DragEndEvent) => void
  onProjectDragCancel: () => void
  attachProjectListAutoAnimateRef: (node: HTMLElement | null) => void
  isManualProjectSorting: boolean
}

function SidebarPinnedThreadList(
  props: Pick<
    SidebarProjectListProps,
    | 'renderedPinnedThreads'
    | 'getThreadRowProps'
    | 'routeThreadId'
    | 'selectedThreadIds'
    | 'threadJumpLabelById'
    | 'terminalStateByThreadId'
    | 'prByThreadId'
    | 'confirmingArchiveThreadId'
  >
) {
  if (props.renderedPinnedThreads.length === 0) {
    return null
  }

  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center gap-1.5 pl-2 pr-1.5">
        <PinIcon className="size-3 text-muted-foreground/60" />
        <span className="text-mini font-medium uppercase tracking-wider text-muted-foreground/60">
          Pinned
        </span>
      </div>
      <SidebarMenuSub className="mx-1 my-0 w-full translate-x-0 gap-0.5 overflow-hidden px-1.5 py-0">
        {props.renderedPinnedThreads.map(({ thread, orderedProjectThreadIds, threadStatus }) => {
          const isActive = props.routeThreadId === thread.id
          const isSelected = props.selectedThreadIds.has(thread.id)
          const jumpLabel = props.threadJumpLabelById.get(thread.id) ?? null
          const isThreadRunning =
            thread.session?.status === 'running' && thread.session.activeTurnId != null
          const prStatus = prStatusIndicator(props.prByThreadId.get(thread.id) ?? null)
          const terminalStatus = terminalStatusFromRunningIds(
            selectThreadTerminalState(props.terminalStateByThreadId, thread.id).runningTerminalIds
          )
          const isConfirmingArchive =
            props.confirmingArchiveThreadId === thread.id && !isThreadRunning
          return (
            <ThreadRow
              key={thread.id}
              thread={thread}
              isActive={isActive}
              isSelected={isSelected}
              jumpLabel={jumpLabel}
              isThreadRunning={isThreadRunning}
              threadStatus={threadStatus}
              prStatus={prStatus}
              terminalStatus={terminalStatus}
              isConfirmingArchive={isConfirmingArchive}
              orderedProjectThreadIds={orderedProjectThreadIds}
              rowClassName={resolveThreadRowClassName({ isActive, isSelected })}
              {...props.getThreadRowProps(thread)}
            />
          )
        })}
      </SidebarMenuSub>
    </div>
  )
}

export function SidebarDndProjectList({
  renderedPinnedThreads,
  renderedProjects,
  getProjectItemProps,
  getThreadRowProps,
  routeThreadId,
  selectedThreadIds,
  threadJumpLabelById,
  terminalStateByThreadId,
  prByThreadId,
  confirmingArchiveThreadId,
  projectDnDSensors,
  projectCollisionDetection,
  onProjectDragStart,
  onProjectDragEnd,
  onProjectDragCancel,
}: Omit<SidebarProjectListProps, 'attachProjectListAutoAnimateRef' | 'isManualProjectSorting'>) {
  return (
    <DndContext
      sensors={projectDnDSensors}
      collisionDetection={projectCollisionDetection}
      modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
      onDragStart={onProjectDragStart}
      onDragEnd={onProjectDragEnd}
      onDragCancel={onProjectDragCancel}
    >
      <SidebarPinnedThreadList
        renderedPinnedThreads={renderedPinnedThreads}
        getThreadRowProps={getThreadRowProps}
        routeThreadId={routeThreadId}
        selectedThreadIds={selectedThreadIds}
        threadJumpLabelById={threadJumpLabelById}
        terminalStateByThreadId={terminalStateByThreadId}
        prByThreadId={prByThreadId}
        confirmingArchiveThreadId={confirmingArchiveThreadId}
      />
      <SidebarMenu>
        <SortableContext
          items={renderedProjects.map(rp => rp.project.id)}
          strategy={verticalListSortingStrategy}
        >
          {renderedProjects.map(renderedProject => {
            const { projectItemProps } = getProjectItemProps()
            return (
              <SortableProjectItem
                key={renderedProject.project.id}
                projectId={renderedProject.project.id}
              >
                {(handleProps: SortableProjectHandleProps) => (
                  <ProjectItem
                    renderedProject={renderedProject}
                    dragHandleProps={handleProps}
                    {...projectItemProps}
                  />
                )}
              </SortableProjectItem>
            )
          })}
        </SortableContext>
      </SidebarMenu>
    </DndContext>
  )
}

export function SidebarStaticProjectList({
  renderedPinnedThreads,
  renderedProjects,
  getProjectItemProps,
  getThreadRowProps,
  routeThreadId,
  selectedThreadIds,
  threadJumpLabelById,
  terminalStateByThreadId,
  prByThreadId,
  confirmingArchiveThreadId,
  attachProjectListAutoAnimateRef,
}: Pick<
  SidebarProjectListProps,
  | 'renderedPinnedThreads'
  | 'renderedProjects'
  | 'getProjectItemProps'
  | 'getThreadRowProps'
  | 'routeThreadId'
  | 'selectedThreadIds'
  | 'threadJumpLabelById'
  | 'terminalStateByThreadId'
  | 'prByThreadId'
  | 'confirmingArchiveThreadId'
  | 'attachProjectListAutoAnimateRef'
>) {
  return (
    <div ref={attachProjectListAutoAnimateRef}>
      <SidebarPinnedThreadList
        renderedPinnedThreads={renderedPinnedThreads}
        getThreadRowProps={getThreadRowProps}
        routeThreadId={routeThreadId}
        selectedThreadIds={selectedThreadIds}
        threadJumpLabelById={threadJumpLabelById}
        terminalStateByThreadId={terminalStateByThreadId}
        prByThreadId={prByThreadId}
        confirmingArchiveThreadId={confirmingArchiveThreadId}
      />
      <SidebarMenu>
        {renderedProjects.map(renderedProject => {
          const { dragHandleProps, projectItemProps } = getProjectItemProps()
          return (
            <SidebarMenuItem key={renderedProject.project.id} className="rounded-md">
              <ProjectItem
                renderedProject={renderedProject}
                dragHandleProps={dragHandleProps}
                {...projectItemProps}
              />
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </div>
  )
}
