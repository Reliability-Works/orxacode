import type { KanbanTaskDetail } from '@shared/ipc'
import { DetailModalBody } from './KanbanTaskDetailModal.body'
import { DetailModalHeader, DetailTabNav } from './KanbanTaskDetailModal.header'
import { KanbanTaskTerminal } from './KanbanTaskTerminal'
import type { OverviewTabProps } from './KanbanTaskDetailModal.overview'
import type {
  KanbanTaskDetailModalActions,
  KanbanTaskDetailModalState,
} from './kanban-task-detail-modal.actions'

type Props = {
  detail: KanbanTaskDetail
  workspaceDir: string
  onClose: () => void
  state: KanbanTaskDetailModalState
  actions: KanbanTaskDetailModalActions
  dependencyTitles: Array<{ id: string; title: string }>
  overviewProps: OverviewTabProps['overviewProps']
}

function buildDetailModalBodyProps({
  detail,
  workspaceDir,
  state,
  actions,
  dependencyTitles,
  overviewProps,
}: Props) {
  const {
    activeDetailTab,
    selectedFileIndex,
    checkpoints,
    selectedCheckpointId,
    checkpointDiff,
    feedbackDraft,
    reviewFilePath,
    reviewLine,
    reviewBody,
    task,
    runtime,
    diffFiles,
    setSelectedFileIndex,
    setCheckpointDiff,
    setSelectedCheckpointId,
    setFeedbackDraft,
    setReviewFilePath,
    setReviewLine,
    setReviewBody,
    setEditTitle,
    setEditDescription,
    setEditPrompt,
    setEditProvider,
    setEditProviderConfig,
    setEditing,
  } = state
  const {
    handleSaveEdit,
    regenerateField,
    handleAddComment,
    handleSendFeedback,
    handleManualComment,
    loadCheckpointDiff,
  } = actions

  return {
    activeDetailTab,
    overviewProps,
    runtime,
    shortcutResult: state.shortcutResult,
    actionError: state.actionError,
    editing: state.editing,
    editTitle: state.editTitle,
    editDescription: state.editDescription,
    editPrompt: state.editPrompt,
    editProvider: state.editProvider,
    editProviderConfig: state.editProviderConfig,
    regeneratingField: state.regeneratingField,
    task,
    dependencyTitles,
    diffFiles,
    selectedFileIndex,
    reviewComments: detail.reviewComments,
    feedbackDraft,
    reviewFilePath,
    reviewLine,
    reviewBody,
    checkpoints,
    checkpointDiff,
    selectedCheckpointId,
    transcript: detail.transcript,
    workspaceDir,
    setEditTitle,
    setEditDescription,
    setEditPrompt,
    setEditProvider,
    setEditProviderConfig,
    setEditing,
    setSelectedFileIndex,
    setFeedbackDraft,
    setReviewFilePath,
    setReviewLine,
    setReviewBody,
    setSelectedCheckpointId,
    setCheckpointDiff,
    handleSaveEdit,
    regenerateField,
    handleAddComment,
    handleSendFeedback,
    handleManualComment,
    loadCheckpointDiff,
  }
}

export function KanbanTaskDetailModalSurface({
  detail,
  workspaceDir,
  onClose,
  state,
  actions,
  dependencyTitles,
  overviewProps,
}: Props) {
  const bodyProps = buildDetailModalBodyProps({
    detail,
    workspaceDir,
    onClose,
    state,
    actions,
    dependencyTitles,
    overviewProps,
  })
  const { activeDetailTab, setActiveDetailTab, terminalOpen, setTerminalOpen, task, shipLabel } = state

  return (
    <div className="kanban-pane-overlay" onClick={onClose}>
      <section
        className="modal kanban-detail-modal kanban-sheet-modal"
        onClick={e => e.stopPropagation()}
      >
        <DetailModalHeader task={task} shipLabel={shipLabel} onClose={onClose} />
        <DetailTabNav activeTab={activeDetailTab} onChange={setActiveDetailTab} />
        <DetailModalBody {...bodyProps} />
        {terminalOpen ? (
          <KanbanTaskTerminal
            workspaceDir={workspaceDir}
            taskId={task.id}
            open={terminalOpen}
            onClose={() => setTerminalOpen(false)}
          />
        ) : null}
      </section>
    </div>
  )
}
