import type {
  GitCheckoutInput,
  GitCreateBranchInput,
  GitDiscoverReposInput,
  GitDiscoverReposResult,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullRequestRefInput,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitPullInput,
  GitPullResult,
  GitPushWorktreeToParentInput,
  GitPushWorktreeToParentResult,
  GitRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitStatusInput,
  GitStatusResult,
} from './git'
import type {
  ProjectListEntriesInput,
  ProjectListEntriesResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from './project'
import type {
  ServerConfig,
  ServerProviderUpdatedPayload,
  ServerUpsertKeybindingResult,
} from './server'
import type {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from './terminal'
import type { ServerUpsertKeybindingInput } from './server'
import type {
  ClientOrchestrationCommand,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetFullThreadDiffResult,
  OrchestrationGetTurnDiffInput,
  OrchestrationGetTurnDiffResult,
  OrchestrationEvent,
  OrchestrationReadModel,
} from './orchestration'
import { EditorId } from './editor'
import { ServerSettings, ServerSettingsPatch } from './settings'

export interface ContextMenuItem<T extends string = string> {
  id: T
  label: string
  destructive?: boolean
  disabled?: boolean
}

export type DesktopUpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export type DesktopRuntimeArch = 'arm64' | 'x64' | 'other'
export type DesktopTheme = 'light' | 'dark' | 'system'
export type DesktopUpdateReleaseChannel = 'stable' | 'prerelease'

export interface DesktopRuntimeInfo {
  hostArch: DesktopRuntimeArch
  appArch: DesktopRuntimeArch
  runningUnderArm64Translation: boolean
}

export interface DesktopUpdatePreferences {
  releaseChannel: DesktopUpdateReleaseChannel
}

export interface DesktopUpdateState {
  enabled: boolean
  status: DesktopUpdateStatus
  currentVersion: string
  hostArch: DesktopRuntimeArch
  appArch: DesktopRuntimeArch
  runningUnderArm64Translation: boolean
  availableVersion: string | null
  downloadedVersion: string | null
  downloadPercent: number | null
  checkedAt: string | null
  message: string | null
  errorContext: 'check' | 'download' | 'install' | null
  canRetry: boolean
}

export interface DesktopUpdateActionResult {
  accepted: boolean
  completed: boolean
  state: DesktopUpdateState
}

export interface DesktopBrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface DesktopBrowserTabState {
  id: string
  title: string
  url: string
  isActive: boolean
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface DesktopBrowserInspectPoint {
  x: number
  y: number
}

export interface DesktopBrowserAnnotationCandidate {
  element: string
  selector: string
  text: string | null
  boundingBox: DesktopBrowserBounds | null
  computedStyles: string | null
}

export interface DesktopBrowserState {
  tabs: DesktopBrowserTabState[]
  activeTabId: string | null
  activeUrl: string | null
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  bounds: DesktopBrowserBounds | null
}

export interface DesktopRemoteAccessEndpoint {
  id: string
  environmentId?: string
  label: string
  address: string
  url: string
  bootstrapUrl?: string
  pairUrl?: string
  sessionUrl?: string
  authMode?: 'bootstrap' | 'session' | 'bearer'
  transport?: 'ws' | 'wss'
}

export type DesktopRemoteAccessStatus = 'disabled' | 'available' | 'unavailable'

export interface DesktopRemoteAccessPreferences {
  enabled: boolean
  environmentId?: string
}

export type ExecutionEnvironmentKind = 'local-desktop'

export interface ExecutionEnvironmentDescriptor {
  environmentId: string
  label: string
  kind: ExecutionEnvironmentKind
}

export interface EnvironmentCredential {
  environmentId: string
  token: string
  issuedAt: string
  revokedAt: string | null
}

export interface AccessEndpoint {
  id: string
  environmentId: string
  label: string
  transport: 'ws' | 'wss'
  url: string
  bootstrapUrl: string
  sessionUrl: string
  authMode: 'bootstrap' | 'session'
}

export interface KnownEnvironment {
  environment: ExecutionEnvironmentDescriptor
  endpoints: AccessEndpoint[]
  lastSuccessfulEndpointId: string | null
  credential: EnvironmentCredential | null
}

export type EnvironmentConnectionState =
  | 'idle'
  | 'bootstrapping'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'

export interface EnvironmentConnectionTarget {
  httpBaseUrl: string
  wsBaseUrl: string
}

export interface DesktopPrimaryEnvironmentBootstrap {
  environment: ExecutionEnvironmentDescriptor
  target: EnvironmentConnectionTarget
  bootstrapToken: string | null
}

export interface DesktopRemoteAccessSnapshot {
  enabled: boolean
  status: DesktopRemoteAccessStatus
  environment?: ExecutionEnvironmentDescriptor
  bootstrapUrl?: string | null
  port: number
  endpoints: DesktopRemoteAccessEndpoint[]
}

export interface DesktopBrowserBridge {
  getState: () => Promise<DesktopBrowserState>
  navigate: (url: string) => Promise<DesktopBrowserState>
  back: () => Promise<DesktopBrowserState>
  forward: () => Promise<DesktopBrowserState>
  reload: () => Promise<DesktopBrowserState>
  openTab: (url?: string) => Promise<DesktopBrowserState>
  closeTab: (tabId: string) => Promise<DesktopBrowserState>
  switchTab: (tabId: string) => Promise<DesktopBrowserState>
  setBounds: (bounds: DesktopBrowserBounds) => Promise<DesktopBrowserState>
  enableInspect: () => Promise<{ ok: boolean }>
  disableInspect: () => Promise<{ ok: boolean }>
  pollInspectAnnotation: () => Promise<DesktopBrowserAnnotationCandidate | null>
  inspectAtPoint: (
    point: DesktopBrowserInspectPoint
  ) => Promise<DesktopBrowserAnnotationCandidate | null>
}

export interface DesktopUpdateCheckResult {
  checked: boolean
  state: DesktopUpdateState
}

export interface DesktopBridge {
  getLocalEnvironmentBootstrap: () => Promise<DesktopPrimaryEnvironmentBootstrap>
  setRemoteAccessPreferences: (
    input: Partial<DesktopRemoteAccessPreferences>
  ) => Promise<DesktopRemoteAccessPreferences>
  getRemoteAccessSnapshot: () => Promise<DesktopRemoteAccessSnapshot>
  pickFolder: () => Promise<string | null>
  confirm: (message: string) => Promise<boolean>
  setTheme: (theme: DesktopTheme) => Promise<void>
  showContextMenu: <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number }
  ) => Promise<T | null>
  openExternal: (url: string) => Promise<boolean>
  onMenuAction: (listener: (action: string) => void) => () => void
  getUpdateState: () => Promise<DesktopUpdateState>
  getUpdatePreferences: () => Promise<DesktopUpdatePreferences>
  checkForUpdate: () => Promise<DesktopUpdateCheckResult>
  downloadUpdate: () => Promise<DesktopUpdateActionResult>
  installUpdate: () => Promise<DesktopUpdateActionResult>
  setUpdatePreferences: (
    input: Partial<DesktopUpdatePreferences>
  ) => Promise<DesktopUpdatePreferences>
  onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void
  browser?: DesktopBrowserBridge
}

export interface NativeApi {
  dialogs: {
    pickFolder: () => Promise<string | null>
    confirm: (message: string) => Promise<boolean>
  }
  browser?: DesktopBrowserBridge
  terminal: {
    open: (input: typeof TerminalOpenInput.Encoded) => Promise<TerminalSessionSnapshot>
    write: (input: typeof TerminalWriteInput.Encoded) => Promise<void>
    resize: (input: typeof TerminalResizeInput.Encoded) => Promise<void>
    clear: (input: typeof TerminalClearInput.Encoded) => Promise<void>
    restart: (input: typeof TerminalRestartInput.Encoded) => Promise<TerminalSessionSnapshot>
    close: (input: typeof TerminalCloseInput.Encoded) => Promise<void>
    onEvent: (callback: (event: TerminalEvent) => void) => () => void
  }
  projects: {
    listEntries: (input: ProjectListEntriesInput) => Promise<ProjectListEntriesResult>
    searchEntries: (input: ProjectSearchEntriesInput) => Promise<ProjectSearchEntriesResult>
    readFile: (input: ProjectReadFileInput) => Promise<ProjectReadFileResult>
    writeFile: (input: ProjectWriteFileInput) => Promise<ProjectWriteFileResult>
  }
  shell: {
    openInEditor: (cwd: string, editor: EditorId) => Promise<void>
    openExternal: (url: string) => Promise<void>
  }
  git: {
    // Existing branch/worktree API
    listBranches: (input: GitListBranchesInput) => Promise<GitListBranchesResult>
    createWorktree: (input: GitCreateWorktreeInput) => Promise<GitCreateWorktreeResult>
    removeWorktree: (input: GitRemoveWorktreeInput) => Promise<void>
    pushWorktreeToParent: (
      input: GitPushWorktreeToParentInput
    ) => Promise<GitPushWorktreeToParentResult>
    createBranch: (input: GitCreateBranchInput) => Promise<void>
    checkout: (input: GitCheckoutInput) => Promise<void>
    init: (input: GitInitInput) => Promise<void>
    resolvePullRequest: (input: GitPullRequestRefInput) => Promise<GitResolvePullRequestResult>
    preparePullRequestThread: (
      input: GitPreparePullRequestThreadInput
    ) => Promise<GitPreparePullRequestThreadResult>
    // Stacked action API
    pull: (input: GitPullInput) => Promise<GitPullResult>
    status: (input: GitStatusInput) => Promise<GitStatusResult>
    // Multi-repo discovery
    discoverRepos: (input: GitDiscoverReposInput) => Promise<GitDiscoverReposResult>
  }
  contextMenu: {
    show: <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number }
    ) => Promise<T | null>
  }
  server: {
    getConfig: () => Promise<ServerConfig>
    refreshProviders: () => Promise<ServerProviderUpdatedPayload>
    upsertKeybinding: (input: ServerUpsertKeybindingInput) => Promise<ServerUpsertKeybindingResult>
    getSettings: () => Promise<ServerSettings>
    updateSettings: (patch: ServerSettingsPatch) => Promise<ServerSettings>
  }
  orchestration: {
    getSnapshot: () => Promise<OrchestrationReadModel>
    dispatchCommand: (command: ClientOrchestrationCommand) => Promise<{ sequence: number }>
    getTurnDiff: (input: OrchestrationGetTurnDiffInput) => Promise<OrchestrationGetTurnDiffResult>
    getFullThreadDiff: (
      input: OrchestrationGetFullThreadDiffInput
    ) => Promise<OrchestrationGetFullThreadDiffResult>
    replayEvents: (fromSequenceExclusive: number) => Promise<OrchestrationEvent[]>
    onDomainEvent: (callback: (event: OrchestrationEvent) => void) => () => void
  }
}
