import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { CodexCollaborationMode, CodexModelEntry } from '@shared/ipc'
import type { ModelOption } from './lib/models'
import type { UnifiedBackgroundAgentSummary } from './lib/session-presentation'
import type { AppPreferences } from '~/types/app'
import type { SessionType } from '~/types/canvas'
import type { AppSessionContentProps } from './AppSessionContent'
import type { SkillEntry, SessionMessageBundle } from '@shared/ipc'
import type { Attachment } from './hooks/useComposerState'

type BranchControlState = {
  branchMenuOpen: boolean
  setBranchMenuOpen: Dispatch<SetStateAction<boolean>>
  branchControlWidthCh: number
  branchLoading: boolean
  branchSwitching: boolean
  hasActiveProject: boolean
  branchCurrent: string | undefined
  branchDisplayValue: string
  branchSearchInputRef: RefObject<HTMLInputElement | null>
  branchQuery: string
  setBranchQuery: Dispatch<SetStateAction<string>>
  branchActionError: string | null
  clearBranchActionError: () => void
  checkoutBranch: (name: string) => Promise<void>
  filteredBranches: string[]
  openBranchCreateModal: () => void
}

type BuildAppSessionContentPropsArgs = {
  sidebarMode: AppSessionContentProps['sidebarMode']
  activeProjectDir: string | undefined
  activeSessionID: string | undefined
  activeSessionType: SessionType | undefined
  pendingSessionId: string | undefined
  dashboardProps: AppSessionContentProps['dashboardProps']
  skills: SkillEntry[]
  skillsLoading: boolean
  skillsError: string | undefined
  loadSkills: () => void
  openSkillUseModal: (skill: SkillEntry) => void
  createSession: (directory?: string, sessionTypeOrPrompt?: SessionType | string) => Promise<unknown>
  canvasState: AppSessionContentProps['canvasPaneProps']['canvasState']
  mcpDevToolsState: AppSessionContentProps['canvasPaneProps']['mcpDevToolsState']
  activeLocalProviderSessionKey: string
  activeCodexSessionDraft: boolean
  cachedCodexCollaborationModes: CodexCollaborationMode[]
  cachedCodexModels: CodexModelEntry[]
  handleActiveLocalProviderInteraction: () => void
  handleActiveLocalProviderTitleChange: (title: string) => void
  appPreferences: AppPreferences
  setAppPreferences: Dispatch<SetStateAction<AppPreferences>>
  branchControls: BranchControlState
  browserModeEnabled: boolean
  activeSessionKey: string | null
  setBrowserModeBySession: Dispatch<SetStateAction<Record<string, boolean>>>
  openWorkspaceDashboard: () => void
  manualSessionTitles: Record<string, boolean>
  openReferencedFile: (reference: string) => Promise<void>
  setBrowserMode: (enabled: boolean) => Promise<void> | void
  feedMessages: SessionMessageBundle[]
  feedPresentation: AppSessionContentProps['messageFeedProps']['presentation']
  activeSessionNotices: AppSessionContentProps['messageFeedProps']['sessionNotices']
  isSessionInProgress: boolean
  activeOptimisticOpencodePrompt: { text: string; timestamp: number } | null
  assistantLabel: string
  messageFeedBottomClearance: number
  composer: string
  handleComposerChange: AppSessionContentProps['composerPanelProps']['setComposer']
  composerAttachments: Attachment[]
  removeAttachment: (id: string) => void
  slashMenuOpen: boolean
  filteredSlashCommands: AppSessionContentProps['composerPanelProps']['filteredSlashCommands']
  slashSelectedIndex: number
  insertSlashCommand: (command: string) => void
  handleSlashKeyDown: AppSessionContentProps['composerPanelProps']['handleSlashKeyDown']
  addComposerAttachments: (next: Attachment[]) => void
  sendComposerPrompt: () => void
  abortActiveSession: () => Promise<void>
  isSendingPrompt: boolean
  pickImageAttachment: () => Promise<void>
  hasPlanAgent: boolean
  isPlanMode: boolean
  togglePlanMode: AppSessionContentProps['composerPanelProps']['togglePlanMode']
  effectiveComposerAgentOptions: AppSessionContentProps['composerPanelProps']['agentOptions']
  selectedAgent: string | undefined
  setSelectedAgent: AppSessionContentProps['composerPanelProps']['onAgentChange']
  compactionMeter: { progress: number; hint: string; compacted: boolean }
  modelSelectOptions: ModelOption[]
  selectedModel: string | undefined
  setSelectedModel: (model: string | undefined) => void
  selectedVariant: string | undefined
  setSelectedVariant: (variant: string | undefined) => void
  variantOptions: AppSessionContentProps['composerPanelProps']['variantOptions']
  composerPlaceholder: string
  handleComposerLayoutHeightChange: (height: number) => void
  handleDockHeightChange: (height: number) => void
  visibleBackgroundAgents: UnifiedBackgroundAgentSummary[]
  selectedBackgroundAgentId: string | null
  setSelectedBackgroundAgentId: Dispatch<SetStateAction<string | null>>
  handleArchiveBackgroundAgent: (agent: UnifiedBackgroundAgentSummary) => Promise<void>
  backgroundAgentDetail: AppSessionContentProps['composerPanelProps']['backgroundAgentDetail']
  backgroundAgentTaskText: string | null
  selectedBackgroundAgentLoading: boolean
  selectedBackgroundAgentError: string | null
  activeTodoItems: AppSessionContentProps['composerPanelProps']['todoItems']
  dockTodosOpen: boolean
  setDockTodosOpen: Dispatch<SetStateAction<boolean>>
  showReviewChangesDrawer: boolean
  activeReviewChangesFiles: NonNullable<AppSessionContentProps['composerPanelProps']['reviewChangesFiles']>
  dockPendingPermission: AppSessionContentProps['composerPanelProps']['pendingPermission']
  dockPendingQuestion: AppSessionContentProps['composerPanelProps']['pendingQuestion']
  followupQueue: AppSessionContentProps['composerPanelProps']['queuedMessages']
  sendingQueuedId: string | undefined
  queueFollowupMessage: (message: string, attachments?: Attachment[]) => void
  runQueuedMessage: (id: string) => void
  editQueuedMessage: (id: string) => void
  removeQueuedMessage: (id: string) => void
  canShowIntegratedTerminal: boolean
  terminalTabs: { id: string; label: string }[]
  activeTerminalId: string | undefined
  terminalOpen: boolean
  terminalPanelHeight: number
  createTerminal: () => Promise<void>
  closeTerminalTab: (ptyId: string) => Promise<void>
  setActiveTerminalId: Dispatch<SetStateAction<string | undefined>>
  handleTerminalResizeStart: NonNullable<AppSessionContentProps['terminalPanelProps']>['onResizeStart']
}

export function buildAppSessionContentProps(
  args: BuildAppSessionContentPropsArgs
): AppSessionContentProps {
  return {
    sidebarMode: args.sidebarMode,
    activeProjectDir: args.activeProjectDir,
    activeSessionID: args.activeSessionID,
    activeSessionType: args.activeSessionType,
    pendingSessionId: args.pendingSessionId,
    dashboardProps: args.dashboardProps,
    skillsProps: buildSkillsProps(args),
    workspaceLandingProps: buildWorkspaceLandingProps(args),
    canvasPaneProps: buildCanvasPaneProps(args),
    claudeChatPaneProps: buildClaudeChatPaneProps(args),
    claudeTerminalPaneProps: buildClaudeTerminalPaneProps(args),
    codexPaneProps: buildCodexPaneProps(args),
    messageFeedProps: buildMessageFeedProps(args),
    composerPanelProps: buildComposerPanelProps(args),
    terminalPanelProps: buildTerminalPanelProps(args),
  }
}

function buildSkillsProps(args: BuildAppSessionContentPropsArgs) {
  return {
    skills: args.skills,
    loading: args.skillsLoading,
    error: args.skillsError,
    onRefresh: () => args.loadSkills(),
    onUseSkill: args.openSkillUseModal,
  }
}

function buildWorkspaceLandingProps(args: BuildAppSessionContentPropsArgs) {
  return {
    workspaceName: args.activeProjectDir?.split('/').pop() ?? args.activeProjectDir ?? '',
    onPickSession: (type: SessionType) => void args.createSession(args.activeProjectDir, type),
  }
}

function buildCanvasPaneProps(args: BuildAppSessionContentPropsArgs) {
  return {
    canvasState: args.canvasState,
    directory: args.activeProjectDir,
    mcpDevToolsState: args.mcpDevToolsState,
  }
}

function buildClaudeChatPaneProps(args: BuildAppSessionContentPropsArgs) {
  return {
    directory: args.activeProjectDir ?? '',
    sessionStorageKey: args.activeLocalProviderSessionKey,
    onFirstMessage: args.handleActiveLocalProviderInteraction,
    onTitleChange: args.handleActiveLocalProviderTitleChange,
    permissionMode: args.appPreferences.permissionMode,
    onPermissionModeChange: (mode: AppPreferences['permissionMode']) =>
      args.setAppPreferences({ ...args.appPreferences, permissionMode: mode }),
    ...args.branchControls,
    browserModeEnabled: args.browserModeEnabled,
    setBrowserModeEnabled: (enabled: boolean) => {
      if (!args.activeSessionKey) {
        return
      }
      args.setBrowserModeBySession(prev => ({ ...prev, [args.activeSessionKey!]: enabled }))
    },
  }
}

function buildClaudeTerminalPaneProps(args: BuildAppSessionContentPropsArgs) {
  return {
    directory: args.activeProjectDir ?? '',
    sessionStorageKey: args.activeLocalProviderSessionKey,
    onExit: args.openWorkspaceDashboard,
    onFirstInteraction: args.handleActiveLocalProviderInteraction,
  }
}

function buildCodexPaneProps(args: BuildAppSessionContentPropsArgs) {
  return {
    cachedCollaborationModes: args.cachedCodexCollaborationModes,
    cachedModels: args.cachedCodexModels,
    directory: args.activeProjectDir ?? '',
    sessionStorageKey: args.activeLocalProviderSessionKey,
    isDraft: args.activeCodexSessionDraft,
    titleLocked: args.manualSessionTitles[args.activeLocalProviderSessionKey] ?? false,
    onExit: args.openWorkspaceDashboard,
    onFirstMessage: args.handleActiveLocalProviderInteraction,
    onTitleChange: args.handleActiveLocalProviderTitleChange,
    notifyOnAwaitingInput: args.appPreferences.notifyOnAwaitingInput,
    subagentSystemNotificationsEnabled: args.appPreferences.subagentSystemNotificationsEnabled,
    codexAccessMode: args.appPreferences.codexAccessMode,
    defaultReasoningEffort: args.appPreferences.codexReasoningEffort,
    permissionMode: args.appPreferences.permissionMode,
    onPermissionModeChange: (mode: AppPreferences['permissionMode']) =>
      args.setAppPreferences({ ...args.appPreferences, permissionMode: mode }),
    codexPath: args.appPreferences.codexPath,
    codexArgs: args.appPreferences.codexArgs,
    onOpenFileReference: (reference: string) => void args.openReferencedFile(reference),
    browserModeEnabled: args.browserModeEnabled,
    setBrowserModeEnabled: (enabled: boolean) => void args.setBrowserMode(enabled),
    ...args.branchControls,
  }
}

function buildMessageFeedProps(args: BuildAppSessionContentPropsArgs) {
  return {
    messages: args.feedMessages,
    presentation: args.feedPresentation,
    sessionNotices: args.activeSessionNotices,
    showAssistantPlaceholder: args.isSessionInProgress,
    optimisticUserPrompt: args.activeOptimisticOpencodePrompt,
    assistantLabel: args.assistantLabel,
    workspaceDirectory: args.activeProjectDir ?? null,
    bottomClearance: args.messageFeedBottomClearance,
    onOpenFileReference: (reference: string) => void args.openReferencedFile(reference),
    sessionId: args.activeSessionKey ?? undefined,
  }
}

function buildComposerPanelProps(args: BuildAppSessionContentPropsArgs) {
  return {
    composer: args.composer,
    setComposer: args.handleComposerChange,
    composerAttachments: args.composerAttachments,
    removeAttachment: args.removeAttachment,
    slashMenuOpen: args.slashMenuOpen,
    filteredSlashCommands: args.filteredSlashCommands,
    slashSelectedIndex: args.slashSelectedIndex,
    insertSlashCommand: args.insertSlashCommand,
    handleSlashKeyDown: args.handleSlashKeyDown,
    addComposerAttachments: args.addComposerAttachments,
    sendPrompt: args.sendComposerPrompt,
    abortActiveSession: args.abortActiveSession,
    isSessionBusy: args.isSessionInProgress,
    isSendingPrompt: args.isSendingPrompt,
    pickImageAttachment: args.pickImageAttachment,
    hasActiveSession: Boolean(args.activeSessionID),
    isPlanMode: args.isPlanMode,
    hasPlanAgent: args.hasPlanAgent,
    togglePlanMode: args.togglePlanMode,
    browserModeEnabled: args.browserModeEnabled,
    setBrowserModeEnabled: (enabled: boolean) => void args.setBrowserMode(enabled),
    hideBrowserToggle: false,
    hidePlanToggle: true,
    agentOptions: args.effectiveComposerAgentOptions,
    selectedAgent: args.selectedAgent,
    onAgentChange: args.setSelectedAgent,
    permissionMode: args.appPreferences.permissionMode,
    onPermissionModeChange: (mode: AppPreferences['permissionMode']) =>
      args.setAppPreferences({ ...args.appPreferences, permissionMode: mode }),
    compactionProgress: args.compactionMeter.progress,
    compactionHint: args.compactionMeter.hint,
    compactionCompacted: args.compactionMeter.compacted,
    modelSelectOptions: args.modelSelectOptions,
    selectedModel: args.selectedModel,
    setSelectedModel: args.setSelectedModel,
    selectedVariant: args.selectedVariant,
    setSelectedVariant: args.setSelectedVariant,
    variantOptions: args.variantOptions,
    placeholder: args.composerPlaceholder,
    onLayoutHeightChange: args.handleComposerLayoutHeightChange,
    onDockHeightChange: args.handleDockHeightChange,
    backgroundAgents: args.visibleBackgroundAgents,
    selectedBackgroundAgentId: args.selectedBackgroundAgentId,
    onOpenBackgroundAgent: args.setSelectedBackgroundAgentId,
    onCloseBackgroundAgent: () => args.setSelectedBackgroundAgentId(null),
    onArchiveBackgroundAgent: args.handleArchiveBackgroundAgent,
    backgroundAgentDetail: args.backgroundAgentDetail,
    backgroundAgentTaskText: args.backgroundAgentTaskText,
    backgroundAgentDetailLoading: args.selectedBackgroundAgentLoading,
    backgroundAgentDetailError: args.selectedBackgroundAgentError,
    backgroundAgentTaggingHint: null,
    todoItems: args.activeTodoItems,
    todoOpen: args.dockTodosOpen,
    onTodoToggle: () => args.setDockTodosOpen(v => !v),
    reviewChangesFiles: args.showReviewChangesDrawer ? args.activeReviewChangesFiles : undefined,
    onOpenReviewChange: (path: string) => void args.openReferencedFile(path),
    pendingPermission: args.dockPendingPermission,
    pendingQuestion: args.dockPendingQuestion,
    queuedMessages: args.followupQueue,
    sendingQueuedId: args.sendingQueuedId,
    onQueueMessage: args.queueFollowupMessage,
    queuedActionKind: 'send' as const,
    onPrimaryQueuedAction: args.runQueuedMessage,
    onEditQueued: args.editQueuedMessage,
    onRemoveQueued: args.removeQueuedMessage,
    ...args.branchControls,
  }
}

function buildTerminalPanelProps(args: BuildAppSessionContentPropsArgs) {
  if (!args.canShowIntegratedTerminal || !args.activeProjectDir) {
    return undefined
  }
  return {
    directory: args.activeProjectDir,
    tabs: args.terminalTabs,
    activeTabId: args.activeTerminalId,
    open: args.terminalOpen,
    height: args.terminalPanelHeight,
    onCreateTab: args.createTerminal,
    onCloseTab: args.closeTerminalTab,
    onSwitchTab: args.setActiveTerminalId,
    onResizeStart: args.handleTerminalResizeStart,
  }
}
