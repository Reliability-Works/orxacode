import { useRef, type ReactNode } from 'react'
import { Bot } from 'lucide-react'
import type { ComposerPanelProps } from './ComposerPanel'
import { ComposerPanel } from './ComposerPanel'
import { VirtualizedTimeline } from './chat/VirtualizedTimeline'
import { UnifiedTimelineRowView } from './chat/UnifiedTimelineRow'
import { estimateUnifiedTimelineRowHeight, type UnifiedTimelineRenderRow } from './chat/unified-timeline-model'
import type { PermissionMode } from '../types/app'
import type { ModelOption } from '../lib/models'
import type {
  SessionCompactionState,
  SessionGuardrailPrompt,
  SessionGuardrailState,
} from '../lib/session-controls'
import type { ClaudeChatPaneComposerViewModel } from './useClaudeChatPaneComposer'
import type { ClaudeChatPaneSubagentsViewModel } from './useClaudeChatPaneSubagents'
import type { SessionChangeTarget } from './chat/ReviewChangesDock'

type ClaudeChatPaneViewProps = ClaudeChatPaneComposerViewModel &
  ClaudeChatPaneSubagentsViewModel & {
    rows: UnifiedTimelineRenderRow[]
    sessionStorageKey: string
    permissionMode: PermissionMode
    onPermissionModeChange: (mode: PermissionMode) => void
    branchMenuOpen: boolean
    setBranchMenuOpen: (updater: (value: boolean) => boolean) => void
    branchControlWidthCh: number
    branchLoading: boolean
    branchSwitching: boolean
    hasActiveProject: boolean
    branchCurrent?: string
    branchDisplayValue: string
    branchSearchInputRef: React.RefObject<HTMLInputElement | null>
    branchQuery: string
    setBranchQuery: (value: string) => void
    branchActionError: string | null
    clearBranchActionError: () => void
    checkoutBranch: (name: string) => void | Promise<void>
    filteredBranches: string[]
    openBranchCreateModal: () => void | Promise<void>
    browserModeEnabled: boolean
    setBrowserModeEnabled: (enabled: boolean) => void
    modelOptions: ModelOption[]
    customControls: ReactNode
    pendingQuestion: ComposerPanelProps['pendingQuestion']
    pendingPermission: ComposerPanelProps['pendingPermission']
    isSessionBusy: boolean
    guardrailState: SessionGuardrailState
    guardrailPrompt: SessionGuardrailPrompt | null
    onDismissGuardrailWarning: () => void
    onContinueGuardrailOnce: () => void
    onDisableGuardrailsForSession: () => void
    onOpenSettings: () => void
    sessionChangeTargets: SessionChangeTarget[]
    onRevertSessionChange: (targetId: string) => void | Promise<void>
    todoOpen: boolean
    onTodoToggle: () => void
    compactionState: SessionCompactionState
  }

export function ClaudeChatPaneView(props: ClaudeChatPaneViewProps) {
  return (
    <>
      <ClaudeChatTimeline rows={props.rows} sessionStorageKey={props.sessionStorageKey} />
      <ClaudeChatComposer
        composer={props.composer}
        setComposer={props.setComposer}
        composerAttachments={props.composerAttachments}
        removeAttachment={props.removeAttachment}
        addComposerAttachments={props.addComposerAttachments}
        sendPrompt={props.sendPrompt}
        abortActiveSession={props.abortActiveSession}
        isSessionBusy={props.isSessionBusy}
        isPlanMode={props.isPlanMode}
        setIsPlanMode={props.setIsPlanMode}
        browserModeEnabled={props.browserModeEnabled}
        setBrowserModeEnabled={props.setBrowserModeEnabled}
        permissionMode={props.permissionMode}
        onPermissionModeChange={props.onPermissionModeChange}
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
        modelOptions={props.modelOptions}
        selectedModel={props.selectedModel}
        setSelectedModel={props.setSelectedModel}
        customControls={props.customControls}
        backgroundAgents={props.backgroundAgents}
        selectedBackgroundAgentId={props.selectedBackgroundAgentId}
        onOpenBackgroundAgent={props.onOpenBackgroundAgent}
        onCloseBackgroundAgent={props.onCloseBackgroundAgent}
        onArchiveBackgroundAgent={props.onArchiveBackgroundAgent}
        backgroundAgentDetailRows={props.backgroundAgentDetailRows}
        backgroundAgentTaskText={props.backgroundAgentTaskText}
        backgroundAgentDetailLoading={props.backgroundAgentDetailLoading}
        backgroundAgentDetailError={props.backgroundAgentDetailError}
        pendingQuestion={props.pendingQuestion}
        pendingPermission={props.pendingPermission}
        guardrailState={props.guardrailState}
        guardrailPrompt={props.guardrailPrompt}
        onDismissGuardrailWarning={props.onDismissGuardrailWarning}
        onContinueGuardrailOnce={props.onContinueGuardrailOnce}
        onDisableGuardrailsForSession={props.onDisableGuardrailsForSession}
        onOpenSettings={props.onOpenSettings}
        sessionChangeTargets={props.sessionChangeTargets}
        onRevertSessionChange={props.onRevertSessionChange}
        todoOpen={props.todoOpen}
        onTodoToggle={props.onTodoToggle}
        compactionState={props.compactionState}
        pickImageAttachment={props.pickImageAttachment}
      />
    </>
  )
}

function ClaudeChatTimeline({
  rows,
  sessionStorageKey,
}: Pick<ClaudeChatPaneViewProps, 'rows' | 'sessionStorageKey'>) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  return (
    <VirtualizedTimeline
      rows={rows}
      scrollRef={scrollContainerRef}
      className="messages-scroll codex-messages"
      ariaLabel="claude conversation"
      estimateSize={estimateUnifiedTimelineRowHeight}
      virtualize={false}
      sessionId={sessionStorageKey}
      emptyState={
        <div className="center-pane-rail">
          <div className="codex-empty">
            <Bot size={24} color="var(--text-muted)" />
            <span>Send a prompt to start chatting with Claude.</span>
          </div>
        </div>
      }
      renderRow={row => (
        <div className="center-pane-rail center-pane-rail--row">
          <UnifiedTimelineRowView key={row.id} row={row} />
        </div>
      )}
      footer={
        <div className="center-pane-rail center-pane-rail--row">
          <div ref={messagesEndRef} />
        </div>
      }
    />
  )
}

type ClaudeChatComposerProps = Pick<
  ClaudeChatPaneViewProps,
  | 'composer'
  | 'setComposer'
  | 'composerAttachments'
  | 'removeAttachment'
  | 'addComposerAttachments'
  | 'sendPrompt'
  | 'abortActiveSession'
  | 'isPlanMode'
  | 'setIsPlanMode'
  | 'browserModeEnabled'
  | 'setBrowserModeEnabled'
  | 'permissionMode'
  | 'onPermissionModeChange'
  | 'branchMenuOpen'
  | 'setBranchMenuOpen'
  | 'branchControlWidthCh'
  | 'branchLoading'
  | 'branchSwitching'
  | 'hasActiveProject'
  | 'branchCurrent'
  | 'branchDisplayValue'
  | 'branchSearchInputRef'
  | 'branchQuery'
  | 'setBranchQuery'
  | 'branchActionError'
  | 'clearBranchActionError'
  | 'checkoutBranch'
  | 'filteredBranches'
  | 'openBranchCreateModal'
  | 'modelOptions'
  | 'selectedModel'
  | 'setSelectedModel'
  | 'customControls'
  | 'backgroundAgents'
  | 'selectedBackgroundAgentId'
  | 'onOpenBackgroundAgent'
  | 'onCloseBackgroundAgent'
  | 'onArchiveBackgroundAgent'
  | 'backgroundAgentDetailRows'
  | 'backgroundAgentTaskText'
  | 'backgroundAgentDetailLoading'
  | 'backgroundAgentDetailError'
  | 'pendingQuestion'
  | 'pendingPermission'
  | 'isSessionBusy'
  | 'guardrailState'
  | 'guardrailPrompt'
  | 'onDismissGuardrailWarning'
  | 'onContinueGuardrailOnce'
  | 'onDisableGuardrailsForSession'
  | 'onOpenSettings'
  | 'sessionChangeTargets'
  | 'onRevertSessionChange'
  | 'todoOpen'
  | 'onTodoToggle'
  | 'compactionState'
  | 'pickImageAttachment'
>

function ClaudeChatComposer(props: ClaudeChatComposerProps) {
  return (
    <div className="codex-composer-area">
      <div className="center-pane-rail center-pane-rail--composer">
        <ComposerPanel
          placeholder="Send to Claude..."
          composer={props.composer}
          setComposer={props.setComposer}
          composerAttachments={props.composerAttachments}
          removeAttachment={props.removeAttachment}
          slashMenuOpen={false}
          filteredSlashCommands={[]}
          slashSelectedIndex={0}
          insertSlashCommand={() => {}}
          handleSlashKeyDown={() => {}}
          addComposerAttachments={props.addComposerAttachments}
          sendPrompt={props.sendPrompt}
          abortActiveSession={props.abortActiveSession}
          isSessionBusy={props.isSessionBusy}
          isSendingPrompt={false}
          pickImageAttachment={props.pickImageAttachment}
          hasActiveSession
          isPlanMode={props.isPlanMode}
          hasPlanAgent
          togglePlanMode={props.setIsPlanMode}
          browserModeEnabled={props.browserModeEnabled}
          setBrowserModeEnabled={props.setBrowserModeEnabled}
          agentOptions={[]}
          onAgentChange={() => {}}
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
          modelSelectOptions={props.modelOptions}
          selectedModel={props.selectedModel}
          setSelectedModel={props.setSelectedModel}
          selectedVariant={undefined}
          setSelectedVariant={() => {}}
          variantOptions={[]}
          customControls={props.customControls}
          backgroundAgents={props.backgroundAgents}
          selectedBackgroundAgentId={props.selectedBackgroundAgentId}
          onOpenBackgroundAgent={props.onOpenBackgroundAgent}
          onCloseBackgroundAgent={props.onCloseBackgroundAgent}
          onArchiveBackgroundAgent={props.onArchiveBackgroundAgent}
          backgroundAgentDetail={
            props.backgroundAgentDetailRows
              ? props.backgroundAgentDetailRows.map(row => <UnifiedTimelineRowView key={row.id} row={row} />)
              : null
          }
          backgroundAgentTaskText={props.backgroundAgentTaskText}
          backgroundAgentDetailLoading={props.backgroundAgentDetailLoading}
          backgroundAgentDetailError={props.backgroundAgentDetailError}
          pendingQuestion={props.pendingQuestion}
          pendingPermission={props.pendingPermission}
          sessionChangeTargets={props.sessionChangeTargets}
          onRevertSessionChange={props.onRevertSessionChange}
          todoOpen={props.todoOpen}
          onTodoToggle={props.onTodoToggle}
          />
      </div>
    </div>
  )
}
