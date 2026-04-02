import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  Profiler,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { GitCommitHorizontal, Send, Upload } from 'lucide-react'
import type {
  AgentsDocument,
  ChangeProvenanceRecord,
  OpenCodeAgentFile,
  ProjectListItem,
  ClaudeChatHealthStatus,
  CodexCollaborationMode,
  CodexModelEntry,
  CodexState,
  RuntimeProfile,
  RuntimeDependencyReport,
  RuntimeState,
  SessionPermissionMode,
  SkillEntry,
  SessionMessageBundle,
  ProviderUsageStats,
  ProjectBootstrap,
  WorkspaceWorktree,
  AppDiagnosticInput,
  PerfSnapshotExport,
  PerfSnapshotExportInput,
  PerfSummaryRow,
} from '@shared/ipc'
import { type PerfExportOptions, DEFAULT_PERF_EXPORT_OPTIONS } from './perf-export-options'
import type { Agent, ProviderListResponse } from '@opencode-ai/sdk/v2/client'
import { BackgroundSessionSupervisorHost } from './components/BackgroundSessionSupervisorHost'
import { ContentTopBar, type CustomRunCommandPreset } from './components/ContentTopBar'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { WorkspaceSidebar } from './components/WorkspaceSidebar'
import { useAppCoreBackgroundAgents } from './app-core-background-agents'
import { AppTransientOverlays } from './AppTransientOverlays'
import { AppGlobalDialogs } from './AppGlobalDialogs'
import { AppSessionContent } from './AppSessionContent'
import { AppSidePanes } from './AppSidePanes'
import { useAppCoreProjectActions } from './app-core-project-actions'
import { buildAppSessionContentProps } from './app-core-session-content-props'
import { buildContentTopBarProps, buildWorkspaceSidebarProps } from './app-core-shell-props'
import { buildGlobalDialogsProfileActions } from './app-global-dialog-actions'
import { useAppShellCommitFlow } from './hooks/useAppShellCommitFlow'
import { useAppShellDialogs } from './hooks/useAppShellDialogs'
import { useAppShellSessionFeedNotices } from './hooks/useAppShellSessionFeedNotices'
import { useAppShellToasts } from './hooks/useAppShellToasts'
import { useAppShellUpdateFlow } from './hooks/useAppShellUpdateFlow'
import { useCanvasState } from './hooks/useCanvasState'
import { useComposerState, type Attachment } from './hooks/useComposerState'
import { useDashboards } from './hooks/useDashboards'
import { useGitPanel, type CommitNextStep } from './hooks/useGitPanel'
import { usePersistedState } from './hooks/usePersistedState'
import { useWorkspaceState } from './hooks/useWorkspaceState'
import { useWorkspaceSessionMetadata } from './hooks/useWorkspaceSessionMetadata'
import { useWorkspaceSessionMetadataMigration } from './hooks/useWorkspaceSessionMetadataMigration'
import { useAppShellSessionCollections } from './hooks/useAppShellSessionCollections'
import { useWorkspaceDetailSurface } from './hooks/useWorkspaceDetailSurface'
import { useWorkspaceCodexThreads } from './hooks/useWorkspaceCodexThreads'
import { useClaudeSessionBrowser } from './hooks/useClaudeSessionBrowser'
import { useCodexSessionBrowser } from './hooks/useCodexSessionBrowser'
import { useBoundProviderSessionOpeners } from './hooks/useBoundProviderSessionOpeners'
import { useOpencodeSessionControls } from './hooks/useSessionControls'
import { useWorkspaceShellSurface } from './hooks/useWorkspaceShellSurface'
import { useAppCoreAwaitingInput } from './app-core-awaiting-input'
import { useAppCoreBootstrap } from './app-core-bootstrap'
import { useAppCoreDiagnostics } from './app-core-debug'
import { useAppCoreBrowser } from './app-core-browser'
import { shouldHideBrowserViewForPendingInput } from './app-core-browser-visibility'
import { createSessionAction } from './app-core-session'
import { useAppCoreSidebarResize } from './app-core-sidebar-resize'
import { useAppCoreTerminal } from './app-core-terminal'
// TODO: streaming buffer removed — needs reimplementation at the message-part delta
// level rather than the presentation layer to avoid blocking tool calls and diffs
import { useBackgroundSessionDescriptors } from './hooks/useBackgroundSessionDescriptors'
import {
  clearPersistedClaudeChatState,
  getPersistedClaudeChatState,
} from './hooks/claude-chat-session-storage'
import { clearPersistedCodexState, getPersistedCodexState } from './hooks/codex-session-storage'
import { codexModelsToOptions } from './components/CodexPane.helpers'
import {
  buildClaudeChatSessionStatus,
  buildClaudeSessionStatus,
  buildCodexSessionStatus,
  buildOpencodeSessionStatus,
  selectActiveComposerPresentation,
  selectActiveTaskListPresentation,
  selectClaudeChatSessionRuntime,
  selectCodexSessionRuntime,
  selectSessionPresentation,
  useUnifiedRuntimeStore,
} from './state/unified-runtime-store'
import {
  filterModelOptionsByProviderIDs,
  filterHiddenModelOptions,
  findFallbackModel,
  listAgentOptions,
  listModelOptions,
  mergeDiscoverableModelOptions,
  type ModelOption,
} from './lib/models'
import { preferredAgentForMode } from './lib/app-mode'
import { removePersistedValue } from './lib/persistence'
import {
  buildProviderArchiveRequest,
  clearLocalProviderArchiveState,
} from './lib/provider-session-archive'
import { measurePerf, usePerfProfiler } from './lib/performance'
import { resolveSessionCopyIdentifier } from './lib/session-context-menu'
import { isOpencodeRuntimeSession } from './lib/session-types'
import {
  deriveSessionTitleFromPrompt,
  isRecoverableSessionError,
  looksAutoGeneratedSessionTitle,
  shouldAutoRenameSessionTitle,
  toneForStatusLine,
} from './lib/app-session-utils'
import {
  buildAppShellBrowserSidebarState,
  buildAppShellHomeDashboardProps,
  deriveAppShellWorkspaceLayout,
} from './lib/app-shell-view-models'
import { buildWorkspaceSessionMetadataKey } from './lib/workspace-session-metadata'
import { opencodeClient } from './lib/services/opencodeClient'
import type { AppPreferences } from '~/types/app'
import type { SessionType } from '~/types/canvas'
import { CODE_FONT_OPTIONS, UI_FONT_OPTIONS } from '~/types/app'
import { useSyntheticSessionRegistry } from './hooks/useSyntheticSessionRegistry'

const KANBAN_MANAGEMENT_PROVIDERS = ['opencode', 'codex', 'claude'] as const

function extractKanbanManagementSidebarSessionID(
  sessionKey: string | undefined
): string | undefined {
  if (!sessionKey || sessionKey.startsWith('kanban:management:')) {
    return undefined
  }
  return sessionKey.includes('::') ? sessionKey.split('::').at(-1) : sessionKey
}

function describeClaudeHealthFailure(sessionLabel: string, health: ClaudeChatHealthStatus) {
  if (!health.available) {
    const reason = health.message?.trim()
    return reason
      ? `${sessionLabel} requires the local Claude Code CLI. ${reason}`
      : `${sessionLabel} requires the local Claude Code CLI. Verify \`claude --version\`, then retry.`
  }
  if (health.authenticated === false) {
    const reason = health.message?.trim()
    return reason
      ? `${sessionLabel} found Claude Code, but it is not authenticated. ${reason}`
      : `${sessionLabel} found Claude Code, but it is not authenticated. Run \`claude auth status\`, sign in if needed, then retry.`
  }
  return `${sessionLabel} could not verify the local Claude Code setup.`
}
import antigravityLogo from './assets/app-icons/antigravity.png'
import cursorLogo from './assets/app-icons/cursor.png'
import finderLogo from './assets/app-icons/finder.png'
import ghosttyLogo from './assets/app-icons/ghostty.png'
import terminalLogo from './assets/app-icons/terminal.png'
import xcodeLogo from './assets/app-icons/xcode.png'
import zedLogo from './assets/app-icons/zed.png'

const INITIAL_RUNTIME: RuntimeState = {
  status: 'disconnected',
  managedServer: false,
}

type OpenTarget = 'cursor' | 'antigravity' | 'finder' | 'terminal' | 'ghostty' | 'xcode' | 'zed'
type OptimisticOpencodePrompt = {
  text: string
  timestamp: number
}

const DEFAULT_COMMIT_GUIDANCE_PROMPT = [
  'Write a high-quality conventional commit message.',
  'Use this format:',
  '1) First line: <type>(optional-scope): concise summary in imperative mood.',
  '2) Blank line.',
  '3) Body bullets grouped by area, clearly describing what changed and why.',
  '4) Mention notable side effects, risk, and follow-up work if relevant.',
  '5) Keep it specific to the included diff and avoid generic phrasing.',
].join('\n')

const DEFAULT_APP_PREFERENCES: AppPreferences = {
  showOperationsPane: true,
  autoOpenTerminalOnCreate: true,
  confirmDangerousActions: true,
  permissionMode: 'ask-write',
  sessionGuardrailsEnabled: true,
  sessionTokenBudget: 120_000,
  sessionRuntimeBudgetMinutes: 45,
  commitGuidancePrompt: DEFAULT_COMMIT_GUIDANCE_PROMPT,
  codeFont: 'IBM Plex Mono',
  theme: 'glass',
  uiFont: 'Inter',
  hiddenModels: [],
  codexPath: '',
  codexArgs: '',
  codexDefaultModel: '',
  codexReasoningEffort: 'medium',
  codexAccessMode: 'on-request',
  gitAgent: 'opencode',
  notifyOnAwaitingInput: false,
  notifyOnTaskComplete: false,
  collaborationModesEnabled: true,
  subagentSystemNotificationsEnabled: true,
  enableAssistantStreaming: true,
}

const APP_PREFERENCES_KEY = 'orxa:appPreferences:v1'
const OPEN_TARGET_KEY = 'orxa:openTarget:v1'
const SIDEBAR_LEFT_WIDTH_KEY = 'orxa:leftPaneWidth:v1'
const SIDEBAR_BROWSER_WIDTH_KEY = 'orxa:browserPaneWidth:v1'
const SIDEBAR_RIGHT_WIDTH_KEY = 'orxa:rightPaneWidth:v1'
const AGENT_MODEL_PREFS_KEY = 'orxa:agentModelPrefs:v1'
const LAST_SELECTED_AGENT_KEY = 'orxa:lastSelectedAgent:v1'
const CUSTOM_RUN_COMMANDS_KEY = 'orxa:customRunCommands:v1'
const DEFAULT_COMPOSER_LAYOUT_HEIGHT = 132
const COMPOSER_DRAWER_ATTACH_OFFSET = 12
const DEFAULT_TERMINAL_PANEL_HEIGHT = 180

type ProjectSortMode = 'updated' | 'recent' | 'alpha-asc' | 'alpha-desc'

function resolveClaudeChatProviderThreadId(sessionKey: string) {
  const runtime = selectClaudeChatSessionRuntime(sessionKey)
  const persisted = getPersistedClaudeChatState(sessionKey)
  return (
    runtime?.providerThreadId ??
    runtime?.historyMessages.find(message => message.sessionId.trim().length > 0)?.sessionId ??
    persisted.historyMessages.find(message => message.sessionId.trim().length > 0)?.sessionId ??
    null
  )
}

function normalizeFileReferencePath(reference: string, workspaceDirectory?: string | null) {
  const trimmed = reference.trim()
  if (!trimmed) {
    return null
  }
  const withoutHashAnchor = trimmed.replace(/#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?$/i, '')
  const withoutLineSuffix = withoutHashAnchor.replace(/:\d+(?::\d+)?(?:-\d+(?::\d+)?)?$/, '')
  const normalized = withoutLineSuffix.replace(/^file:\/\//i, '')
  if (/^\/(Users|Volumes|private)\//.test(normalized)) {
    return normalized
  }
  if (!workspaceDirectory) {
    return normalized
  }
  const relative = normalized
    .replace(/^\/workspace\/[^/]+\//, '')
    .replace(/^\/workspace\//, '')
    .replace(/^\/workspaces\/[^/]+\//, '')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
  return `${workspaceDirectory.replace(/\/+$/g, '')}/${relative}`
}

type OpenTargetOption = {
  id: OpenTarget
  label: string
  logo: string
}

type DebugLogLevel = 'info' | 'warn' | 'error'

type DebugLogEntry = {
  id: string
  time: number
  level: DebugLogLevel
  eventType: string
  summary: string
  details?: string
}

type ScopedWorkspaceShellState = {
  workspaceMetaByDirectory: Record<string, { lastOpenedAt: number; lastUpdatedAt: number }>
  workspaceRootByDirectory: Record<string, string>
  worktreesByWorkspace: Record<string, WorkspaceWorktree[]>
}

function areRecordReferencesEqual<T>(left: Record<string, T>, right: Record<string, T>): boolean {
  if (left === right) {
    return true
  }
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) {
    return false
  }
  for (const key of leftKeys) {
    if (!(key in right) || left[key] !== right[key]) {
      return false
    }
  }
  return true
}

function areScopedWorkspaceShellStatesEqual(
  left: ScopedWorkspaceShellState,
  right: ScopedWorkspaceShellState
): boolean {
  return (
    areRecordReferencesEqual(left.workspaceMetaByDirectory, right.workspaceMetaByDirectory) &&
    areRecordReferencesEqual(left.workspaceRootByDirectory, right.workspaceRootByDirectory) &&
    areRecordReferencesEqual(left.worktreesByWorkspace, right.worktreesByWorkspace)
  )
}

const OPEN_TARGETS: OpenTargetOption[] = [
  { id: 'cursor', label: 'cursor', logo: cursorLogo },
  { id: 'antigravity', label: 'antigravity', logo: antigravityLogo },
  { id: 'finder', label: 'finder', logo: finderLogo },
  { id: 'terminal', label: 'terminal', logo: terminalLogo },
  { id: 'ghostty', label: 'ghostty', logo: ghosttyLogo },
  { id: 'xcode', label: 'xcode', logo: xcodeLogo },
  { id: 'zed', label: 'zed', logo: zedLogo },
]

function commitFlowRunningMessage(nextStep: CommitNextStep) {
  if (nextStep === 'commit_and_push') {
    return 'Committing changes and pushing'
  }
  if (nextStep === 'commit_and_create_pr') {
    return 'Creating Pull Request'
  }
  return 'Committing changes'
}

function commitFlowSuccessMessage(nextStep: CommitNextStep) {
  if (nextStep === 'commit_and_push') {
    return 'Changes committed and pushed'
  }
  if (nextStep === 'commit_and_create_pr') {
    return 'Pull request created'
  }
  return 'Changes committed'
}
const BROWSER_MODE_BY_SESSION_KEY = 'orxa:browserModeBySession:v1'
const BROWSER_AUTOMATION_HALTED_BY_SESSION_KEY = 'orxa:browserAutomationHaltedBySession:v1'

function parseCustomRunCommands(raw: string): CustomRunCommandPreset[] {
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    return []
  }
  const result: CustomRunCommandPreset[] = []
  const seenIDs = new Set<string>()
  for (let index = 0; index < parsed.length; index += 1) {
    const item = parsed[index]
    if (!item || typeof item !== 'object') {
      continue
    }
    const candidate = item as Partial<CustomRunCommandPreset>
    const title = typeof candidate.title === 'string' ? candidate.title.trim() : ''
    const commands = typeof candidate.commands === 'string' ? candidate.commands.trim() : ''
    if (!title || !commands) {
      continue
    }
    const rawID =
      typeof candidate.id === 'string' && candidate.id.trim().length > 0
        ? candidate.id.trim()
        : `legacy-${index}`
    if (seenIDs.has(rawID)) {
      continue
    }
    seenIDs.add(rawID)
    const updatedAt =
      typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt)
        ? candidate.updatedAt
        : Date.now() - index
    result.push({
      id: rawID,
      title,
      commands: commands.replace(/\r\n/g, '\n'),
      updatedAt,
    })
  }
  return result.sort((a, b) => b.updatedAt - a.updatedAt)
}

export default function App() {
  const [appPreferences, setAppPreferences] = usePersistedState<AppPreferences>(
    APP_PREFERENCES_KEY,
    DEFAULT_APP_PREFERENCES,
    {
      deserialize: raw => {
        const parsed = JSON.parse(raw) as Partial<AppPreferences>
        const merged: AppPreferences = {
          ...DEFAULT_APP_PREFERENCES,
          ...parsed,
        }
        if (!Array.isArray(merged.hiddenModels)) {
          merged.hiddenModels = []
        } else {
          merged.hiddenModels = [
            ...new Set(
              merged.hiddenModels
                .filter((item): item is string => typeof item === 'string')
                .map(item => item.trim())
                .filter(item => item.length > 0)
            ),
          ]
        }
        if (merged.permissionMode !== 'ask-write' && merged.permissionMode !== 'yolo-write') {
          merged.permissionMode = 'ask-write'
        }
        return merged
      },
    }
  )
  const [globalProviders, setGlobalProviders] = useState<ProviderListResponse>({
    all: [],
    connected: [],
    default: {},
  })
  const [codexServiceState, setCodexServiceState] = useState<CodexState | null>(null)
  const [codexServiceModels, setCodexServiceModels] = useState<CodexModelEntry[]>([])
  const [codexServiceCollaborationModes, setCodexServiceCollaborationModes] = useState<
    CodexCollaborationMode[]
  >([])
  const [globalAgents, setGlobalAgents] = useState<Agent[]>([])
  const [opencodeAgentFiles, setOpencodeAgentFiles] = useState<OpenCodeAgentFile[]>([])
  const [runtime, setRuntime] = useState<RuntimeState>(INITIAL_RUNTIME)
  const [profiles, setProfiles] = useState<RuntimeProfile[]>([])
  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [selectedAgent, setSelectedAgent] = usePersistedState<string | undefined>(
    LAST_SELECTED_AGENT_KEY,
    undefined
  )
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalTabs, setTerminalTabs] = useState<Array<{ id: string; label: string }>>([])
  const [activeTerminalId, setActiveTerminalId] = useState<string | undefined>()
  const [profileModalOpen, setProfileModalOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [followupQueue, setFollowupQueue] = useState<
    Array<{ id: string; text: string; timestamp: number; attachments?: Attachment[] }>
  >([])
  const [sendingQueuedId, setSendingQueuedId] = useState<string | undefined>()

  useEffect(() => {
    const option = CODE_FONT_OPTIONS.find(o => o.value === appPreferences.codeFont)
    const stack = option?.stack ?? `"${appPreferences.codeFont}", monospace`
    document.documentElement.style.setProperty('--code-font', stack)
  }, [appPreferences.codeFont])

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', appPreferences.theme)
  }, [appPreferences.theme])

  // Apply UI font
  useEffect(() => {
    const option = UI_FONT_OPTIONS.find(o => o.value === appPreferences.uiFont)
    if (option) {
      document.documentElement.style.setProperty('--font-sans', option.stack)
    }
  }, [appPreferences.uiFont])
  const [statusLine, setStatusLine] = useState<string>('Ready')
  const [debugModalOpen, setDebugModalOpen] = useState(false)
  const [debugLogLevelFilter, setDebugLogLevelFilter] = useState<'all' | DebugLogLevel>('all')
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([])
  const [perfSummaryRows, setPerfSummaryRows] = useState<PerfSummaryRow[]>([])
  const [perfSummaryLoading, setPerfSummaryLoading] = useState(false)
  const [perfSummaryError, setPerfSummaryError] = useState<string | null>(null)
  const [perfWindowMs, setPerfWindowMs] = usePersistedState<number>(
    'orxa:debug:perf-window-ms',
    30 * 60_000
  )
  const [perfExportOptions, setPerfExportOptions] = useState<PerfExportOptions>(
    DEFAULT_PERF_EXPORT_OPTIONS
  )
  const perfProfiler = usePerfProfiler()
  const appendDebugLog = useCallback((entry: Omit<DebugLogEntry, 'id' | 'time'>) => {
    setDebugLogs(current => {
      const next: DebugLogEntry = {
        id: `${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
        time: Date.now(),
        ...entry,
      }
      return [...current, next].slice(-1200)
    })
  }, [])
  const reportRendererDiagnostic = useCallback(
    (input: AppDiagnosticInput) => {
      appendDebugLog({
        level: input.level,
        eventType: input.category,
        summary: input.message,
        details: input.details,
      })
      const pending = window.orxa?.app?.reportRendererDiagnostic?.(input)
      void pending?.catch(() => undefined)
    },
    [appendDebugLog]
  )
  const { toasts, dismissToast, pushToast } = useAppShellToasts({ statusLine, toneForStatusLine })
  const {
    confirmDialogRequest,
    textInputDialog,
    setTextInputDialog,
    requestConfirmation,
    closeConfirmDialog,
    closeTextInputDialog,
    submitTextInputDialog,
  } = useAppShellDialogs()
  const [sessionProvenanceByPath, setSessionProvenanceByPath] = useState<
    Record<string, ChangeProvenanceRecord>
  >({})
  const scheduleGitRefreshRef = useRef<((delayMs?: number) => void) | null>(null)
  const {
    sessionTypes,
    setSessionTypes,
    setSessionTitles,
    manualSessionTitles,
    setManualSessionTitles,
    codexSessionCount,
    claudeSessionCount,
    clearSessionMetadata,
    cleanupEmptySession,
    getSessionType: getStoredSessionType,
    getSessionTitle,
    normalizePresentationProvider,
  } = useWorkspaceSessionMetadata()
  const setProjectDataForDirectory = useUnifiedRuntimeStore(state => state.setProjectData)
  const setWorkspaceMeta = useUnifiedRuntimeStore(state => state.setWorkspaceMeta)
  const clearSessionReadAt = useUnifiedRuntimeStore(state => state.clearSessionReadAt)
  const clearSyntheticSessionMetadata = useCallback(
    (directory: string, sessionID: string) => {
      const sessionKey = buildWorkspaceSessionMetadataKey(directory, sessionID)
      clearSessionMetadata(sessionKey)
      clearSessionReadAt(sessionKey)
    },
    [clearSessionMetadata, clearSessionReadAt]
  )
  const {
    getSyntheticSessionRecord,
    getSessionType,
    isSyntheticSession,
    findReusableDraftSession,
    registerSyntheticSession,
    removeSyntheticSession,
    renameSyntheticSession,
    touchSyntheticSession,
    markSyntheticSessionStarted,
    mergeProjectDataWithSyntheticSessions,
  } = useSyntheticSessionRegistry({
    clearSyntheticSessionMetadata,
    getStoredSessionType,
    setProjectDataForDirectory,
    setSessionTitles,
    setSessionTypes,
    setWorkspaceMeta,
  })
  const cleanupWorkspaceSession = useCallback(
    (directory: string, sessionID: string) => {
      cleanupEmptySession(directory, sessionID)
      if (isSyntheticSession(directory, sessionID)) {
        removeSyntheticSession(directory, sessionID)
      }
    },
    [cleanupEmptySession, isSyntheticSession, removeSyntheticSession]
  )
  const shouldUseOpencodeRuntimeSession = useCallback(
    (directory: string, sessionID: string) =>
      isOpencodeRuntimeSession(getSessionType(sessionID, directory), sessionID),
    [getSessionType]
  )
  const shouldDeleteRemoteEmptySession = useCallback(
    (directory: string, sessionID: string) => shouldUseOpencodeRuntimeSession(directory, sessionID),
    [shouldUseOpencodeRuntimeSession]
  )
  const shouldSkipRuntimeSessionLoad = useCallback(
    (directory: string, sessionID: string) =>
      !shouldUseOpencodeRuntimeSession(directory, sessionID),
    [shouldUseOpencodeRuntimeSession]
  )
  const {
    sidebarMode,
    setSidebarMode,
    activeProjectDir,
    setActiveProjectDir,
    projectData,
    setProjectData,
    activeSessionID,
    pendingSessionId,
    setActiveSessionID,
    clearPendingSession,
    messages,
    setMessages,
    contextMenu,
    setContextMenu,
    pinnedSessions,
    collapsedProjects,
    setCollapsedProjects,
    refreshProject,
    selectProject,
    openWorkspaceDashboard,
    refreshMessages,
    selectSession: selectSessionRaw,
    createSession: createWorkspaceSession,
    applyRuntimeSnapshot,
    applyOpencodeStreamEvent,
    queueRefresh,
    startResponsePolling,
    stopResponsePolling,
    togglePinSession,
    openProjectContextMenu,
    openSessionContextMenu,
    markSessionUsed,
    cleanupPersistedEmptySessions,
  } = useWorkspaceState({
    setStatusLine,
    terminalTabIds: terminalTabs.map(t => t.id),
    setTerminalTabs,
    setActiveTerminalId,
    setTerminalOpen,
    scheduleGitRefresh: delayMs => scheduleGitRefreshRef.current?.(delayMs),
    onCleanupEmptySession: cleanupWorkspaceSession,
    mergeProjectData: mergeProjectDataWithSyntheticSessions,
    shouldDeleteRemoteEmptySession,
    shouldSkipRuntimeSessionLoad,
  })

  const openSession = useCallback(
    async (directory: string, sessionID: string) => {
      setSidebarMode('projects')
      if (activeProjectDir !== directory) {
        await selectProject(directory, { showLanding: false, sessionID })
      }
      await selectSessionRaw(sessionID, directory)
      clearPendingSession()
    },
    [activeProjectDir, clearPendingSession, selectProject, selectSessionRaw, setSidebarMode]
  )

  const [projectSearchOpen, setProjectSearchOpen] = useState(false)
  const projectSearchQuery = ''
  const [projectSortOpen, setProjectSortOpen] = useState(false)
  const [projectSortMode, setProjectSortMode] = usePersistedState<ProjectSortMode>(
    'orxa:projectSortMode:v1',
    'updated',
    {
      deserialize: raw => {
        const valid: ProjectSortMode[] = ['updated', 'recent', 'alpha-asc', 'alpha-desc']
        return valid.includes(raw as ProjectSortMode) ? (raw as ProjectSortMode) : 'updated'
      },
      serialize: value => value,
    }
  )
  const [allSessionsModalOpen, setAllSessionsModalOpen] = useState(false)
  const [globalSearchModalOpen, setGlobalSearchModalOpen] = useState(false)
  const [projectCacheVersion, setProjectCacheVersion] = useState(0)
  const canvasState = useCanvasState(activeSessionID ?? '__none__', activeProjectDir ?? undefined)
  const [projectsSidebarVisible, setProjectsSidebarVisible] = useState(true)
  const setOpencodeMessages = useUnifiedRuntimeStore(state => state.setOpencodeMessages)
  const setSessionReadAt = useUnifiedRuntimeStore(state => state.setSessionReadAt)
  const removeClaudeSession = useUnifiedRuntimeStore(state => state.removeClaudeSession)
  const removeClaudeChatSession = useUnifiedRuntimeStore(state => state.removeClaudeChatSession)
  const removeCodexSession = useUnifiedRuntimeStore(state => state.removeCodexSession)
  const initCodexSession = useUnifiedRuntimeStore(state => state.initCodexSession)
  const setCodexThread = useUnifiedRuntimeStore(state => state.setCodexThread)
  const setCodexStreaming = useUnifiedRuntimeStore(state => state.setCodexStreaming)
  const replaceCodexMessages = useUnifiedRuntimeStore(state => state.replaceCodexMessages)

  const scopedProjectDirectories = useMemo(() => {
    const directories = new Set(projects.map(project => project.worktree))
    if (projectData?.directory) {
      directories.add(projectData.directory)
    }
    return [...directories]
  }, [projectData?.directory, projects])

  const scopedProjectDataByDirectory = useStoreWithEqualityFn(
    useUnifiedRuntimeStore,
    useCallback(
      state => {
        const next: Record<string, ProjectBootstrap> = {}
        for (const directory of scopedProjectDirectories) {
          const cached = state.projectDataByDirectory[directory]
          if (cached) {
            next[directory] = cached
          }
        }
        return next
      },
      [scopedProjectDirectories]
    ),
    areRecordReferencesEqual
  )

  const scopedWorkspaceDirectories = useMemo(() => {
    const directories = new Set(scopedProjectDirectories)
    if (activeProjectDir) {
      directories.add(activeProjectDir)
    }
    return [...directories]
  }, [activeProjectDir, scopedProjectDirectories])

  const workspaceShellState = useStoreWithEqualityFn(
    useUnifiedRuntimeStore,
    useCallback(
      state => {
        const workspaceMetaByDirectory: ScopedWorkspaceShellState['workspaceMetaByDirectory'] = {}
        const workspaceRootByDirectory: ScopedWorkspaceShellState['workspaceRootByDirectory'] = {}
        const workspaceRoots = new Set<string>()
        for (const directory of scopedWorkspaceDirectories) {
          const meta = state.workspaceMetaByDirectory[directory]
          if (meta) {
            workspaceMetaByDirectory[directory] = meta
          }
          const workspaceRoot = state.workspaceRootByDirectory[directory]
          if (workspaceRoot) {
            workspaceRootByDirectory[directory] = workspaceRoot
            workspaceRoots.add(workspaceRoot)
          }
        }
        const worktreesByWorkspace: ScopedWorkspaceShellState['worktreesByWorkspace'] = {}
        for (const workspaceRoot of workspaceRoots) {
          const worktrees = state.worktreesByWorkspace[workspaceRoot]
          if (worktrees) {
            worktreesByWorkspace[workspaceRoot] = worktrees
          }
        }
        return {
          workspaceMetaByDirectory,
          workspaceRootByDirectory,
          worktreesByWorkspace,
        }
      },
      [scopedWorkspaceDirectories]
    ),
    areScopedWorkspaceShellStatesEqual
  )
  const { workspaceMetaByDirectory, workspaceRootByDirectory, worktreesByWorkspace } =
    workspaceShellState

  useWorkspaceSessionMetadataMigration({
    projects,
    projectData: projectData ?? undefined,
    projectDataByDirectory: scopedProjectDataByDirectory,
    setProjectDataForDirectory,
    bumpProjectCacheVersion: () => setProjectCacheVersion(version => version + 1),
    setSessionTypes,
    setSessionTitles,
  })
  const [leftPaneWidth, setLeftPaneWidth] = usePersistedState<number>(SIDEBAR_LEFT_WIDTH_KEY, 300, {
    deserialize: raw => {
      const parsed = Number(raw)
      return Number.isFinite(parsed) && parsed >= 280 ? parsed : 300
    },
    serialize: value => String(Math.round(value)),
  })
  const [browserPaneWidth, setBrowserPaneWidth] = usePersistedState<number>(
    SIDEBAR_BROWSER_WIDTH_KEY,
    380,
    {
      deserialize: raw => {
        const parsed = Number(raw)
        return Number.isFinite(parsed) && parsed >= 280 ? parsed : 380
      },
      serialize: value => String(Math.round(value)),
    }
  )
  const [rightPaneWidth, setRightPaneWidth] = usePersistedState<number>(
    SIDEBAR_RIGHT_WIDTH_KEY,
    340,
    {
      deserialize: raw => {
        const parsed = Number(raw)
        return Number.isFinite(parsed) && parsed >= 280 ? parsed : 340
      },
      serialize: value => String(Math.round(value)),
    }
  )
  const unreadJobRunsCount = 0
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [skillsError, setSkillsError] = useState<string | undefined>()
  const [skillUseModal, setSkillUseModal] = useState<{
    skill: SkillEntry
    projectDir: string
  } | null>(null)
  const [memoryComingSoonOpen, setMemoryComingSoonOpen] = useState(false)
  const [composerLayoutHeight, setComposerLayoutHeight] = useState(DEFAULT_COMPOSER_LAYOUT_HEIGHT)
  const [composerDockHeight, setComposerDockHeight] = useState(0)
  const [terminalPanelHeight, setTerminalPanelHeight] = useState(DEFAULT_TERMINAL_PANEL_HEIGHT)
  const [configModelOptions, setConfigModelOptions] = useState<ModelOption[]>([])
  const [rightSidebarTab, setRightSidebarTab] = useState<'git' | 'files'>('git')
  const [browserSidebarOpen, setBrowserSidebarOpen] = useState(false)
  const [browserModeBySession, setBrowserModeBySession] = usePersistedState<
    Record<string, boolean>
  >(BROWSER_MODE_BY_SESSION_KEY, {})
  const [browserAutomationHaltedBySession, setBrowserAutomationHaltedBySession] = usePersistedState<
    Record<string, number>
  >(BROWSER_AUTOMATION_HALTED_BY_SESSION_KEY, {})
  const [titleMenuOpen, setTitleMenuOpen] = useState(false)
  const [openMenuOpen, setOpenMenuOpen] = useState(false)
  const [preferredOpenTarget, setPreferredOpenTarget] = usePersistedState<OpenTarget>(
    OPEN_TARGET_KEY,
    'finder',
    {
      deserialize: raw => {
        const available = new Set<OpenTarget>(OPEN_TARGETS.map(target => target.id))
        if (available.has(raw as OpenTarget)) {
          return raw as OpenTarget
        }
        try {
          const parsed = JSON.parse(raw)
          if (available.has(parsed as OpenTarget)) {
            return parsed as OpenTarget
          }
        } catch {
          // keep fallback
        }
        return 'finder'
      },
      serialize: value => value,
    }
  )
  const [customRunCommands, setCustomRunCommands] = usePersistedState<CustomRunCommandPreset[]>(
    CUSTOM_RUN_COMMANDS_KEY,
    [],
    {
      deserialize: parseCustomRunCommands,
    }
  )
  const [agentModelPrefs, setAgentModelPrefs] = usePersistedState<Record<string, string>>(
    AGENT_MODEL_PREFS_KEY,
    {}
  )
  const [commitMenuOpen, setCommitMenuOpen] = useState(false)
  const {
    commitFlowState,
    clearCommitFlowDismissTimer,
    scheduleCommitFlowDismiss,
    startCommitFlow,
    completeCommitFlow,
    failCommitFlow,
    dismissCommitFlowState,
  } = useAppShellCommitFlow<CommitNextStep>({
    runningMessage: commitFlowRunningMessage,
    successMessage: commitFlowSuccessMessage,
  })
  const [pendingPrUrl, setPendingPrUrl] = useState<string | null>(null)
  const {
    availableUpdateVersion,
    isCheckingForUpdates,
    updateInstallPending,
    updateProgressState,
    updateStatusMessage,
    setUpdateProgressState,
    handleUpdaterTelemetry,
    checkForUpdates,
    downloadAndInstallUpdate,
  } = useAppShellUpdateFlow({ setStatusLine })
  const [dockTodosOpen, setDockTodosOpen] = useState(false)
  const [archivedBackgroundAgentIds, setArchivedBackgroundAgentIds] = useState<
    Record<string, string[]>
  >({})
  const [hiddenBackgroundSessionIdsByProject, setHiddenBackgroundSessionIdsByProject] =
    usePersistedState<Record<string, string[]>>('orxa:hiddenBackgroundSessionIdsByProject:v1', {})
  const [permissionDecisionPending, setPermissionDecisionPending] = useState<
    'once' | 'always' | 'reject' | null
  >(null)
  const [permissionDecisionPendingRequestID, setPermissionDecisionPendingRequestID] = useState<
    string | null
  >(null)
  const [dependencyReport, setDependencyReport] = useState<RuntimeDependencyReport | null>(null)
  const [dependencyModalOpen, setDependencyModalOpen] = useState(false)
  const { dashboard, refreshDashboard } = useDashboards(
    projects,
    activeProjectDir ?? null,
    projectData
  )
  const activeSessionType = useMemo(
    () => getSessionType(activeSessionID ?? '', activeProjectDir),
    [activeProjectDir, activeSessionID, getSessionType]
  )
  const activeSyntheticSessionRecord = useMemo(
    () => getSyntheticSessionRecord(activeProjectDir, activeSessionID),
    [activeProjectDir, activeSessionID, getSyntheticSessionRecord]
  )
  const canShowIntegratedTerminal = activeSessionType !== 'claude' && activeSessionType !== 'canvas'
  const [codexUsage, setCodexUsage] = useState<ProviderUsageStats | null>(null)
  const [claudeUsage, setClaudeUsage] = useState<ProviderUsageStats | null>(null)
  const [optimisticOpencodePrompts, setOptimisticOpencodePrompts] = useState<
    Record<string, OptimisticOpencodePrompt>
  >({})
  const [codexUsageLoading, setCodexUsageLoading] = useState(false)
  const [claudeUsageLoading, setClaudeUsageLoading] = useState(false)
  const refreshCodexUsage = useCallback(async () => {
    setCodexUsageLoading(true)
    try {
      const stats = await window.orxa.usage.getCodexStats()
      setCodexUsage(stats)
    } catch {
      // Non-fatal
    } finally {
      setCodexUsageLoading(false)
    }
  }, [])
  const refreshClaudeUsage = useCallback(async () => {
    setClaudeUsageLoading(true)
    try {
      const stats = await window.orxa.usage.getClaudeStats()
      setClaudeUsage(stats)
    } catch {
      // Non-fatal
    } finally {
      setClaudeUsageLoading(false)
    }
  }, [])
  const [, setAgentsDocument] = useState<AgentsDocument | null>(null)
  const [, setAgentsDraft] = useState('')
  const [, setAgentsLoading] = useState(false)
  const activeSessionKey = useMemo(() => {
    if (!activeProjectDir || !activeSessionID) {
      return null
    }
    return `${activeProjectDir}::${activeSessionID}`
  }, [activeProjectDir, activeSessionID])
  const activeOptimisticOpencodePrompt = useMemo(
    () =>
      activeSessionType === 'opencode' && activeSessionKey
        ? (optimisticOpencodePrompts[activeSessionKey] ?? null)
        : null,
    [activeSessionKey, activeSessionType, optimisticOpencodePrompts]
  )
  const {
    addSessionFeedNotice,
    activeSessionNotices,
    buildSessionKey: buildSessionFeedNoticeKey,
    getManualSessionStopState,
    markManualSessionStopNoticeEmitted,
    markManualSessionStopRequested,
    pruneManualSessionStops,
  } = useAppShellSessionFeedNotices({
    activeProjectDir,
    activeSessionID,
  })
  // Track whether any overlay/modal is visible in the DOM.
  // The BrowserView is a native Electron overlay that sits on top of the renderer,
  // so we must hide it whenever ANY modal/overlay appears — not just ones we track in state.
  const [anyOverlayInDom, setAnyOverlayInDom] = useState(false)
  useEffect(() => {
    const check = () => {
      const hasOverlay =
        document.querySelector(
          '.overlay, .kanban-pane-overlay, .model-modal-overlay, .settings-overlay, .run-command-modal-overlay'
        ) !== null
      setAnyOverlayInDom(hasOverlay)
    }
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  const { hasProjectContext, showProjectsPane, showGitPane } = deriveAppShellWorkspaceLayout({
    activeProjectDir,
    sidebarMode,
    projectsSidebarVisible,
    showOperationsPane: appPreferences.showOperationsPane,
  })
  const browserPaneVisible = hasProjectContext && browserSidebarOpen && !anyOverlayInDom
  const {
    branchState,
    gitPanelTab,
    setGitPanelTab,
    gitDiffViewMode,
    setGitDiffViewMode,
    gitPanelOutput,
    gitDiffStats,
    commitModalOpen,
    setCommitModalOpen,
    commitIncludeUnstaged,
    setCommitIncludeUnstaged,
    commitMessageDraft,
    setCommitMessageDraft,
    commitNextStep,
    setCommitNextStep,
    commitSummary,
    commitSummaryLoading,
    commitSubmitting,
    setCommitSubmitting,
    commitBaseBranch,
    setCommitBaseBranch,
    commitBaseBranchOptions,
    branchMenuOpen,
    setBranchMenuOpen,
    branchQuery,
    setBranchQuery,
    branchLoading,
    branchSwitching,
    branchCreateModalOpen,
    setBranchCreateModalOpen,
    branchCreateName,
    setBranchCreateName,
    branchCreateError,
    setBranchCreateError,
    branchActionError,
    setBranchActionError,
    loadGitDiff,
    loadGitLog,
    loadGitIssues,
    loadGitPrs,
    stageAllChanges,
    discardAllChanges,
    stageFile,
    restoreFile,
    unstageFile,
    checkoutBranch,
    openBranchCreateModal,
    submitBranchCreate,
    scheduleGitRefresh,
  } = useGitPanel(activeProjectDir ?? null)

  const resizeStateRef = useRef<null | {
    side: 'left' | 'browser' | 'mobile' | 'right'
    startX: number
    startWidth: number
    latestX: number
    currentWidth?: number
    rafId?: number
  }>(null)
  const terminalResizeStateRef = useRef<null | {
    startY: number
    startHeight: number
  }>(null)
  const workspaceRef = useRef<HTMLDivElement | null>(null)
  const { startSidebarResize } = useAppCoreSidebarResize({
    resizeStateRef,
    browserPaneWidth,
    browserSidebarOpen,
    leftPaneWidth,
    rightPaneWidth,
    setBrowserPaneWidth,
    setLeftPaneWidth,
    setRightPaneWidth,
    showGitPane,
    workspaceRef,
  })

  const projectSearchInputRef = useRef<HTMLInputElement | null>(null)
  const branchSearchInputRef = useRef<HTMLInputElement | null>(null)
  const terminalAutoCreateTried = useRef(false)
  const abortActiveSessionRef = useRef<(() => Promise<void>) | null>(null)
  const setSelectedWorkspaceWorktree = useUnifiedRuntimeStore(
    state => state.setSelectedWorkspaceWorktree
  )

  useEffect(() => {
    scheduleGitRefreshRef.current = scheduleGitRefresh
  }, [scheduleGitRefresh])

  const cachedProjects = useMemo(() => {
    const next = { ...scopedProjectDataByDirectory }
    if (projectData?.directory) {
      next[projectData.directory] = projectData
    }
    return next
  }, [projectData, scopedProjectDataByDirectory])
  const { backgroundSessionDescriptors, visibleBackgroundAgents } = useBackgroundSessionDescriptors(
    {
      activeProjectDir: activeProjectDir ?? undefined,
      activeSessionID: activeSessionID ?? undefined,
      activeSessionKey: activeSessionKey ?? undefined,
      activeSessionType,
      cachedProjects,
      archivedBackgroundAgentIds,
      getSessionType,
      normalizePresentationProvider,
    }
  )
  const {
    hiddenSessionIDsByProject,
    sessions,
    cachedSessionsByProject,
    workspaceDetailDirectory,
    workspaceDetailSessions,
    getSessionStatusType,
    getSessionIndicator,
  } = useAppShellSessionCollections({
    projectData: projectData ?? undefined,
    projectDataByDirectory: scopedProjectDataByDirectory,
    workspaceRootByDirectory,
    activeProjectDir,
    activeSessionID: activeSessionID ?? undefined,
    projectCacheVersion,
    pinnedSessions,
    archivedBackgroundAgentIds,
    hiddenBackgroundSessionIdsByProject,
    backgroundSessionDescriptors,
    getSessionType,
    normalizePresentationProvider,
  })

  const availableSlashCommands = useMemo(() => {
    return projectData?.commands ?? []
  }, [projectData?.commands])
  const ensureActiveOpencodeSessionForSend = useCallback(async () => {
    if (!activeProjectDir || !activeSessionID) {
      return null
    }
    const syntheticSession = getSyntheticSessionRecord(activeProjectDir, activeSessionID)
    if (!syntheticSession || syntheticSession.type !== 'opencode') {
      return {
        directory: activeProjectDir,
        sessionID: activeSessionID,
      }
    }

    const nextSessionID = await createWorkspaceSession(activeProjectDir, undefined, {
      permissionMode: appPreferences.permissionMode as SessionPermissionMode,
      selectedAgent: undefined,
      selectedModelPayload: undefined,
      selectedVariant: undefined,
      availableAgentNames: new Set<string>(),
    })
    if (!nextSessionID) {
      return null
    }

    removeSyntheticSession(activeProjectDir, activeSessionID)
    markSessionUsed(nextSessionID)

    return {
      directory: activeProjectDir,
      sessionID: nextSessionID,
    }
  }, [
    activeProjectDir,
    activeSessionID,
    appPreferences.permissionMode,
    createWorkspaceSession,
    getSyntheticSessionRecord,
    markSessionUsed,
    removeSyntheticSession,
  ])

  const fileBackedAgentOptions = useMemo(
    () =>
      opencodeAgentFiles
        .filter(agent => agent.mode === 'primary' || agent.mode === 'all')
        .map(agent => ({
          name: agent.name,
          model: agent.model || undefined,
          description: agent.description,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [opencodeAgentFiles]
  )
  const agentOptions = useMemo(
    () =>
      fileBackedAgentOptions.length > 0
        ? fileBackedAgentOptions
        : listAgentOptions(projectData?.agents ?? globalAgents),
    [fileBackedAgentOptions, globalAgents, projectData?.agents]
  )
  const globalServerModelOptions = useMemo(() => {
    return listModelOptions(globalProviders)
  }, [globalProviders])
  const codexServiceModelOptions = useMemo(
    () => codexModelsToOptions(codexServiceModels),
    [codexServiceModels]
  )
  const discoverableProviderIDs = useMemo(() => {
    const ids = new Set(globalProviders.all.map(provider => provider.id))
    if (
      codexServiceModels.length > 0 ||
      codexServiceState?.status === 'connected' ||
      codexServiceState?.status === 'connecting'
    ) {
      ids.add('codex')
    }
    return ids
  }, [codexServiceModels.length, codexServiceState?.status, globalProviders])
  const discoverableModelOptions = useMemo(
    () =>
      filterModelOptionsByProviderIDs(
        mergeDiscoverableModelOptions(
          configModelOptions,
          globalServerModelOptions,
          codexServiceModelOptions
        ),
        discoverableProviderIDs
      ),
    [
      codexServiceModelOptions,
      configModelOptions,
      discoverableProviderIDs,
      globalServerModelOptions,
    ]
  )
  const settingsModelsRef = useRef<ModelOption[]>([])
  const settingsModelOptions = useMemo(() => {
    const merged = discoverableModelOptions
    if (merged.length > 0) {
      settingsModelsRef.current = merged
    }
    return settingsModelsRef.current.length > 0 ? settingsModelsRef.current : merged
  }, [discoverableModelOptions])
  const preferredAgentModel = useMemo(() => {
    return undefined
  }, [])
  const serverAgentNames = useMemo(
    () => new Set(agentOptions.map(agent => agent.name)),
    [agentOptions]
  )
  const effectiveComposerAgentOptions = useMemo(() => {
    return agentOptions.map(agent => ({
      name: agent.name,
      mode: 'primary' as const,
      description: agent.description,
    }))
  }, [agentOptions])
  const availableAgentNames = useMemo(
    () => new Set(effectiveComposerAgentOptions.map(agent => agent.name)),
    [effectiveComposerAgentOptions]
  )
  const hasPlanAgent = useMemo(() => availableAgentNames.has('plan'), [availableAgentNames])
  const isPlanMode = selectedAgent === 'plan'
  const activePresentationProvider = normalizePresentationProvider(activeSessionType)
  const composerPlaceholder =
    activePresentationProvider === 'opencode'
      ? 'Send OpenCode a message...'
      : activePresentationProvider === 'codex'
        ? 'Send Codex a message...'
        : 'Send message'
  const assistantLabel = selectedAgent
    ? selectedAgent.charAt(0).toUpperCase() + selectedAgent.slice(1)
    : 'Assistant'
  const branchDisplayValue = useMemo(() => {
    if (branchLoading) {
      return 'Loading branch...'
    }
    return branchState?.current || 'Branch'
  }, [branchLoading, branchState])
  const branchControlWidthCh = useMemo(
    () => Math.max(16, Math.min(54, branchDisplayValue.length + 7)),
    [branchDisplayValue]
  )
  const activeOpencodeRuntime = useUnifiedRuntimeStore(
    useCallback(
      state =>
        activeProjectDir && activeSessionID
          ? (state.opencodeSessions[
              buildWorkspaceSessionMetadataKey(activeProjectDir, activeSessionID)
            ] ?? null)
          : null,
      [activeProjectDir, activeSessionID]
    )
  )
  const opencodeSessionControls = useOpencodeSessionControls({
    sessionKey:
      activeSessionKey ??
      (activeProjectDir && activeSessionID
        ? buildWorkspaceSessionMetadataKey(activeProjectDir, activeSessionID)
        : 'inactive'),
    directory: activeProjectDir ?? '',
    preferences: {
      enabled: appPreferences.sessionGuardrailsEnabled,
      tokenBudget: appPreferences.sessionTokenBudget,
      runtimeBudgetMinutes: appPreferences.sessionRuntimeBudgetMinutes,
    },
    messages,
    runtimeSnapshot: activeOpencodeRuntime?.runtimeSnapshot,
  })
  const filteredBranches = useMemo(() => {
    const query = branchQuery.trim().toLowerCase()
    const branches = branchState?.branches ?? []
    if (!query) {
      return branches
    }
    return branches.filter(branch => branch.toLowerCase().includes(query))
  }, [branchQuery, branchState])
  const filteredDebugLogs = useMemo(() => {
    if (debugLogLevelFilter === 'all') {
      return debugLogs
    }
    return debugLogs.filter(entry => entry.level === debugLogLevelFilter)
  }, [debugLogLevelFilter, debugLogs])
  const copyDebugLogsAsJson = useCallback(async () => {
    const payload = filteredDebugLogs.map(entry => ({
      timestamp: new Date(entry.time).toISOString(),
      level: entry.level,
      eventType: entry.eventType,
      summary: entry.summary,
      details: entry.details,
    }))
    const json = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        filter: debugLogLevelFilter,
        count: payload.length,
        logs: payload,
      },
      null,
      2
    )
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard is not available in this environment.')
      }
      await navigator.clipboard.writeText(json)
      setStatusLine(`Copied ${payload.length} debug logs as JSON`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatusLine(`Failed to copy debug logs: ${message}`)
      pushToast(`Failed to copy debug logs: ${message}`, 'error')
    }
  }, [debugLogLevelFilter, filteredDebugLogs, pushToast, setStatusLine])

  const refreshPerfSummary = useCallback(async () => {
    if (!window.orxa?.app?.listPerfSummary) {
      setPerfSummaryError('Performance summary bridge is unavailable.')
      return
    }
    setPerfSummaryLoading(true)
    setPerfSummaryError(null)
    try {
      const windowMinutes = Math.max(1, Math.round(perfWindowMs / 60_000))
      const rows = await window.orxa.app.listPerfSummary({
        limit: 5000,
        sinceMs: perfWindowMs,
        includeInternalTelemetry: false,
      })
      setPerfSummaryRows(rows)
      setStatusLine(`Loaded ${rows.length} performance summary rows (${windowMinutes}m window)`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setPerfSummaryError(message)
      setStatusLine(`Failed to load performance summary: ${message}`)
    } finally {
      setPerfSummaryLoading(false)
    }
  }, [perfWindowMs, setStatusLine])

  const exportPerfSnapshotAsJson = useCallback(async () => {
    if (!window.orxa?.app?.exportPerfSnapshot) {
      setStatusLine('Performance export is unavailable.')
      return
    }
    try {
      const exportFilter: PerfSnapshotExportInput = {
        sinceMs: perfWindowMs,
        summaryLimit: 5_000,
        includeEvents: true,
        eventLimit: 5_000,
        includeInternalTelemetry: false,
        slowOnly: perfExportOptions.slowOnly,
        minDurationMs: perfExportOptions.minDurationMs,
        surfaces: perfExportOptions.surfaces.length > 0 ? perfExportOptions.surfaces : undefined,
      }
      const snapshot = (await window.orxa.app.exportPerfSnapshot(
        exportFilter
      )) as PerfSnapshotExport
      const payload =
        'path' in snapshot
          ? snapshot
          : {
              exportedAt: new Date().toISOString(),
              telemetryMode: 'always_on_local_only',
              summaries: snapshot.rows,
              events: snapshot.events,
              filter: snapshot.filter,
              eventStats: snapshot.eventStats,
            }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `orxa-performance-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      if ('path' in snapshot) {
        setStatusLine(`Exported performance snapshot to ${snapshot.path}`)
      } else {
        const windowMinutes = Math.max(1, Math.round((snapshot.filter.sinceMs ?? 0) / 60_000))
        setStatusLine(
          `Exported ${snapshot.eventStats.exported}/${snapshot.eventStats.matched} events (${windowMinutes}m; priority ${snapshot.eventStats.priorityExported}/${snapshot.eventStats.priorityMatched})`
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatusLine(`Failed to export performance snapshot: ${message}`)
      pushToast(`Failed to export performance snapshot: ${message}`, 'error')
    }
  }, [perfExportOptions, perfWindowMs, pushToast, setStatusLine])

  useEffect(() => {
    if (!debugModalOpen) {
      return
    }
    void refreshPerfSummary()
  }, [debugModalOpen, refreshPerfSummary])

  const storeMarkSessionAbortRequestedAt = useUnifiedRuntimeStore(
    state => state.markSessionAbortRequestedAt
  )

  const markSessionAbortRequested = useCallback(
    (directory: string, sessionID: string) => {
      const now = Date.now()
      const key = buildSessionFeedNoticeKey(directory, sessionID)
      markManualSessionStopRequested(directory, sessionID, now)
      storeMarkSessionAbortRequestedAt(key, now)
      setBrowserAutomationHaltedBySession(current => ({
        ...current,
        [key]: now,
      }))
    },
    [
      buildSessionFeedNoticeKey,
      markManualSessionStopRequested,
      storeMarkSessionAbortRequestedAt,
      setBrowserAutomationHaltedBySession,
    ]
  )

  const {
    composer,
    setComposer,
    composerAttachments,
    setComposerAttachments,
    isSendingPrompt,
    selectedModel,
    setSelectedModel,
    selectedVariant,
    setSelectedVariant,
    selectedModelPayload,
    slashMenuOpen,
    filteredSlashCommands,
    slashSelectedIndex,
    handleComposerChange,
    insertSlashCommand,
    handleSlashKeyDown,
    addComposerAttachments,
    pickImageAttachment,
    removeAttachment,
    sendPrompt,
    abortActiveSession,
  } = useComposerState(activeProjectDir ?? null, activeSessionID ?? null, {
    availableSlashCommands,
    refreshMessages,
    refreshProject,
    sessions,
    ensureSessionForSend: ensureActiveOpencodeSessionForSend,
    selectedAgent,
    availableAgentNames,
    setStatusLine,
    shouldAutoRenameSessionTitle,
    deriveSessionTitleFromPrompt,
    startResponsePolling,
    stopResponsePolling,
    clearPendingSession,
    onSessionAbortRequested: markSessionAbortRequested,
    onPromptAccepted: ({ directory, sessionID, text, promptSource }) => {
      if (promptSource !== 'user') {
        return
      }
      const sessionKey = `${directory}::${sessionID}`
      setOptimisticOpencodePrompts(current => ({
        ...current,
        [sessionKey]: {
          text,
          timestamp: Date.now(),
        },
      }))
    },
  })

  useEffect(() => {
    abortActiveSessionRef.current = async () => {
      await Promise.resolve(abortActiveSession())
    }
    return () => {
      abortActiveSessionRef.current = null
    }
  }, [abortActiveSession])

  const abortSessionViaComposer = useCallback(async () => {
    await Promise.resolve(abortActiveSession())
  }, [abortActiveSession])

  const {
    activePromptToolsPolicy,
    browserActionRunning,
    browserCloseTab,
    browserControlOwner,
    browserGoBack,
    browserGoForward,
    browserHandBack,
    browserHistoryItems,
    browserModeEnabled,
    browserNavigate,
    browserOpenTab,
    browserReload,
    browserReportViewportBounds,
    browserRuntimeState,
    browserSelectHistory,
    browserSelectTab,
    browserStop,
    browserTakeControl,
    clearBrowserAutomationHalt,
    effectiveSystemAddendum,
    mcpDevToolsState,
    setBrowserMode,
    setBrowserActionRunning,
    setBrowserHistoryItems,
    setBrowserRuntimeState,
    setMcpDevToolsState,
    syncBrowserSnapshot,
  } = useAppCoreBrowser({
    activeProjectDir,
    activeSessionID,
    activeSessionKey,
    browserAutomationHaltedBySession,
    browserModeBySession,
    browserSidebarOpen,
    browserPaneVisible,
    composer,
    messages,
    abortSession: abortSessionViaComposer,
    setBrowserModeBySession,
    setBrowserAutomationHaltedBySession,
    setBrowserSidebarOpen,
    setStatusLine,
  })
  const {
    refreshProfiles,
    refreshConfigModels,
    refreshGlobalProviders,
    refreshGlobalAgents,
    refreshAgentFiles,
    refreshRuntimeDependencies,
    bootstrap,
    startupState,
    startupProgressPercent,
  } = useAppCoreBootstrap({
    activeProjectDir,
    cleanupPersistedEmptySessions,
    setRuntime,
    setProfiles,
    setProjects,
    setConfigModelOptions,
    setGlobalProviders,
    setGlobalAgents,
    setOpencodeAgentFiles,
    setDependencyReport,
    setDependencyModalOpen,
    setStatusLine,
    setActiveProjectDir,
    setProjectData,
    setActiveSessionID,
    setMessages,
    setProjectDataForDirectory,
    setProjectCacheVersion,
    syncBrowserSnapshot,
  })
  const refreshCodexServiceSnapshot = useCallback(async () => {
    if (!window.orxa?.codex) {
      setCodexServiceState({ status: 'disconnected' })
      return
    }

    try {
      const state = await window.orxa.codex.getState()
      setCodexServiceState(state)

      if (state.status !== 'connected') {
        return
      }

      const [models, collaborationModes] = await Promise.all([
        window.orxa.codex.listModels().catch(() => [] as CodexModelEntry[]),
        window.orxa.codex.listCollaborationModes().catch(() => [] as CodexCollaborationMode[]),
      ])
      if (models.length > 0) {
        setCodexServiceModels(models)
      }
      if (collaborationModes.length > 0) {
        setCodexServiceCollaborationModes(collaborationModes)
      }
    } catch {
      setCodexServiceState({ status: 'disconnected' })
    }
  }, [])
  useEffect(() => {
    if (!activeProjectDir || activeSessionType !== 'codex' || !window.orxa?.codex) {
      return
    }

    let cancelled = false
    const loadConnectedMetadata = async () => {
      const [models, collaborationModes] = await Promise.all([
        window.orxa.codex.listModels().catch(() => [] as CodexModelEntry[]),
        window.orxa.codex.listCollaborationModes().catch(() => [] as CodexCollaborationMode[]),
      ])
      if (cancelled) {
        return
      }
      if (models.length > 0) {
        setCodexServiceModels(models)
      }
      if (collaborationModes.length > 0) {
        setCodexServiceCollaborationModes(collaborationModes)
      }
    }

    void (async () => {
      try {
        const state = await window.orxa.codex.getState()
        if (cancelled) {
          return
        }
        setCodexServiceState(state)

        if (state.status === 'connected') {
          await loadConnectedMetadata()
          return
        }

        const nextState = await window.orxa.codex.start(activeProjectDir, {
          codexPath: appPreferences.codexPath,
          codexArgs: appPreferences.codexArgs,
        })
        if (cancelled) {
          return
        }
        setCodexServiceState(nextState)
        if (nextState.status === 'connected') {
          await loadConnectedMetadata()
        }
      } catch {
        if (!cancelled) {
          setCodexServiceState({ status: 'disconnected' })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeProjectDir, activeSessionType, appPreferences.codexArgs, appPreferences.codexPath])

  useEffect(() => {
    void refreshCodexServiceSnapshot()
  }, [refreshCodexServiceSnapshot])

  useEffect(() => {
    if (!window.orxa?.events) {
      return
    }

    return window.orxa.events.subscribe(event => {
      if (event.type !== 'codex.state') {
        return
      }
      const state = event.payload as CodexState
      setCodexServiceState(state)
      if (state.status === 'connected') {
        void refreshCodexServiceSnapshot()
      }
    })
  }, [refreshCodexServiceSnapshot])

  useEffect(() => {
    const resume = () => void refreshCodexServiceSnapshot()
    window.addEventListener('focus', resume)
    window.addEventListener('pageshow', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      window.removeEventListener('focus', resume)
      window.removeEventListener('pageshow', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [refreshCodexServiceSnapshot])

  const sendComposerPrompt = useCallback(() => {
    if (activeProjectDir && activeSessionID) {
      clearBrowserAutomationHalt(activeProjectDir, activeSessionID)
    }
    // Mark session as used so it won't be cleaned up on navigation
    if (activeSessionID) {
      markSessionUsed(activeSessionID)
    }
    return sendPrompt({
      systemAddendum: effectiveSystemAddendum,
      promptSource: 'user',
      tools: activePromptToolsPolicy,
    })
  }, [
    activeProjectDir,
    activePromptToolsPolicy,
    activeSessionID,
    clearBrowserAutomationHalt,
    effectiveSystemAddendum,
    markSessionUsed,
    sendPrompt,
  ])

  const queueFollowupMessage = useCallback(
    (text: string, attachments?: Attachment[]) => {
      const trimmed = text.trim()
      if (!trimmed) return
      const id = `fq:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
      setFollowupQueue(current => [
        ...current,
        {
          id,
          text: trimmed,
          timestamp: Date.now(),
          attachments: attachments?.length ? attachments : undefined,
        },
      ])
      setComposer('')
      if (attachments?.length) {
        setComposerAttachments([])
      }
    },
    [setComposer, setComposerAttachments]
  )

  const removeQueuedMessage = useCallback((id: string) => {
    setFollowupQueue(current => current.filter(item => item.id !== id))
  }, [])

  const editQueuedMessage = useCallback(
    (id: string) => {
      setFollowupQueue(current => {
        const item = current.find(m => m.id === id)
        if (item) {
          setComposer(item.text)
          if (item.attachments?.length) {
            setComposerAttachments(item.attachments)
          }
        }
        return current.filter(m => m.id !== id)
      })
    },
    [setComposer, setComposerAttachments]
  )

  const allModelOptions = settingsModelOptions

  const modelSelectOptions = useMemo(
    () => filterHiddenModelOptions(allModelOptions, appPreferences.hiddenModels),
    [allModelOptions, appPreferences.hiddenModels]
  )
  const variantOptions = useMemo(() => {
    const model = modelSelectOptions.find(item => item.key === selectedModel)
    return model?.variants ?? []
  }, [selectedModel, modelSelectOptions])
  useEffect(() => {
    if (hasProjectContext) {
      return
    }
    setBrowserSidebarOpen(false)
  }, [hasProjectContext])

  useEffect(() => {
    if (!settingsOpen) {
      return
    }
    void Promise.all([
      refreshConfigModels(),
      refreshGlobalProviders(),
      refreshAgentFiles(),
      refreshCodexServiceSnapshot(),
    ]).catch(() => undefined)
  }, [
    refreshAgentFiles,
    refreshCodexServiceSnapshot,
    refreshConfigModels,
    refreshGlobalProviders,
    settingsOpen,
  ])

  // Periodically refresh models/agents so the dropdown stays in sync
  // with external config changes without needing to open settings.
  useEffect(() => {
    const interval = window.setInterval(() => {
      void Promise.all([
        refreshConfigModels(),
        refreshGlobalProviders(),
        refreshAgentFiles(),
        refreshCodexServiceSnapshot(),
      ]).catch(() => undefined)
    }, 45_000)
    return () => window.clearInterval(interval)
  }, [refreshAgentFiles, refreshCodexServiceSnapshot, refreshConfigModels, refreshGlobalProviders])

  // Also refresh when switching to a new active session
  const prevActiveSessionRef = useRef(activeSessionID)
  useEffect(() => {
    if (activeSessionID && activeSessionID !== prevActiveSessionRef.current) {
      void Promise.all([
        refreshConfigModels(),
        refreshGlobalProviders(),
        refreshCodexServiceSnapshot(),
      ]).catch(() => undefined)
    }
    prevActiveSessionRef.current = activeSessionID
  }, [activeSessionID, refreshCodexServiceSnapshot, refreshConfigModels, refreshGlobalProviders])

  useEffect(() => {
    if (!activeSessionID || !activeProjectDir) {
      setMessages([])
      return
    }

    // Don't clear messages before refresh — the Zustand store caches messages
    // per session key, so showing cached data instantly avoids the empty flash.
    // refreshMessages() will update with fresh server data in the background.
    void refreshMessages()
  }, [activeProjectDir, activeSessionID, refreshMessages, setMessages])

  useEffect(() => {
    if (!activeSessionKey || !activeOptimisticOpencodePrompt || messages.length === 0) {
      return
    }
    setOptimisticOpencodePrompts(current => {
      if (!(activeSessionKey in current)) {
        return current
      }
      const next = { ...current }
      delete next[activeSessionKey]
      return next
    })
  }, [activeOptimisticOpencodePrompt, activeSessionKey, messages.length])

  const latestMessageProvenanceMarker = useMemo(() => {
    const latestMessage = messages[messages.length - 1]
    if (!latestMessage) {
      return 'none'
    }
    const latestPart = latestMessage.parts[latestMessage.parts.length - 1]
    return `${latestMessage.info.id}:${latestMessage.parts.length}:${latestPart?.id ?? ''}`
  }, [messages])

  useEffect(() => {
    if (!activeProjectDir || !activeSessionID) {
      setSessionProvenanceByPath({})
      return
    }
    let cancelled = false
    const timeout = window.setTimeout(() => {
      void opencodeClient
        .loadChangeProvenance(activeProjectDir, activeSessionID, 0)
        .then(snapshot => {
          if (cancelled) {
            return
          }
          const next: Record<string, ChangeProvenanceRecord> = {}
          const ordered = [...snapshot.records].sort((a, b) => b.timestamp - a.timestamp)
          for (const record of ordered) {
            if (!record.filePath || next[record.filePath]) {
              continue
            }
            next[record.filePath] = record
          }
          setSessionProvenanceByPath(next)
        })
        .catch(() => {
          if (!cancelled) {
            setSessionProvenanceByPath({})
          }
        })
    }, 1100)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [activeProjectDir, activeSessionID, messages.length, latestMessageProvenanceMarker])

  // Helper to resolve the next agent when current is unavailable
  const resolveNextAgent = useCallback(
    (
      currentAgent: string | undefined,
      available: Set<string>,
      primaryOptions: typeof effectiveComposerAgentOptions,
      allOptions: typeof agentOptions,
      hasPlan: boolean,
      serverNames: typeof serverAgentNames
    ): string | undefined => {
      if (!currentAgent || !available.has(currentAgent)) {
        const firstPrimary = primaryOptions[0]?.name
        return (
          firstPrimary ??
          preferredAgentForMode({
            hasPlanAgent: hasPlan,
            serverAgentNames: serverNames,
            firstAgentName: allOptions[0]?.name,
          })
        )
      }
      return currentAgent
    },
    []
  )

  // Helper to compute the preferred visible model
  const resolvePreferredVisibleModel = useCallback(
    (
      nextAgent: string | undefined,
      agentOptionsList: typeof agentOptions,
      modelPrefs: typeof agentModelPrefs,
      preferredModel: string | undefined,
      projectModel: string | undefined,
      modelOptions: typeof modelSelectOptions
    ): string | undefined => {
      const agentDef = agentOptionsList.find(agent => agent.name === nextAgent)
      const savedModel = nextAgent ? modelPrefs[nextAgent] : undefined
      const preferredModelValue = savedModel ?? agentDef?.model ?? preferredModel ?? projectModel
      if (preferredModelValue && modelOptions.some(item => item.key === preferredModelValue)) {
        return preferredModelValue
      }
      return undefined
    },
    []
  )

  useEffect(() => {
    const available = new Set(availableAgentNames)

    const nextAgent = resolveNextAgent(
      selectedAgent,
      available,
      effectiveComposerAgentOptions,
      agentOptions,
      hasPlanAgent,
      serverAgentNames
    )
    if (nextAgent !== selectedAgent) {
      setSelectedAgent(nextAgent)
    }

    const preferredVisibleModel = resolvePreferredVisibleModel(
      nextAgent,
      agentOptions,
      agentModelPrefs,
      preferredAgentModel,
      projectData?.config.model,
      modelSelectOptions
    )
    const fallback = findFallbackModel(
      modelSelectOptions,
      selectedModel ?? preferredVisibleModel ?? preferredVisibleModel
    )
    if (!selectedModel || nextAgent !== selectedAgent) {
      setSelectedModel(preferredVisibleModel ?? fallback?.key)
    } else if (!modelSelectOptions.some(item => item.key === selectedModel)) {
      setSelectedModel(preferredVisibleModel ?? fallback?.key)
    }
  }, [
    agentModelPrefs,
    agentOptions,
    availableAgentNames,
    hasPlanAgent,
    modelSelectOptions,
    preferredAgentModel,
    projectData?.config.model,
    resolveNextAgent,
    resolvePreferredVisibleModel,
    selectedAgent,
    selectedModel,
    setSelectedAgent,
    setSelectedModel,
    serverAgentNames,
    effectiveComposerAgentOptions,
  ])

  const prevSelectedAgentRef = useRef<string | undefined>(selectedAgent)
  useEffect(() => {
    if (selectedModel && selectedAgent && prevSelectedAgentRef.current === selectedAgent) {
      if (modelSelectOptions.some(item => item.key === selectedModel)) {
        setAgentModelPrefs(prev => {
          if (prev[selectedAgent] === selectedModel) return prev
          return { ...prev, [selectedAgent]: selectedModel }
        })
      }
    }
    prevSelectedAgentRef.current = selectedAgent
  }, [selectedModel, selectedAgent, modelSelectOptions, setAgentModelPrefs])

  useAppCoreDiagnostics({
    appendDebugLog,
    reportRendererDiagnostic,
    setDebugLogs,
    setRuntime,
    setStatusLine,
    openSettings: () => setSettingsOpen(true),
    toggleWorkspaceSidebar: () => setProjectsSidebarVisible(current => !current),
    toggleOperationsSidebar: () =>
      setAppPreferences(current => ({
        ...current,
        showOperationsPane: !current.showOperationsPane,
      })),
    toggleBrowserSidebar: () => setBrowserSidebarOpen(current => !current),
    setBrowserRuntimeState,
    setBrowserHistoryItems,
    setBrowserActionRunning,
    setMcpDevToolsState,
    handleUpdaterTelemetry,
    bootstrap,
    applyRuntimeSnapshot,
    applyOpencodeStreamEvent,
    activeProjectDir,
    activeSessionID,
    addSessionFeedNotice,
    buildSessionFeedNoticeKey,
    getManualSessionStopState,
    markManualSessionStopNoticeEmitted,
    pruneManualSessionStops,
    pushToast,
    queueRefresh,
    scheduleGitRefresh,
    stopResponsePolling,
    isRecoverableSessionError,
  })

  const { activeProject, activeWorkspaceWorktree, filteredProjects, sidebarActiveProjectDir } =
    useWorkspaceShellSurface({
      projects,
      activeProjectDir,
      projectSearchQuery,
      projectSortMode,
      workspaceMetaByDirectory,
      workspaceRootByDirectory,
      worktreesByWorkspace,
      setSelectedWorkspaceWorktree,
    })

  const allProjectSessions = useMemo(() => {
    return Object.fromEntries(
      Object.entries(cachedSessionsByProject).map(([directory, sessionsForProject]) => [
        directory,
        sessionsForProject.map(session => ({
          id: session.id,
          title: session.title,
          slug: session.slug,
        })),
      ])
    )
  }, [cachedSessionsByProject])

  const setSessionReadTimestamp = useCallback(
    (directory: string, sessionID: string, nextReadAt: number) => {
      const sessionKey = buildWorkspaceSessionMetadataKey(directory, sessionID)
      setSessionReadAt(sessionKey, nextReadAt)
    },
    [setSessionReadAt]
  )

  useEffect(() => {
    const cachedProjects = { ...scopedProjectDataByDirectory }
    if (projectData?.directory) {
      cachedProjects[projectData.directory] = projectData
    }

    for (const [directory, data] of Object.entries(cachedProjects)) {
      for (const session of data.sessions) {
        if (getSessionType(session.id, directory) !== 'codex') {
          continue
        }
        const sessionKey = buildWorkspaceSessionMetadataKey(directory, session.id)
        const persisted = getPersistedCodexState(sessionKey)
        if (!persisted.thread && !persisted.isStreaming && persisted.messages.length === 0) {
          continue
        }
        const existing = useUnifiedRuntimeStore.getState().codexSessions[sessionKey]
        if (existing?.thread || existing?.isStreaming || existing?.messages.length) {
          continue
        }
        initCodexSession(sessionKey, directory)
        setCodexThread(sessionKey, persisted.thread ?? null)
        setCodexStreaming(sessionKey, Boolean(persisted.isStreaming))
        replaceCodexMessages(sessionKey, persisted.messages)
      }
    }
  }, [
    getSessionType,
    initCodexSession,
    projectCacheVersion,
    projectData,
    scopedProjectDataByDirectory,
    replaceCodexMessages,
    setCodexStreaming,
    setCodexThread,
    sessionTypes,
  ])

  const refreshAgentsDocument = useCallback(
    async (directory?: string) => {
      const targetDirectory = directory ?? activeProjectDir
      if (!targetDirectory) {
        setAgentsDocument(null)
        setAgentsDraft('')
        return
      }
      try {
        setAgentsLoading(true)
        const doc = await window.orxa.opencode.readAgentsMd(targetDirectory)
        setAgentsDocument(doc)
        setAgentsDraft(doc.content)
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
      } finally {
        setAgentsLoading(false)
      }
    },
    [activeProjectDir]
  )

  useEffect(() => {
    if (activeProjectDir) {
      return
    }
    void refreshDashboard()
  }, [activeProjectDir, refreshDashboard])

  useEffect(() => {
    if (!activeProjectDir || activeSessionID) {
      return
    }
    void refreshAgentsDocument(activeProjectDir)
  }, [activeProjectDir, activeSessionID, refreshAgentsDocument])

  useEffect(() => {
    if (activeProjectDir && !activeSessionID) {
      return
    }
    setAgentsDocument(null)
    setAgentsDraft('')
  }, [activeProjectDir, activeSessionID])

  const createSession = useCallback(
    async (directory?: string, sessionTypeOrPrompt?: SessionType | string) =>
      createSessionAction(
        {
          activeProjectDir,
          appPermissionMode: appPreferences.permissionMode as SessionPermissionMode,
          availableAgentNames,
          clearPendingSession,
          createWorkspaceSession,
          describeClaudeHealthFailure,
          findReusableDraftSession,
          markSessionUsed,
          registerLocalProviderSession: registerSyntheticSession,
          selectProject,
          selectedAgent,
          selectedModelPayload,
          selectedVariant,
          setActiveProjectDir,
          setActiveSessionID,
          setManualSessionTitles,
          setSessionTitles,
          setSessionTypes,
          setSidebarMode,
          setStatusLine,
        },
        directory,
        sessionTypeOrPrompt
      ),
    [
      activeProjectDir,
      appPreferences.permissionMode,
      availableAgentNames,
      clearPendingSession,
      createWorkspaceSession,
      findReusableDraftSession,
      markSessionUsed,
      registerSyntheticSession,
      selectProject,
      selectedAgent,
      selectedModelPayload,
      selectedVariant,
      setActiveProjectDir,
      setActiveSessionID,
      setManualSessionTitles,
      setSessionTitles,
      setSessionTypes,
      setSidebarMode,
      setStatusLine,
    ]
  )

  const { openBoundClaudeSession, openBoundCodexSession } = useBoundProviderSessionOpeners({
    activeProjectDir,
    clearPendingSession,
    markSessionUsed,
    registerSyntheticSession,
    selectProject,
    setActiveProjectDir,
    setActiveSessionID,
    setManualSessionTitles,
    setSessionTitles,
    setSessionTypes,
    setSidebarMode,
    setStatusLine,
  })

  const openWorkspaceCodexThread = openBoundCodexSession

  const {
    addProjectDirectory,
    applySkillToProject,
    changeProjectDirectory,
    copyProjectPath,
    loadSkills,
    openSkillUseModal,
    removeProjectDirectory,
  } = useAppCoreProjectActions({
    activeProjectDir,
    activeSessionID,
    projects,
    bootstrap,
    selectProject,
    pushToast,
    setStatusLine,
    setSkills,
    setSkillsLoading,
    setSkillsError,
    setSkillUseModal,
    setProjectData,
    setActiveSessionID,
    setComposer,
    setMessages,
    setOpencodeMessages,
    setSidebarMode,
    requestConfirmation,
    setActiveProjectDir,
    setTerminalTabs,
    setActiveTerminalId,
    setTerminalOpen,
  })

  useEffect(() => {
    if (sidebarMode !== 'skills') {
      return
    }
    void loadSkills()
  }, [loadSkills, sidebarMode])

  useEffect(() => {
    if (!projectSearchOpen) {
      return
    }
    projectSearchInputRef.current?.focus()
  }, [projectSearchOpen])

  useEffect(() => {
    setAllSessionsModalOpen(false)
  }, [activeProjectDir])

  const {
    workspaceRoot: workspaceDetailRoot,
    worktrees: workspaceWorktrees,
    worktreesLoading: workspaceWorktreesLoading,
    selectedWorktreeDirectory,
    setSelectedWorktreeDirectory,
    createWorktree: createWorkspaceWorktree,
    openWorktree: openWorkspaceWorktree,
    deleteWorktree: deleteWorkspaceWorktree,
    launchSessionInWorktree,
  } = useWorkspaceDetailSurface({
    workspaceDetailDirectory,
    createSession,
    setStatusLine,
  })
  const { codexThreads: workspaceCodexThreads } = useWorkspaceCodexThreads({
    modalOpen: allSessionsModalOpen,
    workspaceRoot: workspaceDetailRoot,
    setStatusLine,
  })

  const {
    claudeSessionBrowserOpen,
    setClaudeSessionBrowserOpen,
    claudeBrowserSessions,
    claudeBrowserSessionsLoading,
    selectedClaudeBrowserWorkspace,
    setSelectedClaudeBrowserWorkspace,
    openClaudeSessionBrowser,
    openClaudeBrowserSession,
  } = useClaudeSessionBrowser({
    activeProjectDir,
    projects,
    setStatusLine,
    openBoundClaudeSession,
  })
  const {
    codexSessionBrowserOpen,
    setCodexSessionBrowserOpen,
    codexBrowserThreads,
    codexBrowserThreadsLoading,
    selectedCodexBrowserWorkspace,
    setSelectedCodexBrowserWorkspace,
    openCodexSessionBrowser,
    openCodexBrowserThread,
  } = useCodexSessionBrowser({
    activeProjectDir,
    projects,
    setStatusLine,
    openBoundCodexSession,
  })

  const renameSession = useCallback(
    (directory: string, sessionID: string, currentTitle: string) => {
      setTextInputDialog({
        title: 'Rename session',
        defaultValue: currentTitle,
        placeholder: 'Session title',
        confirmLabel: 'Rename',
        validate: value => {
          if (!value.trim()) {
            return 'Session title is required'
          }
          return null
        },
        onConfirm: async value => {
          const nextTitle = value.trim()
          if (nextTitle === currentTitle) {
            return
          }
          const scopedSessionKey = buildWorkspaceSessionMetadataKey(directory, sessionID)
          try {
            const sessionType = getSessionType(sessionID, directory)
            const syntheticSession = getSyntheticSessionRecord(directory, sessionID)
            if (sessionType === 'opencode') {
              if (!syntheticSession) {
                await window.orxa.opencode.renameSession(directory, sessionID, nextTitle)
                await refreshProject(directory)
              }
            } else if (sessionType === 'codex') {
              const codexThreadId = selectCodexSessionRuntime(scopedSessionKey)?.thread?.id
              if (codexThreadId) {
                await window.orxa.codex.setThreadName(codexThreadId, nextTitle)
              }
            } else if (sessionType === 'claude-chat') {
              const claudeThreadId = resolveClaudeChatProviderThreadId(scopedSessionKey)
              if (claudeThreadId) {
                await window.orxa.claudeChat.renameProviderSession(
                  claudeThreadId,
                  nextTitle,
                  directory
                )
              }
            }
            if (syntheticSession) {
              renameSyntheticSession(directory, sessionID, nextTitle)
            }
            setSessionTitles(prev => ({
              ...prev,
              [scopedSessionKey]: nextTitle,
            }))
            setManualSessionTitles(prev => ({
              ...prev,
              [scopedSessionKey]: true,
            }))
            setStatusLine('Session renamed')
          } catch (error) {
            setStatusLine(error instanceof Error ? error.message : String(error))
          }
        },
      })
    },
    [
      getSyntheticSessionRecord,
      getSessionType,
      refreshProject,
      renameSyntheticSession,
      setManualSessionTitles,
      setSessionTitles,
      setTextInputDialog,
    ]
  )

  const removeSessionFromLocalProjectCache = useCallback(
    (directory: string, sessionID: string) => {
      const cachedProject = useUnifiedRuntimeStore.getState().projectDataByDirectory[directory]
      if (!cachedProject) {
        return
      }
      if (!cachedProject.sessions.some(session => session.id === sessionID)) {
        return
      }
      const nextSessionStatus = { ...cachedProject.sessionStatus }
      delete nextSessionStatus[sessionID]
      const nextProject = {
        ...cachedProject,
        sessions: cachedProject.sessions.filter(session => session.id !== sessionID),
        sessionStatus: nextSessionStatus,
      }
      setProjectDataForDirectory(directory, nextProject)
      if (activeProjectDir === directory) {
        setProjectData(nextProject)
      }
      setProjectCacheVersion(version => version + 1)
    },
    [activeProjectDir, setProjectData, setProjectDataForDirectory]
  )

  const archiveSession = useCallback(
    async (directory: string, sessionID: string) => {
      try {
        const sessionKey = buildWorkspaceSessionMetadataKey(directory, sessionID)
        const archivedSessionType = getSessionType(sessionID, directory)
        const isArchivedSessionActive =
          activeProjectDir === directory && activeSessionID === sessionID
        const syntheticSession = getSyntheticSessionRecord(directory, sessionID)
        const codexThreadId =
          archivedSessionType === 'codex'
            ? selectCodexSessionRuntime(sessionKey)?.thread?.id
            : undefined
        const providerThreadId =
          archivedSessionType === 'claude-chat'
            ? resolveClaudeChatProviderThreadId(sessionKey)
            : undefined
        const providerArchiveRequest = buildProviderArchiveRequest({
          archivedSessionType,
          sessionKey,
          directory,
          codexThreadId,
          providerThreadId,
        })
        if (shouldUseOpencodeRuntimeSession(directory, sessionID)) {
          await window.orxa.opencode.archiveSession(directory, sessionID)
        }
        // Clear canvas state for archived sessions so new canvas sessions start fresh
        try {
          const dirSuffix = directory ? `:${directory.replace(/\//g, '_')}` : ''
          removePersistedValue(`orxa:canvasState:${sessionID}${dirSuffix}:v2`)
          // Also clear legacy v1 key
          removePersistedValue(`orxa:canvasState:${sessionID}:v1`)
        } catch {
          /* non-fatal */
        }
        clearLocalProviderArchiveState({
          archivedSessionType,
          sessionKey,
          clearPersistedCodexState,
          removeCodexSession,
          clearPersistedClaudeChatState,
          removeClaudeChatSession,
          removeClaudeSession,
        })
        if (syntheticSession) {
          removeSyntheticSession(directory, sessionID)
        }
        clearSessionReadAt(sessionKey)
        clearSessionMetadata(sessionKey)
        removeSessionFromLocalProjectCache(directory, sessionID)
        if (isArchivedSessionActive) {
          clearPendingSession()
          setActiveSessionID(undefined)
          setMessages([])
          await selectProject(directory)
          removeSessionFromLocalProjectCache(directory, sessionID)
        } else if (!syntheticSession) {
          void refreshProject(directory).catch(() => undefined)
        }
        if (providerArchiveRequest) {
          void providerArchiveRequest().catch(() => undefined)
        }
        setStatusLine('Session archived')
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
      }
    },
    [
      activeSessionID,
      activeProjectDir,
      clearPendingSession,
      clearSessionMetadata,
      clearSessionReadAt,
      getSessionType,
      getSyntheticSessionRecord,
      refreshProject,
      removeSyntheticSession,
      selectProject,
      removeCodexSession,
      removeClaudeChatSession,
      removeClaudeSession,
      removeSessionFromLocalProjectCache,
      setActiveSessionID,
      setMessages,
      shouldUseOpencodeRuntimeSession,
    ]
  )

  const copySessionID = useCallback(
    async (directory: string, sessionID: string) => {
      try {
        const sessionType = getSessionType(sessionID, directory)
        const sessionKey = buildWorkspaceSessionMetadataKey(directory, sessionID)
        const claudeChatProviderThreadId = resolveClaudeChatProviderThreadId(sessionKey)
        if (sessionType === 'claude-chat' && !claudeChatProviderThreadId) {
          throw new Error('Claude thread ID is not available to copy.')
        }
        const resolved = resolveSessionCopyIdentifier({
          sessionType,
          workspaceSessionID: sessionID,
          codexThreadID:
            selectCodexSessionRuntime(sessionKey)?.thread?.id ??
            getPersistedCodexState(sessionKey).thread?.id ??
            null,
          claudeChatProviderThreadId,
        })
        await navigator.clipboard.writeText(resolved.value)
        setStatusLine(`${resolved.label} copied`)
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
      }
    },
    [getSessionType]
  )

  useEffect(() => {
    const activeStatus = activeSessionID
      ? projectData?.sessionStatus[activeSessionID]?.type
      : undefined
    const canAbortSession = activeStatus === 'busy' || activeStatus === 'retry' || isSendingPrompt
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      setTitleMenuOpen(false)
      setOpenMenuOpen(false)
      setCommitMenuOpen(false)
      setProjectSearchOpen(false)
      setProjectSortOpen(false)
      setBranchMenuOpen(false)
      if (canAbortSession) {
        event.preventDefault()
        void abortActiveSession()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [abortActiveSession, activeSessionID, isSendingPrompt, projectData, setBranchMenuOpen])

  useEffect(() => {
    const onPointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) {
        return
      }
      const insideTopMenus =
        target.closest('.titlebar-split') ||
        target.closest('.title-overflow-button') ||
        target.closest('.title-overflow-menu')
      if (!insideTopMenus) {
        setOpenMenuOpen(false)
        setCommitMenuOpen(false)
        setTitleMenuOpen(false)
      }
      if (!target.closest('.project-search-popover') && !target.closest('.pane-action-icon')) {
        setProjectSearchOpen(false)
      }
      if (!target.closest('.project-sort-popover') && !target.closest('.pane-action-icon')) {
        setProjectSortOpen(false)
      }
      if (!target.closest('.composer-branch-wrap')) {
        setBranchMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
    }
  }, [setBranchMenuOpen])

  useEffect(() => {
    setTitleMenuOpen(false)
    setOpenMenuOpen(false)
    setCommitMenuOpen(false)
    setBranchMenuOpen(false)
  }, [activeProjectDir, activeSessionID, setBranchMenuOpen])

  useEffect(() => {
    if (!branchMenuOpen) {
      return
    }
    window.setTimeout(() => {
      branchSearchInputRef.current?.focus()
    }, 0)
  }, [branchMenuOpen])

  const togglePlanMode = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        if (hasPlanAgent) {
          setSelectedAgent('plan')
        }
        return
      }
      const nonPlanAgent = agentOptions.find(a => a.name !== 'plan')
      setSelectedAgent(nonPlanAgent?.name ?? agentOptions[0]?.name)
    },
    [agentOptions, hasPlanAgent, setSelectedAgent]
  )

  const activeSession = useMemo(
    () => sessions.find(item => item.id === activeSessionID),
    [activeSessionID, sessions]
  )
  const activeUnifiedSessionStatusSignal = useUnifiedRuntimeStore(
    useCallback(() => {
      if (!activeProjectDir || !activeSessionID) {
        return 'inactive'
      }
      const sessionKey =
        activeSessionKey ?? buildWorkspaceSessionMetadataKey(activeProjectDir, activeSessionID)
      const status =
        activeSessionType === 'codex'
          ? buildCodexSessionStatus(sessionKey, true)
          : activeSessionType === 'claude-chat'
            ? buildClaudeChatSessionStatus(sessionKey, true)
            : activeSessionType === 'claude'
              ? buildClaudeSessionStatus(sessionKey, true)
              : buildOpencodeSessionStatus(activeProjectDir, activeSessionID, true, sessionKey)
      return `${status.type}:${status.busy ? 1 : 0}:${status.awaiting ? 1 : 0}:${status.unread ? 1 : 0}:${status.planReady ? 1 : 0}:${status.activityAt}`
    }, [activeProjectDir, activeSessionID, activeSessionKey, activeSessionType])
  )
  const activeUnifiedSessionStatus = useMemo(() => {
    void activeUnifiedSessionStatusSignal
    if (!activeProjectDir || !activeSessionID) {
      return null
    }
    const sessionKey =
      activeSessionKey ?? buildWorkspaceSessionMetadataKey(activeProjectDir, activeSessionID)
    if (activeSessionType === 'codex') {
      return buildCodexSessionStatus(sessionKey, true)
    }
    if (activeSessionType === 'claude-chat') {
      return buildClaudeChatSessionStatus(sessionKey, true)
    }
    if (activeSessionType === 'claude') {
      return buildClaudeSessionStatus(sessionKey, true)
    }
    return buildOpencodeSessionStatus(activeProjectDir, activeSessionID, true, sessionKey)
  }, [
    activeProjectDir,
    activeSessionID,
    activeSessionKey,
    activeSessionType,
    activeUnifiedSessionStatusSignal,
  ])
  // Not memoized: this selector reads session status from projectDataByDirectory
  // via getState() and must re-run on every render to detect busy→idle transitions.
  const activeComposerPresentation = selectActiveComposerPresentation({
    provider: normalizePresentationProvider(activeSessionType),
    directory: activeProjectDir,
    sessionID: activeSessionID,
    sessionKey: activeSessionKey ?? undefined,
    sending: isSendingPrompt,
  })
  const isSessionBusy = activeComposerPresentation.busy
  const isSessionInProgress = isSessionBusy || isSendingPrompt
  const contentPaneTitle =
    activeSession?.title?.trim() || activeSession?.slug || activeProject?.name || 'Untitled session'
  const isActiveSessionPinned = Boolean(
    activeProjectDir &&
    activeSessionID &&
    (pinnedSessions[activeProjectDir] ?? []).includes(activeSessionID)
  )
  const activeTodoPresentation = selectActiveTaskListPresentation({
    provider: normalizePresentationProvider(activeSessionType),
    directory: activeProjectDir,
    sessionID: activeSessionID,
    sessionKey: activeSessionKey ?? undefined,
  })
  const activeSessionPresentation = selectSessionPresentation({
    provider: normalizePresentationProvider(activeSessionType),
    directory: activeProjectDir,
    sessionID: activeSessionID,
    sessionKey: activeSessionKey ?? undefined,
    assistantLabel,
  })
  const feedMessages = useMemo<SessionMessageBundle[]>(() => {
    if (!activeOptimisticOpencodePrompt || !activeSessionID || messages.length > 0) {
      return messages
    }
    return [
      {
        info: {
          id: `optimistic-user:${activeSessionID}`,
          role: 'user',
          sessionID: activeSessionID,
          time: {
            created: activeOptimisticOpencodePrompt.timestamp,
            updated: activeOptimisticOpencodePrompt.timestamp,
          },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: `optimistic-user-part:${activeSessionID}`,
            type: 'text',
            sessionID: activeSessionID,
            messageID: `optimistic-user:${activeSessionID}`,
            text: activeOptimisticOpencodePrompt.text,
          },
        ] as SessionMessageBundle['parts'],
      },
    ]
  }, [activeOptimisticOpencodePrompt, activeSessionID, messages])
  const feedPresentation =
    activeOptimisticOpencodePrompt && messages.length === 0 ? null : activeSessionPresentation
  useEffect(() => {
    const kanban = window.orxa?.kanban
    const events = window.orxa?.events
    if (!kanban) {
      return
    }

    let cancelled = false
    const hideSessions = (sessions: Array<{ directory: string; sessionId?: string }>) => {
      if (sessions.length === 0) {
        return
      }
      setHiddenBackgroundSessionIdsByProject(current => {
        let changed = false
        const next = { ...current }
        for (const session of sessions) {
          if (!session.sessionId) {
            continue
          }
          const hiddenIds = new Set(next[session.directory] ?? [])
          if (hiddenIds.has(session.sessionId)) {
            continue
          }
          hiddenIds.add(session.sessionId)
          next[session.directory] = [...hiddenIds]
          changed = true
        }
        return changed ? next : current
      })
    }

    const syncKanbanManagementSessions = async () => {
      const workspaces = await kanban
        .listWorkspaces()
        .catch(() => [] as Awaited<ReturnType<typeof kanban.listWorkspaces>>)
      const sessions = await Promise.all(
        workspaces.flatMap(workspace =>
          KANBAN_MANAGEMENT_PROVIDERS.map(async provider => {
            const session = await kanban
              .getManagementSession(workspace.directory, provider)
              .catch(() => null)
            return {
              directory: workspace.directory,
              sessionId: extractKanbanManagementSidebarSessionID(session?.sessionKey),
            }
          })
        )
      )
      if (!cancelled) {
        hideSessions(sessions)
      }
    }

    void syncKanbanManagementSessions()

    const unsubscribe = events?.subscribe(event => {
      if (event.type !== 'kanban.management') {
        return
      }
      hideSessions([
        {
          directory: event.payload.workspaceDir,
          sessionId: extractKanbanManagementSidebarSessionID(event.payload.session.sessionKey),
        },
      ])
    })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [setHiddenBackgroundSessionIdsByProject])
  const resumeRefreshActiveProjectDirRef = useRef(activeProjectDir)
  const resumeRefreshCachedProjectsRef = useRef(cachedProjects)
  const resumeRefreshProjectRef = useRef(refreshProject)
  const resumeRefreshDiagnosticsRef = useRef(reportRendererDiagnostic)

  useEffect(() => {
    resumeRefreshActiveProjectDirRef.current = activeProjectDir
    resumeRefreshCachedProjectsRef.current = cachedProjects
    resumeRefreshProjectRef.current = refreshProject
    resumeRefreshDiagnosticsRef.current = reportRendererDiagnostic
  }, [activeProjectDir, cachedProjects, refreshProject, reportRendererDiagnostic])

  useEffect(() => {
    let cancelled = false
    let refreshInFlight = false
    let refreshQueued = false
    let resumeRefreshTimer: number | undefined

    const runBackgroundRefresh = async () => {
      if (refreshInFlight) {
        refreshQueued = true
        return
      }
      refreshInFlight = true
      try {
        do {
          refreshQueued = false
          const currentActiveProjectDir = resumeRefreshActiveProjectDirRef.current
          const projects = resumeRefreshCachedProjectsRef.current
          const directories = Object.entries(projects)
            .filter(([directory, project]) => {
              if (directory === currentActiveProjectDir) {
                return false
              }
              if (!project) {
                return false
              }
              const hasWorkflowBacklog =
                (project.permissions?.length ?? 0) > 0 ||
                (project.questions?.length ?? 0) > 0 ||
                (project.commands?.length ?? 0) > 0
              if (hasWorkflowBacklog) {
                return true
              }
              const hasActiveSessionState = Object.values(project.sessionStatus ?? {}).some(
                status => Boolean(status?.type) && status.type !== 'idle'
              )
              return hasActiveSessionState
            })
            .map(([directory]) => directory)
          for (const directory of directories) {
            if (cancelled) {
              return
            }
            await measurePerf(
              {
                surface: 'background',
                metric: 'background.workspace_refresh_ms',
                kind: 'span',
                unit: 'ms',
                process: 'renderer',
                trigger: 'resume',
                component: 'app-core',
                workspaceHash: directory,
              },
              () => resumeRefreshProjectRef.current(directory, true)
            ).catch(error => {
              resumeRefreshDiagnosticsRef.current({
                level: 'warn',
                source: 'renderer',
                category: 'background.refresh-project',
                message: `Failed to refresh background workspace ${directory}`,
                details: error instanceof Error ? (error.stack ?? error.message) : String(error),
              })
            })
            if (cancelled) {
              return
            }
            await new Promise(resolve => window.setTimeout(resolve, 60))
          }
        } while (!cancelled && refreshQueued)
      } finally {
        refreshInFlight = false
      }
    }

    const onResume = () => {
      if (document.visibilityState === 'hidden') {
        return
      }
      if (resumeRefreshTimer) {
        window.clearTimeout(resumeRefreshTimer)
      }
      resumeRefreshTimer = window.setTimeout(() => {
        if (cancelled) {
          return
        }
        void runBackgroundRefresh()
      }, 260)
    }

    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('focus', onResume)
    window.addEventListener('pageshow', onResume)
    return () => {
      cancelled = true
      if (resumeRefreshTimer) {
        window.clearTimeout(resumeRefreshTimer)
      }
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('focus', onResume)
      window.removeEventListener('pageshow', onResume)
    }
  }, [])
  const effectiveBrowserState = useMemo(
    () =>
      buildAppShellBrowserSidebarState({
        runtimeState: browserRuntimeState,
        history: browserHistoryItems,
        modeEnabled: browserModeEnabled,
        controlOwner: browserControlOwner,
        actionRunning: browserActionRunning,
        isSessionInProgress,
      }),
    [
      browserActionRunning,
      browserControlOwner,
      browserHistoryItems,
      browserModeEnabled,
      browserRuntimeState,
      isSessionInProgress,
    ]
  )

  const openReferencedFile = useCallback(
    async (reference: string) => {
      if (!window.orxa?.opencode) {
        return
      }
      const resolvedPath = normalizeFileReferencePath(reference, activeProjectDir ?? null)
      if (!resolvedPath) {
        return
      }
      await window.orxa.opencode.openFileIn(resolvedPath, preferredOpenTarget)
    },
    [activeProjectDir, preferredOpenTarget]
  )

  useEffect(() => {
    if (!activeProjectDir || !activeSessionID) {
      return
    }
    const latestSeenAt = Math.max(
      activeSession?.time.updated ?? 0,
      activeUnifiedSessionStatus?.activityAt ?? 0
    )
    if (latestSeenAt > 0) {
      setSessionReadTimestamp(activeProjectDir, activeSessionID, latestSeenAt)
    }
  }, [
    activeUnifiedSessionStatus?.activityAt,
    activeProjectDir,
    activeSession?.time.updated,
    activeSessionID,
    setSessionReadTimestamp,
  ])

  const composerOffsetLift = Math.max(0, composerLayoutHeight - DEFAULT_COMPOSER_LAYOUT_HEIGHT)
  const messageFeedBottomClearance = useMemo(
    () => Math.max(24, 24 + composerOffsetLift + composerDockHeight),
    [composerOffsetLift, composerDockHeight]
  )
  const composerAnchorBottom = useMemo(
    () =>
      Math.max(0, composerLayoutHeight - COMPOSER_DRAWER_ATTACH_OFFSET) +
      (terminalOpen && canShowIntegratedTerminal ? terminalPanelHeight : 0),
    [canShowIntegratedTerminal, composerLayoutHeight, terminalOpen, terminalPanelHeight]
  )
  const composerToastStyle = useMemo(
    () =>
      ({
        '--composer-toast-bottom': `${Math.max(140, composerAnchorBottom + 24)}px`,
      }) as CSSProperties,
    [composerAnchorBottom]
  )
  const {
    pendingPermission,
    pendingQuestion,
    isPermissionDecisionInFlight,
    replyPendingPermission,
    replyPendingQuestion,
    rejectPendingQuestion,
    dockPendingPermission,
    dockPendingQuestion,
  } = useAppCoreAwaitingInput({
    activePresentationProvider:
      activePresentationProvider === 'claude'
        ? 'claude-chat'
        : (activePresentationProvider ?? 'opencode'),
    activeProjectDir,
    activeSessionID,
    activeSessionKey,
    appPreferences,
    effectiveSystemAddendum,
    followupQueue,
    isSessionInProgress,
    permissions: projectData?.permissions ?? [],
    questions: projectData?.questions ?? [],
    requestConfirmation,
    sendingQueuedId,
    setAppPreferences,
    setFollowupQueue,
    setPermissionDecisionPending,
    setPermissionDecisionPendingRequestID,
    setSendingQueuedId,
    setStatusLine,
    sendPrompt,
    toolsPolicy: activePromptToolsPolicy,
    permissionDecisionPending,
    permissionDecisionPendingRequestID,
  })
  const {
    backgroundAgentDetail,
    backgroundAgentTaskText,
    handleArchiveBackgroundAgent,
    selectedBackgroundAgentError,
    selectedBackgroundAgentId,
    selectedBackgroundAgentLoading,
    setSelectedBackgroundAgentId,
  } = useAppCoreBackgroundAgents({
    activeProjectDir,
    activeSessionID,
    visibleBackgroundAgents,
    setOpencodeMessages,
    openReferencedFile,
    refreshProject,
    setArchivedBackgroundAgentIds,
    setStatusLine,
  })

  // Hide BrowserView whenever an active pending approval/question dock is shown.
  // This prevents BrowserView from intercepting clicks intended for dock actions.
  useEffect(() => {
    const hasPendingInputDock = shouldHideBrowserViewForPendingInput({
      pendingPermission,
      pendingQuestion,
      dockPendingPermission,
      dockPendingQuestion,
    })
    if (hasPendingInputDock) {
      void window.orxa.browser.setVisible(false).catch(() => {})
      return
    }
    void window.orxa.browser.setVisible(browserPaneVisible).catch(() => {})
  }, [
    browserPaneVisible,
    dockPendingPermission,
    dockPendingQuestion,
    pendingPermission,
    pendingQuestion,
  ])

  const workspaceClassName = [
    'workspace',
    showGitPane ? '' : 'workspace-no-ops',
    showProjectsPane ? '' : 'workspace-left-collapsed',
    showGitPane ? '' : 'workspace-right-collapsed',
    hasProjectContext ? 'workspace-has-topbar' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const isDiffContentView =
    hasProjectContext &&
    rightSidebarTab === 'git' &&
    gitPanelTab === 'diff' &&
    gitDiffViewMode !== 'list'
  const effectiveRightPaneWidth = isDiffContentView ? Math.max(rightPaneWidth, 520) : rightPaneWidth
  const workspaceStyle = useMemo(
    () =>
      ({
        '--left-pane-visible': showProjectsPane ? 1 : 0,
        '--browser-pane-visible': hasProjectContext && browserSidebarOpen ? 1 : 0,
        '--right-pane-visible': showGitPane ? 1 : 0,
      }) as CSSProperties,
    [browserSidebarOpen, hasProjectContext, showGitPane, showProjectsPane]
  )

  useLayoutEffect(() => {
    if (!resizeStateRef.current) {
      workspaceRef.current?.style.setProperty('--left-pane-width', `${leftPaneWidth}px`)
      document.documentElement.style.setProperty('--left-pane-width', `${leftPaneWidth}px`)
    }
  }, [leftPaneWidth])

  useLayoutEffect(() => {
    if (!resizeStateRef.current) {
      workspaceRef.current?.style.setProperty('--browser-pane-width', `${browserPaneWidth}px`)
    }
  }, [browserPaneWidth])

  useLayoutEffect(() => {
    if (!resizeStateRef.current) {
      workspaceRef.current?.style.setProperty('--right-pane-width', `${effectiveRightPaneWidth}px`)
    }
  }, [effectiveRightPaneWidth])

  useEffect(() => {
    document.documentElement.style.setProperty('--left-pane-visible', showProjectsPane ? '1' : '0')
  }, [showProjectsPane])

  useEffect(() => {
    setDockTodosOpen(false)
  }, [activeSessionID])

  useEffect(() => {
    if (!canShowIntegratedTerminal) {
      setTerminalOpen(false)
    }
  }, [canShowIntegratedTerminal])

  const {
    createTerminal,
    toggleTerminal,
    handleTerminalResizeStart,
    upsertCustomRunCommand,
    runCustomRunCommand,
    deleteCustomRunCommand,
    closeTerminalTab,
  } = useAppCoreTerminal({
    activeProjectDir,
    activeTerminalId,
    canShowIntegratedTerminal,
    projectDirectory: projectData?.path.directory,
    terminalOpen,
    terminalPanelHeight,
    terminalTabs,
    terminalResizeStateRef,
    setActiveTerminalId,
    setTerminalOpen,
    setTerminalPanelHeight,
    setTerminalTabs,
    setCustomRunCommands,
    setStatusLine,
  })

  useEffect(() => {
    if (!terminalOpen || !activeProjectDir || !canShowIntegratedTerminal) {
      terminalAutoCreateTried.current = false
      return
    }

    if (terminalTabs.length > 0) {
      terminalAutoCreateTried.current = false
      return
    }

    if (terminalAutoCreateTried.current) {
      return
    }

    terminalAutoCreateTried.current = true
    void createTerminal()
  }, [
    activeProjectDir,
    canShowIntegratedTerminal,
    createTerminal,
    terminalOpen,
    terminalTabs.length,
  ])

  const openDirectoryInTarget = useCallback(
    async (target: OpenTarget) => {
      if (!activeProjectDir) {
        return
      }
      try {
        const result = await window.orxa.opencode.openDirectoryIn(activeProjectDir, target)
        setStatusLine(result.detail)
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
      } finally {
        setOpenMenuOpen(false)
      }
    },
    [activeProjectDir]
  )

  const selectOpenTarget = useCallback(
    (target: OpenTarget) => {
      setPreferredOpenTarget(target)
      setOpenMenuOpen(false)
    },
    [setPreferredOpenTarget]
  )

  const openCommitModal = useCallback(
    (nextStep?: CommitNextStep) => {
      if (!activeProjectDir) {
        return
      }
      if (nextStep) {
        setCommitNextStep(nextStep)
      }
      setCommitModalOpen(true)
      setCommitMenuOpen(false)
    },
    [activeProjectDir, setCommitModalOpen, setCommitNextStep]
  )

  const handleComposerLayoutHeightChange = useCallback((height: number) => {
    setComposerLayoutHeight(current => (current === height ? current : height))
  }, [])

  const handleDockHeightChange = useCallback((height: number) => {
    setComposerDockHeight(current => (current === height ? current : height))
  }, [])

  const openPendingPullRequest = useCallback(() => {
    if (!pendingPrUrl) {
      return
    }
    void window.orxa.app
      .openExternal(pendingPrUrl)
      .then(() => {
        setStatusLine('Opened pull request')
      })
      .catch(error => {
        setStatusLine(error instanceof Error ? error.message : String(error))
      })
    setPendingPrUrl(null)
    setCommitMenuOpen(false)
    setOpenMenuOpen(false)
    setTitleMenuOpen(false)
  }, [pendingPrUrl, setStatusLine])

  const submitCommit = useCallback(async () => {
    if (!activeProjectDir) {
      return
    }
    const selectedNextStep = commitNextStep
    clearCommitFlowDismissTimer()
    try {
      setCommitModalOpen(false)
      setCommitSubmitting(true)
      startCommitFlow(selectedNextStep)
      const result = await window.orxa.opencode.gitCommit(activeProjectDir, {
        includeUnstaged: commitIncludeUnstaged,
        message: commitMessageDraft.trim().length > 0 ? commitMessageDraft.trim() : undefined,
        guidancePrompt: appPreferences.commitGuidancePrompt,
        baseBranch:
          selectedNextStep === 'commit_and_create_pr' ? commitBaseBranch || undefined : undefined,
        nextStep: selectedNextStep,
      })
      setCommitMessageDraft('')
      const prSuffix = result.prUrl ? ` • PR ${result.prUrl}` : ''
      const pushSuffix = result.pushed ? ' • pushed' : ''
      setStatusLine(`Committed ${result.commitHash.slice(0, 7)}${pushSuffix}${prSuffix}`)
      if (result.prUrl) {
        setPendingPrUrl(result.prUrl)
      }
      completeCommitFlow(selectedNextStep)
      scheduleCommitFlowDismiss(1150)
      await refreshProject(activeProjectDir)
      if (rightSidebarTab === 'git') {
        void loadGitDiff()
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      setStatusLine(detail)
      failCommitFlow(selectedNextStep, detail)
    } finally {
      setCommitSubmitting(false)
    }
  }, [
    activeProjectDir,
    appPreferences.commitGuidancePrompt,
    completeCommitFlow,
    clearCommitFlowDismissTimer,
    commitBaseBranch,
    commitIncludeUnstaged,
    commitMessageDraft,
    commitNextStep,
    failCommitFlow,
    loadGitDiff,
    rightSidebarTab,
    refreshProject,
    scheduleCommitFlowDismiss,
    startCommitFlow,
    setCommitMessageDraft,
    setCommitModalOpen,
    setCommitSubmitting,
  ])

  const appendPathToComposer = useCallback(
    (filePath: string) => {
      setComposer(current => (current.trim().length > 0 ? `${current}\n${filePath}` : filePath))
    },
    [setComposer]
  )

  useEffect(() => {
    if (!activeProjectDir) {
      setRightSidebarTab('git')
      return
    }
  }, [activeProjectDir])

  useEffect(() => {
    if (!activeProjectDir || rightSidebarTab !== 'git') {
      return
    }
    if (gitPanelTab === 'diff') {
      void loadGitDiff()
      return
    }
    if (gitPanelTab === 'log') {
      void loadGitLog()
      return
    }
    if (gitPanelTab === 'issues') {
      void loadGitIssues()
      return
    }
    void loadGitPrs()
  }, [
    activeProjectDir,
    gitPanelTab,
    loadGitDiff,
    loadGitIssues,
    loadGitLog,
    loadGitPrs,
    rightSidebarTab,
  ])

  const openTargets = OPEN_TARGETS
  const activeOpenTarget =
    openTargets.find(target => target.id === preferredOpenTarget) ?? openTargets[2]!

  const commitNextStepOptions: Array<{ id: CommitNextStep; label: string; icon: ReactNode }> = [
    { id: 'commit', label: 'Commit', icon: <GitCommitHorizontal size={14} aria-hidden="true" /> },
    {
      id: 'commit_and_push',
      label: 'Commit and push',
      icon: <Upload size={14} aria-hidden="true" />,
    },
    { id: 'commit_and_create_pr', label: 'Create PR', icon: <Send size={14} aria-hidden="true" /> },
  ]
  const homeDashboardProps = useMemo(
    () =>
      buildAppShellHomeDashboardProps({
        dashboard,
        codexSessionCount,
        claudeSessionCount,
        codexUsage,
        claudeUsage,
        codexUsageLoading,
        claudeUsageLoading,
        onRefreshCodexUsage: () => void refreshCodexUsage(),
        onRefreshClaudeUsage: () => void refreshClaudeUsage(),
        onRefresh: () => void refreshDashboard(),
        onAddWorkspace: () => void addProjectDirectory(),
        onOpenSettings: () => setSettingsOpen(true),
      }),
    [
      addProjectDirectory,
      claudeSessionCount,
      claudeUsage,
      claudeUsageLoading,
      codexSessionCount,
      codexUsage,
      codexUsageLoading,
      dashboard,
      refreshClaudeUsage,
      refreshCodexUsage,
      refreshDashboard,
    ]
  )
  const profileActions = buildGlobalDialogsProfileActions({
    refreshProfiles,
    refreshConfigModels,
    refreshGlobalProviders,
    refreshGlobalAgents,
    refreshAgentFiles,
    bootstrap,
    setStatusLine,
  })
  const activeLocalProviderSessionKey =
    activeProjectDir && activeSessionID
      ? (activeSessionKey ?? buildWorkspaceSessionMetadataKey(activeProjectDir, activeSessionID))
      : (activeSessionKey ?? '')
  const handleActiveLocalProviderInteraction = useCallback(() => {
    if (!activeProjectDir || !activeSessionID) {
      return
    }
    markSessionUsed(activeSessionID)
    markSyntheticSessionStarted(activeProjectDir, activeSessionID)
    touchSyntheticSession(activeProjectDir, activeSessionID)
  }, [
    activeProjectDir,
    activeSessionID,
    markSessionUsed,
    markSyntheticSessionStarted,
    touchSyntheticSession,
  ])
  const handleActiveLocalProviderTitleChange = useCallback(
    (title: string) => {
      if (!activeSessionID || !activeProjectDir) {
        return
      }
      const scopedSessionKey = buildWorkspaceSessionMetadataKey(activeProjectDir, activeSessionID)
      if (!title.trim() || looksAutoGeneratedSessionTitle(title)) {
        return
      }
      if (manualSessionTitles[scopedSessionKey]) {
        return
      }
      setSessionTitles(prev => {
        const currentTitle = prev[scopedSessionKey]
        if (currentTitle === title) {
          return prev
        }
        if (
          currentTitle &&
          !looksAutoGeneratedSessionTitle(currentTitle) &&
          currentTitle !== title
        ) {
          return prev
        }
        return {
          ...prev,
          [scopedSessionKey]: title,
        }
      })
      renameSyntheticSession(activeProjectDir, activeSessionID, title)
    },
    [
      activeProjectDir,
      activeSessionID,
      manualSessionTitles,
      renameSyntheticSession,
      setSessionTitles,
    ]
  )
  const runQueuedMessage = useCallback(
    (id: string) => {
      const item = followupQueue.find(message => message.id === id)
      if (!item || sendingQueuedId) {
        return
      }
      setSendingQueuedId(id)
      void sendPrompt({
        textOverride: item.text,
        attachmentOverride: item.attachments ?? [],
        systemAddendum: effectiveSystemAddendum,
        promptSource: 'user',
        tools: activePromptToolsPolicy,
      }).finally(() => {
        setSendingQueuedId(undefined)
      })
      removeQueuedMessage(id)
    },
    [
      activePromptToolsPolicy,
      effectiveSystemAddendum,
      followupQueue,
      removeQueuedMessage,
      sendPrompt,
      sendingQueuedId,
    ]
  )
  const guardedSendComposerPrompt = useCallback(
    () => opencodeSessionControls.withGuardrails(sendComposerPrompt),
    [opencodeSessionControls, sendComposerPrompt]
  )
  const guardedRunQueuedMessage = useCallback(
    (id: string) => void opencodeSessionControls.withGuardrails(() => runQueuedMessage(id)),
    [opencodeSessionControls, runQueuedMessage]
  )
  const branchControls = {
    branchMenuOpen,
    setBranchMenuOpen,
    branchControlWidthCh,
    branchLoading,
    branchSwitching,
    hasActiveProject: Boolean(activeProjectDir),
    branchCurrent: branchState?.current,
    branchDisplayValue,
    branchSearchInputRef,
    branchQuery,
    setBranchQuery,
    branchActionError,
    clearBranchActionError: () => setBranchActionError(null),
    checkoutBranch,
    filteredBranches,
    openBranchCreateModal,
  }
  const appSessionContentProps = buildAppSessionContentProps({
    sidebarMode,
    activeProjectDir,
    activeSessionID,
    activeSessionType,
    pendingSessionId,
    dashboardProps: homeDashboardProps,
    skills,
    skillsLoading,
    skillsError,
    loadSkills,
    openSkillUseModal,
    createSession,
    openClaudeSessionBrowser,
    openCodexSessionBrowser,
    activeWorkspaceWorktree,
    openWorkspaceDetail: () => setAllSessionsModalOpen(true),
    canvasState,
    mcpDevToolsState,
    activeLocalProviderSessionKey,
    activeCodexSessionDraft:
      activeSessionType === 'codex' ? (activeSyntheticSessionRecord?.draft ?? false) : false,
    cachedCodexCollaborationModes: codexServiceCollaborationModes,
    cachedCodexModels: codexServiceModels,
    handleActiveLocalProviderInteraction,
    handleActiveLocalProviderTitleChange,
    appPreferences,
    setAppPreferences,
    branchControls,
    browserModeEnabled,
    activeSessionKey,
    setBrowserModeBySession,
    openWorkspaceDashboard,
    manualSessionTitles,
    openReferencedFile,
    setBrowserMode,
    openSettings: () => setSettingsOpen(true),
    feedMessages,
    feedPresentation,
    activeSessionNotices,
    isSessionInProgress,
    activeOptimisticOpencodePrompt,
    assistantLabel,
    messageFeedBottomClearance,
    composer,
    handleComposerChange,
    composerAttachments,
    removeAttachment,
    slashMenuOpen,
    filteredSlashCommands,
    slashSelectedIndex,
    insertSlashCommand,
    handleSlashKeyDown,
    addComposerAttachments,
    sendComposerPrompt: guardedSendComposerPrompt,
    abortActiveSession,
    isSendingPrompt,
    pickImageAttachment,
    hasPlanAgent,
    isPlanMode,
    togglePlanMode,
    effectiveComposerAgentOptions,
    selectedAgent,
    setSelectedAgent,
    sessionGuardrailPreferences: {
      enabled: appPreferences.sessionGuardrailsEnabled,
      tokenBudget: appPreferences.sessionTokenBudget,
      runtimeBudgetMinutes: appPreferences.sessionRuntimeBudgetMinutes,
    },
    compactionState: opencodeSessionControls.compactionState,
    guardrailState: opencodeSessionControls.guardrailState,
    guardrailPrompt: opencodeSessionControls.guardrailPrompt,
    dismissGuardrailWarning: opencodeSessionControls.dismissGuardrailWarning,
    continueGuardrailOnce: opencodeSessionControls.continueOnce,
    disableGuardrailsForSession: opencodeSessionControls.disableGuardrailsForSession,
    revertTargets: opencodeSessionControls.revertTargets,
    revertSessionChange: async targetId => {
      await opencodeSessionControls.revertTarget(targetId)
    },
    modelSelectOptions,
    selectedModel,
    setSelectedModel,
    selectedVariant,
    setSelectedVariant,
    variantOptions,
    composerPlaceholder,
    handleComposerLayoutHeightChange,
    handleDockHeightChange,
    visibleBackgroundAgents,
    selectedBackgroundAgentId,
    setSelectedBackgroundAgentId,
    handleArchiveBackgroundAgent,
    backgroundAgentDetail,
    backgroundAgentTaskText,
    selectedBackgroundAgentLoading,
    selectedBackgroundAgentError,
    activeTodoItems: activeTodoPresentation?.items,
    dockTodosOpen,
    setDockTodosOpen,
    dockPendingPermission,
    dockPendingQuestion,
    followupQueue,
    sendingQueuedId,
    queueFollowupMessage,
    runQueuedMessage: guardedRunQueuedMessage,
    editQueuedMessage,
    removeQueuedMessage,
    canShowIntegratedTerminal,
    terminalTabs,
    activeTerminalId,
    terminalOpen,
    terminalPanelHeight,
    createTerminal,
    closeTerminalTab,
    setActiveTerminalId,
    handleTerminalResizeStart,
  })
  const contentTopBarProps = buildContentTopBarProps({
    showProjectsPane,
    setProjectsSidebarVisible,
    showGitPane,
    setAppPreferences,
    browserSidebarOpen,
    setBrowserSidebarOpen,
    gitDiffStats,
    contentPaneTitle,
    activeProjectDir,
    projectData,
    terminalOpen,
    canShowIntegratedTerminal,
    toggleTerminal,
    titleMenuOpen,
    openMenuOpen,
    setOpenMenuOpen,
    commitMenuOpen,
    setCommitMenuOpen,
    setTitleMenuOpen,
    activeSessionID,
    activeSessionType,
    isActiveSessionPinned,
    togglePinSession,
    setStatusLine,
    activeSession,
    renameSession,
    archiveSession,
    openWorkspaceDashboard,
    copyProjectPath,
    copySessionID,
    activeOpenTarget,
    openTargets,
    selectOpenTarget,
    openDirectoryInTarget,
    openCommitModal,
    pendingPrUrl,
    openPendingPullRequest,
    commitNextStepOptions,
    setCommitNextStep,
    customRunCommands,
    upsertCustomRunCommand,
    runCustomRunCommand,
    deleteCustomRunCommand,
  })
  const workspaceSidebarProps = buildWorkspaceSidebarProps({
    sidebarMode,
    setSidebarMode,
    unreadJobRunsCount,
    availableUpdateVersion,
    isCheckingForUpdates,
    updateInstallPending,
    updateStatusMessage,
    checkForUpdates,
    downloadAndInstallUpdate,
    openWorkspaceDashboard,
    projectSortOpen,
    setProjectSortOpen,
    projectSortMode,
    setProjectSortMode,
    filteredProjects,
    activeProjectDir: sidebarActiveProjectDir,
    collapsedProjects,
    setCollapsedProjects,
    sessions,
    cachedSessionsByProject,
    hiddenSessionIDsByProject,
    pinnedSessions,
    activeSessionID: activeSessionID ?? undefined,
    setAllSessionsModalOpen,
    getSessionTitle,
    getSessionType,
    getSessionIndicator,
    selectProject,
    createSession,
    openClaudeSessionBrowser,
    openCodexSessionBrowser,
    openSession,
    togglePinSession,
    setStatusLine,
    archiveSession,
    openProjectContextMenu,
    openSessionContextMenu,
    addProjectDirectory: () => void addProjectDirectory(),
    setGlobalSearchModalOpen,
    setMemoryComingSoonOpen,
    setDebugModalOpen,
    setSettingsOpen,
  })
  const browserSidebarProps = {
    browserState: effectiveBrowserState,
    onBrowserOpenTab: browserOpenTab,
    onBrowserCloseTab: browserCloseTab,
    onBrowserNavigate: browserNavigate,
    onBrowserGoBack: browserGoBack,
    onBrowserGoForward: browserGoForward,
    onBrowserReload: browserReload,
    onBrowserSelectTab: browserSelectTab,
    onBrowserSelectHistory: browserSelectHistory,
    onBrowserReportViewportBounds: browserReportViewportBounds,
    onBrowserTakeControl: browserTakeControl,
    onBrowserHandBack: browserHandBack,
    onBrowserStop: browserStop,
    onStatusChange: setStatusLine,
    onSendAnnotations: (text: string) => setComposer(prev => (prev ? `${prev}\n\n${text}` : text)),
    mcpDevToolsState,
  }
  const gitSidebarProps = {
    sidebarPanelTab: rightSidebarTab,
    setSidebarPanelTab: setRightSidebarTab,
    gitPanelTab,
    setGitPanelTab,
    gitDiffViewMode,
    setGitDiffViewMode,
    gitPanelOutput,
    branchState,
    branchQuery,
    setBranchQuery,
    activeProjectDir: activeProjectDir ?? null,
    onLoadGitDiff: loadGitDiff,
    onLoadGitLog: loadGitLog,
    onLoadGitIssues: loadGitIssues,
    onLoadGitPrs: loadGitPrs,
    onStageAllChanges: stageAllChanges,
    onDiscardAllChanges: discardAllChanges,
    onStageFile: stageFile,
    onRestoreFile: restoreFile,
    onUnstageFile: unstageFile,
    fileProvenanceByPath: sessionProvenanceByPath,
    onAddToChatPath: appendPathToComposer,
    onStatusChange: setStatusLine,
  }

  return (
    <AppErrorBoundary
      onError={(error, info) => {
        reportRendererDiagnostic({
          level: 'error',
          source: 'renderer',
          category: 'renderer.error-boundary',
          message: error.message || 'Renderer subtree crashed',
          details: JSON.stringify({
            stack: error.stack,
            componentStack: info.componentStack,
          }),
        })
      }}
    >
      <Profiler id="AppCoreShell" onRender={perfProfiler('AppCoreShell')}>
        <div className="app-shell">
          <BackgroundSessionSupervisorHost
            sessions={backgroundSessionDescriptors}
            codexPath={appPreferences.codexPath}
            codexArgs={appPreferences.codexArgs}
          />
          <div className="window-drag-region" />
          {startupState.phase === 'running' ? (
            <section className="startup-overlay" aria-live="polite" role="status">
              <div className="startup-card">
                <h2>Initializing Orxa Code</h2>
                <p>{startupState.message}</p>
                <div className="startup-meter" aria-label="Startup progress">
                  <div
                    className="startup-meter-fill"
                    style={{ width: `${startupProgressPercent}%` }}
                  />
                </div>
                <small>{startupProgressPercent}%</small>
              </div>
            </section>
          ) : null}
          {hasProjectContext && !settingsOpen ? <ContentTopBar {...contentTopBarProps} /> : null}
          <div ref={workspaceRef} className={workspaceClassName} style={workspaceStyle}>
            <div
              className={`workspace-left-pane ${showProjectsPane ? 'open' : 'collapsed'}`.trim()}
            >
              <Profiler id="WorkspaceSidebar" onRender={perfProfiler('WorkspaceSidebar')}>
                <WorkspaceSidebar {...workspaceSidebarProps} />
              </Profiler>
            </div>
            <button
              type="button"
              className={`sidebar-resizer sidebar-resizer-left ${showProjectsPane ? '' : 'is-collapsed'}`.trim()}
              aria-label="Resize workspaces sidebar"
              onMouseDown={event => startSidebarResize('left', event)}
              disabled={!showProjectsPane}
            />

            <main
              className={`content-pane ${activeProjectDir ? '' : 'content-pane-dashboard'}`.trim()}
            >
              <Profiler id="AppSessionContent" onRender={perfProfiler('AppSessionContent')}>
                <AppSessionContent {...appSessionContentProps} />
              </Profiler>
              {toasts.length > 0 ? (
                <div
                  className="composer-toast-stack"
                  style={composerToastStyle}
                  role="status"
                  aria-live="polite"
                >
                  {toasts.map(toast => (
                    <article key={toast.id} className={`composer-toast ${toast.tone}`.trim()}>
                      <p>{toast.message}</p>
                      <button
                        type="button"
                        onClick={() => dismissToast(toast.id)}
                        aria-label="Dismiss notification"
                      >
                        ×
                      </button>
                    </article>
                  ))}
                </div>
              ) : null}
            </main>
            <Profiler id="AppSidePanes" onRender={perfProfiler('AppSidePanes')}>
              <AppSidePanes
                hasProjectContext={hasProjectContext}
                browserSidebarOpen={browserSidebarOpen}
                showGitPane={showGitPane}
                startSidebarResize={startSidebarResize}
                setBrowserSidebarOpen={setBrowserSidebarOpen}
                browserSidebarProps={browserSidebarProps}
                gitSidebarProps={gitSidebarProps}
              />
            </Profiler>
          </div>

          <AppTransientOverlays
            contextMenu={contextMenu}
            setContextMenu={setContextMenu}
            changeProjectDirectory={changeProjectDirectory}
            removeProjectDirectory={removeProjectDirectory}
            getSessionType={getSessionType}
            archiveSession={archiveSession}
            copySessionID={copySessionID}
            renameSession={renameSession}
            debugModalOpen={debugModalOpen}
            setDebugModalOpen={setDebugModalOpen}
            statusLine={statusLine}
            debugLogLevelFilter={debugLogLevelFilter}
            setDebugLogLevelFilter={setDebugLogLevelFilter}
            filteredDebugLogs={filteredDebugLogs}
            copyDebugLogsAsJson={copyDebugLogsAsJson}
            perfSummaryRows={perfSummaryRows}
            perfSummaryLoading={perfSummaryLoading}
            perfSummaryError={perfSummaryError}
            perfWindowMs={perfWindowMs}
            setPerfWindowMs={setPerfWindowMs}
            refreshPerfSummary={refreshPerfSummary}
            exportPerfSnapshotAsJson={exportPerfSnapshotAsJson}
            perfExportOptions={perfExportOptions}
            setPerfExportOptions={setPerfExportOptions}
            updateProgressState={updateProgressState}
            setUpdateProgressState={setUpdateProgressState}
          />

          <AppGlobalDialogs
            confirmDialogProps={{
              isOpen: Boolean(confirmDialogRequest),
              title: confirmDialogRequest?.title ?? 'Confirm',
              message: confirmDialogRequest?.message ?? 'Are you sure?',
              confirmLabel: confirmDialogRequest?.confirmLabel,
              cancelLabel: confirmDialogRequest?.cancelLabel,
              variant: confirmDialogRequest?.variant,
              onConfirm: () => closeConfirmDialog(true),
              onCancel: () => closeConfirmDialog(false),
            }}
            textInputDialogProps={{
              isOpen: Boolean(textInputDialog),
              title: textInputDialog?.title ?? '',
              placeholder: textInputDialog?.placeholder,
              defaultValue: textInputDialog?.defaultValue,
              confirmLabel: textInputDialog?.confirmLabel,
              cancelLabel: textInputDialog?.cancelLabel,
              validate: textInputDialog?.validate,
              onConfirm: submitTextInputDialog,
              onCancel: closeTextInputDialog,
            }}
            globalModalsProps={{
              activeProjectDir,
              workspaceDetailDirectory: workspaceDetailRoot,
              permissionMode: appPreferences.permissionMode,
              dependencyReport,
              dependencyModalOpen,
              setDependencyModalOpen,
              onCheckDependencies: refreshRuntimeDependencies,
              permissionRequest: pendingPermission ?? null,
              permissionDecisionInFlight: isPermissionDecisionInFlight,
              replyPermission: replyPendingPermission,
              questionRequest: pendingQuestion,
              replyQuestion: replyPendingQuestion,
              rejectQuestion: rejectPendingQuestion,
              allSessionsModalOpen,
              setAllSessionsModalOpen,
              claudeSessionBrowserOpen,
              setClaudeSessionBrowserOpen,
              codexSessionBrowserOpen,
              setCodexSessionBrowserOpen,
              claudeBrowserSessions,
              claudeBrowserSessionsLoading,
              codexBrowserThreads,
              codexBrowserThreadsLoading,
              selectedClaudeBrowserWorkspace,
              setSelectedClaudeBrowserWorkspace,
              selectedCodexBrowserWorkspace,
              setSelectedCodexBrowserWorkspace,
              openClaudeBrowserSession,
              openCodexBrowserThread,
              sessions: workspaceDetailSessions,
              workspaceWorktrees,
              workspaceWorktreesLoading,
              workspaceCodexThreads,
              selectedWorktreeDirectory,
              setSelectedWorktreeDirectory,
              createWorkspaceWorktree,
              openWorkspaceWorktree,
              deleteWorkspaceWorktree,
              launchSessionInWorktree,
              openWorkspaceCodexThread,
              getSessionStatusType,
              activeSessionID,
              openSession,
              projects,
              branchCreateModalOpen,
              setBranchCreateModalOpen,
              branchCreateName,
              setBranchCreateName,
              branchCreateError,
              setBranchCreateError,
              submitBranchCreate,
              branchSwitching,
              commitModalOpen,
              setCommitModalOpen,
              commitSummary,
              commitSummaryLoading,
              commitIncludeUnstaged,
              setCommitIncludeUnstaged,
              commitMessageDraft,
              setCommitMessageDraft,
              commitNextStepOptions,
              commitNextStep,
              setCommitNextStep,
              commitSubmitting,
              commitBaseBranch,
              setCommitBaseBranch,
              commitBaseBranchOptions,
              commitBaseBranchLoading: branchLoading,
              commitFlowState,
              dismissCommitFlowState,
              submitCommit,
              addProjectDirectory,
              skillUseModal,
              setSkillUseModal,
              applySkillToProject,
              profileModalOpen,
              setProfileModalOpen,
              profiles,
              runtime,
              ...profileActions,
            }}
            globalSearchProps={{
              open: globalSearchModalOpen,
              onClose: () => setGlobalSearchModalOpen(false),
              projects,
              projectSessions: allProjectSessions,
              getSessionTitle,
              getSessionType,
              openSession,
            }}
            settingsDrawerProps={{
              open: settingsOpen,
              directory: activeProjectDir,
              onClose: () => setSettingsOpen(false),
              onReadRaw: (scope, directory) => window.orxa.opencode.readRawConfig(scope, directory),
              onWriteRaw: async (scope, content, directory) => {
                const doc = await window.orxa.opencode.writeRawConfig(scope, content, directory)
                if (scope === 'global') {
                  await Promise.all([refreshConfigModels(), refreshGlobalProviders()])
                }
                if (directory) {
                  await refreshProject(directory)
                }
                setStatusLine('Raw config saved')
                return doc
              },
              onReadGlobalAgentsMd: () => window.orxa.opencode.readGlobalAgentsMd(),
              onWriteGlobalAgentsMd: async content => {
                const doc = await window.orxa.opencode.writeGlobalAgentsMd(content)
                setStatusLine('Global AGENTS.md saved')
                return doc
              },
              appPreferences,
              onAppPreferencesChange: setAppPreferences,
              onGetServerDiagnostics: () => window.orxa.opencode.getServerDiagnostics(),
              onRepairRuntime: () => window.orxa.opencode.repairRuntime(),
              onGetUpdatePreferences: () => window.orxa.updates.getPreferences(),
              onSetUpdatePreferences: input => window.orxa.updates.setPreferences(input),
              onCheckForUpdates: () => window.orxa.updates.checkNow(),
              allModelOptions: settingsModelOptions,
              profiles,
              runtime,
              onSaveProfile: async profile => {
                await window.orxa.runtime.saveProfile(profile)
                await refreshProfiles()
              },
              onDeleteProfile: async profileID => {
                await window.orxa.runtime.deleteProfile(profileID)
                await refreshProfiles()
              },
              onAttachProfile: async profileID => {
                await window.orxa.runtime.attach(profileID)
                await refreshProfiles()
                await Promise.all([
                  refreshConfigModels(),
                  refreshGlobalProviders(),
                  refreshGlobalAgents(),
                  refreshAgentFiles(),
                ])
                await bootstrap()
              },
              onStartLocalProfile: async profileID => {
                await window.orxa.runtime.startLocal(profileID)
                await refreshProfiles()
                await Promise.all([
                  refreshConfigModels(),
                  refreshGlobalProviders(),
                  refreshGlobalAgents(),
                  refreshAgentFiles(),
                ])
                await bootstrap()
              },
              onStopLocalProfile: async () => {
                await window.orxa.runtime.stopLocal()
                await refreshProfiles()
                await Promise.all([
                  refreshConfigModels(),
                  refreshGlobalProviders(),
                  refreshGlobalAgents(),
                  refreshAgentFiles(),
                ])
              },
              onRefreshProfiles: refreshProfiles,
            }}
            infoDialogProps={{
              isOpen: memoryComingSoonOpen,
              title: 'Memory coming soon',
              message:
                'Workspace-scoped memory that lets your agents recall project context, decisions, and preferences across sessions. Coming soon.',
              dismissLabel: 'Close',
              onDismiss: () => setMemoryComingSoonOpen(false),
            }}
          />
        </div>
      </Profiler>
    </AppErrorBoundary>
  )
}
