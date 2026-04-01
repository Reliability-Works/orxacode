import { useCallback, useEffect } from 'react'
import type { KanbanRegenerateTaskField, KanbanTask } from '@shared/ipc'
import {
  buildRunAgentCliOptions,
  buildTaskFieldRegenerationPrompt,
  extractGeneratedFieldText,
} from './kanban-task-generation'
import { createTaskDraft, extractEventTaskId } from './kanban-board-utils'
import { BOARD_REFRESH_EVENT_TYPES, type KanbanBoardState } from './KanbanBoard.types'

function useKanbanTaskDetailActions({
  activeDetailTaskIdRef,
  loadBoard,
  selectedWorkspaceDir,
  setDetail,
  setDetailError,
  snapshot,
}: {
  activeDetailTaskIdRef: KanbanBoardState['activeDetailTaskIdRef']
  loadBoard: (workspaceDir: string, options?: { silent?: boolean }) => Promise<void>
  selectedWorkspaceDir: string
  setDetail: KanbanBoardState['setDetail']
  setDetailError: KanbanBoardState['setDetailError']
  snapshot: KanbanBoardState['snapshot']
}) {
  const tasks = snapshot?.tasks
  const trashedTasks = snapshot?.trashedTasks
  const openTaskDetail = useCallback(async (task: KanbanTask) => {
    activeDetailTaskIdRef.current = task.id
    setDetailError(null)
    try {
      const next = await window.orxa.kanban.getTaskDetail(task.workspaceDir, task.id)
      if (activeDetailTaskIdRef.current === task.id) setDetail(next)
    } catch (nextError) {
      setDetailError(nextError instanceof Error ? nextError.message : String(nextError))
      if (activeDetailTaskIdRef.current === task.id) setDetail(null)
    }
  }, [activeDetailTaskIdRef, setDetail, setDetailError])

  const refreshDetail = useCallback(() => {
    const taskId = activeDetailTaskIdRef.current
    if (!taskId || !selectedWorkspaceDir) return
    const task = tasks?.find(entry => entry.id === taskId) ?? trashedTasks?.find(entry => entry.id === taskId)
    if (task) void openTaskDetail(task)
  }, [activeDetailTaskIdRef, openTaskDetail, selectedWorkspaceDir, tasks, trashedTasks])

  useEffect(() => {
    const unsubscribe = window.orxa.events.subscribe(event => {
      if (!selectedWorkspaceDir || !BOARD_REFRESH_EVENT_TYPES.has(event.type)) return
      const payload = event.payload as { workspaceDir?: string } | undefined
      if (payload?.workspaceDir !== selectedWorkspaceDir) return
      void loadBoard(selectedWorkspaceDir, { silent: true })
      const detailTaskId = activeDetailTaskIdRef.current
      if (!detailTaskId) return
      if (event.type === 'kanban.board') {
        void refreshDetail()
        return
      }
      if (extractEventTaskId(event.payload) === detailTaskId) void refreshDetail()
    })
    return unsubscribe
  }, [activeDetailTaskIdRef, loadBoard, refreshDetail, selectedWorkspaceDir])

  return { openTaskDetail, refreshDetail }
}

function useKanbanMutationActions(
  state: KanbanBoardState,
  helpers: {
    loadBoard: (workspaceDir: string, options?: { silent?: boolean }) => Promise<void>
    loadWorkspaces: (preferredWorkspaceDir?: string) => Promise<unknown>
  }
) {
  const handleCreateTask = useCallback(async () => {
    if (!state.selectedWorkspaceDir || !state.taskDraft.title.trim() || !state.taskDraft.prompt.trim()) return
    await window.orxa.kanban.createTask({
      workspaceDir: state.selectedWorkspaceDir,
      title: state.taskDraft.title,
      prompt: state.taskDraft.prompt,
      description: state.taskDraft.description,
      provider: state.taskDraft.provider,
      providerConfig: state.taskDraft.providerConfig,
      columnId: state.taskDraft.columnId,
      autoStartWhenUnblocked: state.taskDraft.autoStartWhenUnblocked,
    })
    state.setTaskModalOpen(false)
    state.setTaskDraft(createTaskDraft(state.snapshot?.settings))
    await helpers.loadBoard(state.selectedWorkspaceDir)
  }, [helpers, state])

  const regenerateTaskDraftField = useCallback(async (field: KanbanRegenerateTaskField) => {
    if (!state.selectedWorkspaceDir) return
    state.setRegeneratingField(field)
    try {
      const prompt = buildTaskFieldRegenerationPrompt({
        workspaceDir: state.selectedWorkspaceDir,
        provider: state.taskDraft.provider,
        field,
        title: state.taskDraft.title,
        description: state.taskDraft.description,
        prompt: state.taskDraft.prompt,
      })
      const result = await window.orxa.app.runAgentCli(buildRunAgentCliOptions({
        provider: state.taskDraft.provider,
        providerConfig: state.taskDraft.providerConfig,
        workspaceDir: state.selectedWorkspaceDir,
        prompt,
      }))
      const text = extractGeneratedFieldText(result.output)
      if (!result.ok || !text) throw new Error(result.output.trim() || 'Field regeneration failed')
      state.setTaskDraft(current => ({ ...current, [field]: text }))
    } catch (error) {
      state.setError(error instanceof Error ? error.message : String(error))
    } finally {
      state.setRegeneratingField(null)
    }
  }, [state])

  const handleCreateAutomation = useCallback(async () => {
    if (!state.selectedWorkspaceDir || !state.automationDraft.name.trim() || !state.automationDraft.prompt.trim()) return
    await window.orxa.kanban.createAutomation({ workspaceDir: state.selectedWorkspaceDir, ...state.automationDraft })
    state.setAutomationModalOpen(false)
    await helpers.loadBoard(state.selectedWorkspaceDir)
  }, [helpers, state])

  const handleUpdateAutomation = useCallback(async () => {
    if (!state.editingAutomationId || !state.selectedWorkspaceDir || !state.automationDraft.name.trim() || !state.automationDraft.prompt.trim()) return
    await window.orxa.kanban.updateAutomation({ id: state.editingAutomationId, workspaceDir: state.selectedWorkspaceDir, ...state.automationDraft })
    state.setAutomationModalOpen(false)
    state.setEditingAutomationId(null)
    await helpers.loadBoard(state.selectedWorkspaceDir)
  }, [helpers, state])

  const handleAddWorkspace = useCallback(async () => {
    try {
      const workspace = await window.orxa.kanban.addWorkspaceDirectory()
      if (!workspace) return
      await helpers.loadWorkspaces(workspace.directory)
    } catch (nextError) {
      state.setError(nextError instanceof Error ? nextError.message : String(nextError))
    }
  }, [helpers, state])

  const openCreateTaskModal = useCallback(() => {
    state.setTaskDraft(createTaskDraft(state.snapshot?.settings))
    state.setTaskModalOpen(true)
  }, [state])

  const trashTask = useCallback(async (task: KanbanTask) => {
    await window.orxa.kanban.trashTask(task.workspaceDir, task.id)
    state.setContextMenu(null)
    if (state.detail?.task.id === task.id) {
      state.activeDetailTaskIdRef.current = null
      state.setDetail(null)
      state.setDetailError(null)
    }
    await helpers.loadBoard(task.workspaceDir, { silent: true })
  }, [helpers, state])

  return { handleAddWorkspace, handleCreateAutomation, handleCreateTask, handleUpdateAutomation, openCreateTaskModal, regenerateTaskDraftField, trashTask }
}

export function useKanbanBoardActions(
  state: KanbanBoardState,
  helpers: {
    loadBoard: (workspaceDir: string, options?: { silent?: boolean }) => Promise<void>
    loadWorkspaces: (preferredWorkspaceDir?: string) => Promise<unknown>
  }
) {
  const detailActions = useKanbanTaskDetailActions({
    activeDetailTaskIdRef: state.activeDetailTaskIdRef,
    loadBoard: helpers.loadBoard,
    selectedWorkspaceDir: state.selectedWorkspaceDir,
    setDetail: state.setDetail,
    setDetailError: state.setDetailError,
    snapshot: state.snapshot,
  })
  const mutationActions = useKanbanMutationActions(state, helpers)
  return { ...detailActions, ...mutationActions }
}
