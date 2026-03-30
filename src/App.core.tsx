import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { parse as parseJsonc } from 'jsonc-parser'
import { GitCommitHorizontal, Send, Upload } from 'lucide-react'
import type {
  AgentsDocument,
  ChangeProvenanceRecord,
  OpenCodeAgentFile,
  ProjectListItem,
  ClaudeChatHealthStatus,
  RuntimeProfile,
  RuntimeProfileInput,
  RuntimeDependencyReport,
  RuntimeState,
  SessionPermissionMode,
  SkillEntry,
  SessionMessageBundle,
  ProviderUsageStats,
  AppDiagnosticInput,
} from '@shared/ipc'
import type { Agent, ProviderListResponse, QuestionAnswer } from '@opencode-ai/sdk/v2/client'
import { CanvasPane } from './components/CanvasPane'
import { BackgroundSessionSupervisorHost } from './components/BackgroundSessionSupervisorHost'
import { WorkspaceLanding } from './components/WorkspaceLanding'
import { ClaudeChatPane } from './components/ClaudeChatPane'
import { ClaudeTerminalPane } from './components/ClaudeTerminalPane'
import { CodexPane } from './components/CodexPane'
import { ComposerPanel } from './components/ComposerPanel'
import type { AgentQuestion } from './components/chat/QuestionDock'
import { HomeDashboard } from './components/HomeDashboard'
import { BrowserSidebar } from './components/BrowserSidebar'
import {
  ContentTopBar,
  type CustomRunCommandInput,
  type CustomRunCommandPreset,
} from './components/ContentTopBar'
import { GlobalModalsHost } from './components/GlobalModalsHost'
import type { SkillPromptTarget } from './components/GlobalModalsHost'
import { GlobalSearchModal } from './components/GlobalSearchModal'
import { MessageFeed } from './components/MessageFeed'
import { UnifiedTimelineRowView } from './components/chat/UnifiedTimelineRow'
import { GitSidebar } from './components/GitSidebar'
import { SettingsDrawer } from './components/SettingsDrawer'
import { TerminalPanel } from './components/TerminalPanel'
import { KanbanBoard } from './components/KanbanBoard'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { WorkspaceSidebar } from './components/WorkspaceSidebar'
import { ConfirmDialog } from './components/ConfirmDialog'
import { InfoDialog } from './components/InfoDialog'
import { TextInputDialog } from './components/TextInputDialog'
import { SkillsBoard } from './components/SkillsBoard'
import { useAppShellCommitFlow } from './hooks/useAppShellCommitFlow'
import { useAppShellDialogs } from './hooks/useAppShellDialogs'
import { useAppShellSessionFeedNotices } from './hooks/useAppShellSessionFeedNotices'
import { useAppShellStartupFlow } from './hooks/useAppShellStartupFlow'
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
import { useAppCoreDiagnostics } from './app-core-debug'
import { useAppCoreBrowser } from './app-core-browser'
import { createSessionAction } from './app-core-session'
import { useAppCoreSidebarResize } from './app-core-sidebar-resize'
// TODO: streaming buffer removed — needs reimplementation at the message-part delta
// level rather than the presentation layer to avoid blocking tool calls and diffs
import { useBackgroundSessionDescriptors } from './hooks/useBackgroundSessionDescriptors'
import {
  clearPersistedClaudeChatState,
  getPersistedClaudeChatState,
} from './hooks/claude-chat-session-storage'
import { clearPersistedCodexState, getPersistedCodexState } from './hooks/codex-session-storage'
import {
  buildClaudeChatSessionStatus,
  buildClaudeSessionStatus,
  buildCodexSessionStatus,
  buildOpencodeSessionStatus,
  selectActiveComposerPresentation,
  selectActiveTaskListPresentation,
  selectPendingPermissionDockData,
  selectPendingQuestionDockData,
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
  listModelOptionsFromConfigReferences,
  mergeDiscoverableModelOptions,
  type ModelOption,
} from './lib/models'
import { preferredAgentForMode } from './lib/app-mode'
import { removePersistedValue } from './lib/persistence'
import { getSessionContextActions, resolveSessionCopyIdentifier } from './lib/session-context-menu'
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
import type { UnifiedBackgroundAgentSummary } from './lib/session-presentation'
import { extractReviewChangesFiles } from './lib/timeline-row-grouping'
import { buildWorkspaceSessionMetadataKey } from './lib/workspace-session-metadata'
import {
  LOCAL_PROVIDER_SESSIONS_KEY,
  createLocalProviderSessionRecord,
  isLocalProviderSessionType,
  mergeLocalProviderSessions,
  removeLocalProviderSessionRecord,
  renameLocalProviderSessionRecord,
  touchLocalProviderSessionRecord,
  upsertLocalProviderSessionRecord,
} from './lib/local-provider-sessions'
import { opencodeClient } from './lib/services/opencodeClient'
import type { AppPreferences } from '~/types/app'
import type { SessionType } from '~/types/canvas'
import { CODE_FONT_OPTIONS, UI_FONT_OPTIONS } from '~/types/app'

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
const MIN_TERMINAL_PANEL_HEIGHT = 120
const MAX_TERMINAL_PANEL_HEIGHT = 420

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
const DEFAULT_COMPACTION_THRESHOLD = 120_000
const MIN_COMPACTION_THRESHOLD = 24_000
const PERMISSION_REPLY_TIMEOUT_MS = 15_000
const BROWSER_MODE_BY_SESSION_KEY = 'orxa:browserModeBySession:v1'
const BROWSER_AUTOMATION_HALTED_BY_SESSION_KEY = 'orxa:browserAutomationHaltedBySession:v1'
const STARTUP_STEP_TIMEOUT_MS = 12_000

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

function splitCommandLines(commands: string) {
  return commands
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string) {
  let timeoutId: number | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId)
    }
  }
}

function tokenCountFromMessageInfo(info: SessionMessageBundle['info']) {
  if (info.role !== 'assistant') {
    return 0
  }
  const assistantInfo = info as SessionMessageBundle['info'] & {
    tokens?: {
      total?: number
      input?: number
      output?: number
      cache?: { read?: number; write?: number }
    }
  }
  const total = typeof assistantInfo.tokens?.total === 'number' ? assistantInfo.tokens.total : 0
  if (total > 0) {
    return total
  }
  const input = typeof assistantInfo.tokens?.input === 'number' ? assistantInfo.tokens.input : 0
  const output = typeof assistantInfo.tokens?.output === 'number' ? assistantInfo.tokens.output : 0
  const cacheRead =
    typeof assistantInfo.tokens?.cache?.read === 'number' ? assistantInfo.tokens.cache.read : 0
  const cacheWrite =
    typeof assistantInfo.tokens?.cache?.write === 'number' ? assistantInfo.tokens.cache.write : 0
  return input + output + cacheRead + cacheWrite
}

function buildCompactionMeterState(messages: SessionMessageBundle[]) {
  const compactionIndexes: number[] = []
  const compactionThresholdHints: number[] = []

  for (let index = 0; index < messages.length; index += 1) {
    const bundle = messages[index]
    if (!bundle.parts.some(part => part.type === 'compaction')) {
      continue
    }
    compactionIndexes.push(index)
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      const previousTokens = tokenCountFromMessageInfo(messages[previous]!.info)
      if (previousTokens > 0) {
        compactionThresholdHints.push(previousTokens)
        break
      }
    }
  }

  const lastCompactionIndex =
    compactionIndexes.length > 0 ? compactionIndexes[compactionIndexes.length - 1]! : -1
  let currentTokens = 0
  for (let index = messages.length - 1; index > lastCompactionIndex; index -= 1) {
    const tokens = tokenCountFromMessageInfo(messages[index]!.info)
    if (tokens > 0) {
      currentTokens = tokens
      break
    }
  }

  let threshold =
    compactionThresholdHints.length > 0
      ? compactionThresholdHints[compactionThresholdHints.length - 1]!
      : DEFAULT_COMPACTION_THRESHOLD
  threshold = Math.max(MIN_COMPACTION_THRESHOLD, threshold)
  if (currentTokens > threshold) {
    threshold = currentTokens
  }

  const progress = threshold > 0 ? Math.min(1, currentTokens / threshold) : 0
  const compacted =
    lastCompactionIndex >= 0 && currentTokens < Math.max(4_000, Math.round(threshold * 0.22))
  const hint = compacted
    ? 'Recent context compaction completed. The context window has been reset.'
    : `Estimated context usage before auto-compaction (${currentTokens.toLocaleString()} / ${threshold.toLocaleString()} tokens).`

  return { progress, hint, compacted }
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
    getSessionType,
    getSessionTitle,
    normalizePresentationProvider,
  } = useWorkspaceSessionMetadata()
  const [localProviderSessions, setLocalProviderSessions] = usePersistedState<
    Record<string, ReturnType<typeof createLocalProviderSessionRecord>>
  >(LOCAL_PROVIDER_SESSIONS_KEY, {})
  const mergeProjectDataWithLocalSessions = useCallback(
    (project: Parameters<typeof mergeLocalProviderSessions>[0]) =>
      mergeLocalProviderSessions(project, localProviderSessions, getSessionType),
    [getSessionType, localProviderSessions]
  )
  const cleanupWorkspaceSession = useCallback(
    (directory: string, sessionID: string) => {
      const sessionType = getSessionType(sessionID, directory)
      cleanupEmptySession(directory, sessionID)
      if (isLocalProviderSessionType(sessionType)) {
        setLocalProviderSessions(prev =>
          removeLocalProviderSessionRecord(prev, directory, sessionID)
        )
      }
    },
    [cleanupEmptySession, getSessionType, setLocalProviderSessions]
  )
  const shouldDeleteRemoteEmptySession = useCallback(
    (directory: string, sessionID: string) =>
      !isLocalProviderSessionType(getSessionType(sessionID, directory)),
    [getSessionType]
  )
  const shouldSkipRuntimeSessionLoad = useCallback(
    (directory: string, sessionID: string) =>
      isLocalProviderSessionType(getSessionType(sessionID, directory)),
    [getSessionType]
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
    applyOpencodeStreamEvent,
    queueRefresh,
    startResponsePolling,
    stopResponsePolling,
    togglePinSession,
    openProjectContextMenu,
    openSessionContextMenu,
    markSessionUsed,
    trackEmptySession,
    cleanupPersistedEmptySessions,
  } = useWorkspaceState({
    setStatusLine,
    terminalTabIds: terminalTabs.map(t => t.id),
    setTerminalTabs,
    setActiveTerminalId,
    setTerminalOpen,
    scheduleGitRefresh: delayMs => scheduleGitRefreshRef.current?.(delayMs),
    onCleanupEmptySession: cleanupWorkspaceSession,
    mergeProjectData: mergeProjectDataWithLocalSessions,
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
  const sessionReadTimestamps = useUnifiedRuntimeStore(state => state.sessionReadTimestamps)
  const workspaceMetaByDirectory = useUnifiedRuntimeStore(state => state.workspaceMetaByDirectory)
  const codexSessionStateMap = useUnifiedRuntimeStore(state => state.codexSessions)
  const setOpencodeMessages = useUnifiedRuntimeStore(state => state.setOpencodeMessages)
  const opencodeSessionStateMap = useUnifiedRuntimeStore(state => state.opencodeSessions)
  const claudeChatSessionStateMap = useUnifiedRuntimeStore(state => state.claudeChatSessions)
  const claudeSessionStateMap = useUnifiedRuntimeStore(state => state.claudeSessions)
  const projectDataByDirectory = useUnifiedRuntimeStore(state => state.projectDataByDirectory)
  const setSessionReadAt = useUnifiedRuntimeStore(state => state.setSessionReadAt)
  const clearSessionReadAt = useUnifiedRuntimeStore(state => state.clearSessionReadAt)
  const removeClaudeSession = useUnifiedRuntimeStore(state => state.removeClaudeSession)
  const removeClaudeChatSession = useUnifiedRuntimeStore(state => state.removeClaudeChatSession)
  const setProjectDataForDirectory = useUnifiedRuntimeStore(state => state.setProjectData)
  const setWorkspaceMeta = useUnifiedRuntimeStore(state => state.setWorkspaceMeta)
  const initCodexSession = useUnifiedRuntimeStore(state => state.initCodexSession)
  const setCodexThread = useUnifiedRuntimeStore(state => state.setCodexThread)
  const setCodexStreaming = useUnifiedRuntimeStore(state => state.setCodexStreaming)
  const replaceCodexMessages = useUnifiedRuntimeStore(state => state.replaceCodexMessages)
  const syncLocalProviderSessionsIntoProject = useCallback(
    (directory: string, nextRecords: typeof localProviderSessions) => {
      const state = useUnifiedRuntimeStore.getState()
      const cached = state.projectDataByDirectory[directory]
      if (!cached) {
        return
      }
      const merged = mergeLocalProviderSessions(cached, nextRecords, getSessionType)
      setProjectDataForDirectory(directory, merged)
      if (state.activeWorkspaceDirectory === directory) {
        setProjectData(merged)
      }
      const lastUpdated = merged.sessions.reduce(
        (max, session) => Math.max(max, session.time.updated),
        0
      )
      setWorkspaceMeta(directory, { lastUpdatedAt: lastUpdated })
    },
    [getSessionType, setProjectData, setProjectDataForDirectory, setWorkspaceMeta]
  )
  const registerLocalProviderSession = useCallback(
    (record: ReturnType<typeof createLocalProviderSessionRecord>) => {
      const next = upsertLocalProviderSessionRecord(localProviderSessions, record)
      setLocalProviderSessions(next)
      syncLocalProviderSessionsIntoProject(record.directory, next)
      return record
    },
    [localProviderSessions, setLocalProviderSessions, syncLocalProviderSessionsIntoProject]
  )
  const renameLocalProviderSession = useCallback(
    (directory: string, sessionID: string, title: string) => {
      const next = renameLocalProviderSessionRecord(
        localProviderSessions,
        directory,
        sessionID,
        title
      )
      setLocalProviderSessions(next)
      syncLocalProviderSessionsIntoProject(directory, next)
    },
    [localProviderSessions, setLocalProviderSessions, syncLocalProviderSessionsIntoProject]
  )
  const touchLocalProviderSession = useCallback(
    (directory: string, sessionID: string, updatedAt?: number) => {
      const next = touchLocalProviderSessionRecord(
        localProviderSessions,
        directory,
        sessionID,
        updatedAt
      )
      if (next === localProviderSessions) {
        return
      }
      setLocalProviderSessions(next)
      syncLocalProviderSessionsIntoProject(directory, next)
    },
    [localProviderSessions, setLocalProviderSessions, syncLocalProviderSessionsIntoProject]
  )
  useWorkspaceSessionMetadataMigration({
    projects,
    projectData: projectData ?? undefined,
    projectDataByDirectory,
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
  const [selectedBackgroundAgentId, setSelectedBackgroundAgentId] = useState<string | null>(null)
  const [archivedBackgroundAgentIds, setArchivedBackgroundAgentIds] = useState<
    Record<string, string[]>
  >({})
  const [hiddenBackgroundSessionIdsByProject, setHiddenBackgroundSessionIdsByProject] =
    usePersistedState<Record<string, string[]>>('orxa:hiddenBackgroundSessionIdsByProject:v1', {})
  const [selectedBackgroundAgentLoading, setSelectedBackgroundAgentLoading] = useState(false)
  const [selectedBackgroundAgentError, setSelectedBackgroundAgentError] = useState<string | null>(
    null
  )
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
  const activeClaudeSessionState =
    activeSessionType === 'claude' && activeSessionKey
      ? claudeSessionStateMap[activeSessionKey]
      : undefined
  const activeOptimisticOpencodePrompt = useMemo(
    () =>
      activeSessionType === 'standalone' && activeSessionKey
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

  useEffect(() => {
    scheduleGitRefreshRef.current = scheduleGitRefresh
  }, [scheduleGitRefresh])

  const {
    hiddenSessionIDsByProject,
    sessions,
    cachedSessionsByProject,
    getSessionStatusType,
    getSessionIndicator,
  } = useAppShellSessionCollections({
    projectData: projectData ?? undefined,
    projectDataByDirectory,
    activeProjectDir,
    activeSessionID: activeSessionID ?? undefined,
    projectCacheVersion,
    pinnedSessions,
    archivedBackgroundAgentIds,
    hiddenBackgroundSessionIdsByProject,
    getSessionType,
    normalizePresentationProvider,
  })

  const availableSlashCommands = useMemo(() => {
    return projectData?.commands ?? []
  }, [projectData?.commands])

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
  const authenticatedProviderIDs = useMemo(
    () => new Set(globalProviders.all.map(provider => provider.id)),
    [globalProviders]
  )
  const discoverableModelOptions = useMemo(
    () =>
      filterModelOptionsByProviderIDs(
        mergeDiscoverableModelOptions(configModelOptions, globalServerModelOptions),
        authenticatedProviderIDs
      ),
    [authenticatedProviderIDs, configModelOptions, globalServerModelOptions]
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
  const compactionMeter = useMemo(() => buildCompactionMeterState(messages), [messages])
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

  const refreshProfiles = useCallback(async () => {
    const [nextRuntime, nextProfiles] = await Promise.all([
      window.orxa.runtime.getState(),
      window.orxa.runtime.listProfiles(),
    ])
    setRuntime(nextRuntime)
    setProfiles(nextProfiles)
  }, [])

  const refreshConfigModels = useCallback(async () => {
    try {
      const globalDoc = await window.orxa.opencode.readRawConfig('global')
      const parsed = parseJsonc(globalDoc.content) as unknown
      setConfigModelOptions(listModelOptionsFromConfigReferences(parsed))
    } catch {
      setConfigModelOptions([])
    }
  }, [])

  const refreshGlobalProviders = useCallback(async () => {
    try {
      const providers = await window.orxa.opencode.listProviders()
      setGlobalProviders(providers)
    } catch {
      setGlobalProviders({ all: [], connected: [], default: {} })
    }
  }, [])

  const refreshGlobalAgents = useCallback(async () => {
    try {
      const agents = await window.orxa.opencode.listAgents()
      setGlobalAgents(agents)
    } catch {
      setGlobalAgents([])
    }
  }, [])

  const refreshAgentFiles = useCallback(async () => {
    try {
      const files = await window.orxa.opencode.listAgentFiles()
      setOpencodeAgentFiles(files)
    } catch {
      setOpencodeAgentFiles([])
    }
  }, [])

  const refreshRuntimeDependencies = useCallback(async () => {
    try {
      const report = await window.orxa.opencode.checkDependencies()
      setDependencyReport(report)
      setDependencyModalOpen(report.missingAny)
    } catch {
      setDependencyReport(null)
    }
  }, [])

  const bootstrap = useCallback(async () => {
    try {
      const result = await window.orxa.opencode.bootstrap()
      setProjects(result.projects)
      setRuntime(result.runtime)
      if (activeProjectDir && !result.projects.some(item => item.worktree === activeProjectDir)) {
        setStatusLine(`Workspace directory is no longer accessible: ${activeProjectDir}`)
        setActiveProjectDir(undefined)
        setProjectData(null)
        setActiveSessionID(undefined)
        setMessages([])
      }
      // Pre-load session data for all projects in background (for sidebar display).
      // Always refresh from the server even if we have cached data — the cache only
      // provides immediate sidebar display while the server starts up.
      for (const project of result.projects) {
        if (project.worktree === activeProjectDir) continue // Active project already loaded
        window.orxa.opencode
          .selectProject(project.worktree)
          .then(data => {
            setProjectDataForDirectory(project.worktree, data)
            setProjectCacheVersion(version => version + 1)
          })
          .catch(() => {
            /* non-fatal */
          })
      }
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error))
    }
  }, [
    activeProjectDir,
    setActiveProjectDir,
    setActiveSessionID,
    setMessages,
    setProjectData,
    setProjectDataForDirectory,
  ])

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
  const startupSteps = useMemo(
    () => [
      { message: 'Loading runtime profiles…', action: refreshProfiles },
      { message: 'Cleaning temporary sessions…', action: cleanupPersistedEmptySessions },
      { message: 'Bootstrapping workspaces…', action: bootstrap },
      { message: 'Loading model references…', action: refreshConfigModels },
      { message: 'Loading provider registry…', action: refreshGlobalProviders },
      { message: 'Loading agent registry…', action: refreshGlobalAgents },
      { message: 'Loading agent files…', action: refreshAgentFiles },
      { message: 'Checking runtime dependencies…', action: refreshRuntimeDependencies },
      { message: 'Syncing browser state…', action: syncBrowserSnapshot },
    ],
    [
      bootstrap,
      cleanupPersistedEmptySessions,
      refreshConfigModels,
      refreshGlobalAgents,
      refreshGlobalProviders,
      refreshAgentFiles,
      refreshProfiles,
      refreshRuntimeDependencies,
      syncBrowserSnapshot,
    ]
  )
  const handleStartupStepError = useCallback((error: unknown) => {
    setStatusLine(error instanceof Error ? error.message : String(error))
  }, [])
  const { startupState, startupProgressPercent } = useAppShellStartupFlow({
    initialMessage: 'Initializing Orxa Code…',
    totalSteps: startupSteps.length,
    stepTimeoutMs: STARTUP_STEP_TIMEOUT_MS,
    steps: startupSteps,
    onStepError: handleStartupStepError,
  })

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
    void Promise.all([refreshConfigModels(), refreshGlobalProviders(), refreshAgentFiles()]).catch(
      () => undefined
    )
  }, [refreshAgentFiles, refreshConfigModels, refreshGlobalProviders, settingsOpen])

  // Periodically refresh models/agents so the dropdown stays in sync
  // with external config changes without needing to open settings.
  useEffect(() => {
    const interval = window.setInterval(() => {
      void Promise.all([
        refreshConfigModels(),
        refreshGlobalProviders(),
        refreshAgentFiles(),
      ]).catch(() => undefined)
    }, 45_000)
    return () => window.clearInterval(interval)
  }, [refreshConfigModels, refreshGlobalProviders, refreshAgentFiles])

  // Also refresh when switching to a new active session
  const prevActiveSessionRef = useRef(activeSessionID)
  useEffect(() => {
    if (activeSessionID && activeSessionID !== prevActiveSessionRef.current) {
      void Promise.all([refreshConfigModels(), refreshGlobalProviders()]).catch(() => undefined)
    }
    prevActiveSessionRef.current = activeSessionID
  }, [activeSessionID, refreshConfigModels, refreshGlobalProviders])

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
      const preferredModelValue =
        savedModel ?? agentDef?.model ?? preferredModel ?? projectModel
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
    setBrowserRuntimeState,
    setBrowserHistoryItems,
    setBrowserActionRunning,
    setMcpDevToolsState,
    handleUpdaterTelemetry,
    bootstrap,
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

  const activeProject = useMemo(
    () => projects.find(item => item.worktree === activeProjectDir),
    [projects, activeProjectDir]
  )

  const filteredProjects = useMemo(() => {
    const query = projectSearchQuery.trim().toLowerCase()
    const filtered = projects.filter(project => {
      const name = (
        project.name ||
        project.worktree.split('/').at(-1) ||
        project.worktree
      ).toLowerCase()
      return query ? name.includes(query) : true
    })
    const withIndex = filtered.map((project, index) => ({ project, index }))
    withIndex.sort((left, right) => {
      const leftName =
        left.project.name || left.project.worktree.split('/').at(-1) || left.project.worktree
      const rightName =
        right.project.name || right.project.worktree.split('/').at(-1) || right.project.worktree
      if (projectSortMode === 'alpha-asc') {
        return leftName.localeCompare(rightName)
      }
      if (projectSortMode === 'alpha-desc') {
        return rightName.localeCompare(leftName)
      }
      if (projectSortMode === 'recent') {
        const leftTime = workspaceMetaByDirectory[left.project.worktree]?.lastOpenedAt ?? 0
        const rightTime = workspaceMetaByDirectory[right.project.worktree]?.lastOpenedAt ?? 0
        if (rightTime !== leftTime) {
          return rightTime - leftTime
        }
      }
      if (projectSortMode === 'updated') {
        const leftTime = workspaceMetaByDirectory[left.project.worktree]?.lastUpdatedAt ?? 0
        const rightTime = workspaceMetaByDirectory[right.project.worktree]?.lastUpdatedAt ?? 0
        if (rightTime !== leftTime) {
          return rightTime - leftTime
        }
      }
      return left.index - right.index
    })
    return withIndex.map(item => item.project)
  }, [projectSearchQuery, projectSortMode, projects, workspaceMetaByDirectory])

  const allProjectSessions = useMemo(() => {
    const map: Record<string, Array<{ id: string; title?: string; slug: string }>> = {}
    const allData = { ...projectDataByDirectory }
    if (projectData?.directory) {
      allData[projectData.directory] = projectData
    }
    for (const [directory, data] of Object.entries(allData)) {
      map[directory] = data.sessions.map(s => ({ id: s.id, title: s.title, slug: s.slug }))
    }
    return map
  }, [projectData, projectDataByDirectory])

  const setSessionReadTimestamp = useCallback(
    (directory: string, sessionID: string, nextReadAt: number) => {
      const sessionKey = buildWorkspaceSessionMetadataKey(directory, sessionID)
      setSessionReadAt(sessionKey, nextReadAt)
    },
    [setSessionReadAt]
  )

  useEffect(() => {
    const cachedProjects = { ...projectDataByDirectory }
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
        const existing = codexSessionStateMap[sessionKey]
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
    codexSessionStateMap,
    getSessionType,
    initCodexSession,
    projectCacheVersion,
    projectData,
    projectDataByDirectory,
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
          markSessionUsed,
          registerLocalProviderSession,
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
          trackEmptySession,
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
      markSessionUsed,
      registerLocalProviderSession,
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
      trackEmptySession,
    ]
  )

  const addProjectDirectory = useCallback(
    async (options?: { select?: boolean }) => {
      try {
        const result = await opencodeClient.addProjectDirectory()
        if (!result) {
          return undefined
        }
        const directory = result.directory
        await bootstrap()
        if (options?.select !== false) {
          await selectProject(directory)
        }
        setStatusLine(`Workspace added: ${directory}`)
        return directory
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
        return undefined
      }
    },
    [bootstrap, selectProject]
  )

  const changeProjectDirectory = useCallback(
    async (directory: string, label: string) => {
      try {
        const nextDirectory = await addProjectDirectory()
        if (!nextDirectory) {
          return
        }
        if (nextDirectory === directory) {
          setStatusLine(`Workspace already points to ${nextDirectory}`)
          return
        }
        await opencodeClient.removeProjectDirectory(directory)
        await bootstrap()
        if (activeProjectDir === directory) {
          await selectProject(nextDirectory)
        }
        setStatusLine(`Updated workspace "${label}"`)
        pushToast(`Workspace path updated to ${nextDirectory}`, 'info', 4_000)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setStatusLine(message)
        pushToast(message, 'error')
      }
    },
    [activeProjectDir, addProjectDirectory, bootstrap, pushToast, selectProject, setStatusLine]
  )

  const loadSkills = useCallback(async () => {
    try {
      setSkillsLoading(true)
      setSkillsError(undefined)
      const entries = await window.orxa.opencode.listSkills()
      setSkills(entries)
    } catch (error) {
      setSkillsError(error instanceof Error ? error.message : String(error))
    } finally {
      setSkillsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (sidebarMode !== 'skills') {
      return
    }
    void loadSkills()
  }, [loadSkills, sidebarMode])

  const openSkillUseModal = useCallback(
    (skill: SkillEntry) => {
      setSkillUseModal({
        skill,
        projectDir: activeProjectDir ?? projects[0]?.worktree ?? '',
      })
    },
    [activeProjectDir, projects]
  )

  const applySkillToProject = useCallback(
    async (skill: SkillEntry, targetProjectDir: string, sessionTarget: SkillPromptTarget) => {
      try {
        const project = projects.find(item => item.worktree === targetProjectDir)
        if (!project) {
          setStatusLine('Select a valid workspace')
          return
        }
        const seedPrompt = [
          `Use skill: ${skill.name}`,
          '',
          skill.description,
          '',
          `Skill path: ${skill.path}`,
          '',
          'Apply this skill to the current task and ask clarifying questions if needed.',
        ].join('\n')

        await selectProject(targetProjectDir)
        const latest = await opencodeClient.refreshProject(targetProjectDir)
        setProjectData(latest)

        let targetSessionID: string | null = null
        let usedCurrentSession = false
        if (
          sessionTarget === 'current' &&
          activeProjectDir === targetProjectDir &&
          activeSessionID
        ) {
          const currentSessionAvailable = latest.sessions.some(
            item => item.id === activeSessionID && !item.time.archived
          )
          if (currentSessionAvailable) {
            targetSessionID = activeSessionID
            usedCurrentSession = true
          }
        }

        if (!targetSessionID) {
          const created = await opencodeClient.createSession(
            targetProjectDir,
            `Skill: ${skill.name}`
          )
          targetSessionID = created.id
          setMessages([])
        } else {
          const msgs = await opencodeClient
            .loadMessages(targetProjectDir, targetSessionID)
            .catch(() => [])
          setOpencodeMessages(targetProjectDir, targetSessionID, msgs)
        }

        setActiveSessionID(targetSessionID)
        setComposer(seedPrompt)
        setSidebarMode('projects')
        setSkillUseModal(null)
        const projectLabel = project.name || project.worktree.split('/').at(-1) || project.worktree
        const targetLabel = usedCurrentSession ? 'current session' : 'new session'
        setStatusLine(`Prepared skill prompt for ${projectLabel} (${targetLabel})`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setStatusLine(message)
        pushToast(message, 'warning')
      }
    },
    [
      activeProjectDir,
      activeSessionID,
      projects,
      pushToast,
      selectProject,
      setActiveSessionID,
      setComposer,
      setMessages,
      setOpencodeMessages,
      setProjectData,
      setSidebarMode,
    ]
  )

  useEffect(() => {
    if (!projectSearchOpen) {
      return
    }
    projectSearchInputRef.current?.focus()
  }, [projectSearchOpen])

  useEffect(() => {
    setAllSessionsModalOpen(false)
  }, [activeProjectDir])

  const removeProjectDirectory = useCallback(
    async (directory: string, label: string) => {
      try {
        const confirmed = await requestConfirmation({
          title: 'Remove workspace',
          message: `Remove "${label}" from Orxa Code workspace list?`,
          confirmLabel: 'Remove',
          cancelLabel: 'Cancel',
          variant: 'danger',
        })
        if (!confirmed) {
          return
        }
        await opencodeClient.removeProjectDirectory(directory)
        if (activeProjectDir === directory) {
          setActiveProjectDir(undefined)
          setProjectData(null)
          setActiveSessionID(undefined)
          setMessages([])
          setTerminalTabs([])
          setActiveTerminalId(undefined)
          setTerminalOpen(false)
        }
        await bootstrap()
        setStatusLine(`Removed workspace: ${label}`)
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
      }
    },
    [
      activeProjectDir,
      bootstrap,
      requestConfirmation,
      setActiveProjectDir,
      setActiveSessionID,
      setMessages,
      setProjectData,
    ]
  )

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
            if (sessionType === 'standalone') {
              await window.orxa.opencode.renameSession(directory, sessionID, nextTitle)
              await refreshProject(directory)
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
            if (isLocalProviderSessionType(sessionType)) {
              renameLocalProviderSession(directory, sessionID, nextTitle)
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
      getSessionType,
      refreshProject,
      renameLocalProviderSession,
      setManualSessionTitles,
      setSessionTitles,
      setTextInputDialog,
    ]
  )

  const removeSessionFromLocalProjectCache = useCallback(
    (directory: string, sessionID: string) => {
      const cachedProject = projectDataByDirectory[directory]
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
    [activeProjectDir, projectDataByDirectory, setProjectData, setProjectDataForDirectory]
  )

  const archiveSession = useCallback(
    async (directory: string, sessionID: string) => {
      try {
        const sessionKey = buildWorkspaceSessionMetadataKey(directory, sessionID)
        const archivedSessionType = getSessionType(sessionID, directory)
        const isArchivedSessionActive =
          activeProjectDir === directory && activeSessionID === sessionID
        const localProviderSession = isLocalProviderSessionType(archivedSessionType)
        if (!localProviderSession) {
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
        if (archivedSessionType === 'codex') {
          const codexThreadId = selectCodexSessionRuntime(sessionKey)?.thread?.id
          if (codexThreadId) {
            await window.orxa.codex.archiveThreadTree(codexThreadId)
          }
          clearPersistedCodexState(sessionKey)
        } else if (archivedSessionType === 'claude-chat') {
          await window.orxa.claudeChat.archiveSession(sessionKey)
          clearPersistedClaudeChatState(sessionKey)
          removeClaudeChatSession(sessionKey)
        } else if (archivedSessionType === 'claude') {
          removeClaudeSession(sessionKey)
        }
        let nextLocalProviderSessions = localProviderSessions
        if (localProviderSession) {
          nextLocalProviderSessions = removeLocalProviderSessionRecord(
            localProviderSessions,
            directory,
            sessionID
          )
          setLocalProviderSessions(nextLocalProviderSessions)
          syncLocalProviderSessionsIntoProject(directory, nextLocalProviderSessions)
        }
        clearSessionReadAt(sessionKey)
        clearSessionMetadata(sessionKey)
        removeSessionFromLocalProjectCache(directory, sessionID)
        if (isArchivedSessionActive) {
          clearPendingSession()
          await selectProject(directory)
        } else if (!localProviderSession) {
          void refreshProject(directory).catch(() => undefined)
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
      localProviderSessions,
      refreshProject,
      selectProject,
      setLocalProviderSessions,
      removeClaudeChatSession,
      removeClaudeSession,
      removeSessionFromLocalProjectCache,
      syncLocalProviderSessionsIntoProject,
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

  const copyProjectPath = useCallback(async (directory: string) => {
    try {
      await navigator.clipboard.writeText(directory)
      setStatusLine('Workspace path copied')
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const createWorktreeSession = useCallback(
    (directory: string, sessionID: string, currentTitle: string) => {
      const suggested = currentTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32)
      setTextInputDialog({
        title: 'New worktree name',
        defaultValue: suggested || 'feature',
        placeholder: 'feature/my-worktree',
        confirmLabel: 'Create',
        validate: value => {
          if (!value.trim()) {
            return 'Worktree name is required'
          }
          return null
        },
        onConfirm: async value => {
          const nameInput = value.trim()
          if (!nameInput) {
            return
          }

          try {
            const result = await window.orxa.opencode.createWorktreeSession(
              directory,
              sessionID,
              nameInput || undefined
            )
            await bootstrap()
            await selectProject(result.worktree.directory)
            setActiveSessionID(result.session.id)
            setStatusLine(`Worktree session created: ${result.worktree.name}`)
          } catch (error) {
            setStatusLine(error instanceof Error ? error.message : String(error))
          }
        },
      })
    },
    [bootstrap, selectProject, setActiveSessionID, setTextInputDialog]
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
  const activeUnifiedSessionStatus = useMemo(() => {
    void activeClaudeSessionState
    void codexSessionStateMap
    void claudeChatSessionStateMap
    void claudeSessionStateMap
    void opencodeSessionStateMap
    void sessionReadTimestamps
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
    activeClaudeSessionState,
    activeProjectDir,
    activeSessionID,
    activeSessionKey,
    activeSessionType,
    claudeChatSessionStateMap,
    claudeSessionStateMap,
    codexSessionStateMap,
    opencodeSessionStateMap,
    sessionReadTimestamps,
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
  const activeReviewChangesFiles = useMemo(
    () => extractReviewChangesFiles(activeSessionPresentation?.rows ?? []),
    [activeSessionPresentation]
  )
  const showReviewChangesDrawer = Boolean(
    activeTodoPresentation?.items.length &&
    activeTodoPresentation.items.every(item => item.status === 'completed') &&
    activeReviewChangesFiles.length > 0
  )
  const cachedProjects = useMemo(() => {
    const next = { ...projectDataByDirectory }
    if (projectData?.directory) {
      next[projectData.directory] = projectData
    }
    return next
  }, [projectData, projectDataByDirectory])
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
  useEffect(() => {
    const refreshBackgroundProjects = () => {
      const directories = Object.keys(cachedProjects).filter(
        directory => directory !== activeProjectDir
      )
      for (const directory of directories) {
        void refreshProject(directory, true).catch(error => {
          reportRendererDiagnostic({
            level: 'warn',
            source: 'renderer',
            category: 'background.refresh-project',
            message: `Failed to refresh background workspace ${directory}`,
            details: error instanceof Error ? (error.stack ?? error.message) : String(error),
          })
        })
      }
    }
    const onResume = () => {
      if (document.visibilityState === 'hidden') {
        return
      }
      refreshBackgroundProjects()
    }
    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('focus', onResume)
    window.addEventListener('pageshow', onResume)
    return () => {
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('focus', onResume)
      window.removeEventListener('pageshow', onResume)
    }
  }, [activeProjectDir, cachedProjects, refreshProject, reportRendererDiagnostic])
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
  const pendingPermission = useMemo(
    () => (projectData?.permissions ?? [])[0],
    [projectData?.permissions]
  )
  const isPermissionDecisionInFlight = Boolean(
    pendingPermission &&
    permissionDecisionPending !== null &&
    permissionDecisionPendingRequestID === pendingPermission.id
  )

  useEffect(() => {
    if (!permissionDecisionPending) {
      if (permissionDecisionPendingRequestID !== null) {
        setPermissionDecisionPendingRequestID(null)
      }
      return
    }
    if (!pendingPermission || permissionDecisionPendingRequestID !== pendingPermission.id) {
      setPermissionDecisionPending(null)
      setPermissionDecisionPendingRequestID(null)
    }
  }, [pendingPermission, permissionDecisionPending, permissionDecisionPendingRequestID])

  useEffect(() => {
    if (appPreferences.permissionMode !== 'yolo-write') {
      return
    }
    if (!activeProjectDir || !pendingPermission || isPermissionDecisionInFlight) {
      return
    }
    let cancelled = false
    void (async () => {
      try {
        setPermissionDecisionPending('once')
        setPermissionDecisionPendingRequestID(pendingPermission.id)
        await window.orxa.opencode.replyPermission(
          activeProjectDir,
          pendingPermission.id,
          'once',
          'Auto-approved in Yolo mode'
        )
        if (!cancelled) {
          await refreshProject(activeProjectDir)
        }
      } catch (error) {
        if (!cancelled) {
          setStatusLine(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (!cancelled) {
          setPermissionDecisionPending(null)
          setPermissionDecisionPendingRequestID(null)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    activeProjectDir,
    appPreferences.permissionMode,
    isPermissionDecisionInFlight,
    pendingPermission,
    permissionDecisionPendingRequestID,
    refreshProject,
    setStatusLine,
  ])
  const pendingQuestion = useMemo(() => {
    const q = (projectData?.questions ?? [])[0] ?? null
    // Only show questions for the active session
    if (q && activeSessionID && q.sessionID && q.sessionID !== activeSessionID) return null
    return q
  }, [projectData?.questions, activeSessionID])
  const selectedBackgroundAgent = useMemo<UnifiedBackgroundAgentSummary | null>(
    () => visibleBackgroundAgents.find(agent => agent.id === selectedBackgroundAgentId) ?? null,
    [selectedBackgroundAgentId, visibleBackgroundAgents]
  )
  const selectedBackgroundAgentSessionID =
    selectedBackgroundAgent?.provider === 'opencode'
      ? (selectedBackgroundAgent.sessionID ?? null)
      : null
  const selectedBackgroundAgentPrompt =
    selectedBackgroundAgent?.provider === 'opencode'
      ? (selectedBackgroundAgent.prompt ?? null)
      : null

  useEffect(() => {
    if (selectedBackgroundAgentId && !selectedBackgroundAgent) {
      setSelectedBackgroundAgentId(null)
    }
  }, [selectedBackgroundAgent, selectedBackgroundAgentId])

  useEffect(() => {
    if (!selectedBackgroundAgentSessionID || !activeProjectDir) {
      setSelectedBackgroundAgentLoading(false)
      setSelectedBackgroundAgentError(null)
      return
    }
    const bridge = window.orxa?.opencode
    if (!bridge?.loadMessages) {
      setSelectedBackgroundAgentLoading(false)
      setSelectedBackgroundAgentError(null)
      return
    }
    let cancelled = false
    let timer: number | null = null
    const load = async (showLoading = false) => {
      if (cancelled) {
        return
      }
      if (showLoading) {
        setSelectedBackgroundAgentLoading(true)
      }
      try {
        const bundles = await bridge.loadMessages(
          activeProjectDir,
          selectedBackgroundAgentSessionID
        )
        if (cancelled) {
          return
        }
        setOpencodeMessages(activeProjectDir, selectedBackgroundAgentSessionID, bundles)
        setSelectedBackgroundAgentError(null)
      } catch (error) {
        if (!cancelled) {
          setSelectedBackgroundAgentError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (!cancelled && showLoading) {
          setSelectedBackgroundAgentLoading(false)
        }
      }
    }

    void load(true)
    timer = window.setInterval(() => {
      void load(false)
    }, 1300)

    return () => {
      cancelled = true
      if (timer !== null) {
        window.clearInterval(timer)
      }
    }
  }, [activeProjectDir, selectedBackgroundAgentSessionID, setOpencodeMessages])

  const backgroundAgentDetail = useMemo<ReactNode>(() => {
    if (!selectedBackgroundAgent || selectedBackgroundAgent.provider !== 'opencode') {
      return null
    }
    const projected =
      activeProjectDir && selectedBackgroundAgentSessionID
        ? selectSessionPresentation({
            provider: 'opencode',
            directory: activeProjectDir,
            sessionID: selectedBackgroundAgentSessionID,
            assistantLabel: selectedBackgroundAgent.name,
          })
        : null
    if (!projected || projected.rows.length === 0) {
      return null
    }
    const normalizeTranscriptText = (value: string) => value.replace(/\s+/g, ' ').trim()
    const normalizedPrompt = selectedBackgroundAgentPrompt
      ? normalizeTranscriptText(selectedBackgroundAgentPrompt)
      : null
    let taskRowConsumed = false
    const filteredRows = projected.rows.filter(row => {
      if (row.kind !== 'message' || row.role !== 'user') {
        return true
      }
      const rowText = normalizeTranscriptText(
        row.sections
          .filter(
            (section): section is Extract<(typeof row.sections)[number], { type: 'text' }> =>
              section.type === 'text'
          )
          .map(section => section.content)
          .join('\n')
      )
      if (normalizedPrompt && rowText === normalizedPrompt) {
        return false
      }
      if (!taskRowConsumed) {
        taskRowConsumed = true
        return false
      }
      return true
    })
    if (filteredRows.length === 0) {
      return null
    }
    return (
      <div className="agent-dock-detail-transcript">
        {filteredRows.map(row => (
          <UnifiedTimelineRowView
            key={row.id}
            row={row}
            onOpenFileReference={reference => void openReferencedFile(reference)}
          />
        ))}
      </div>
    )
  }, [
    activeProjectDir,
    openReferencedFile,
    selectedBackgroundAgent,
    selectedBackgroundAgentPrompt,
    selectedBackgroundAgentSessionID,
  ])
  const backgroundAgentTaskText = useMemo(() => {
    if (!selectedBackgroundAgent || selectedBackgroundAgent.provider !== 'opencode') {
      return null
    }
    const projected =
      activeProjectDir && selectedBackgroundAgentSessionID
        ? selectSessionPresentation({
            provider: 'opencode',
            directory: activeProjectDir,
            sessionID: selectedBackgroundAgentSessionID,
            assistantLabel: selectedBackgroundAgent.name,
          })
        : null
    if (!projected) {
      return null
    }
    const normalizeTranscriptText = (value: string) => value.replace(/\s+/g, ' ').trim()
    const normalizedPrompt = selectedBackgroundAgentPrompt
      ? normalizeTranscriptText(selectedBackgroundAgentPrompt)
      : null
    const firstUserRow = projected.rows.find(row => row.kind === 'message' && row.role === 'user')
    if (!firstUserRow || firstUserRow.kind !== 'message') {
      return null
    }
    const taskText = firstUserRow.sections
      .filter(
        (section): section is Extract<(typeof firstUserRow.sections)[number], { type: 'text' }> =>
          section.type === 'text'
      )
      .map(section => section.content)
      .join('\n')
      .trim()
    if (!taskText) {
      return null
    }
    return normalizedPrompt && normalizeTranscriptText(taskText) === normalizedPrompt
      ? null
      : taskText
  }, [
    activeProjectDir,
    selectedBackgroundAgent,
    selectedBackgroundAgentPrompt,
    selectedBackgroundAgentSessionID,
  ])

  // Hide BrowserView when permission/question modals are open
  useEffect(() => {
    if (pendingPermission || pendingQuestion) {
      void window.orxa.browser.setVisible(false).catch(() => {})
    }
  }, [pendingPermission, pendingQuestion])

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
    setSelectedBackgroundAgentId(null)
    setSelectedBackgroundAgentLoading(false)
    setSelectedBackgroundAgentError(null)
  }, [activeSessionID])

  useEffect(() => {
    if (!canShowIntegratedTerminal) {
      setTerminalOpen(false)
    }
  }, [canShowIntegratedTerminal])

  const createTerminalTab = useCallback(async (): Promise<string> => {
    if (!activeProjectDir) {
      throw new Error('No active workspace selected.')
    }

    const cwd = projectData?.path.directory ?? activeProjectDir
    const tabNum = terminalTabs.length + 1
    const pty = await window.orxa.terminal.create(activeProjectDir, cwd, `Tab ${tabNum}`)
    const newTab = { id: pty.id, label: `Tab ${tabNum}` }
    setTerminalTabs(prev => [...prev, newTab])
    setActiveTerminalId(pty.id)
    setTerminalOpen(true)
    return pty.id
  }, [activeProjectDir, projectData?.path.directory, terminalTabs.length])

  const createTerminal = useCallback(async () => {
    try {
      await createTerminalTab()
      setStatusLine('Terminal created')
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error))
    }
  }, [createTerminalTab])

  const toggleTerminal = useCallback(async () => {
    if (!canShowIntegratedTerminal) {
      return
    }
    if (terminalOpen) {
      setTerminalOpen(false)
      return
    }
    if (!activeProjectDir) {
      return
    }
    if (terminalTabs.length === 0) {
      await createTerminal()
      return
    }
    setTerminalOpen(true)
  }, [
    activeProjectDir,
    canShowIntegratedTerminal,
    createTerminal,
    terminalOpen,
    terminalTabs.length,
  ])

  const handleTerminalResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      terminalResizeStateRef.current = {
        startY: event.clientY,
        startHeight: terminalPanelHeight,
      }
    },
    [terminalPanelHeight]
  )

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const state = terminalResizeStateRef.current
      if (!state) {
        return
      }
      const deltaY = state.startY - event.clientY
      const nextHeight = Math.min(
        MAX_TERMINAL_PANEL_HEIGHT,
        Math.max(MIN_TERMINAL_PANEL_HEIGHT, state.startHeight + deltaY)
      )
      setTerminalPanelHeight(nextHeight)
    }

    const handleMouseUp = () => {
      terminalResizeStateRef.current = null
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  const upsertCustomRunCommand = useCallback(
    (input: CustomRunCommandInput): CustomRunCommandPreset => {
      const title = input.title.trim()
      const commands = input.commands.replace(/\r\n/g, '\n').trim()
      if (!title) {
        throw new Error('Name is required.')
      }
      if (!commands) {
        throw new Error('Add at least one command.')
      }

      const normalizedID = input.id?.trim()
      const next: CustomRunCommandPreset = {
        id:
          normalizedID && normalizedID.length > 0
            ? normalizedID
            : `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        commands,
        updatedAt: Date.now(),
      }
      setCustomRunCommands(current => {
        const remaining = current.filter(item => item.id !== next.id)
        return [next, ...remaining].sort((a, b) => b.updatedAt - a.updatedAt)
      })
      return next
    },
    [setCustomRunCommands]
  )

  const runCustomRunCommand = useCallback(
    async (preset: CustomRunCommandPreset) => {
      if (!activeProjectDir) {
        setStatusLine('Select a workspace before running commands.')
        return
      }
      const commandLines = splitCommandLines(preset.commands)
      if (commandLines.length === 0) {
        setStatusLine(`No commands found for ${preset.title}.`)
        return
      }

      let targetPtyID = activeTerminalId ?? terminalTabs[0]?.id
      try {
        if (!targetPtyID) {
          targetPtyID = await createTerminalTab()
        }

        if (activeTerminalId !== targetPtyID) {
          setActiveTerminalId(targetPtyID)
        }
        setTerminalOpen(true)
        await window.orxa.terminal.connect(activeProjectDir, targetPtyID)
        for (const command of commandLines) {
          await window.orxa.terminal.write(activeProjectDir, targetPtyID, `${command}\n`)
        }
        setStatusLine(
          `Ran ${commandLines.length} command${commandLines.length === 1 ? '' : 's'} from ${preset.title}.`
        )
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
      }
    },
    [activeProjectDir, activeTerminalId, createTerminalTab, terminalTabs]
  )

  const deleteCustomRunCommand = useCallback(
    (id: string) => {
      setCustomRunCommands(current => current.filter(item => item.id !== id))
      setStatusLine('Custom run command deleted.')
    },
    [setCustomRunCommands]
  )

  const closeTerminalTab = useCallback(
    async (ptyId: string) => {
      if (!activeProjectDir) return
      await window.orxa.terminal.close(activeProjectDir, ptyId).catch(() => undefined)
      setTerminalTabs(prev => {
        const remaining = prev.filter(t => t.id !== ptyId)
        if (activeTerminalId === ptyId) {
          setActiveTerminalId(remaining[remaining.length - 1]?.id)
        }
        if (remaining.length === 0) {
          setTerminalOpen(false)
        }
        return remaining
      })
    },
    [activeProjectDir, activeTerminalId]
  )

  const replyPendingPermission = useCallback(
    async (reply: 'once' | 'always' | 'reject') => {
      if (!activeProjectDir || !pendingPermission) {
        return
      }
      if (reply === 'reject' && appPreferences.confirmDangerousActions) {
        const confirmed = await requestConfirmation({
          title: 'Reject permission request',
          message: 'Reject this permission request?',
          confirmLabel: 'Reject',
          cancelLabel: 'Cancel',
          variant: 'danger',
        })
        if (!confirmed) {
          return
        }
      }
      try {
        if (reply === 'always') {
          setAppPreferences(current =>
            current.permissionMode === 'yolo-write'
              ? current
              : {
                  ...current,
                  permissionMode: 'yolo-write',
                }
          )
        }
        setPermissionDecisionPending(reply)
        setPermissionDecisionPendingRequestID(pendingPermission.id)
        await withTimeout(
          window.orxa.opencode.replyPermission(activeProjectDir, pendingPermission.id, reply),
          PERMISSION_REPLY_TIMEOUT_MS,
          'Permission response timed out. Please try again.'
        )
        await refreshProject(activeProjectDir)
        setStatusLine(`Permission ${reply === 'reject' ? 'rejected' : 'approved'}`)
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
      } finally {
        setPermissionDecisionPending(null)
        setPermissionDecisionPendingRequestID(null)
      }
    },
    [
      activeProjectDir,
      appPreferences.confirmDangerousActions,
      pendingPermission,
      refreshProject,
      requestConfirmation,
      setAppPreferences,
      setStatusLine,
    ]
  )

  const replyPendingQuestion = useCallback(
    async (answers: QuestionAnswer[]) => {
      if (!activeProjectDir || !pendingQuestion) {
        return
      }
      const normalized = answers.map(item =>
        item.map(value => value.trim()).filter(value => value.length > 0)
      )
      if (!normalized.some(item => item.length > 0)) {
        return
      }
      try {
        await window.orxa.opencode.replyQuestion(activeProjectDir, pendingQuestion.id, normalized)
        await refreshProject(activeProjectDir)
        setStatusLine('Question answered')
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
      }
    },
    [activeProjectDir, pendingQuestion, refreshProject]
  )

  const rejectPendingQuestion = useCallback(async () => {
    if (!activeProjectDir || !pendingQuestion) {
      return
    }
    if (appPreferences.confirmDangerousActions) {
      const confirmed = await requestConfirmation({
        title: 'Reject question request',
        message: 'Reject this question request?',
        confirmLabel: 'Reject',
        cancelLabel: 'Cancel',
        variant: 'danger',
      })
      if (!confirmed) {
        return
      }
    }
    try {
      await window.orxa.opencode.rejectQuestion(activeProjectDir, pendingQuestion.id)
      await refreshProject(activeProjectDir)
      setStatusLine('Question rejected')
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error))
    }
  }, [
    activeProjectDir,
    appPreferences.confirmDangerousActions,
    pendingQuestion,
    refreshProject,
    requestConfirmation,
  ])

  // --- Dock props for ComposerPanel ---

  const pendingPermissionData = selectPendingPermissionDockData({
    provider: normalizePresentationProvider(activeSessionType),
    directory: activeProjectDir,
    sessionID: activeSessionID,
    sessionKey: activeSessionKey ?? undefined,
    permissionMode: appPreferences.permissionMode,
  })

  const pendingQuestionData = selectPendingQuestionDockData({
    provider: normalizePresentationProvider(activeSessionType),
    directory: activeProjectDir,
    sessionID: activeSessionID,
    sessionKey: activeSessionKey ?? undefined,
  })

  const dockPendingPermission = useMemo(() => {
    if (!pendingPermissionData || isPermissionDecisionInFlight) {
      return null
    }
    return {
      description: pendingPermissionData.description,
      filePattern: pendingPermissionData.filePattern,
      command: pendingPermissionData.command,
      onDecide: (decision: 'allow_once' | 'allow_always' | 'reject') => {
        const replyMap: Record<string, 'once' | 'always' | 'reject'> = {
          allow_once: 'once',
          allow_always: 'always',
          reject: 'reject',
        }
        void replyPendingPermission(replyMap[decision])
      },
    }
  }, [isPermissionDecisionInFlight, pendingPermissionData, replyPendingPermission])

  const dockPendingQuestion = useMemo(() => {
    if (!pendingQuestionData) {
      return null
    }
    return {
      questions: pendingQuestionData.questions as AgentQuestion[],
      onSubmit: (answers: Record<string, string | string[]>) => {
        const ordered: QuestionAnswer[] = pendingQuestionData.questions.map(question => {
          const answer = answers[question.id]
          if (!answer) return [] as string[]
          if (Array.isArray(answer)) return answer
          return [answer]
        })
        void replyPendingQuestion(ordered)
      },
      onReject: () => {
        void rejectPendingQuestion()
      },
    }
  }, [pendingQuestionData, rejectPendingQuestion, replyPendingQuestion])

  // ── Desktop notifications (deduplicated) ──────────────────────────
  const prevSessionBusy = useRef(false)
  const lastOpenCodeNotifyRef = useRef<string | null>(null)

  useEffect(() => {
    if (appPreferences.permissionMode === 'yolo-write') return
    if (!appPreferences.notifyOnAwaitingInput || document.hasFocus()) return
    const key = dockPendingQuestion
      ? `question:${typeof dockPendingQuestion === 'object' && 'questions' in dockPendingQuestion ? dockPendingQuestion.questions?.[0]?.id : 'q'}`
      : dockPendingPermission
        ? `permission:${typeof dockPendingPermission === 'object' && 'description' in dockPendingPermission ? dockPendingPermission.description?.slice(0, 40) : 'p'}`
        : null
    if (!key || key === lastOpenCodeNotifyRef.current) return
    lastOpenCodeNotifyRef.current = key
    new Notification('Orxa Code', {
      body: dockPendingQuestion
        ? 'Agent is asking a question'
        : 'Agent needs permission to continue',
      silent: false,
    }).onclick = () => window.focus()
  }, [
    appPreferences.notifyOnAwaitingInput,
    appPreferences.permissionMode,
    dockPendingPermission,
    dockPendingQuestion,
  ])

  useEffect(() => {
    const isBusy = isSessionInProgress
    const wasBusy = prevSessionBusy.current
    prevSessionBusy.current = isBusy
    if (!appPreferences.notifyOnTaskComplete || document.hasFocus()) return
    if (wasBusy && !isBusy && activeSessionID) {
      new Notification('Orxa Code', {
        body: 'Agent has finished its task',
        silent: false,
      }).onclick = () => window.focus()
    }
  }, [isSessionInProgress, activeSessionID, appPreferences.notifyOnTaskComplete])

  // Auto-send first queued followup when session becomes idle
  const prevSessionBusyForQueue = useRef(false)
  useEffect(() => {
    const isBusy = isSessionInProgress
    const wasBusy = prevSessionBusyForQueue.current
    prevSessionBusyForQueue.current = isBusy
    if (wasBusy && !isBusy && followupQueue.length > 0 && !sendingQueuedId) {
      const first = followupQueue[0]
      if (first) {
        setSendingQueuedId(first.id)
        void sendPrompt({
          textOverride: first.text,
          attachmentOverride: first.attachments ?? [],
          systemAddendum: effectiveSystemAddendum,
          promptSource: 'user',
          tools: activePromptToolsPolicy,
        }).finally(() => {
          setSendingQueuedId(undefined)
        })
        setFollowupQueue(current => current.filter(m => m.id !== first.id))
      }
    }
  }, [
    isSessionInProgress,
    followupQueue.length,
    sendingQueuedId,
    sendPrompt,
    effectiveSystemAddendum,
    activePromptToolsPolicy,
    followupQueue,
  ])

  // Clear queue when active session changes
  useEffect(() => {
    setFollowupQueue([])
    setSendingQueuedId(undefined)
  }, [activeSessionID])

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
        {hasProjectContext && !settingsOpen ? (
          <ContentTopBar
            projectsPaneVisible={showProjectsPane}
            toggleProjectsPane={() => setProjectsSidebarVisible(!showProjectsPane)}
            showGitPane={showGitPane}
            setGitPaneVisible={visible =>
              setAppPreferences(current => ({
                ...current,
                showOperationsPane: visible,
              }))
            }
            browserSidebarOpen={browserSidebarOpen}
            toggleBrowserSidebar={() => setBrowserSidebarOpen(current => !current)}
            gitDiffStats={gitDiffStats}
            contentPaneTitle={contentPaneTitle}
            activeProjectDir={activeProjectDir ?? null}
            projectData={projectData}
            terminalOpen={terminalOpen}
            showTerminalToggle={canShowIntegratedTerminal}
            toggleTerminal={toggleTerminal}
            titleMenuOpen={titleMenuOpen}
            openMenuOpen={openMenuOpen}
            setOpenMenuOpen={setOpenMenuOpen}
            commitMenuOpen={commitMenuOpen}
            setCommitMenuOpen={setCommitMenuOpen}
            setTitleMenuOpen={setTitleMenuOpen}
            hasActiveSession={Boolean(activeSessionID)}
            isActiveSessionCanvasSession={activeSessionType === 'canvas'}
            activeSessionType={activeSessionType}
            isActiveSessionPinned={isActiveSessionPinned}
            onTogglePinSession={() => {
              if (!activeProjectDir || !activeSessionID) {
                return
              }
              const nextPinned = !isActiveSessionPinned
              togglePinSession(activeProjectDir, activeSessionID)
              setStatusLine(nextPinned ? 'Session pinned' : 'Session unpinned')
              setTitleMenuOpen(false)
            }}
            onRenameSession={() => {
              if (!activeProjectDir || !activeSessionID || !activeSession) {
                return
              }
              setTitleMenuOpen(false)
              void renameSession(
                activeProjectDir,
                activeSessionID,
                activeSession.title || activeSession.slug
              )
            }}
            onArchiveSession={() => {
              if (!activeProjectDir || !activeSessionID) {
                return
              }
              setTitleMenuOpen(false)
              void archiveSession(activeProjectDir, activeSessionID)
            }}
            onViewWorkspace={() => {
              setTitleMenuOpen(false)
              openWorkspaceDashboard()
            }}
            onCopyPath={() => {
              if (!activeProjectDir) {
                return
              }
              setTitleMenuOpen(false)
              void copyProjectPath(activeProjectDir)
            }}
            onCopySessionId={() => {
              if (!activeProjectDir || !activeSessionID) {
                return
              }
              setTitleMenuOpen(false)
              void copySessionID(activeProjectDir, activeSessionID)
            }}
            activeOpenTarget={activeOpenTarget}
            openTargets={openTargets}
            onSelectOpenTarget={selectOpenTarget}
            openDirectoryInTarget={openDirectoryInTarget}
            openCommitModal={openCommitModal}
            pendingPrUrl={pendingPrUrl}
            onOpenPendingPullRequest={openPendingPullRequest}
            commitNextStepOptions={commitNextStepOptions}
            setCommitNextStep={setCommitNextStep}
            customRunCommands={customRunCommands}
            onUpsertCustomRunCommand={upsertCustomRunCommand}
            onRunCustomRunCommand={runCustomRunCommand}
            onDeleteCustomRunCommand={deleteCustomRunCommand}
          />
        ) : null}
        <div ref={workspaceRef} className={workspaceClassName} style={workspaceStyle}>
          <div className={`workspace-left-pane ${showProjectsPane ? 'open' : 'collapsed'}`.trim()}>
            <WorkspaceSidebar
              sidebarMode={sidebarMode}
              setSidebarMode={setSidebarMode}
              unreadJobRunsCount={unreadJobRunsCount}
              updateAvailableVersion={availableUpdateVersion}
              isCheckingForUpdates={isCheckingForUpdates}
              updateInstallPending={updateInstallPending}
              updateStatusMessage={updateStatusMessage}
              onCheckForUpdates={checkForUpdates}
              onDownloadAndInstallUpdate={downloadAndInstallUpdate}
              openWorkspaceDashboard={openWorkspaceDashboard}
              projectSortOpen={projectSortOpen}
              setProjectSortOpen={setProjectSortOpen}
              projectSortMode={projectSortMode}
              setProjectSortMode={setProjectSortMode}
              filteredProjects={filteredProjects}
              activeProjectDir={activeProjectDir}
              collapsedProjects={collapsedProjects}
              setCollapsedProjects={setCollapsedProjects}
              sessions={sessions}
              cachedSessionsByProject={cachedSessionsByProject}
              hiddenSessionIDsByProject={hiddenSessionIDsByProject}
              pinnedSessionsByProject={pinnedSessions}
              activeSessionID={activeSessionID ?? undefined}
              setAllSessionsModalOpen={setAllSessionsModalOpen}
              getSessionTitle={getSessionTitle}
              getSessionType={getSessionType}
              getSessionIndicator={getSessionIndicator}
              selectProject={selectProject}
              createSession={createSession}
              openSession={openSession}
              togglePinSession={(directory, sessionID) => {
                togglePinSession(directory, sessionID)
                const isPinned = (pinnedSessions[directory] ?? []).includes(sessionID)
                setStatusLine(isPinned ? 'Session unpinned' : 'Session pinned')
              }}
              archiveSession={archiveSession}
              openProjectContextMenu={openProjectContextMenu}
              openSessionContextMenu={openSessionContextMenu}
              addProjectDirectory={() => addProjectDirectory()}
              onOpenSearchModal={() => setGlobalSearchModalOpen(true)}
              onOpenMemoryModal={() => setMemoryComingSoonOpen(true)}
              onOpenDebugLogs={() => setDebugModalOpen(true)}
              setSettingsOpen={setSettingsOpen}
            />
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
            {sidebarMode === 'kanban' ? (
              <KanbanBoard />
            ) : sidebarMode === 'skills' ? (
              <SkillsBoard
                skills={skills}
                loading={skillsLoading}
                error={skillsError}
                onRefresh={() => void loadSkills()}
                onUseSkill={openSkillUseModal}
              />
            ) : activeProjectDir ? (
              <Fragment>
                {!activeSessionID ? (
                  pendingSessionId ? (
                    <div className="workspace-session-transition" aria-live="polite">
                      Opening session...
                    </div>
                  ) : (
                    <WorkspaceLanding
                      workspaceName={activeProjectDir.split('/').pop() ?? activeProjectDir}
                      onPickSession={type => void createSession(activeProjectDir, type)}
                    />
                  )
                ) : activeSessionType === 'canvas' ? (
                  <CanvasPane
                    canvasState={canvasState}
                    directory={activeProjectDir}
                    mcpDevToolsState={mcpDevToolsState}
                  />
                ) : activeSessionType === 'claude-chat' ? (
                  <ClaudeChatPane
                    directory={activeProjectDir}
                    sessionStorageKey={
                      activeSessionKey ??
                      buildWorkspaceSessionMetadataKey(activeProjectDir, activeSessionID)
                    }
                    onFirstMessage={() => {
                      if (!activeSessionID) {
                        return
                      }
                      markSessionUsed(activeSessionID)
                      touchLocalProviderSession(activeProjectDir, activeSessionID)
                    }}
                    onTitleChange={title => {
                      if (!activeSessionID || !activeProjectDir) {
                        return
                      }
                      const scopedSessionKey = buildWorkspaceSessionMetadataKey(
                        activeProjectDir,
                        activeSessionID
                      )
                      if (!title.trim() || looksAutoGeneratedSessionTitle(title)) {
                        return
                      }
                      if (manualSessionTitles[scopedSessionKey]) {
                        return
                      }
                      setSessionTitles(prev => {
                        const currentTitle = prev[scopedSessionKey]
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
                      renameLocalProviderSession(activeProjectDir, activeSessionID, title)
                    }}
                    permissionMode={appPreferences.permissionMode}
                    onPermissionModeChange={mode =>
                      setAppPreferences({ ...appPreferences, permissionMode: mode })
                    }
                    branchMenuOpen={branchMenuOpen}
                    setBranchMenuOpen={setBranchMenuOpen}
                    branchControlWidthCh={branchControlWidthCh}
                    branchLoading={branchLoading}
                    branchSwitching={branchSwitching}
                    hasActiveProject={Boolean(activeProjectDir)}
                    branchCurrent={branchState?.current}
                    branchDisplayValue={branchDisplayValue}
                    branchSearchInputRef={branchSearchInputRef}
                    branchQuery={branchQuery}
                    setBranchQuery={setBranchQuery}
                    branchActionError={branchActionError}
                    clearBranchActionError={() => setBranchActionError(null)}
                    checkoutBranch={checkoutBranch}
                    filteredBranches={filteredBranches}
                    openBranchCreateModal={openBranchCreateModal}
                    browserModeEnabled={browserModeEnabled}
                    setBrowserModeEnabled={enabled => {
                      if (!activeSessionKey) {
                        return
                      }
                      setBrowserModeBySession(prev => ({ ...prev, [activeSessionKey]: enabled }))
                    }}
                  />
                ) : activeSessionType === 'claude' ? (
                  <ClaudeTerminalPane
                    directory={activeProjectDir}
                    sessionStorageKey={
                      activeSessionKey ??
                      buildWorkspaceSessionMetadataKey(activeProjectDir, activeSessionID)
                    }
                    onExit={openWorkspaceDashboard}
                    onFirstInteraction={() => {
                      if (!activeSessionID) {
                        return
                      }
                      markSessionUsed(activeSessionID)
                      touchLocalProviderSession(activeProjectDir, activeSessionID)
                    }}
                  />
                ) : activeSessionType === 'codex' ? (
                  <CodexPane
                    directory={activeProjectDir}
                    sessionStorageKey={
                      activeSessionKey ??
                      buildWorkspaceSessionMetadataKey(activeProjectDir, activeSessionID)
                    }
                    titleLocked={
                      manualSessionTitles[
                        activeSessionKey ??
                          buildWorkspaceSessionMetadataKey(activeProjectDir, activeSessionID)
                      ] ?? false
                    }
                    onExit={openWorkspaceDashboard}
                    onFirstMessage={() => {
                      if (!activeSessionID) {
                        return
                      }
                      markSessionUsed(activeSessionID)
                      touchLocalProviderSession(activeProjectDir, activeSessionID)
                    }}
                    onTitleChange={title => {
                      if (!activeSessionID || !activeProjectDir) {
                        return
                      }
                      const scopedSessionKey = buildWorkspaceSessionMetadataKey(
                        activeProjectDir,
                        activeSessionID
                      )
                      if (!title.trim() || looksAutoGeneratedSessionTitle(title)) {
                        return
                      }
                      if (manualSessionTitles[scopedSessionKey]) {
                        return
                      }
                      setSessionTitles(prev => {
                        const currentTitle = prev[scopedSessionKey]
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
                      renameLocalProviderSession(activeProjectDir, activeSessionID, title)
                    }}
                    notifyOnAwaitingInput={appPreferences.notifyOnAwaitingInput}
                    subagentSystemNotificationsEnabled={
                      appPreferences.subagentSystemNotificationsEnabled
                    }
                    codexAccessMode={appPreferences.codexAccessMode}
                    defaultReasoningEffort={appPreferences.codexReasoningEffort}
                    permissionMode={appPreferences.permissionMode}
                    onPermissionModeChange={mode =>
                      setAppPreferences({ ...appPreferences, permissionMode: mode })
                    }
                    codexPath={appPreferences.codexPath}
                    codexArgs={appPreferences.codexArgs}
                    branchMenuOpen={branchMenuOpen}
                    setBranchMenuOpen={setBranchMenuOpen}
                    branchControlWidthCh={branchControlWidthCh}
                    branchLoading={branchLoading}
                    branchSwitching={branchSwitching}
                    hasActiveProject={Boolean(activeProjectDir)}
                    branchCurrent={branchState?.current}
                    branchDisplayValue={branchDisplayValue}
                    branchSearchInputRef={branchSearchInputRef}
                    branchQuery={branchQuery}
                    setBranchQuery={setBranchQuery}
                    branchActionError={branchActionError}
                    clearBranchActionError={() => setBranchActionError(null)}
                    checkoutBranch={checkoutBranch}
                    filteredBranches={filteredBranches}
                    openBranchCreateModal={openBranchCreateModal}
                    onOpenFileReference={reference => void openReferencedFile(reference)}
                    browserModeEnabled={browserModeEnabled}
                    setBrowserModeEnabled={enabled => void setBrowserMode(enabled)}
                  />
                ) : (
                  <>
                    <MessageFeed
                      messages={feedMessages}
                      presentation={feedPresentation}
                      sessionNotices={activeSessionNotices}
                      showAssistantPlaceholder={isSessionInProgress}
                      optimisticUserPrompt={activeOptimisticOpencodePrompt}
                      assistantLabel={assistantLabel}
                      workspaceDirectory={activeProjectDir ?? null}
                      bottomClearance={messageFeedBottomClearance}
                      onOpenFileReference={reference => void openReferencedFile(reference)}
                      sessionId={activeSessionKey ?? undefined}
                    />

                    <div className="center-pane-rail center-pane-rail--composer">
                      <ComposerPanel
                        composer={composer}
                        setComposer={handleComposerChange}
                        composerAttachments={composerAttachments}
                        removeAttachment={removeAttachment}
                        slashMenuOpen={slashMenuOpen}
                        filteredSlashCommands={filteredSlashCommands}
                        slashSelectedIndex={slashSelectedIndex}
                        insertSlashCommand={insertSlashCommand}
                        handleSlashKeyDown={handleSlashKeyDown}
                        addComposerAttachments={addComposerAttachments}
                        sendPrompt={sendComposerPrompt}
                        abortActiveSession={abortActiveSession}
                        isSessionBusy={isSessionInProgress}
                        isSendingPrompt={isSendingPrompt}
                        pickImageAttachment={pickImageAttachment}
                        hasActiveSession={Boolean(activeSessionID)}
                        isPlanMode={isPlanMode}
                        hasPlanAgent={hasPlanAgent}
                        togglePlanMode={togglePlanMode}
                        browserModeEnabled={browserModeEnabled}
                        setBrowserModeEnabled={enabled => void setBrowserMode(enabled)}
                        hideBrowserToggle={false}
                        hidePlanToggle
                        agentOptions={effectiveComposerAgentOptions}
                        selectedAgent={selectedAgent}
                        onAgentChange={setSelectedAgent}
                        permissionMode={appPreferences.permissionMode}
                        onPermissionModeChange={mode =>
                          setAppPreferences({ ...appPreferences, permissionMode: mode })
                        }
                        compactionProgress={compactionMeter.progress}
                        compactionHint={compactionMeter.hint}
                        compactionCompacted={compactionMeter.compacted}
                        branchMenuOpen={branchMenuOpen}
                        setBranchMenuOpen={setBranchMenuOpen}
                        branchControlWidthCh={branchControlWidthCh}
                        branchLoading={branchLoading}
                        branchSwitching={branchSwitching}
                        hasActiveProject={Boolean(activeProjectDir)}
                        branchCurrent={branchState?.current}
                        branchDisplayValue={branchDisplayValue}
                        branchSearchInputRef={branchSearchInputRef}
                        branchQuery={branchQuery}
                        setBranchQuery={setBranchQuery}
                        branchActionError={branchActionError}
                        clearBranchActionError={() => setBranchActionError(null)}
                        checkoutBranch={checkoutBranch}
                        filteredBranches={filteredBranches}
                        openBranchCreateModal={openBranchCreateModal}
                        modelSelectOptions={modelSelectOptions}
                        selectedModel={selectedModel}
                        setSelectedModel={setSelectedModel}
                        selectedVariant={selectedVariant}
                        setSelectedVariant={setSelectedVariant}
                        variantOptions={variantOptions}
                        placeholder={composerPlaceholder}
                        onLayoutHeightChange={handleComposerLayoutHeightChange}
                        onDockHeightChange={handleDockHeightChange}
                        backgroundAgents={visibleBackgroundAgents}
                        selectedBackgroundAgentId={selectedBackgroundAgentId}
                        onOpenBackgroundAgent={setSelectedBackgroundAgentId}
                        onCloseBackgroundAgent={() => setSelectedBackgroundAgentId(null)}
                        onArchiveBackgroundAgent={async agent => {
                          if (!activeProjectDir || !agent.sessionID) {
                            return
                          }
                          try {
                            await window.orxa.opencode
                              .abortSession(activeProjectDir, agent.sessionID)
                              .catch(() => false)
                            await window.orxa.opencode.archiveSession(
                              activeProjectDir,
                              agent.sessionID
                            )
                            setArchivedBackgroundAgentIds(current => {
                              const next = { ...current }
                              const existing = new Set(next[activeProjectDir] ?? [])
                              existing.add(agent.id)
                              existing.add(agent.sessionID!)
                              next[activeProjectDir] = [...existing]
                              return next
                            })
                            if (selectedBackgroundAgentId === agent.id) {
                              setSelectedBackgroundAgentId(null)
                            }
                            await refreshProject(activeProjectDir)
                          } catch (error) {
                            setStatusLine(error instanceof Error ? error.message : String(error))
                          }
                        }}
                        backgroundAgentDetail={backgroundAgentDetail}
                        backgroundAgentTaskText={backgroundAgentTaskText}
                        backgroundAgentDetailLoading={selectedBackgroundAgentLoading}
                        backgroundAgentDetailError={selectedBackgroundAgentError}
                        backgroundAgentTaggingHint={null}
                        todoItems={activeTodoPresentation?.items}
                        todoOpen={dockTodosOpen}
                        onTodoToggle={() => setDockTodosOpen(v => !v)}
                        reviewChangesFiles={
                          showReviewChangesDrawer ? activeReviewChangesFiles : undefined
                        }
                        onOpenReviewChange={path => void openReferencedFile(path)}
                        pendingPermission={dockPendingPermission}
                        pendingQuestion={dockPendingQuestion}
                        queuedMessages={followupQueue}
                        sendingQueuedId={sendingQueuedId}
                        onQueueMessage={queueFollowupMessage}
                        queuedActionKind="send"
                        onPrimaryQueuedAction={(id: string) => {
                          const item = followupQueue.find(m => m.id === id)
                          if (!item || sendingQueuedId) return
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
                        }}
                        onEditQueued={editQueuedMessage}
                        onRemoveQueued={removeQueuedMessage}
                      />
                    </div>
                  </>
                )}
                {canShowIntegratedTerminal ? (
                  <TerminalPanel
                    directory={activeProjectDir}
                    tabs={terminalTabs}
                    activeTabId={activeTerminalId}
                    open={terminalOpen}
                    height={terminalPanelHeight}
                    onCreateTab={createTerminal}
                    onCloseTab={closeTerminalTab}
                    onSwitchTab={setActiveTerminalId}
                    onResizeStart={handleTerminalResizeStart}
                  />
                ) : null}
              </Fragment>
            ) : (
              <HomeDashboard {...homeDashboardProps} />
            )}
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
          {hasProjectContext ? (
            <button
              type="button"
              className={`sidebar-resizer sidebar-resizer-browser ${browserSidebarOpen ? '' : 'is-collapsed'}`.trim()}
              aria-label="Resize browser sidebar"
              onMouseDown={event => startSidebarResize('browser', event)}
              disabled={!browserSidebarOpen}
            />
          ) : null}
          {hasProjectContext ? (
            <div
              className={`workspace-browser-pane ${browserSidebarOpen ? 'open' : 'collapsed'}`.trim()}
            >
              {browserSidebarOpen ? (
                <BrowserSidebar
                  browserState={effectiveBrowserState}
                  onBrowserOpenTab={browserOpenTab}
                  onBrowserCloseTab={browserCloseTab}
                  onBrowserNavigate={browserNavigate}
                  onBrowserGoBack={browserGoBack}
                  onBrowserGoForward={browserGoForward}
                  onBrowserReload={browserReload}
                  onBrowserSelectTab={browserSelectTab}
                  onBrowserSelectHistory={browserSelectHistory}
                  onBrowserReportViewportBounds={browserReportViewportBounds}
                  onBrowserTakeControl={browserTakeControl}
                  onBrowserHandBack={browserHandBack}
                  onBrowserStop={browserStop}
                  onCollapse={() => setBrowserSidebarOpen(false)}
                  onStatusChange={setStatusLine}
                  onSendAnnotations={text =>
                    setComposer(prev => (prev ? `${prev}\n\n${text}` : text))
                  }
                  mcpDevToolsState={mcpDevToolsState}
                />
              ) : null}
            </div>
          ) : null}
          {hasProjectContext ? (
            <button
              type="button"
              className={`sidebar-resizer sidebar-resizer-right ${showGitPane ? '' : 'is-collapsed'}`.trim()}
              aria-label="Resize git sidebar"
              onMouseDown={event => startSidebarResize('right', event)}
              disabled={!showGitPane}
            />
          ) : null}
          {hasProjectContext ? (
            <div className={`workspace-right-pane ${showGitPane ? 'open' : 'collapsed'}`.trim()}>
              <GitSidebar
                sidebarPanelTab={rightSidebarTab}
                setSidebarPanelTab={setRightSidebarTab}
                gitPanelTab={gitPanelTab}
                setGitPanelTab={setGitPanelTab}
                gitDiffViewMode={gitDiffViewMode}
                setGitDiffViewMode={setGitDiffViewMode}
                gitPanelOutput={gitPanelOutput}
                branchState={branchState}
                branchQuery={branchQuery}
                setBranchQuery={setBranchQuery}
                activeProjectDir={activeProjectDir ?? null}
                onLoadGitDiff={loadGitDiff}
                onLoadGitLog={loadGitLog}
                onLoadGitIssues={loadGitIssues}
                onLoadGitPrs={loadGitPrs}
                onStageAllChanges={stageAllChanges}
                onDiscardAllChanges={discardAllChanges}
                onStageFile={stageFile}
                onRestoreFile={restoreFile}
                onUnstageFile={unstageFile}
                fileProvenanceByPath={sessionProvenanceByPath}
                onAddToChatPath={appendPathToComposer}
                onStatusChange={setStatusLine}
              />
            </div>
          ) : null}
        </div>

        {contextMenu ? (
          <div
            className="context-menu-overlay"
            onClick={() => setContextMenu(null)}
            onContextMenu={event => event.preventDefault()}
          >
            <div
              className="context-menu"
              style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
              onClick={event => event.stopPropagation()}
            >
              {contextMenu.kind === 'project' ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const { directory, label } = contextMenu
                      setContextMenu(null)
                      void changeProjectDirectory(directory, label)
                    }}
                  >
                    Change Working Directory...
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      const { directory, label } = contextMenu
                      setContextMenu(null)
                      void removeProjectDirectory(directory, label)
                    }}
                  >
                    Delete
                  </button>
                </>
              ) : (
                <>
                  {getSessionContextActions(
                    getSessionType(contextMenu.sessionID, contextMenu.directory)
                  ).includes('archive') ? (
                    <button
                      type="button"
                      onClick={() => {
                        const { directory, sessionID } = contextMenu
                        setContextMenu(null)
                        void archiveSession(directory, sessionID)
                      }}
                    >
                      Archive Session
                    </button>
                  ) : null}
                  {getSessionContextActions(
                    getSessionType(contextMenu.sessionID, contextMenu.directory)
                  ).includes('copy_id') ? (
                    <button
                      type="button"
                      onClick={() => {
                        const { directory, sessionID } = contextMenu
                        setContextMenu(null)
                        void copySessionID(directory, sessionID)
                      }}
                    >
                      {getSessionType(contextMenu.sessionID, contextMenu.directory) === 'codex'
                        ? 'Copy Codex Thread ID'
                        : getSessionType(contextMenu.sessionID, contextMenu.directory) ===
                            'claude-chat'
                          ? 'Copy Claude Thread ID'
                          : 'Copy Session ID'}
                    </button>
                  ) : null}
                  {getSessionContextActions(
                    getSessionType(contextMenu.sessionID, contextMenu.directory)
                  ).includes('create_worktree') ? (
                    <button
                      type="button"
                      onClick={() => {
                        const { directory, sessionID, title } = contextMenu
                        setContextMenu(null)
                        void createWorktreeSession(directory, sessionID, title)
                      }}
                    >
                      Create Worktree Session
                    </button>
                  ) : null}
                  {getSessionContextActions(
                    getSessionType(contextMenu.sessionID, contextMenu.directory)
                  ).includes('rename') ? (
                    <button
                      type="button"
                      onClick={() => {
                        const { directory, sessionID, title } = contextMenu
                        setContextMenu(null)
                        void renameSession(directory, sessionID, title)
                      }}
                    >
                      Rename Session
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </div>
        ) : null}

        {debugModalOpen ? (
          <div className="overlay debug-log-overlay" onClick={() => setDebugModalOpen(false)}>
            <section
              className="modal debug-log-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Session debug logs"
              onClick={event => event.stopPropagation()}
            >
              <header className="modal-header">
                <div>
                  <h2>Session Debug Logs</h2>
                  <small className="debug-log-subtitle">Current status: {statusLine}</small>
                </div>
                <button type="button" onClick={() => setDebugModalOpen(false)}>
                  Close
                </button>
              </header>
              <div className="debug-log-toolbar">
                <span className="debug-log-filter-label">Filter level</span>
                {(['all', 'info', 'warn', 'error'] as const).map(level => (
                  <button
                    key={level}
                    type="button"
                    className={debugLogLevelFilter === level ? 'active' : ''}
                    onClick={() => setDebugLogLevelFilter(level)}
                  >
                    {level === 'all' ? 'All' : level.toUpperCase()}
                  </button>
                ))}
                <button
                  type="button"
                  className="debug-log-copy-btn"
                  onClick={() => void copyDebugLogsAsJson()}
                >
                  Copy logs as JSON
                </button>
              </div>
              <div className="debug-log-list" role="log" aria-live="polite">
                {filteredDebugLogs.length === 0 ? (
                  <p className="dashboard-empty">No debug logs yet.</p>
                ) : (
                  filteredDebugLogs
                    .slice()
                    .reverse()
                    .map(entry => (
                      <article key={entry.id} className={`debug-log-item ${entry.level}`.trim()}>
                        <div className="debug-log-item-meta">
                          <span>{new Date(entry.time).toLocaleTimeString()}</span>
                          <span>{entry.eventType}</span>
                        </div>
                        <p>{entry.summary}</p>
                        {entry.details ? (
                          <details>
                            <summary>Details</summary>
                            <pre>{entry.details}</pre>
                          </details>
                        ) : null}
                      </article>
                    ))
                )}
              </div>
            </section>
          </div>
        ) : null}

        {updateProgressState ? (
          <div
            className="overlay"
            onClick={
              updateProgressState.phase === 'error' ? () => setUpdateProgressState(null) : undefined
            }
          >
            <section
              className="modal update-progress-modal"
              onClick={event => event.stopPropagation()}
            >
              <div className="update-progress-body">
                {updateProgressState.phase === 'error' ? (
                  <>
                    <h2>Update failed</h2>
                    <p>{updateProgressState.message}</p>
                    <button type="button" onClick={() => setUpdateProgressState(null)}>
                      Dismiss
                    </button>
                  </>
                ) : (
                  <>
                    <span
                      className="session-status-indicator busy commit-progress-spinner"
                      aria-hidden="true"
                    />
                    <h2>
                      {updateProgressState.phase === 'installing'
                        ? 'Installing update'
                        : 'Downloading update'}
                      {updateProgressState.version ? ` ${updateProgressState.version}` : ''}
                    </h2>
                    <p>{updateProgressState.message}</p>
                    {updateProgressState.phase === 'downloading' ? (
                      <div className="update-progress-meter" aria-label="Update download progress">
                        <div
                          className="update-progress-meter-fill"
                          style={{
                            width: `${Math.max(0, Math.min(100, updateProgressState.percent ?? 0))}%`,
                          }}
                        />
                      </div>
                    ) : null}
                    {updateProgressState.phase === 'downloading' ? (
                      <small>
                        {typeof updateProgressState.percent === 'number'
                          ? `${Math.round(updateProgressState.percent)}%`
                          : 'Starting...'}
                      </small>
                    ) : null}
                  </>
                )}
              </div>
            </section>
          </div>
        ) : null}

        <ConfirmDialog
          isOpen={Boolean(confirmDialogRequest)}
          title={confirmDialogRequest?.title ?? 'Confirm'}
          message={confirmDialogRequest?.message ?? 'Are you sure?'}
          confirmLabel={confirmDialogRequest?.confirmLabel}
          cancelLabel={confirmDialogRequest?.cancelLabel}
          variant={confirmDialogRequest?.variant}
          onConfirm={() => closeConfirmDialog(true)}
          onCancel={() => closeConfirmDialog(false)}
        />

        <TextInputDialog
          isOpen={Boolean(textInputDialog)}
          title={textInputDialog?.title ?? ''}
          placeholder={textInputDialog?.placeholder}
          defaultValue={textInputDialog?.defaultValue}
          confirmLabel={textInputDialog?.confirmLabel}
          cancelLabel={textInputDialog?.cancelLabel}
          validate={textInputDialog?.validate}
          onConfirm={submitTextInputDialog}
          onCancel={closeTextInputDialog}
        />

        <GlobalModalsHost
          activeProjectDir={activeProjectDir}
          permissionMode={appPreferences.permissionMode}
          dependencyReport={dependencyReport}
          dependencyModalOpen={dependencyModalOpen}
          setDependencyModalOpen={setDependencyModalOpen}
          onCheckDependencies={refreshRuntimeDependencies}
          permissionRequest={pendingPermission ?? null}
          permissionDecisionInFlight={isPermissionDecisionInFlight}
          replyPermission={replyPendingPermission}
          questionRequest={pendingQuestion}
          replyQuestion={replyPendingQuestion}
          rejectQuestion={rejectPendingQuestion}
          allSessionsModalOpen={allSessionsModalOpen}
          setAllSessionsModalOpen={setAllSessionsModalOpen}
          sessions={sessions}
          getSessionStatusType={getSessionStatusType}
          activeSessionID={activeSessionID}
          openSession={openSession}
          projects={projects}
          branchCreateModalOpen={branchCreateModalOpen}
          setBranchCreateModalOpen={setBranchCreateModalOpen}
          branchCreateName={branchCreateName}
          setBranchCreateName={setBranchCreateName}
          branchCreateError={branchCreateError}
          setBranchCreateError={setBranchCreateError}
          submitBranchCreate={submitBranchCreate}
          branchSwitching={branchSwitching}
          commitModalOpen={commitModalOpen}
          setCommitModalOpen={setCommitModalOpen}
          commitSummary={commitSummary}
          commitSummaryLoading={commitSummaryLoading}
          commitIncludeUnstaged={commitIncludeUnstaged}
          setCommitIncludeUnstaged={setCommitIncludeUnstaged}
          commitMessageDraft={commitMessageDraft}
          setCommitMessageDraft={setCommitMessageDraft}
          commitNextStepOptions={commitNextStepOptions}
          commitNextStep={commitNextStep}
          setCommitNextStep={setCommitNextStep}
          commitSubmitting={commitSubmitting}
          commitBaseBranch={commitBaseBranch}
          setCommitBaseBranch={setCommitBaseBranch}
          commitBaseBranchOptions={commitBaseBranchOptions}
          commitBaseBranchLoading={branchLoading}
          commitFlowState={commitFlowState}
          dismissCommitFlowState={dismissCommitFlowState}
          submitCommit={submitCommit}
          addProjectDirectory={addProjectDirectory}
          skillUseModal={skillUseModal}
          setSkillUseModal={setSkillUseModal}
          applySkillToProject={applySkillToProject}
          profileModalOpen={profileModalOpen}
          setProfileModalOpen={setProfileModalOpen}
          profiles={profiles}
          runtime={runtime}
          onSaveProfile={async (profile: RuntimeProfileInput) => {
            await window.orxa.runtime.saveProfile(profile)
            await refreshProfiles()
            setStatusLine('Profile saved')
          }}
          onDeleteProfile={async profileID => {
            await window.orxa.runtime.deleteProfile(profileID)
            await refreshProfiles()
            setStatusLine('Profile deleted')
          }}
          onAttachProfile={async profileID => {
            await window.orxa.runtime.attach(profileID)
            await refreshProfiles()
            await Promise.all([
              refreshConfigModels(),
              refreshGlobalProviders(),
              refreshGlobalAgents(),
              refreshAgentFiles(),
            ])
            await bootstrap()
            setStatusLine('Attached to server')
          }}
          onStartLocalProfile={async profileID => {
            await window.orxa.runtime.startLocal(profileID)
            await refreshProfiles()
            await Promise.all([
              refreshConfigModels(),
              refreshGlobalProviders(),
              refreshGlobalAgents(),
              refreshAgentFiles(),
            ])
            await bootstrap()
            setStatusLine('Local server started')
          }}
          onStopLocalProfile={async () => {
            await window.orxa.runtime.stopLocal()
            await refreshProfiles()
            await Promise.all([
              refreshConfigModels(),
              refreshGlobalProviders(),
              refreshGlobalAgents(),
              refreshAgentFiles(),
            ])
            setStatusLine('Local server stopped')
          }}
        />

        <GlobalSearchModal
          open={globalSearchModalOpen}
          onClose={() => setGlobalSearchModalOpen(false)}
          projects={projects}
          projectSessions={allProjectSessions}
          getSessionTitle={getSessionTitle}
          getSessionType={getSessionType}
          openSession={openSession}
        />

        <SettingsDrawer
          open={settingsOpen}
          directory={activeProjectDir}
          onClose={() => setSettingsOpen(false)}
          onReadRaw={(scope, directory) => window.orxa.opencode.readRawConfig(scope, directory)}
          onWriteRaw={async (scope, content, directory) => {
            const doc = await window.orxa.opencode.writeRawConfig(scope, content, directory)
            if (scope === 'global') {
              await Promise.all([refreshConfigModels(), refreshGlobalProviders()])
            }
            if (directory) {
              await refreshProject(directory)
            }
            setStatusLine('Raw config saved')
            return doc
          }}
          onReadGlobalAgentsMd={() => window.orxa.opencode.readGlobalAgentsMd()}
          onWriteGlobalAgentsMd={async content => {
            const doc = await window.orxa.opencode.writeGlobalAgentsMd(content)
            setStatusLine('Global AGENTS.md saved')
            return doc
          }}
          appPreferences={appPreferences}
          onAppPreferencesChange={setAppPreferences}
          onGetServerDiagnostics={() => window.orxa.opencode.getServerDiagnostics()}
          onRepairRuntime={() => window.orxa.opencode.repairRuntime()}
          onGetUpdatePreferences={() => window.orxa.updates.getPreferences()}
          onSetUpdatePreferences={input => window.orxa.updates.setPreferences(input)}
          onCheckForUpdates={() => window.orxa.updates.checkNow()}
          allModelOptions={settingsModelOptions}
          profiles={profiles}
          runtime={runtime}
          onSaveProfile={async profile => {
            await window.orxa.runtime.saveProfile(profile)
            await refreshProfiles()
          }}
          onDeleteProfile={async profileID => {
            await window.orxa.runtime.deleteProfile(profileID)
            await refreshProfiles()
          }}
          onAttachProfile={async profileID => {
            await window.orxa.runtime.attach(profileID)
            await refreshProfiles()
            await Promise.all([
              refreshConfigModels(),
              refreshGlobalProviders(),
              refreshGlobalAgents(),
              refreshAgentFiles(),
            ])
            await bootstrap()
          }}
          onStartLocalProfile={async profileID => {
            await window.orxa.runtime.startLocal(profileID)
            await refreshProfiles()
            await Promise.all([
              refreshConfigModels(),
              refreshGlobalProviders(),
              refreshGlobalAgents(),
              refreshAgentFiles(),
            ])
            await bootstrap()
          }}
          onStopLocalProfile={async () => {
            await window.orxa.runtime.stopLocal()
            await refreshProfiles()
            await Promise.all([
              refreshConfigModels(),
              refreshGlobalProviders(),
              refreshGlobalAgents(),
              refreshAgentFiles(),
            ])
          }}
          onRefreshProfiles={refreshProfiles}
        />
        <InfoDialog
          isOpen={memoryComingSoonOpen}
          title="Memory coming soon"
          message="Workspace-scoped memory that lets your agents recall project context, decisions, and preferences across sessions. Coming soon."
          dismissLabel="Close"
          onDismiss={() => setMemoryComingSoonOpen(false)}
        />
      </div>
    </AppErrorBoundary>
  )
}
