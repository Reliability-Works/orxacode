import { useKanbanBoardState } from './useKanbanBoardState'
import { useKanbanBoardData } from './useKanbanBoardData'
import { useKanbanBoardActions } from './useKanbanBoardActions'
import { useKanbanBoardInteractions } from './useKanbanBoardInteractions'

export function useKanbanBoardController() {
  const state = useKanbanBoardState()
  const data = useKanbanBoardData(state)
  const actions = useKanbanBoardActions(state, {
    loadBoard: data.loadBoard,
    loadWorkspaces: data.loadWorkspaces,
  })
  const interactions = useKanbanBoardInteractions(state, {
    loadBoard: data.loadBoard,
    openTaskDetail: actions.openTaskDetail,
    tasksByColumn: data.tasksByColumn,
    visibleTaskIds: data.visibleTaskIds,
  })

  return {
    actions,
    data,
    interactions,
    state,
  }
}
