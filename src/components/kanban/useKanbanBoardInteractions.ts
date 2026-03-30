import { useCallback, useEffect } from 'react'
import type { DragEndEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { KANBAN_COLUMNS } from './kanban-utils'
import type { KanbanBoardState, KanbanDerivedState } from './KanbanBoard.types'
import type { KanbanTask } from '@shared/ipc'

function useKanbanDragAndLinking(
  state: KanbanBoardState,
  args: {
    loadBoard: (workspaceDir: string, options?: { silent?: boolean }) => Promise<void>
    openTaskDetail: (task: KanbanTask) => Promise<void>
    tasksByColumn: KanbanDerivedState['tasksByColumn']
  }
) {
  const {
    boardCanvasRef,
    linking,
    selectedWorkspaceDir,
    setDraggedTaskId,
    setLinking,
    snapshot,
  } = state
  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    setDraggedTaskId(null)
    if (!selectedWorkspaceDir || !snapshot || !over || active.id === over.id) return
    const activeTaskId = String(active.id)
    const draggedTask = snapshot.tasks.find(task => task.id === activeTaskId)
    if (!draggedTask) return
    const sourceTasks = args.tasksByColumn.get(draggedTask.columnId) ?? []
    const overColumnId = KANBAN_COLUMNS.some(column => column.id === String(over.id))
      ? (String(over.id) as KanbanTask['columnId'])
      : (snapshot.tasks.find(task => task.id === String(over.id))?.columnId ?? draggedTask.columnId)
    const destinationTasks = args.tasksByColumn.get(overColumnId) ?? []
    const activeIndex = sourceTasks.findIndex(task => task.id === activeTaskId)
    const overIndex = destinationTasks.findIndex(task => task.id === String(over.id))
    const targetIndex = overIndex >= 0 ? overIndex : destinationTasks.length

    if (draggedTask.columnId === overColumnId) {
      const reordered = arrayMove(sourceTasks, activeIndex, targetIndex)
      for (let index = 0; index < reordered.length; index += 1) {
        await window.orxa.kanban.moveTask({ workspaceDir: selectedWorkspaceDir, taskId: reordered[index]!.id, columnId: overColumnId, position: index })
      }
    } else {
      const reordered = [...destinationTasks]
      reordered.splice(targetIndex, 0, draggedTask)
      for (let index = 0; index < reordered.length; index += 1) {
        await window.orxa.kanban.moveTask({ workspaceDir: selectedWorkspaceDir, taskId: reordered[index]!.id, columnId: overColumnId, position: index })
      }
    }
    await args.loadBoard(selectedWorkspaceDir)
  }, [args, selectedWorkspaceDir, setDraggedTaskId, snapshot])

  const getAnchorPoint = useCallback((event: Pick<ReactPointerEvent<HTMLButtonElement>, 'currentTarget'>) => {
    const board = boardCanvasRef.current
    if (!board) return { x: 0, y: 0 }
    const boardRect = board.getBoundingClientRect()
    const card = event.currentTarget.closest<HTMLElement>('.kanban-task-card')
    const rect = card ? card.getBoundingClientRect() : event.currentTarget.getBoundingClientRect()
    return { x: rect.right - boardRect.left + board.scrollLeft, y: rect.top + rect.height / 2 - boardRect.top + board.scrollTop }
  }, [boardCanvasRef])

  const handleLinkStart = useCallback((task: KanbanTask, event: ReactPointerEvent<HTMLButtonElement>) => {
    const anchor = getAnchorPoint(event)
    setLinking({ fromTaskId: task.id, startX: anchor.x, startY: anchor.y, currentX: anchor.x, currentY: anchor.y, hoverTaskId: null, targetX: null, targetY: null })
  }, [getAnchorPoint, setLinking])

  const handleLinkComplete = useCallback(async (task: KanbanTask) => {
    if (!linking || !selectedWorkspaceDir || linking.fromTaskId === task.id) return
    await window.orxa.kanban.linkTasks(selectedWorkspaceDir, linking.fromTaskId, task.id)
    setLinking(null)
    await args.loadBoard(selectedWorkspaceDir, { silent: true })
  }, [args, linking, selectedWorkspaceDir, setLinking])

  const handleLinkHover = useCallback((task: KanbanTask | null, event?: ReactPointerEvent<HTMLButtonElement>) => {
    const anchor = task && event ? getAnchorPoint(event) : null
    setLinking(current => {
      if (!current) return null
      if (!task || !anchor) return { ...current, hoverTaskId: null, targetX: null, targetY: null }
      return { ...current, hoverTaskId: task.id, targetX: anchor.x, targetY: anchor.y }
    })
  }, [getAnchorPoint, setLinking])

  useEffect(() => {
    if (!linking) return
    const handleMove = (event: PointerEvent) => {
      const board = boardCanvasRef.current
      if (!board) return
      const boardRect = board.getBoundingClientRect()
      setLinking(current => current ? { ...current, currentX: event.clientX - boardRect.left + board.scrollLeft, currentY: event.clientY - boardRect.top + board.scrollTop } : null)
    }
    const handleUp = () => setLinking(null)
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [boardCanvasRef, linking, setLinking])

  return { handleDragEnd, handleLinkComplete, handleLinkHover, handleLinkStart }
}

function useKanbanDependencyEdges(
  state: KanbanBoardState,
  args: {
    loadBoard: (workspaceDir: string, options?: { silent?: boolean }) => Promise<void>
    visibleTaskIds: Set<string>
  }
) {
  const { boardCanvasRef, selectedWorkspaceDir, setDependencyEdges, setHoveredDependencyId, snapshot, showDependencies } = state
  const recalculateDependencyEdges = useCallback(() => {
    if (!boardCanvasRef.current || !showDependencies || !snapshot?.dependencies.length) {
      setDependencyEdges([])
      setHoveredDependencyId(null)
      return
    }
    const board = boardCanvasRef.current
    const boardRect = board.getBoundingClientRect()
    const nextEdges = snapshot.dependencies.flatMap(dependency => {
      if (!args.visibleTaskIds.has(dependency.fromTaskId) || !args.visibleTaskIds.has(dependency.toTaskId)) return []
      const fromCard = board.querySelector<HTMLElement>(`[data-kanban-task-anchor="${dependency.fromTaskId}"]`)?.closest<HTMLElement>('.kanban-task-card')
      const toCard = board.querySelector<HTMLElement>(`[data-kanban-task-anchor="${dependency.toTaskId}"]`)?.closest<HTMLElement>('.kanban-task-card')
      if (!fromCard || !toCard) return []
      const fromRect = fromCard.getBoundingClientRect()
      const toRect = toCard.getBoundingClientRect()
      const x1 = fromRect.right - boardRect.left + board.scrollLeft
      const y1 = fromRect.top + fromRect.height / 2 - boardRect.top + board.scrollTop
      const x2 = toRect.left - boardRect.left + board.scrollLeft
      const y2 = toRect.top + toRect.height / 2 - boardRect.top + board.scrollTop
      const pull = Math.max(42, Math.min(Math.abs(x2 - x1) * 0.4, 180))
      return [{ id: dependency.id, fromTaskId: dependency.fromTaskId, toTaskId: dependency.toTaskId, x1, y1, x2, y2, cx1: x1 + pull, cy1: y1, cx2: x2 - pull, cy2: y2 }]
    })
    setDependencyEdges(nextEdges)
    setHoveredDependencyId(current => nextEdges.some(edge => edge.id === current) ? current : null)
  }, [args.visibleTaskIds, boardCanvasRef, setDependencyEdges, setHoveredDependencyId, showDependencies, snapshot])

  useEffect(() => {
    const frame = window.requestAnimationFrame(recalculateDependencyEdges)
    const handleResize = () => recalculateDependencyEdges()
    const handleScroll = () => recalculateDependencyEdges()
    const canvasElement = boardCanvasRef.current
    window.addEventListener('resize', handleResize)
    canvasElement?.addEventListener('scroll', handleScroll)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', handleResize)
      canvasElement?.removeEventListener('scroll', handleScroll)
    }
  }, [boardCanvasRef, recalculateDependencyEdges])

  const unlinkDependency = useCallback(async (dependencyId: string) => {
    if (!selectedWorkspaceDir || !snapshot) return
    const dependency = snapshot.dependencies.find(entry => entry.id === dependencyId)
    if (!dependency) return
    await window.orxa.kanban.unlinkTasks(selectedWorkspaceDir, dependency.fromTaskId, dependency.toTaskId)
    setHoveredDependencyId(null)
    await args.loadBoard(selectedWorkspaceDir, { silent: true })
  }, [args, selectedWorkspaceDir, setHoveredDependencyId, snapshot])

  return { recalculateDependencyEdges, unlinkDependency }
}

export function useKanbanBoardInteractions(
  state: KanbanBoardState,
  args: {
    loadBoard: (workspaceDir: string, options?: { silent?: boolean }) => Promise<void>
    openTaskDetail: (task: KanbanTask) => Promise<void>
    tasksByColumn: KanbanDerivedState['tasksByColumn']
    visibleTaskIds: Set<string>
  }
) {
  const dragAndLinking = useKanbanDragAndLinking(state, args)
  const dependencies = useKanbanDependencyEdges(state, {
    loadBoard: args.loadBoard,
    visibleTaskIds: args.visibleTaskIds,
  })
  return { ...dependencies, ...dragAndLinking }
}
