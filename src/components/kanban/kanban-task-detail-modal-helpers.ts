import type {
  KanbanCheckpointDiff,
  KanbanProvider,
  KanbanRegenerateTaskField,
  KanbanTaskCheckpoint,
  KanbanTaskProviderConfig,
} from '@shared/ipc'
import {
  buildRunAgentCliOptions,
  buildTaskFieldRegenerationPrompt,
  extractGeneratedFieldText,
} from './kanban-task-generation'

export function createTaskActionErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export async function loadCheckpointsHelper(
  workspaceDir: string,
  taskId: string,
  setCheckpoints: (c: KanbanTaskCheckpoint[]) => void
) {
  try {
    const next = await window.orxa.kanban.listCheckpoints(workspaceDir, taskId)
    setCheckpoints(next)
  } catch {
    /* ignore */
  }
}

export async function loadCheckpointDiffHelper(
  workspaceDir: string,
  taskId: string,
  checkpointId: string,
  setCheckpointDiff: (d: KanbanCheckpointDiff | null) => void,
  setSelectedFileIndex: (i: number) => void
) {
  try {
    const next = await window.orxa.kanban.getCheckpointDiff(workspaceDir, taskId, checkpointId)
    setCheckpointDiff(next)
    setSelectedFileIndex(0)
  } catch {
    /* ignore */
  }
}

export async function handleAddCommentHelper(
  workspaceDir: string,
  taskId: string,
  filePath: string,
  line: number,
  body: string,
  onRefresh: () => void
) {
  await window.orxa.kanban.addReviewComment(workspaceDir, taskId, filePath, line, body)
  onRefresh()
}

export async function handleSendFeedbackHelper(
  workspaceDir: string,
  taskId: string,
  feedbackDraft: string,
  setActionError: (e: string | null) => void,
  setFeedbackDraft: (v: string) => void,
  onRefresh: () => void
) {
  const text = feedbackDraft.trim()
  if (!text) return
  try {
    setActionError(null)
    await window.orxa.kanban.sendReviewFeedback(workspaceDir, taskId, text)
    setFeedbackDraft('')
    onRefresh()
  } catch (error) {
    setActionError(createTaskActionErrorMessage(error))
  }
}

export async function handleManualCommentHelper(
  workspaceDir: string,
  taskId: string,
  reviewFilePath: string,
  reviewLine: string,
  reviewBody: string,
  setActionError: (e: string | null) => void,
  setReviewBody: (v: string) => void,
  onRefresh: () => void
) {
  const line = Number(reviewLine)
  if (!reviewFilePath.trim() || !reviewBody.trim() || !Number.isFinite(line)) return
  try {
    setActionError(null)
    await window.orxa.kanban.addReviewComment(
      workspaceDir,
      taskId,
      reviewFilePath.trim(),
      line,
      reviewBody.trim()
    )
    setReviewBody('')
    onRefresh()
  } catch (error) {
    setActionError(createTaskActionErrorMessage(error))
  }
}

export async function handleSaveEditHelper(
  workspaceDir: string,
  taskId: string,
  editTitle: string,
  editDescription: string,
  editPrompt: string,
  editProvider: KanbanProvider,
  editProviderConfig: KanbanTaskProviderConfig | undefined,
  setActionError: (e: string | null) => void,
  setEditing: (v: boolean) => void,
  onRefresh: () => void
) {
  try {
    setActionError(null)
    await window.orxa.kanban.updateTask({
      id: taskId,
      workspaceDir,
      title: editTitle,
      description: editDescription,
      prompt: editPrompt,
      provider: editProvider,
      providerConfig: editProviderConfig,
    })
    setEditing(false)
    onRefresh()
  } catch (error) {
    setActionError(createTaskActionErrorMessage(error))
  }
}

export async function regenerateFieldHelper(
  workspaceDir: string,
  editProvider: KanbanProvider,
  editProviderConfig: KanbanTaskProviderConfig | undefined,
  editTitle: string,
  editDescription: string,
  editPrompt: string,
  field: KanbanRegenerateTaskField,
  setActionError: (e: string | null) => void,
  setRegeneratingField: (f: KanbanRegenerateTaskField | null) => void,
  setEditTitle: (v: string) => void,
  setEditDescription: (v: string) => void,
  setEditPrompt: (v: string) => void
) {
  setRegeneratingField(field)
  try {
    setActionError(null)
    const prompt = buildTaskFieldRegenerationPrompt({
      workspaceDir,
      provider: editProvider,
      field,
      title: editTitle,
      description: editDescription,
      prompt: editPrompt,
    })
    const result = await window.orxa.app.runAgentCli(
      buildRunAgentCliOptions({
        provider: editProvider,
        providerConfig: editProviderConfig,
        workspaceDir,
        prompt,
      })
    )
    const text = extractGeneratedFieldText(result.output)
    if (!result.ok || !text) {
      throw new Error(result.output.trim() || 'Field regeneration failed')
    }
    if (field === 'title') setEditTitle(text)
    if (field === 'description') setEditDescription(text)
    if (field === 'prompt') setEditPrompt(text)
  } catch (error) {
    setActionError(createTaskActionErrorMessage(error))
  } finally {
    setRegeneratingField(null)
  }
}

