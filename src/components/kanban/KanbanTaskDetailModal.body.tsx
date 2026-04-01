import type {
  KanbanCheckpointDiff,
  KanbanProvider,
  KanbanRegenerateTaskField,
  KanbanReviewComment,
  KanbanScriptShortcutResult,
  KanbanTask,
  KanbanTaskCheckpoint,
  KanbanTaskDetail,
  KanbanTaskProviderConfig,
} from '@shared/ipc'
import type { DetailTab } from './kanban-task-detail-modal.types'
import { CheckpointsList, DiffViewer, ReviewTab, TranscriptTab } from './KanbanTaskDetailModal.diff'
import { OverviewTab } from './KanbanTaskDetailModal.overview'
import type { OverviewTabProps } from './KanbanTaskDetailModal.overview'

export type DetailModalBodyProps = {
  activeDetailTab: DetailTab
  overviewProps: OverviewTabProps['overviewProps']
  runtime: KanbanTaskDetail['runtime']
  shortcutResult: KanbanScriptShortcutResult | null
  actionError: string | null
  editing: boolean
  editTitle: string
  editDescription: string
  editPrompt: string
  editProvider: KanbanProvider
  editProviderConfig: KanbanTaskProviderConfig | undefined
  regeneratingField: KanbanRegenerateTaskField | null
  task: KanbanTask
  dependencyTitles: Array<{ id: string; title: string }>
  diffFiles: KanbanTaskDetail['structuredDiff']
  selectedFileIndex: number
  reviewComments: KanbanReviewComment[]
  feedbackDraft: string
  reviewFilePath: string
  reviewLine: string
  reviewBody: string
  checkpoints: KanbanTaskCheckpoint[]
  checkpointDiff: KanbanCheckpointDiff | null
  selectedCheckpointId: string | null
  transcript: KanbanTaskDetail['transcript']
  workspaceDir: string
  setEditTitle: (v: string) => void
  setEditDescription: (v: string) => void
  setEditPrompt: (v: string) => void
  setEditProvider: (v: KanbanProvider) => void
  setEditProviderConfig: (v: KanbanTaskProviderConfig | undefined) => void
  setEditing: (v: boolean) => void
  setSelectedFileIndex: (v: number) => void
  setFeedbackDraft: (v: string) => void
  setReviewFilePath: (v: string) => void
  setReviewLine: (v: string) => void
  setReviewBody: (v: string) => void
  setSelectedCheckpointId: (v: string | null) => void
  setCheckpointDiff: (v: KanbanCheckpointDiff | null) => void
  handleSaveEdit: () => Promise<void>
  regenerateField: (f: KanbanRegenerateTaskField) => void
  handleAddComment: (p: string, l: number, b: string) => void
  handleSendFeedback: () => Promise<void>
  handleManualComment: () => Promise<void>
  loadCheckpointDiff: (id: string) => void
}

function DetailOverviewPanel(props: DetailModalBodyProps) {
  const {
    activeDetailTab,
    overviewProps,
    runtime,
    shortcutResult,
    actionError,
    editing,
    editTitle,
    editDescription,
    editPrompt,
    editProvider,
    editProviderConfig,
    regeneratingField,
    task,
    dependencyTitles,
    workspaceDir,
    setEditTitle,
    setEditDescription,
    setEditPrompt,
    setEditProvider,
    setEditProviderConfig,
    setEditing,
    handleSaveEdit,
    regenerateField,
  } = props

  if (activeDetailTab !== 'overview') return null

  return (
    <OverviewTab
      overviewProps={overviewProps}
      runtime={runtime}
      shortcutResult={shortcutResult}
      actionError={actionError}
      editing={editing}
      editTitle={editTitle}
      editDescription={editDescription}
      editPrompt={editPrompt}
      editProvider={editProvider}
      editProviderConfig={editProviderConfig}
      regeneratingField={regeneratingField}
      task={task}
      dependencyTitles={dependencyTitles}
      onEditTitleChange={setEditTitle}
      onEditDescriptionChange={setEditDescription}
      onEditPromptChange={setEditPrompt}
      onEditProviderChange={setEditProvider}
      onEditProviderConfigChange={setEditProviderConfig}
      onCancelEdit={() => setEditing(false)}
      onSaveEdit={() => void handleSaveEdit()}
      onRegenerateField={regenerateField}
      workspaceDir={workspaceDir}
    />
  )
}

function DetailDiffPanel(props: DetailModalBodyProps) {
  const { activeDetailTab, checkpointDiff, diffFiles, selectedFileIndex, reviewComments, setSelectedFileIndex, handleAddComment } =
    props
  if (activeDetailTab !== 'diff' && !(activeDetailTab === 'checkpoints' && checkpointDiff)) return null

  return (
    <DiffViewer
      diffFiles={diffFiles}
      selectedFileIndex={selectedFileIndex}
      reviewComments={reviewComments}
      onSelectFile={setSelectedFileIndex}
      onAddComment={handleAddComment}
    />
  )
}

function DetailReviewPanel(props: DetailModalBodyProps) {
  const {
    activeDetailTab,
    feedbackDraft,
    reviewFilePath,
    reviewLine,
    reviewBody,
    reviewComments,
    setFeedbackDraft,
    setReviewFilePath,
    setReviewLine,
    setReviewBody,
    handleSendFeedback,
    handleManualComment,
  } = props

  if (activeDetailTab !== 'review') return null

  return (
    <ReviewTab
      feedbackDraft={feedbackDraft}
      onFeedbackChange={setFeedbackDraft}
      onSendFeedback={() => void handleSendFeedback()}
      reviewFilePath={reviewFilePath}
      onReviewFilePathChange={setReviewFilePath}
      reviewLine={reviewLine}
      onReviewLineChange={setReviewLine}
      reviewBody={reviewBody}
      onReviewBodyChange={setReviewBody}
      onAddComment={() => void handleManualComment()}
      reviewComments={reviewComments}
    />
  )
}

function DetailCheckpointsPanel(props: DetailModalBodyProps) {
  const {
    activeDetailTab,
    checkpoints,
    checkpointDiff,
    selectedCheckpointId,
    setSelectedCheckpointId,
    setCheckpointDiff,
    loadCheckpointDiff,
  } = props

  if (activeDetailTab !== 'checkpoints') return null

  if (!checkpointDiff) {
    return (
      <CheckpointsList
        checkpoints={checkpoints}
        selectedCheckpointId={selectedCheckpointId}
        onSelectCheckpoint={id => {
          setSelectedCheckpointId(id)
          void loadCheckpointDiff(id)
        }}
      />
    )
  }

  return (
    <div>
      <button
        type="button"
        className="kanban-filter-toggle"
        style={{ marginBottom: 8 }}
        onClick={() => {
          setCheckpointDiff(null)
          setSelectedCheckpointId(null)
        }}
      >
        Back to checkpoints
      </button>
    </div>
  )
}

function DetailTranscriptPanel(props: DetailModalBodyProps) {
  if (props.activeDetailTab !== 'transcript') return null
  return <TranscriptTab transcript={props.transcript} />
}

export function DetailModalBody(props: DetailModalBodyProps) {
  return (
    <div className="kanban-detail-body">
      <DetailOverviewPanel {...props} />
      <DetailDiffPanel {...props} />
      <DetailReviewPanel {...props} />
      <DetailCheckpointsPanel {...props} />
      <DetailTranscriptPanel {...props} />
    </div>
  )
}
