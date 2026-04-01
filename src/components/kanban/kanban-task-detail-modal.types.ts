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

export type DetailTab = 'overview' | 'diff' | 'review' | 'checkpoints' | 'transcript'

export type DetailModalState = {
  activeDetailTab: DetailTab
  setActiveDetailTab: (tab: DetailTab) => void
  terminalOpen: boolean
  setTerminalOpen: (value: boolean) => void
  selectedFileIndex: number
  setSelectedFileIndex: (value: number) => void
  checkpoints: KanbanTaskCheckpoint[]
  setCheckpoints: (value: KanbanTaskCheckpoint[]) => void
  selectedCheckpointId: string | null
  setSelectedCheckpointId: (value: string | null) => void
  checkpointDiff: KanbanCheckpointDiff | null
  setCheckpointDiff: (value: KanbanCheckpointDiff | null) => void
  feedbackDraft: string
  setFeedbackDraft: (value: string) => void
  reviewFilePath: string
  setReviewFilePath: (value: string) => void
  reviewLine: string
  setReviewLine: (value: string) => void
  reviewBody: string
  setReviewBody: (value: string) => void
  settings: KanbanSettings | null
  shortcutResult: KanbanScriptShortcutResult | null
  setShortcutResult: (value: KanbanScriptShortcutResult | null) => void
  actionError: string | null
  setActionError: (value: string | null) => void
  editing: boolean
  setEditing: (value: boolean) => void
  editTitle: string
  setEditTitle: (value: string) => void
  editDescription: string
  setEditDescription: (value: string) => void
  editPrompt: string
  setEditPrompt: (value: string) => void
  editProvider: KanbanProvider
  setEditProvider: (value: KanbanProvider) => void
  editProviderConfig: KanbanTaskProviderConfig | undefined
  setEditProviderConfig: (value: KanbanTaskProviderConfig | undefined) => void
  regeneratingField: KanbanRegenerateTaskField | null
  setRegeneratingField: (value: KanbanRegenerateTaskField | null) => void
  task: KanbanTask
  runtime: KanbanTaskDetail['runtime']
  diffFiles: KanbanTaskDetail['structuredDiff']
  shipLabel: string | null
}
