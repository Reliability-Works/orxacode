import { ComposerPanel } from './ComposerPanel'
import type { Attachment } from '../hooks/useComposerState'
import type { PermissionMode } from '../types/app'
import type { ModelOption } from '../lib/models'
import type { CodexCollaborationMode } from '@shared/ipc'
import type { TodoItem } from './chat/TodoDock'
import type { SessionChangeTarget } from './chat/ReviewChangesDock'
import type { UnifiedBackgroundAgentSummary } from '../lib/session-presentation'
import type { RefObject, ReactNode } from 'react'
import type { SessionCompactionState, SessionGuardrailPrompt, SessionGuardrailState } from '../lib/session-controls'

export type CodexPaneComposerPanelProps = {
  input: string
  setInput: (value: string) => void
  composerAttachments: Attachment[]
  removeAttachment: (url: string) => void
  addComposerAttachments: (attachments: Attachment[]) => void
  sendPrompt: () => Promise<void>
  abortActiveSession: () => Promise<void>
  isSessionBusy: boolean
  pickImageAttachment: () => Promise<void>
  hasActiveSession: boolean
  isPlanMode: boolean
  setIsPlanMode: (value: boolean) => void
  collaborationModes: CodexCollaborationMode[]
  selectedCollabMode: string | undefined
  setSelectedCollabMode: (value: string | undefined) => void
  permissionMode: PermissionMode
  onPermissionModeChange: (mode: PermissionMode) => void
  guardrailState: SessionGuardrailState
  guardrailPrompt: SessionGuardrailPrompt | null
  onDismissGuardrailWarning: () => void
  onContinueGuardrailOnce: () => void
  onDisableGuardrailsForSession: () => void
  onOpenSettings: () => void
  compactionState: SessionCompactionState
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
  selectedModel: string | undefined
  setSelectedModel: (value: string | undefined) => void
  selectedReasoningEffort: string | undefined
  setSelectedReasoningEffort: (value: string | undefined) => void
  reasoningEffortOptions: string[]
  customControls?: ReactNode
  placeholder: string
  backgroundAgents: UnifiedBackgroundAgentSummary[]
  selectedBackgroundAgentId: string | null
  onOpenBackgroundAgent: (threadId: string) => void
  onCloseBackgroundAgent: () => void
  onArchiveBackgroundAgent: (agent: UnifiedBackgroundAgentSummary) => Promise<void>
  backgroundAgentDetail: ReactNode
  backgroundAgentTaskText: string | null
  backgroundAgentDetailLoading: boolean
  backgroundAgentDetailError: string | null
  backgroundAgentTaggingHint: string
  pendingPermission:
    | {
        description: string
        filePattern?: string
        command?: string[]
        onDecide: (decision: 'allow_once' | 'allow_always' | 'reject') => void
      }
    | null
  todoItems?: TodoItem[]
  todoOpen: boolean
  onTodoToggle: () => void
  sessionChangeTargets?: SessionChangeTarget[]
  onOpenReviewChange: (path: string) => void
  onRevertSessionChange: (targetId: string) => void | Promise<void>
  queuedMessages: Array<{ id: string; text: string; timestamp: number }>
  sendingQueuedId: string | undefined
  onQueueMessage: (text: string) => void
  queuedActionKind: 'steer'
  onPrimaryQueuedAction: (id: string) => Promise<void>
  onEditQueued: (id: string) => void
  onRemoveQueued: (id: string) => void
  browserModeEnabled?: boolean
  setBrowserModeEnabled?: (enabled: boolean) => void
}

export function CodexPaneComposerPanel(props: CodexPaneComposerPanelProps) {
  return (
    <ComposerPanel
      composer={props.input}
      setComposer={props.setInput}
      composerAttachments={props.composerAttachments}
      removeAttachment={props.removeAttachment}
      slashMenuOpen={false}
      filteredSlashCommands={[]}
      slashSelectedIndex={0}
      insertSlashCommand={() => undefined}
      handleSlashKeyDown={() => undefined}
      addComposerAttachments={props.addComposerAttachments}
      sendPrompt={props.sendPrompt}
      abortActiveSession={props.abortActiveSession}
      isSessionBusy={props.isSessionBusy}
      isSendingPrompt={false}
      pickImageAttachment={props.pickImageAttachment}
      hasActiveSession={props.hasActiveSession}
      isPlanMode={props.isPlanMode}
      hasPlanAgent={true}
      togglePlanMode={enabled => {
        props.setIsPlanMode(enabled)
        if (enabled) {
          const planMode = props.collaborationModes.find(m => m.mode === 'plan' || m.id === 'plan')
          props.setSelectedCollabMode(planMode?.id ?? 'plan')
        } else {
          props.setSelectedCollabMode(undefined)
        }
      }}
      browserModeEnabled={props.browserModeEnabled ?? false}
      setBrowserModeEnabled={props.setBrowserModeEnabled ?? (() => undefined)}
      hideBrowserToggle={!props.setBrowserModeEnabled}
      agentOptions={[]}
      onAgentChange={() => undefined}
      permissionMode={props.permissionMode}
      onPermissionModeChange={props.onPermissionModeChange}
      guardrailState={props.guardrailState}
      guardrailPrompt={props.guardrailPrompt}
      onDismissGuardrailWarning={props.onDismissGuardrailWarning}
      onContinueGuardrailOnce={props.onContinueGuardrailOnce}
      onDisableGuardrailsForSession={props.onDisableGuardrailsForSession}
      onOpenSettings={props.onOpenSettings}
      compactionProgress={props.compactionState.progress}
      compactionHint={props.compactionState.hint}
      compactionCompacted={props.compactionState.compacted}
      branchMenuOpen={props.branchMenuOpen}
      setBranchMenuOpen={props.setBranchMenuOpen}
      branchControlWidthCh={props.branchControlWidthCh}
      branchLoading={props.branchLoading}
      branchSwitching={props.branchSwitching}
      hasActiveProject={props.hasActiveProject}
      branchCurrent={props.branchCurrent}
      branchDisplayValue={props.branchDisplayValue}
      branchSearchInputRef={props.branchSearchInputRef}
      branchQuery={props.branchQuery}
      setBranchQuery={props.setBranchQuery}
      branchActionError={props.branchActionError}
      clearBranchActionError={props.clearBranchActionError}
      checkoutBranch={props.checkoutBranch}
      filteredBranches={props.filteredBranches}
      openBranchCreateModal={props.openBranchCreateModal}
      modelSelectOptions={props.modelSelectOptions}
      selectedModel={props.selectedModel}
      setSelectedModel={props.setSelectedModel}
      selectedVariant={props.selectedReasoningEffort}
      setSelectedVariant={props.setSelectedReasoningEffort}
      variantOptions={props.reasoningEffortOptions}
      variantLabel="Reasoning effort"
      variantEmptyLabel="(default effort)"
      customControls={props.customControls}
      placeholder={props.placeholder}
      simpleModelPicker
      backgroundAgents={props.backgroundAgents}
      selectedBackgroundAgentId={props.selectedBackgroundAgentId}
      onOpenBackgroundAgent={props.onOpenBackgroundAgent}
      onCloseBackgroundAgent={props.onCloseBackgroundAgent}
      onArchiveBackgroundAgent={props.onArchiveBackgroundAgent}
      backgroundAgentDetail={props.backgroundAgentDetail}
      backgroundAgentTaskText={props.backgroundAgentTaskText}
      backgroundAgentDetailLoading={props.backgroundAgentDetailLoading}
      backgroundAgentDetailError={props.backgroundAgentDetailError}
      backgroundAgentTaggingHint={props.backgroundAgentTaggingHint}
      pendingPermission={props.pendingPermission}
      todoItems={props.todoItems}
      todoOpen={props.todoOpen}
      onTodoToggle={props.onTodoToggle}
      sessionChangeTargets={props.sessionChangeTargets}
      onOpenReviewChange={props.onOpenReviewChange}
      onRevertSessionChange={props.onRevertSessionChange}
      queuedMessages={props.queuedMessages}
      sendingQueuedId={props.sendingQueuedId}
      onQueueMessage={props.onQueueMessage}
      queuedActionKind={props.queuedActionKind}
      onPrimaryQueuedAction={props.onPrimaryQueuedAction}
      onEditQueued={props.onEditQueued}
      onRemoveQueued={props.onRemoveQueued}
    />
  )
}
