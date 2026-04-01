import { useEffect, useMemo } from 'react'
import type { KanbanTask, KanbanTaskDetail } from '@shared/ipc'
import { KanbanTaskDetailModalSurface } from './KanbanTaskDetailModal.surface'
import type {
  KanbanTaskDetailModalActions,
  KanbanTaskDetailModalState,
} from './kanban-task-detail-modal.actions'

type Props = {
  detail: KanbanTaskDetail
  snapshot: { tasks: KanbanTask[]; dependencies: Array<{ fromTaskId: string; toTaskId: string }> }
  workspaceDir: string
  onClose: () => void
  onRefresh: () => void
  state: KanbanTaskDetailModalState
  actions: KanbanTaskDetailModalActions
}

export function KanbanTaskDetailModalView({
  detail,
  snapshot,
  workspaceDir,
  onClose,
  onRefresh,
  state,
  actions,
}: Props) {
  const {
    activeDetailTab,
    terminalOpen,
    setTerminalOpen,
    task,
    settings,
    editing,
    setEditing,
    setShortcutResult,
  } = state
  const { loadCheckpoints } = actions

  const dependencyTitles = useMemo(() => {
    const depTaskIds = snapshot.dependencies
      .filter(d => d.toTaskId === task.id)
      .map(d => d.fromTaskId)
    return depTaskIds.map(id => {
      const t = snapshot.tasks.find(t => t.id === id)
      return { id, title: t?.title ?? id }
    })
  }, [snapshot.dependencies, snapshot.tasks, task.id])

  useEffect(() => {
    if (activeDetailTab === 'checkpoints') {
      void loadCheckpoints()
    }
  }, [activeDetailTab, loadCheckpoints])

  const hasConflictedMerge = Boolean(detail.worktree && detail.worktree.mergeStatus === 'conflicted')
  const hasUnmergedWorktree = Boolean(detail.worktree && detail.worktree.mergeStatus !== 'merged')

  const overviewProps = {
    workspaceDir,
    taskId: task.id,
    worktree: detail.worktree,
    trashStatus: task.trashStatus,
    hasConflictedMerge,
    hasUnmergedWorktree,
    onRefresh,
    onClose,
    onTerminalToggle: () => setTerminalOpen(!terminalOpen),
    onEditToggle: () => setEditing(!editing),
    settings,
    onShortcutResult: setShortcutResult,
  }

  return (
    <KanbanTaskDetailModalSurface
      detail={detail}
      workspaceDir={workspaceDir}
      onClose={onClose}
      state={state}
      actions={actions}
      dependencyTitles={dependencyTitles}
      overviewProps={overviewProps}
    />
  )
}
