import { useCallback, useEffect, useMemo } from 'react'
import type { KanbanColumnId } from '@shared/ipc'
import { KANBAN_COLUMNS } from './kanban-utils'
import { createTaskDraft } from './kanban-board-utils'
import type { KanbanBoardState, KanbanDerivedState } from './KanbanBoard.types'

function useKanbanBoardLoader(state: KanbanBoardState & { migrateLegacyJobs: () => Promise<void> }) {
  const {
    contextMenu,
    migrateLegacyJobs,
    selectedWorkspaceDir,
    setContextMenu,
    setError,
    setLoading,
    setRefreshing,
    setSelectedWorkspaceDir,
    setSnapshot,
    setTaskDraft,
    setWorkspaces,
    snapshot,
    taskModalOpen,
  } = state
  const loadWorkspaces = useCallback(async (preferredWorkspaceDir?: string) => {
    const nextWorkspaces = await window.orxa.kanban.listWorkspaces()
    setWorkspaces(nextWorkspaces)
    setSelectedWorkspaceDir(current => {
      if (preferredWorkspaceDir && nextWorkspaces.some(workspace => workspace.directory === preferredWorkspaceDir)) {
        return preferredWorkspaceDir
      }
      if (current && nextWorkspaces.some(workspace => workspace.directory === current)) {
        return current
      }
      return nextWorkspaces[0]?.directory ?? ''
    })
    return nextWorkspaces
  }, [setSelectedWorkspaceDir, setWorkspaces])

  const loadBoard = useCallback(async (workspaceDir: string, options?: { silent?: boolean }) => {
    if (!workspaceDir) {
      setSnapshot(null)
      return
    }
    const silent = options?.silent === true
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      setSnapshot(await window.orxa.kanban.getBoard(workspaceDir))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      if (silent) setRefreshing(false)
      else setLoading(false)
    }
  }, [setError, setLoading, setRefreshing, setSnapshot])

  useEffect(() => {
    void (async () => {
      try {
        await migrateLegacyJobs()
        await loadWorkspaces()
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      }
    })()
  }, [loadWorkspaces, migrateLegacyJobs, setError])

  useEffect(() => {
    if (selectedWorkspaceDir) void loadBoard(selectedWorkspaceDir)
    else setSnapshot(null)
  }, [loadBoard, selectedWorkspaceDir, setSnapshot])

  useEffect(() => {
    if (!taskModalOpen || !snapshot?.settings) return
    setTaskDraft(current =>
      current.title || current.prompt || current.description ? current : createTaskDraft(snapshot?.settings)
    )
  }, [snapshot?.settings, taskModalOpen, setTaskDraft])

  useEffect(() => {
    if (!contextMenu) return
    const handlePointer = () => setContextMenu(null)
    window.addEventListener('mousedown', handlePointer)
    return () => window.removeEventListener('mousedown', handlePointer)
  }, [contextMenu, setContextMenu])

  return { loadBoard, loadWorkspaces }
}

function useKanbanDerivedState(state: KanbanBoardState): KanbanDerivedState {
  const filteredTasks = useMemo(() => {
    const tasks = state.snapshot?.tasks ?? []
    return tasks.filter(task => {
      if (state.providerFilter !== 'all' && task.provider !== state.providerFilter) return false
      if (state.statusFilter === 'blocked') return task.blocked
      if (state.statusFilter !== 'all' && task.statusSummary !== state.statusFilter) return false
      return true
    })
  }, [state.providerFilter, state.snapshot?.tasks, state.statusFilter])

  const tasksByColumn = useMemo(() => {
    const map = new Map<KanbanColumnId, typeof filteredTasks>()
    for (const column of KANBAN_COLUMNS) map.set(column.id, [])
    for (const task of filteredTasks) map.get(task.columnId)?.push(task)
    for (const tasks of map.values()) tasks.sort((left, right) => left.position - right.position)
    return map
  }, [filteredTasks])
  const runtimeStatuses = useMemo(() => {
    const map = new Map<string, KanbanDerivedState['runtimeStatuses'] extends Map<string, infer T> ? T : never>()
    for (const runtime of state.snapshot?.runtimes ?? []) if (runtime.status !== 'archived') map.set(runtime.taskId, runtime.status)
    return map
  }, [state.snapshot?.runtimes])
  const activeTask = useMemo(
    () => filteredTasks.find(task => task.id === state.draggedTaskId) ?? null,
    [filteredTasks, state.draggedTaskId]
  )
  const workspaceOptions = useMemo(
    () => state.workspaces.map(workspace => ({ value: workspace.directory, label: workspace.name })),
    [state.workspaces]
  )
  const visibleTaskIds = useMemo(() => new Set(filteredTasks.map(task => task.id)), [filteredTasks])

  return {
    activeTask,
    automations: state.snapshot?.automations ?? [],
    filteredTasks,
    runs: state.snapshot?.runs ?? [],
    runtimeStatuses,
    tasksByColumn,
    trashedCount: state.snapshot?.trashedTasks?.length ?? 0,
    visibleTaskIds,
    workspaceOptions,
    worktreeCount: state.snapshot?.worktrees?.length ?? 0,
  }
}

export function useKanbanBoardData(state: KanbanBoardState & { migrateLegacyJobs: () => Promise<void> }) {
  const loaders = useKanbanBoardLoader(state)
  const derived = useKanbanDerivedState(state)
  return { ...derived, ...loaders }
}
