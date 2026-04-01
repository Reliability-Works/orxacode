import { createElement, useMemo, useRef } from 'react'
import { useCodexSession } from '../hooks/useCodexSession'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'
import type { CodexPaneViewProps } from './CodexPane.view'
import type { CodexPaneComposerPanelProps } from './CodexPaneComposerPanel'
import type { CodexPaneProps } from './CodexPane.types'
import { useCodexPaneBootstrap } from './useCodexPaneBootstrap'
import { useCodexPaneComposer } from './useCodexPaneComposer'
import { useCodexPaneNotifications } from './useCodexPaneNotifications'
import { useCodexPaneSubagentState } from './useCodexPaneSubagentState'
import { useCodexSessionControls } from '../hooks/useSessionControls'
import { ProviderCommandBrowserControl } from './ProviderCommandBrowserControl'

function buildComposerPlaceholder({
  connectionStatus,
  isDraft,
  lastError,
  thread,
}: {
  connectionStatus: string
  isDraft?: boolean
  lastError?: string
  thread: { id?: string | null } | null
}) {
  if (connectionStatus === 'error') return lastError ?? 'Error connecting to Codex. Click to retry.'
  if (isDraft) return 'Send Codex a message...'
  if (connectionStatus !== 'connected') return 'Connecting to Codex...'
  if (!thread) return 'Starting thread...'
  return 'Send Codex a message...'
}

function useCodexPaneMessagePresentation(messages: ReturnType<typeof useCodexSession>['messages'], isStreaming: boolean) {
  const trailingReasoningId = useMemo(
    () => (isStreaming ? [...messages].reverse().find(msg => msg.kind === 'reasoning')?.id ?? null : null),
    [isStreaming, messages]
  )
  const visibleMessages = useMemo(() => messages.filter(msg => msg.kind !== 'reasoning'), [messages])
  const trailingReasoning = trailingReasoningId
    ? messages.find(msg => msg.id === trailingReasoningId && msg.kind === 'reasoning')
    : undefined
  return { trailingReasoning, visibleMessages }
}

function buildComposerProps(args: {
  pane: CodexPaneProps
  bootstrap: ReturnType<typeof useCodexPaneBootstrap>
  composer: ReturnType<typeof useCodexPaneComposer>
  permissionDockProps: ReturnType<typeof useCodexPaneNotifications>['permissionDockProps']
  session: ReturnType<typeof useCodexSession>
  composerPlaceholder: string
  subagents: ReturnType<typeof useCodexPaneSubagentState>
  controls: ReturnType<typeof useCodexSessionControls>
}): CodexPaneComposerPanelProps {
  const { pane, bootstrap, composer, permissionDockProps, session, composerPlaceholder, subagents, controls } = args
  return {
    input: composer.input,
    setInput: composer.setInput,
    composerAttachments: composer.composerAttachments,
    removeAttachment: composer.removeAttachment,
    addComposerAttachments: composer.addComposerAttachments,
    sendPrompt: async () => {
      await controls.withGuardrails(composer.sendPrompt)
    },
    abortActiveSession: composer.abortActiveSession,
    isSessionBusy: session.isStreaming,
    pickImageAttachment: composer.pickImageAttachment,
    hasActiveSession: pane.isDraft || (session.connectionStatus === 'connected' && session.thread !== null),
    isPlanMode: composer.isPlanMode,
    setIsPlanMode: composer.setIsPlanMode,
    collaborationModes: bootstrap.collaborationModes,
    selectedCollabMode: bootstrap.selectedCollabMode,
    setSelectedCollabMode: bootstrap.setSelectedCollabMode,
    permissionMode: pane.permissionMode,
    onPermissionModeChange: pane.onPermissionModeChange,
    guardrailState: controls.guardrailState,
    guardrailPrompt: controls.guardrailPrompt,
    onDismissGuardrailWarning: controls.dismissGuardrailWarning,
    onContinueGuardrailOnce: controls.continueOnce,
    onDisableGuardrailsForSession: controls.disableGuardrailsForSession,
    onOpenSettings: pane.onOpenSettings,
    compactionState: controls.compactionState,
    branchMenuOpen: pane.branchMenuOpen,
    setBranchMenuOpen: pane.setBranchMenuOpen,
    branchControlWidthCh: pane.branchControlWidthCh,
    branchLoading: pane.branchLoading,
    branchSwitching: pane.branchSwitching,
    hasActiveProject: pane.hasActiveProject,
    branchCurrent: pane.branchCurrent,
    branchDisplayValue: pane.branchDisplayValue,
    branchSearchInputRef: pane.branchSearchInputRef,
    branchQuery: pane.branchQuery,
    setBranchQuery: pane.setBranchQuery,
    branchActionError: pane.branchActionError,
    clearBranchActionError: pane.clearBranchActionError,
    checkoutBranch: pane.checkoutBranch,
    filteredBranches: pane.filteredBranches,
    openBranchCreateModal: pane.openBranchCreateModal,
    modelSelectOptions: bootstrap.modelSelectOptions,
    selectedModel: bootstrap.selectedModel,
    setSelectedModel: bootstrap.setSelectedModel,
    selectedReasoningEffort: bootstrap.selectedReasoningEffort,
    setSelectedReasoningEffort: bootstrap.setSelectedReasoningEffort,
    reasoningEffortOptions: bootstrap.reasoningEffortOptions,
    customControls: createElement(ProviderCommandBrowserControl, { provider: 'codex' }),
    placeholder: composerPlaceholder,
    backgroundAgents: subagents.effectiveBackgroundAgents,
    selectedBackgroundAgentId: session.activeSubagentThreadId,
    onOpenBackgroundAgent: subagents.handleOpenBackgroundAgent,
    onCloseBackgroundAgent: session.closeSubagentThread,
    onArchiveBackgroundAgent: subagents.handleArchiveBackgroundAgent,
    backgroundAgentDetail: subagents.subagentDetailBody,
    backgroundAgentTaskText: subagents.subagentTaskText,
    backgroundAgentDetailLoading: subagents.selectedBackgroundAgentDetailLoading,
    backgroundAgentDetailError: subagents.selectedBackgroundAgentDetailError,
    backgroundAgentTaggingHint: '(@ to tag agents)',
    pendingPermission: permissionDockProps,
    todoItems: subagents.effectiveTodoItems.length > 0 ? subagents.effectiveTodoItems : undefined,
    todoOpen: subagents.todoOpen,
    onTodoToggle: subagents.toggleTodoOpen,
    sessionChangeTargets: controls.revertTargets,
    onOpenReviewChange: subagents.handleOpenReviewChange,
    onRevertSessionChange: async targetId => {
      await controls.revertTarget(targetId)
    },
    queuedMessages: composer.codexQueue,
    sendingQueuedId: composer.codexSendingId,
    onQueueMessage: composer.queueCodexMessage,
    queuedActionKind: 'steer',
    onPrimaryQueuedAction: async id => {
      await controls.withGuardrails(() => composer.queuedAction(id))
    },
    onEditQueued: composer.editCodexQueued,
    onRemoveQueued: composer.removeCodexQueued,
    browserModeEnabled: pane.browserModeEnabled,
    setBrowserModeEnabled: pane.setBrowserModeEnabled,
  }
}

function useCodexPaneRuntime(pane: CodexPaneProps) {
  const codexRuntime = useUnifiedRuntimeStore(state => state.codexSessions[pane.sessionStorageKey] ?? null)
  const session = useCodexSession(pane.directory, pane.sessionStorageKey, {
    codexPath: pane.codexPath,
    codexArgs: pane.codexArgs,
  })
  const bootstrap = useCodexPaneBootstrap({
    cachedCollaborationModes: pane.cachedCollaborationModes,
    cachedModels: pane.cachedModels,
    codexAccessMode: pane.codexAccessMode,
    isDraft: pane.isDraft,
    connect: session.connect,
    connectionStatus: session.connectionStatus,
    defaultReasoningEffort: pane.defaultReasoningEffort,
    onTitleChange: pane.onTitleChange,
    permissionMode: pane.permissionMode,
    sessionStorageKey: pane.sessionStorageKey,
    startThread: session.startThread,
    thread: session.thread,
    threadName: session.threadName,
    titleLocked: pane.titleLocked ?? false,
  })
  const composer = useCodexPaneComposer({
    connect: session.connect,
    directory: pane.directory,
    interruptTurn: session.interruptTurn,
    connectionStatus: session.connectionStatus,
    codexAccessMode: pane.codexAccessMode,
    isDraft: pane.isDraft,
    isStreaming: session.isStreaming,
    messageCount: session.messages.filter(item => item.kind === 'message' && item.role === 'user').length,
    onFirstMessage: pane.onFirstMessage,
    queueAutoTitleGeneration: bootstrap.queueAutoTitleGeneration,
    permissionMode: pane.permissionMode,
    selectedCollabMode: bootstrap.selectedCollabMode,
    selectedModelID: bootstrap.selectedModelID,
    selectedReasoningEffort: bootstrap.selectedReasoningEffort,
    sendMessage: session.sendMessage,
    startThread: session.startThread,
    steerMessage: session.steerMessage,
    thread: session.thread,
  })
  const turnStartedAt = useRef<number>(0)
  const notifications = useCodexPaneNotifications({
    acceptPlan: session.acceptPlan,
    approveAction: session.approveAction,
    defaultCollaborationModeId: bootstrap.defaultCollaborationModeId,
    denyAction: session.denyAction,
    dismissPlan: session.dismissPlan,
    dismissedPlanIds: session.dismissedPlanIds,
    interruptTurn: session.interruptTurn,
    isStreaming: session.isStreaming,
    isSubagentThread: session.isSubagentThread,
    messages: session.messages,
    notifyOnAwaitingInput: pane.notifyOnAwaitingInput,
    pendingApproval: session.pendingApproval,
    pendingUserInput: session.pendingUserInput,
    permissionMode: pane.permissionMode,
    rejectUserInput: session.rejectUserInput,
    respondToUserInput: session.respondToUserInput,
    selectedModelID: bootstrap.selectedModelID,
    selectedReasoningEffort: bootstrap.selectedReasoningEffort,
    sessionStorageKey: pane.sessionStorageKey,
    setIsPlanMode: composer.setIsPlanMode,
    setSelectedCollabMode: bootstrap.setSelectedCollabMode,
    subagentSystemNotificationsEnabled: pane.subagentSystemNotificationsEnabled,
    submitPlanChanges: session.submitPlanChanges,
    turnStartedAt,
  })
  const subagents = useCodexPaneSubagentState({
    activeSubagentThreadId: session.activeSubagentThreadId,
    childThreads: codexRuntime?.runtimeSnapshot?.childThreads,
    closeSubagentThread: session.closeSubagentThread,
    lastError: session.lastError,
    messages: session.messages,
    onOpenFileReference: pane.onOpenFileReference,
    openSubagentThread: session.openSubagentThread,
    planItems: session.planItems,
    subagentMessages: session.subagentMessages,
    subagents: session.subagents,
    threadId: session.thread?.id ?? codexRuntime?.runtimeSnapshot?.thread?.id ?? undefined,
  })
  const controls = useCodexSessionControls({
    sessionKey: pane.sessionStorageKey,
    directory: pane.directory,
    preferences: pane.sessionGuardrailPreferences,
    messages: session.messages,
    observedTokenTotal: codexRuntime?.observedTokenTotal ?? 0,
    turnTokenTotals: codexRuntime?.turnTokenTotals ?? [],
  })
  return { bootstrap, composer, controls, notifications, session, subagents }
}

export function useCodexPaneViewProps(pane: CodexPaneProps): CodexPaneViewProps {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const runtime = useCodexPaneRuntime(pane)
  const messagePresentation = useCodexPaneMessagePresentation(runtime.session.messages, runtime.session.isStreaming)
  const composerPlaceholder = buildComposerPlaceholder({
    connectionStatus: runtime.session.connectionStatus,
    isDraft: pane.isDraft,
    lastError: runtime.session.lastError,
    thread: runtime.session.thread,
  })

  return {
    sessionId: pane.sessionStorageKey,
    isAvailable: Boolean(window.orxa?.codex),
    connectionStatus: runtime.session.connectionStatus,
    thread: runtime.session.thread,
    messages: runtime.session.messages,
    isStreaming: runtime.session.isStreaming,
    activePlanItem: runtime.notifications.activePlanItem,
    dismissedPlanIds: runtime.session.dismissedPlanIds,
    planItems: runtime.session.planItems,
    pendingApproval: runtime.session.pendingApproval,
    pendingUserInput: runtime.session.pendingUserInput,
    planReady: runtime.notifications.planReady,
    scrollContainerRef,
    messagesEndRef,
    handleScroll: runtime.bootstrap.handleScroll,
    onOpenFileReference: pane.onOpenFileReference,
    visibleMessages: messagePresentation.visibleMessages,
    trailingReasoning: messagePresentation.trailingReasoning,
    composerAlert: runtime.subagents.codexUsageAlert,
    questionDockProps: runtime.notifications.questionDockProps,
    pendingPlanProps: runtime.notifications.pendingPlanProps,
    composerProps: buildComposerProps({
      pane,
      bootstrap: runtime.bootstrap,
      composer: runtime.composer,
      permissionDockProps: runtime.notifications.permissionDockProps,
      session: runtime.session,
      composerPlaceholder,
      subagents: runtime.subagents,
      controls: runtime.controls,
    }),
  }
}
