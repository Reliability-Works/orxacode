import { memo, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react'
import type { Attachment } from '../hooks/useComposerState'
import type { ModelOption } from '../lib/models'
import type { PermissionMode } from '../types/app'
import type { TodoItem } from './chat/TodoDock'
import type { ReviewChangeItem } from './chat/ReviewChangesDock'
import type { AgentQuestion } from './chat/QuestionDock'
import type { QueuedMessage } from './chat/QueuedMessagesDock'
import type { UnifiedBackgroundAgentSummary } from '../lib/session-presentation'
import { ComposerPanelSurface } from './composer-panel-surface'

type AgentOption = {
  name: string
  mode: 'primary' | 'subagent' | 'all'
  description?: string
}

type Command = {
  name: string
  description?: string
}

type ComposerPanelProps = {
  placeholder: string
  composer: string
  setComposer: (value: string) => void
  composerAttachments: Attachment[]
  removeAttachment: (url: string) => void
  slashMenuOpen: boolean
  filteredSlashCommands: Command[]
  slashSelectedIndex: number
  insertSlashCommand: (name: string) => void
  handleSlashKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void
  addComposerAttachments: (attachments: Attachment[]) => void
  sendPrompt: () => void | Promise<void>
  abortActiveSession: () => void | Promise<void>
  isSessionBusy: boolean
  isSendingPrompt: boolean
  pickImageAttachment: () => void | Promise<void>
  hasActiveSession: boolean
  isPlanMode: boolean
  hasPlanAgent: boolean
  togglePlanMode: (enabled: boolean) => void
  browserModeEnabled: boolean
  setBrowserModeEnabled: (enabled: boolean) => void
  hideBrowserToggle?: boolean
  hidePlanToggle?: boolean
  agentOptions: AgentOption[]
  selectedAgent?: string
  onAgentChange: (name: string) => void
  permissionMode: PermissionMode
  onPermissionModeChange: (mode: PermissionMode) => void
  compactionProgress: number
  compactionHint: string
  compactionCompacted: boolean
  branchMenuOpen: boolean
  setBranchMenuOpen: (updater: (value: boolean) => boolean) => void
  branchControlWidthCh: number
  branchLoading: boolean
  branchSwitching: boolean
  hasActiveProject: boolean
  branchCurrent?: string
  branchDisplayValue: string
  branchSearchInputRef: RefObject<HTMLInputElement | null>
  branchQuery: string
  setBranchQuery: (value: string) => void
  branchActionError: string | null
  clearBranchActionError: () => void
  checkoutBranch: (name: string) => void | Promise<void>
  filteredBranches: string[]
  openBranchCreateModal: () => void | Promise<void>
  modelSelectOptions: ModelOption[]
  selectedModel?: string
  setSelectedModel: (value: string | undefined) => void
  selectedVariant?: string
  setSelectedVariant: (value: string | undefined) => void
  variantOptions: string[]
  variantLabel?: string
  variantEmptyLabel?: string
  customControls?: ReactNode
  onLayoutHeightChange?: (height: number) => void
  /** When true, always use the compact dropdown model selector instead of the full modal picker.
   *  When omitted/false, auto-decides: ≤10 models → dropdown, >10 → modal. */
  simpleModelPicker?: boolean
  todoItems?: TodoItem[]
  todoOpen?: boolean
  onTodoToggle?: () => void
  reviewChangesFiles?: ReviewChangeItem[]
  onOpenReviewChange?: (path: string) => void
  backgroundAgents?: UnifiedBackgroundAgentSummary[]
  selectedBackgroundAgentId?: string | null
  onOpenBackgroundAgent?: (id: string) => void
  onCloseBackgroundAgent?: () => void
  onArchiveBackgroundAgent?: (agent: UnifiedBackgroundAgentSummary) => void
  backgroundAgentDetail?: ReactNode
  backgroundAgentTaskText?: string | null
  backgroundAgentDetailLoading?: boolean
  backgroundAgentDetailError?: string | null
  backgroundAgentTaggingHint?: string | null
  pendingPlan?: {
    onAccept: () => void
    onSubmitChanges: (changes: string) => void
    onDismiss: () => void
  } | null
  pendingQuestion?: {
    questions: AgentQuestion[]
    onSubmit: (answers: Record<string, string | string[]>) => void
    onReject: () => void
  } | null
  pendingPermission?: {
    description: string
    filePattern?: string
    command?: string[]
    onDecide: (decision: 'allow_once' | 'allow_always' | 'reject') => void
  } | null
  followupSuggestions?: string[]
  onFollowupSelect?: (text: string) => void
  onFollowupDismiss?: () => void
  queuedMessages?: QueuedMessage[]
  sendingQueuedId?: string
  onQueueMessage?: (text: string, attachments?: Attachment[]) => void
  queuedActionKind?: 'send' | 'steer'
  onPrimaryQueuedAction?: (id: string) => void
  onEditQueued?: (id: string) => void
  onRemoveQueued?: (id: string) => void
  onDockHeightChange?: (height: number) => void
}

export const ComposerPanel = memo(function ComposerPanel(props: ComposerPanelProps) {
  return <ComposerPanelSurface {...props} />
})
export type { AgentOption, Command, ComposerPanelProps }
export type { TodoItem } from './chat/TodoDock'
export type { AgentQuestion, QuestionOption } from './chat/QuestionDock'
