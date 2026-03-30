import { useCallback, useEffect, useState } from 'react'
import type {
  KanbanCheckpointDiff,
  KanbanProvider,
  KanbanRegenerateTaskField,
  KanbanScriptShortcutResult,
  KanbanSettings,
  KanbanTask,
  KanbanTaskCheckpoint,
  KanbanTaskDetail,
  KanbanTaskProviderConfig,
} from '@shared/ipc'
import { shipStatusLabel } from './kanban-utils'
import type { DetailModalState } from './kanban-task-detail-modal.types'
import {
  handleAddCommentHelper,
  handleManualCommentHelper,
  handleSaveEditHelper,
  handleSendFeedbackHelper,
  loadCheckpointDiffHelper,
  loadCheckpointsHelper,
  regenerateFieldHelper,
} from './kanban-task-detail-modal-helpers'

function useDetailModalSettings(
  workspaceDir: string,
  setSettings: (value: KanbanSettings | null) => void
) {
  useEffect(() => {
    void window.orxa.kanban
      .getSettings(workspaceDir)
      .then(setSettings)
      .catch(() => undefined)
  }, [workspaceDir, setSettings])
}

function useDetailModalTaskSync(
  detail: KanbanTaskDetail,
  editing: boolean,
  setCheckpoints: DetailModalState['setCheckpoints'],
  setEditTitle: DetailModalState['setEditTitle'],
  setEditDescription: DetailModalState['setEditDescription'],
  setEditPrompt: DetailModalState['setEditPrompt'],
  setEditProvider: DetailModalState['setEditProvider'],
  setEditProviderConfig: DetailModalState['setEditProviderConfig']
) {
  useEffect(() => {
    setCheckpoints(detail.checkpoints)
    if (!editing) {
      setEditTitle(detail.task.title)
      setEditDescription(detail.task.description)
      setEditPrompt(detail.task.prompt)
      setEditProvider(detail.task.provider)
      setEditProviderConfig(detail.task.providerConfig)
    }
  }, [
    detail.checkpoints,
    detail.task.description,
    detail.task.prompt,
    detail.task.provider,
    detail.task.providerConfig,
    detail.task.title,
    editing,
    setCheckpoints,
    setEditDescription,
    setEditPrompt,
    setEditProvider,
    setEditProviderConfig,
    setEditTitle,
  ])
}

function useCheckpointDetailActions(
  workspaceDir: string,
  taskId: string,
  setCheckpoints: DetailModalState['setCheckpoints'],
  setCheckpointDiff: DetailModalState['setCheckpointDiff'],
  setSelectedFileIndex: DetailModalState['setSelectedFileIndex']
) {
  return {
    loadCheckpoints: useCallback(
      () => loadCheckpointsHelper(workspaceDir, taskId, setCheckpoints),
      [workspaceDir, taskId, setCheckpoints]
    ),
    loadCheckpointDiff: useCallback(
      (checkpointId: string) =>
        loadCheckpointDiffHelper(
          workspaceDir,
          taskId,
          checkpointId,
          setCheckpointDiff,
          setSelectedFileIndex
        ),
      [workspaceDir, taskId, setCheckpointDiff, setSelectedFileIndex]
    ),
  }
}

function useReviewDetailActions(
  workspaceDir: string,
  taskId: string,
  feedbackDraft: string,
  reviewFilePath: string,
  reviewLine: string,
  reviewBody: string,
  setActionError: DetailModalState['setActionError'],
  setFeedbackDraft: DetailModalState['setFeedbackDraft'],
  setReviewBody: DetailModalState['setReviewBody'],
  onRefresh: () => void
) {
  return {
    handleAddComment: useCallback(
      (filePath: string, line: number, body: string) =>
        handleAddCommentHelper(workspaceDir, taskId, filePath, line, body, onRefresh),
      [workspaceDir, taskId, onRefresh]
    ),
    handleSendFeedback: useCallback(
      () =>
        handleSendFeedbackHelper(
          workspaceDir,
          taskId,
          feedbackDraft,
          setActionError,
          setFeedbackDraft,
          onRefresh
        ),
      [workspaceDir, taskId, feedbackDraft, onRefresh, setActionError, setFeedbackDraft]
    ),
    handleManualComment: useCallback(
      () =>
        handleManualCommentHelper(
          workspaceDir,
          taskId,
          reviewFilePath,
          reviewLine,
          reviewBody,
          setActionError,
          setReviewBody,
          onRefresh
        ),
      [
        workspaceDir,
        taskId,
        reviewFilePath,
        reviewLine,
        reviewBody,
        onRefresh,
        setActionError,
        setReviewBody,
      ]
    ),
  }
}

function useEditDetailActions(
  workspaceDir: string,
  taskId: string,
  editTitle: string,
  editDescription: string,
  editPrompt: string,
  editProvider: KanbanProvider,
  editProviderConfig: KanbanTaskProviderConfig | undefined,
  setActionError: DetailModalState['setActionError'],
  setEditing: DetailModalState['setEditing'],
  setRegeneratingField: DetailModalState['setRegeneratingField'],
  setEditTitle: DetailModalState['setEditTitle'],
  setEditDescription: DetailModalState['setEditDescription'],
  setEditPrompt: DetailModalState['setEditPrompt'],
  onRefresh: () => void
) {
  return {
    handleSaveEdit: useCallback(
      () =>
        handleSaveEditHelper(
          workspaceDir,
          taskId,
          editTitle,
          editDescription,
          editPrompt,
          editProvider,
          editProviderConfig,
          setActionError,
          setEditing,
          onRefresh
        ),
      [
        workspaceDir,
        taskId,
        editTitle,
        editDescription,
        editPrompt,
        editProvider,
        editProviderConfig,
        onRefresh,
        setActionError,
        setEditing,
      ]
    ),
    regenerateField: useCallback(
      (field: KanbanRegenerateTaskField) =>
        regenerateFieldHelper(
          workspaceDir,
          editProvider,
          editProviderConfig,
          editTitle,
          editDescription,
          editPrompt,
          field,
          setActionError,
          setRegeneratingField,
          setEditTitle,
          setEditDescription,
          setEditPrompt
        ),
      [
        workspaceDir,
        editProvider,
        editProviderConfig,
        editTitle,
        editDescription,
        editPrompt,
        setActionError,
        setRegeneratingField,
        setEditDescription,
        setEditPrompt,
        setEditTitle,
      ]
    ),
  }
}

function useDetailModalState(detail: KanbanTaskDetail, workspaceDir: string) {
  const [activeDetailTab, setActiveDetailTab] = useState<DetailModalState['activeDetailTab']>(
    'overview'
  )
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [selectedFileIndex, setSelectedFileIndex] = useState(0)
  const [checkpoints, setCheckpoints] = useState<KanbanTaskCheckpoint[]>(detail.checkpoints)
  const [selectedCheckpointId, setSelectedCheckpointId] = useState<string | null>(null)
  const [checkpointDiff, setCheckpointDiff] = useState<KanbanCheckpointDiff | null>(null)
  const [feedbackDraft, setFeedbackDraft] = useState('')
  const [reviewFilePath, setReviewFilePath] = useState('')
  const [reviewLine, setReviewLine] = useState('1')
  const [reviewBody, setReviewBody] = useState('')
  const [settings, setSettings] = useState<KanbanSettings | null>(null)
  const [shortcutResult, setShortcutResult] = useState<KanbanScriptShortcutResult | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(detail.task.title)
  const [editDescription, setEditDescription] = useState(detail.task.description)
  const [editPrompt, setEditPrompt] = useState(detail.task.prompt)
  const [editProvider, setEditProvider] = useState(detail.task.provider)
  const [editProviderConfig, setEditProviderConfig] = useState<
    KanbanTaskProviderConfig | undefined
  >(detail.task.providerConfig)
  const [regeneratingField, setRegeneratingField] = useState<KanbanRegenerateTaskField | null>(null)

  const task = detail.task
  const runtime = detail.runtime
  const diffFiles =
    activeDetailTab === 'checkpoints' && checkpointDiff
      ? checkpointDiff.files
      : detail.structuredDiff
  const shipLabel = shipStatusLabel(task.shipStatus)

  useDetailModalSettings(workspaceDir, setSettings)
  useDetailModalTaskSync(
    detail,
    editing,
    setCheckpoints,
    setEditTitle,
    setEditDescription,
    setEditPrompt,
    setEditProvider,
    setEditProviderConfig
  )

  return {
    activeDetailTab,
    setActiveDetailTab,
    terminalOpen,
    setTerminalOpen,
    selectedFileIndex,
    setSelectedFileIndex,
    checkpoints,
    setCheckpoints,
    selectedCheckpointId,
    setSelectedCheckpointId,
    checkpointDiff,
    setCheckpointDiff,
    feedbackDraft,
    setFeedbackDraft,
    reviewFilePath,
    setReviewFilePath,
    reviewLine,
    setReviewLine,
    reviewBody,
    setReviewBody,
    settings,
    shortcutResult,
    setShortcutResult,
    actionError,
    setActionError,
    editing,
    setEditing,
    editTitle,
    setEditTitle,
    editDescription,
    setEditDescription,
    editPrompt,
    setEditPrompt,
    editProvider,
    setEditProvider,
    editProviderConfig,
    setEditProviderConfig,
    regeneratingField,
    setRegeneratingField,
    task,
    runtime,
    diffFiles,
    shipLabel,
  }
}

export function useKanbanTaskDetailModalState(detail: KanbanTaskDetail, workspaceDir: string) {
  return useDetailModalState(detail, workspaceDir)
}

export function useKanbanTaskDetailModalActions(
  workspaceDir: string,
  task: KanbanTask,
  state: DetailModalState,
  onRefresh: () => void
) {
  const { loadCheckpoints, loadCheckpointDiff } = useCheckpointDetailActions(
    workspaceDir,
    task.id,
    state.setCheckpoints,
    state.setCheckpointDiff,
    state.setSelectedFileIndex
  )
  const { handleAddComment, handleSendFeedback, handleManualComment } = useReviewDetailActions(
    workspaceDir,
    task.id,
    state.feedbackDraft,
    state.reviewFilePath,
    state.reviewLine,
    state.reviewBody,
    state.setActionError,
    state.setFeedbackDraft,
    state.setReviewBody,
    onRefresh
  )
  const { handleSaveEdit, regenerateField } = useEditDetailActions(
    workspaceDir,
    task.id,
    state.editTitle,
    state.editDescription,
    state.editPrompt,
    state.editProvider,
    state.editProviderConfig,
    state.setActionError,
    state.setEditing,
    state.setRegeneratingField,
    state.setEditTitle,
    state.setEditDescription,
    state.setEditPrompt,
    onRefresh
  )

  return {
    loadCheckpoints,
    loadCheckpointDiff,
    handleAddComment,
    handleSendFeedback,
    handleManualComment,
    handleSaveEdit,
    regenerateField,
  }
}

export type KanbanTaskDetailModalState = ReturnType<typeof useDetailModalState>
export type KanbanTaskDetailModalActions = ReturnType<typeof useKanbanTaskDetailModalActions>
