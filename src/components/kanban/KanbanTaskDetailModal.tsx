import type { KanbanTask, KanbanTaskDetail } from '@shared/ipc'
import { KanbanTaskDetailModalView } from './KanbanTaskDetailModal.view'
import {
  useKanbanTaskDetailModalActions,
  useKanbanTaskDetailModalState,
} from './kanban-task-detail-modal.actions'

type Props = {
  detail: KanbanTaskDetail
  snapshot: { tasks: KanbanTask[]; dependencies: Array<{ fromTaskId: string; toTaskId: string }> }
  workspaceDir: string
  onClose: () => void
  onRefresh: () => void
}

export function KanbanTaskDetailModal({
  detail,
  snapshot,
  workspaceDir,
  onClose,
  onRefresh,
}: Props) {
  const state = useKanbanTaskDetailModalState(detail, workspaceDir)
  const actions = useKanbanTaskDetailModalActions(workspaceDir, state.task, state, onRefresh)

  return (
    <KanbanTaskDetailModalView
      detail={detail}
      snapshot={snapshot}
      workspaceDir={workspaceDir}
      onClose={onClose}
      onRefresh={onRefresh}
      state={state}
      actions={actions}
    />
  )
}

