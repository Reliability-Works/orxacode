import { KanbanBoardView } from './KanbanBoardView'
import { useKanbanBoardController } from './useKanbanBoardController'

export function KanbanBoard() {
  return <KanbanBoardView {...useKanbanBoardController()} />
}
