import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useDroppable } from '@dnd-kit/core'
import { GitBranch, GripVertical, Link2, Ship, Trash2, Wrench } from 'lucide-react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { KanbanColumnId, KanbanTask, KanbanTaskStatusSummary } from '@shared/ipc'
import { providerLabel, shipStatusLabel, statusDotClass, statusLabel } from './kanban-utils'

function TaskCardFooter({
  task,
  shipLabel,
  onTrash,
}: {
  task: KanbanTask
  shipLabel: string | null
  onTrash: (task: KanbanTask) => void
}) {
  return (
    <footer className="kanban-task-card-footer">
      <span className="kanban-task-pill kanban-task-pill--provider">
        {providerLabel(task.provider)}
      </span>
      <span
        className={`kanban-task-pill kanban-task-pill--status${task.blocked ? ' is-blocked' : ''}`.trim()}
      >
        {statusLabel(task)}
      </span>
      {task.taskBranch ? (
        <span className="kanban-task-pill kanban-task-pill--branch" title={task.taskBranch}>
          <GitBranch size={10} aria-hidden="true" />
          {task.taskBranch.length > 20 ? `${task.taskBranch.slice(0, 18)}…` : task.taskBranch}
        </span>
      ) : null}
      {shipLabel ? (
        <span className="kanban-task-pill kanban-task-pill--ship">
          <Ship size={10} aria-hidden="true" />
          {shipLabel}
        </span>
      ) : null}
      {task.latestActivityKind ? (
        <span className="kanban-task-pill">
          <Wrench size={10} aria-hidden="true" />
          {task.latestActivityKind}
        </span>
      ) : null}
      {task.columnId === 'done' ? (
        <button
          type="button"
          className="kanban-task-inline-action"
          onClick={event => {
            event.stopPropagation()
            onTrash(task)
          }}
        >
          <Trash2 size={10} aria-hidden="true" />
          Trash
        </button>
      ) : null}
    </footer>
  )
}

export function SortableTaskCard({
  task,
  runtimeStatus,
  onOpen,
  onTrash,
  onContext,
  onLinkStart,
  onLinkComplete,
  onLinkHover,
  isLinkSource,
  isLinkTarget,
}: {
  task: KanbanTask
  runtimeStatus?: KanbanTaskStatusSummary
  onOpen: (task: KanbanTask) => void
  onTrash: (task: KanbanTask) => void
  onContext: (task: KanbanTask, x: number, y: number) => void
  onLinkStart: (task: KanbanTask, event: ReactPointerEvent<HTMLButtonElement>) => void
  onLinkComplete: (task: KanbanTask, event: ReactPointerEvent<HTMLButtonElement>) => void
  onLinkHover: (task: KanbanTask | null, event?: ReactPointerEvent<HTMLButtonElement>) => void
  isLinkSource: boolean
  isLinkTarget: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: {
      taskId: task.id,
      columnId: task.columnId,
    },
  })

  const dotClass = statusDotClass(runtimeStatus)
  const shipLabel = shipStatusLabel(task.shipStatus)

  return (
    <article
      ref={setNodeRef}
      className={`kanban-task-card${task.blocked ? ' is-blocked' : ''}${isDragging ? ' is-dragging' : ''}`.trim()}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={() => onOpen(task)}
      onContextMenu={event => {
        event.preventDefault()
        onContext(task, event.clientX, event.clientY)
      }}
    >
      {dotClass ? <span className={dotClass} aria-hidden="true" /> : null}
      <button
        type="button"
        className={`kanban-task-link-anchor${isLinkSource ? ' is-source' : ''}${isLinkTarget ? ' is-target' : ''}`.trim()}
        data-kanban-task-anchor={task.id}
        title={isLinkSource ? 'Linking dependency' : 'Drag to another task to create a dependency'}
        onPointerDown={event => {
          event.stopPropagation()
          onLinkStart(task, event)
        }}
        onPointerUp={event => {
          event.stopPropagation()
          onLinkComplete(task, event)
        }}
        onPointerEnter={event => onLinkHover(task, event)}
        onPointerLeave={() => onLinkHover(null)}
        onClick={event => event.stopPropagation()}
      >
        <Link2 size={11} aria-hidden="true" />
      </button>
      <div className="kanban-task-card-row">
        <button
          type="button"
          className="kanban-task-grip"
          aria-label={`Drag ${task.title}`}
          onClick={event => event.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={12} aria-hidden="true" />
        </button>
        <div className="kanban-task-card-content">
          <strong className="kanban-task-card-title">{task.title}</strong>
          {task.latestPreview ? (
            <p className="kanban-task-card-preview">{task.latestPreview}</p>
          ) : null}
          {task.description || task.prompt ? (
            <p className="kanban-task-card-desc">{task.description || task.prompt}</p>
          ) : null}
        </div>
      </div>
      <TaskCardFooter task={task} shipLabel={shipLabel} onTrash={onTrash} />
    </article>
  )
}

export function KanbanColumn({
  column,
  tasks,
  runtimeStatuses,
  onOpenTask,
  onTrashTask,
  onContextTask,
  onLinkStart,
  onLinkComplete,
  onLinkHover,
  linkingSourceTaskId,
  linkingTargetTaskId,
}: {
  column: { id: KanbanColumnId; label: string }
  tasks: KanbanTask[]
  runtimeStatuses: Map<string, KanbanTaskStatusSummary>
  onOpenTask: (task: KanbanTask) => void
  onTrashTask: (task: KanbanTask) => void
  onContextTask: (task: KanbanTask, x: number, y: number) => void
  onLinkStart: (task: KanbanTask, event: ReactPointerEvent<HTMLButtonElement>) => void
  onLinkComplete: (task: KanbanTask, event: ReactPointerEvent<HTMLButtonElement>) => void
  onLinkHover: (task: KanbanTask | null, event?: ReactPointerEvent<HTMLButtonElement>) => void
  linkingSourceTaskId: string | null
  linkingTargetTaskId: string | null
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })

  return (
    <section className={`kanban-column${isOver ? ' is-over' : ''}`.trim()}>
      <header className="kanban-column-header">
        <h2>{column.label}</h2>
        {tasks.length > 0 ? <span className="kanban-column-count">{tasks.length}</span> : null}
      </header>
      <div ref={setNodeRef} className="kanban-column-body">
        <SortableContext items={tasks.map(task => task.id)} strategy={verticalListSortingStrategy}>
          {tasks.length === 0 ? <div className="kanban-column-empty">No tasks</div> : null}
          {tasks.map(task => (
            <SortableTaskCard
              key={task.id}
              task={task}
              runtimeStatus={runtimeStatuses.get(task.id)}
              onOpen={onOpenTask}
              onTrash={onTrashTask}
              onContext={onContextTask}
              onLinkStart={onLinkStart}
              onLinkComplete={onLinkComplete}
              onLinkHover={onLinkHover}
              isLinkSource={linkingSourceTaskId === task.id}
              isLinkTarget={linkingTargetTaskId === task.id}
            />
          ))}
        </SortableContext>
      </div>
    </section>
  )
}
