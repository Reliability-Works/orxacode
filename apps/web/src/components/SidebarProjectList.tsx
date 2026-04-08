/**
 * SidebarProjectList — presentational sub-components for SidebarBody.
 *
 * Extracted from SidebarBody.tsx to keep that file under the max-lines limit.
 * Owns the add-project form and the DnD / static project list renderers.
 */

import { FolderIcon } from 'lucide-react'
import { DndContext, type CollisionDetection, type DragEndEvent } from '@dnd-kit/core'
import { restrictToVerticalAxis, restrictToFirstScrollableAncestor } from '@dnd-kit/modifiers'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { isElectron } from '../env'
import { SidebarMenu, SidebarMenuItem } from './ui/sidebar'
import { SortableProjectItem } from './sidebar/SidebarHelpers'
import type { SortableProjectHandleProps } from './sidebar/SidebarHelpers'
import { ProjectItem } from './sidebar/ProjectItem'
import type { RenderedProjectData } from './sidebar/ProjectItem'

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
        <p className="mt-1 px-0.5 text-[11px] leading-tight text-red-400">{addProjectError}</p>
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
  renderedProjects: RenderedProjectData[]
  getProjectItemProps: GetProjectItemProps
  projectDnDSensors: ReturnType<typeof import('@dnd-kit/core').useSensors>
  projectCollisionDetection: CollisionDetection
  onProjectDragStart: () => void
  onProjectDragEnd: (event: DragEndEvent) => void
  onProjectDragCancel: () => void
  attachProjectListAutoAnimateRef: (node: HTMLElement | null) => void
  isManualProjectSorting: boolean
}

export function SidebarDndProjectList({
  renderedProjects,
  getProjectItemProps,
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
  renderedProjects,
  getProjectItemProps,
  attachProjectListAutoAnimateRef,
}: Pick<
  SidebarProjectListProps,
  'renderedProjects' | 'getProjectItemProps' | 'attachProjectListAutoAnimateRef'
>) {
  return (
    <SidebarMenu ref={attachProjectListAutoAnimateRef}>
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
  )
}
