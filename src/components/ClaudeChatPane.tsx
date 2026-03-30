import { useMemo } from 'react'
import { useClaudeChatSession } from '../hooks/useClaudeChatSession'
import { ClaudeTraitsPicker } from './ClaudeTraitsPicker'
import { projectClaudeChatProjectedSessionPresentation } from '../lib/claude-chat-session-presentation'
import type { ComposerPanelProps } from './ComposerPanel'
import type { PermissionMode } from '../types/app'
import type { AgentQuestion } from './chat/QuestionDock'
import { ClaudeChatPaneView } from './ClaudeChatPane.view'
import { useClaudeChatPaneComposer } from './useClaudeChatPaneComposer'
import { useClaudeChatPaneSubagents } from './useClaudeChatPaneSubagents'

interface Props {
  directory: string
  sessionStorageKey: string
  onFirstMessage?: () => void
  onTitleChange?: (title: string) => void
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
  browserModeEnabled?: boolean
  setBrowserModeEnabled?: (enabled: boolean) => void
}

function buildPendingQuestion(
  pendingUserInput: ReturnType<typeof useClaudeChatSession>['pendingUserInput'],
  respondToUserInput: ReturnType<typeof useClaudeChatSession>['respondToUserInput']
): ComposerPanelProps['pendingQuestion'] {
  if (!pendingUserInput) {
    return null
  }
  const questions: AgentQuestion[] = [
    {
      id: pendingUserInput.elicitationId ?? pendingUserInput.id,
      header: pendingUserInput.server,
      text: pendingUserInput.message,
      options: pendingUserInput.options?.map(option => ({
        label: option.label,
        value: option.value,
      })),
    },
  ]
  return {
    questions,
    onSubmit: (answers: Record<string, string | string[]>) => {
      const firstValue = Object.values(answers)[0]
      const response = Array.isArray(firstValue)
        ? firstValue.join(', ')
        : (firstValue ?? '').toString()
      void respondToUserInput(pendingUserInput.id, response)
    },
    onReject: () => {
      void respondToUserInput(pendingUserInput.id, '')
    },
  }
}

function buildPendingPermission(
  pendingApproval: ReturnType<typeof useClaudeChatSession>['pendingApproval'],
  approveAction: ReturnType<typeof useClaudeChatSession>['approveAction']
): ComposerPanelProps['pendingPermission'] {
  if (!pendingApproval) {
    return null
  }
  return {
    description: pendingApproval.reason,
    command: pendingApproval.command ? [pendingApproval.command] : undefined,
    onDecide: (decision: 'allow_once' | 'allow_always' | 'reject') => {
      const mapped =
        decision === 'allow_once'
          ? 'accept'
          : decision === 'allow_always'
            ? 'acceptForSession'
            : 'decline'
      void approveAction(pendingApproval.id, mapped)
    },
  }
}

function ClaudeChatTraitControls({
  selectedModelId,
  effort,
  thinking,
  fastMode,
  onEffortChange,
  onThinkingChange,
  onFastModeChange,
}: {
  selectedModelId: string | undefined
  effort: ReturnType<typeof useClaudeChatPaneComposer>['effort']
  thinking: boolean
  fastMode: boolean
  onEffortChange: ReturnType<typeof useClaudeChatPaneComposer>['setEffort']
  onThinkingChange: ReturnType<typeof useClaudeChatPaneComposer>['setThinking']
  onFastModeChange: ReturnType<typeof useClaudeChatPaneComposer>['setFastMode']
}) {
  return (
    <ClaudeTraitsPicker
      model={selectedModelId}
      effort={effort}
      thinking={thinking}
      fastMode={fastMode}
      onEffortChange={onEffortChange}
      onThinkingChange={onThinkingChange}
      onFastModeChange={onFastModeChange}
    />
  )
}

export function ClaudeChatPane({
  directory,
  sessionStorageKey,
  onFirstMessage,
  onTitleChange,
  permissionMode,
  onPermissionModeChange,
  branchMenuOpen,
  setBranchMenuOpen,
  branchControlWidthCh,
  branchLoading,
  branchSwitching,
  hasActiveProject,
  branchCurrent,
  branchDisplayValue,
  branchSearchInputRef,
  branchQuery,
  setBranchQuery,
  branchActionError,
  clearBranchActionError,
  checkoutBranch,
  filteredBranches,
  openBranchCreateModal,
  browserModeEnabled = false,
  setBrowserModeEnabled = () => {},
}: Props) {
  const {
    messages,
    pendingApproval,
    pendingUserInput,
    isStreaming,
    subagents,
    modelOptions,
    startTurn,
    interruptTurn,
    approveAction,
    respondToUserInput,
    archiveProviderSession,
    loadSubagentMessages,
  } = useClaudeChatSession(directory, sessionStorageKey)
  const activeSessionPresentation = useMemo(() => projectClaudeChatProjectedSessionPresentation(messages, isStreaming, subagents), [isStreaming, messages, subagents])
  const composerState = useClaudeChatPaneComposer({ messages, modelOptions, permissionMode, onFirstMessage, onTitleChange, startTurn, interruptTurn })
  const subagentState = useClaudeChatPaneSubagents({ subagents, loadSubagentMessages, archiveProviderSession })
  const pendingQuestion = buildPendingQuestion(pendingUserInput, respondToUserInput)
  const pendingPermission = buildPendingPermission(pendingApproval, approveAction)
  const customControls = (
    <ClaudeChatTraitControls
      selectedModelId={composerState.selectedModelId}
      effort={composerState.effort}
      thinking={composerState.thinking}
      fastMode={composerState.fastMode}
      onEffortChange={composerState.setEffort}
      onThinkingChange={composerState.setThinking}
      onFastModeChange={composerState.setFastMode}
    />
  )

  return (
    <ClaudeChatPaneView
      {...composerState}
      {...subagentState}
      rows={activeSessionPresentation.rows}
      sessionStorageKey={sessionStorageKey}
      permissionMode={permissionMode}
      onPermissionModeChange={onPermissionModeChange}
      branchMenuOpen={branchMenuOpen}
      setBranchMenuOpen={setBranchMenuOpen}
      branchControlWidthCh={branchControlWidthCh}
      branchLoading={branchLoading}
      branchSwitching={branchSwitching}
      hasActiveProject={hasActiveProject}
      branchCurrent={branchCurrent}
      branchDisplayValue={branchDisplayValue}
      branchSearchInputRef={branchSearchInputRef}
      branchQuery={branchQuery}
      setBranchQuery={setBranchQuery}
      branchActionError={branchActionError}
      clearBranchActionError={clearBranchActionError}
      checkoutBranch={checkoutBranch}
      filteredBranches={filteredBranches}
      openBranchCreateModal={openBranchCreateModal}
      browserModeEnabled={browserModeEnabled}
      setBrowserModeEnabled={setBrowserModeEnabled}
      modelOptions={modelOptions}
      customControls={customControls}
      pendingQuestion={pendingQuestion}
      pendingPermission={pendingPermission}
    />
  )
}
