import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { useClaudeChatSession } from '../hooks/useClaudeChatSession'
import { ClaudeTraitsPicker } from './ClaudeTraitsPicker'
import { projectClaudeChatProjectedSessionPresentation } from '../lib/claude-chat-session-presentation'
import type { ComposerPanelProps } from './ComposerPanel'
import type { PermissionMode } from '../types/app'
import type { SessionGuardrailPreferences } from '../lib/session-controls'
import type { AgentQuestion } from './chat/QuestionDock'
import { ClaudeChatPaneView } from './ClaudeChatPane.view'
import { useClaudeChatPaneComposer } from './useClaudeChatPaneComposer'
import { useClaudeChatPaneSubagents } from './useClaudeChatPaneSubagents'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'
import { useClaudeSessionControls } from '../hooks/useSessionControls'

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
  sessionGuardrailPreferences: SessionGuardrailPreferences
  onOpenSettings: () => void
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
  approveAction: ReturnType<typeof useClaudeChatSession>['approveAction'],
  permissionMode: PermissionMode
): ComposerPanelProps['pendingPermission'] {
  if (!pendingApproval || permissionMode === 'yolo-write') {
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
  ...props
}: Props) {
  return <ClaudeChatPaneView {...useClaudeChatPaneState(props)} />
}

function useClaudeChatPaneSessionState(input: {
  directory: string
  sessionStorageKey: string
  messages: ReturnType<typeof useClaudeChatSession>['messages']
  isStreaming: boolean
  subagents: ReturnType<typeof useClaudeChatSession>['subagents']
  modelOptions: ReturnType<typeof useClaudeChatSession>['modelOptions']
  permissionMode: PermissionMode
  onFirstMessage?: () => void
  onTitleChange?: (title: string) => void
  startTurn: ReturnType<typeof useClaudeChatSession>['startTurn']
  interruptTurn: ReturnType<typeof useClaudeChatSession>['interruptTurn']
  loadSubagentMessages: ReturnType<typeof useClaudeChatSession>['loadSubagentMessages']
  archiveProviderSession: ReturnType<typeof useClaudeChatSession>['archiveProviderSession']
  sessionGuardrailPreferences: SessionGuardrailPreferences
}) {
  const activeSessionPresentation = useMemo(
    () =>
      projectClaudeChatProjectedSessionPresentation(
        input.messages,
        input.isStreaming,
        input.subagents
      ),
    [input.isStreaming, input.messages, input.subagents]
  )
  const claudeRuntime = useUnifiedRuntimeStore(
    state => state.claudeChatSessions[input.sessionStorageKey] ?? null
  )
  const controls = useClaudeSessionControls({
    sessionKey: input.sessionStorageKey,
    directory: input.directory,
    preferences: input.sessionGuardrailPreferences,
    messages: input.messages,
    observedTokenTotal: claudeRuntime?.observedTokenTotal ?? 0,
    turnTokenTotals: claudeRuntime?.turnTokenTotals ?? [],
  })
  const composerState = useClaudeChatPaneComposer({
    directory: input.directory,
    messages: input.messages,
    modelOptions: input.modelOptions,
    permissionMode: input.permissionMode,
    onFirstMessage: input.onFirstMessage,
    onTitleChange: input.onTitleChange,
    startTurn: input.startTurn,
    interruptTurn: input.interruptTurn,
  })
  const subagentState = useClaudeChatPaneSubagents({
    subagents: input.subagents,
    loadSubagentMessages: input.loadSubagentMessages,
    archiveProviderSession: input.archiveProviderSession,
  })

  return {
    activeSessionPresentation,
    controls,
    composerState,
    subagentState,
  }
}

function buildClaudeChatPaneViewModel(input: {
  composerState: ReturnType<typeof useClaudeChatPaneComposer>
  subagentState: ReturnType<typeof useClaudeChatPaneSubagents>
  activeSessionPresentation: ReturnType<typeof projectClaudeChatProjectedSessionPresentation>
  isSessionBusy: boolean
  sessionStorageKey: string
  permissionMode: PermissionMode
  onPermissionModeChange: (mode: PermissionMode) => void
  branchProps: {
    branchMenuOpen: boolean
    setBranchMenuOpen: Props['setBranchMenuOpen']
    branchControlWidthCh: number
    branchLoading: boolean
    branchSwitching: boolean
    hasActiveProject: boolean
    branchCurrent?: string
    branchDisplayValue: string
    branchSearchInputRef: Props['branchSearchInputRef']
    branchQuery: string
    setBranchQuery: (value: string) => void
    branchActionError: string | null
    clearBranchActionError: () => void
    checkoutBranch: (name: string) => void | Promise<void>
    filteredBranches: string[]
    openBranchCreateModal: () => void | Promise<void>
    browserModeEnabled: boolean
    setBrowserModeEnabled: (enabled: boolean) => void
    onOpenSettings: () => void
  }
  modelOptions: ReturnType<typeof useClaudeChatSession>['modelOptions']
  customControls: ReactNode
  pendingQuestion: ComposerPanelProps['pendingQuestion']
  pendingPermission: ComposerPanelProps['pendingPermission']
  controls: ReturnType<typeof useClaudeSessionControls>
  changesOpen: boolean
  setChangesOpen: Dispatch<SetStateAction<boolean>>
}) {
  return {
    ...input.composerState,
    ...input.subagentState,
    rows: input.activeSessionPresentation.rows,
    sessionStorageKey: input.sessionStorageKey,
    permissionMode: input.permissionMode,
    onPermissionModeChange: input.onPermissionModeChange,
    ...input.branchProps,
    modelOptions: input.modelOptions,
    customControls: input.customControls,
    pendingQuestion: input.pendingQuestion,
    pendingPermission: input.pendingPermission,
    isSessionBusy: input.isSessionBusy,
    guardrailState: input.controls.guardrailState,
    guardrailPrompt: input.controls.guardrailPrompt,
    onDismissGuardrailWarning: input.controls.dismissGuardrailWarning,
    onContinueGuardrailOnce: input.controls.continueOnce,
    onDisableGuardrailsForSession: input.controls.disableGuardrailsForSession,
    sessionChangeTargets: input.controls.revertTargets,
    onRevertSessionChange: async (targetId: string) => {
      await input.controls.revertTarget(targetId)
    },
    todoOpen: input.changesOpen,
    onTodoToggle: () => input.setChangesOpen(value => !value),
    compactionState: input.controls.compactionState,
    sendPrompt: async () => {
      await input.controls.withGuardrails(input.composerState.sendPrompt)
    },
  }
}

function buildClaudeChatPaneBranchProps(input: {
  branchMenuOpen: boolean
  setBranchMenuOpen: Props['setBranchMenuOpen']
  branchControlWidthCh: number
  branchLoading: boolean
  branchSwitching: boolean
  hasActiveProject: boolean
  branchCurrent?: string
  branchDisplayValue: string
  branchSearchInputRef: Props['branchSearchInputRef']
  branchQuery: string
  setBranchQuery: (value: string) => void
  branchActionError: string | null
  clearBranchActionError: () => void
  checkoutBranch: (name: string) => void | Promise<void>
  filteredBranches: string[]
  openBranchCreateModal: () => void | Promise<void>
  browserModeEnabled: boolean
  setBrowserModeEnabled: (enabled: boolean) => void
  onOpenSettings: () => void
}) {
  return input
}

function buildClaudeChatCustomControls(
  composerState: ReturnType<typeof useClaudeChatPaneComposer>
) {
  return (
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
}

function useClaudeChatPanePendingState(input: {
  pendingApproval: ReturnType<typeof useClaudeChatSession>['pendingApproval']
  pendingUserInput: ReturnType<typeof useClaudeChatSession>['pendingUserInput']
  respondToUserInput: ReturnType<typeof useClaudeChatSession>['respondToUserInput']
  approveAction: ReturnType<typeof useClaudeChatSession>['approveAction']
  permissionMode: PermissionMode
}) {
  const {
    pendingApproval,
    pendingUserInput,
    respondToUserInput,
    approveAction,
    permissionMode,
  } = input
  const pendingQuestion = buildPendingQuestion(pendingUserInput, respondToUserInput)
  const pendingPermission = buildPendingPermission(
    pendingApproval,
    approveAction,
    permissionMode
  )

  useEffect(() => {
    if (permissionMode !== 'yolo-write' || !pendingApproval) {
      return
    }
    void approveAction(pendingApproval.id, 'acceptForSession')
  }, [approveAction, pendingApproval, permissionMode])

  return {
    pendingQuestion,
    pendingPermission,
  }
}

function useClaudeChatPaneRuntime(input: {
  directory: string
  sessionStorageKey: string
  onFirstMessage?: () => void
  onTitleChange?: (title: string) => void
  permissionMode: PermissionMode
  sessionGuardrailPreferences: SessionGuardrailPreferences
}) {
  const session = useClaudeChatSession(input.directory, input.sessionStorageKey)
  const sessionState = useClaudeChatPaneSessionState({
    directory: input.directory,
    sessionStorageKey: input.sessionStorageKey,
    messages: session.messages,
    isStreaming: session.isStreaming,
    subagents: session.subagents,
    modelOptions: session.modelOptions,
    permissionMode: input.permissionMode,
    onFirstMessage: input.onFirstMessage,
    onTitleChange: input.onTitleChange,
    startTurn: session.startTurn,
    interruptTurn: session.interruptTurn,
    loadSubagentMessages: session.loadSubagentMessages,
    archiveProviderSession: session.archiveProviderSession,
    sessionGuardrailPreferences: input.sessionGuardrailPreferences,
  })

  return {
    ...session,
    ...sessionState,
  }
}

function useClaudeChatPaneState({
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
  sessionGuardrailPreferences,
  onOpenSettings,
}: Props) {
  const {
    connectionStatus,
    isStreaming,
    pendingApproval,
    pendingUserInput,
    approveAction,
    respondToUserInput,
    modelOptions,
    activeSessionPresentation,
    controls,
    composerState,
    subagentState,
  } = useClaudeChatPaneRuntime({
    directory,
    sessionStorageKey,
    onFirstMessage,
    onTitleChange,
    permissionMode,
    sessionGuardrailPreferences,
  })
  const [changesOpen, setChangesOpen] = useState(false)
  const { pendingQuestion, pendingPermission } = useClaudeChatPanePendingState({
    pendingApproval,
    pendingUserInput,
    respondToUserInput,
    approveAction,
    permissionMode,
  })
  const customControls = buildClaudeChatCustomControls(composerState)

  return buildClaudeChatPaneViewModel({
    composerState,
    subagentState,
    activeSessionPresentation,
    isSessionBusy: isStreaming || connectionStatus === 'connecting',
    sessionStorageKey,
    permissionMode,
    onPermissionModeChange,
    branchProps: buildClaudeChatPaneBranchProps({
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
      browserModeEnabled,
      setBrowserModeEnabled,
      onOpenSettings,
    }),
    modelOptions,
    customControls,
    pendingQuestion,
    pendingPermission,
    controls,
    changesOpen,
    setChangesOpen,
  })
}
