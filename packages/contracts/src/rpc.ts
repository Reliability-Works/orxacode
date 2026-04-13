import { Schema } from 'effect'
import * as Rpc from 'effect/unstable/rpc/Rpc'
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup'

import {
  DashboardGetProviderUsageInput,
  DashboardGetProviderUsageResult,
  DashboardGetSnapshotInput,
  DashboardGetSnapshotResult,
  DashboardQueryError,
  DashboardRefreshInput,
  DashboardRefreshResult,
  ProviderUsageUnavailableError,
} from './dashboard'
import { OpenError, OpenInEditorInput } from './editor'
import {
  GitActionProgressEvent,
  GitCheckoutInput,
  GitCommandError,
  GitCreateBranchInput,
  GitDiscoverReposInput,
  GitDiscoverReposResult,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitGetDiffInput,
  GitGetDiffResult,
  GitGetIssuesInput,
  GitGetIssuesResult,
  GitGetLogInput,
  GitGetLogResult,
  GitGetPullRequestsInput,
  GitGetPullRequestsResult,
  GitHubCliError,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitManagerServiceError,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullInput,
  GitPullRequestRefInput,
  GitPullResult,
  GitRemoveWorktreeInput,
  GitRestoreAllUnstagedInput,
  GitResolvePullRequestResult,
  GitRestorePathInput,
  GitRunStackedActionInput,
  GitStageAllInput,
  GitStagePathInput,
  GitStatusInput,
  GitStatusResult,
  GitUnstagePathInput,
} from './git'
import {
  SkillGetRootsInput,
  SkillGetRootsResult,
  SkillListInput,
  SkillListResult,
  SkillRefreshInput,
  SkillRefreshResult,
  SkillSetRootsInput,
  SkillSetRootsResult,
  SkillsServiceError,
} from './skills'
import {
  ProviderGetComposerCapabilitiesInput,
  ProviderComposerCapabilities,
  ProviderListCommandsInput,
  ProviderListCommandsResult,
  ProviderListPluginsInput,
  ProviderListPluginsResult,
} from './providerDiscovery'
import { KeybindingsConfigError } from './keybindings'
import {
  ClientOrchestrationCommand,
  OrchestrationEvent,
  ORCHESTRATION_WS_METHODS,
  OrchestrationDispatchCommandError,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetSnapshotError,
  OrchestrationGetSnapshotInput,
  OrchestrationGetTurnDiffError,
  OrchestrationGetTurnDiffInput,
  OrchestrationReplayEventsError,
  OrchestrationReplayEventsInput,
  OrchestrationRpcSchemas,
} from './orchestration'
import {
  ProjectListEntriesError,
  ProjectListEntriesInput,
  ProjectListEntriesResult,
  ProjectReadFileError,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectSearchEntriesError,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileError,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from './project'
import {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalError,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from './terminal'
import { ProviderListAgentsInput, ProviderListAgentsResult } from './provider'
import {
  ServerConfigStreamEvent,
  ServerConfig,
  ServerLifecycleStreamEvent,
  ServerProviderUpdatedPayload,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
} from './server'
import { ServerSettings, ServerSettingsError, ServerSettingsPatch } from './settings'

export const WS_METHODS = {
  // Project registry methods
  projectsList: 'projects.list',
  projectsAdd: 'projects.add',
  projectsRemove: 'projects.remove',
  projectsListEntries: 'projects.listEntries',
  projectsSearchEntries: 'projects.searchEntries',
  projectsReadFile: 'projects.readFile',
  projectsWriteFile: 'projects.writeFile',

  // Shell methods
  shellOpenInEditor: 'shell.openInEditor',

  // Git methods
  gitPull: 'git.pull',
  gitStatus: 'git.status',
  gitRunStackedAction: 'git.runStackedAction',
  gitListBranches: 'git.listBranches',
  gitCreateWorktree: 'git.createWorktree',
  gitRemoveWorktree: 'git.removeWorktree',
  gitCreateBranch: 'git.createBranch',
  gitCheckout: 'git.checkout',
  gitInit: 'git.init',
  gitResolvePullRequest: 'git.resolvePullRequest',
  gitPreparePullRequestThread: 'git.preparePullRequestThread',
  gitGetDiff: 'git.getDiff',
  gitGetLog: 'git.getLog',
  gitGetIssues: 'git.getIssues',
  gitGetPullRequests: 'git.getPullRequests',
  gitStageAll: 'git.stageAll',
  gitRestoreAllUnstaged: 'git.restoreAllUnstaged',
  gitStagePath: 'git.stagePath',
  gitUnstagePath: 'git.unstagePath',
  gitRestorePath: 'git.restorePath',
  gitDiscoverRepos: 'git.discoverRepos',
  // Dashboard methods
  dashboardGetSnapshot: 'dashboard.getSnapshot',
  dashboardRefresh: 'dashboard.refresh',
  dashboardGetProviderUsage: 'dashboard.getProviderUsage',

  // Skills methods
  skillsList: 'skills.list',
  skillsRefresh: 'skills.refresh',
  skillsGetRoots: 'skills.getRoots',
  skillsSetRoots: 'skills.setRoots',

  // Terminal methods
  terminalOpen: 'terminal.open',
  terminalWrite: 'terminal.write',
  terminalResize: 'terminal.resize',
  terminalClear: 'terminal.clear',
  terminalRestart: 'terminal.restart',
  terminalClose: 'terminal.close',

  // Server meta
  serverGetConfig: 'server.getConfig',
  serverRefreshProviders: 'server.refreshProviders',
  serverUpsertKeybinding: 'server.upsertKeybinding',
  serverGetSettings: 'server.getSettings',
  serverUpdateSettings: 'server.updateSettings',

  // Provider methods
  providerListAgents: 'provider.listAgents',
  providerGetComposerCapabilities: 'provider.getComposerCapabilities',
  providerListCommands: 'provider.listCommands',
  providerListPlugins: 'provider.listPlugins',

  // Streaming subscriptions
  subscribeOrchestrationDomainEvents: 'subscribeOrchestrationDomainEvents',
  subscribeTerminalEvents: 'subscribeTerminalEvents',
  subscribeServerConfig: 'subscribeServerConfig',
  subscribeServerLifecycle: 'subscribeServerLifecycle',
} as const

export const WsServerUpsertKeybindingRpc = Rpc.make(WS_METHODS.serverUpsertKeybinding, {
  payload: ServerUpsertKeybindingInput,
  success: ServerUpsertKeybindingResult,
  error: KeybindingsConfigError,
})

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError]),
})

export const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({}),
  success: ServerProviderUpdatedPayload,
})

export const WsServerGetSettingsRpc = Rpc.make(WS_METHODS.serverGetSettings, {
  payload: Schema.Struct({}),
  success: ServerSettings,
  error: ServerSettingsError,
})

export const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
  payload: Schema.Struct({ patch: ServerSettingsPatch }),
  success: ServerSettings,
  error: ServerSettingsError,
})

export const WsProviderListAgentsRpc = Rpc.make(WS_METHODS.providerListAgents, {
  payload: ProviderListAgentsInput,
  success: ProviderListAgentsResult,
})

export const WsProviderGetComposerCapabilitiesRpc = Rpc.make(
  WS_METHODS.providerGetComposerCapabilities,
  { payload: ProviderGetComposerCapabilitiesInput, success: ProviderComposerCapabilities }
)
export const WsProviderListCommandsRpc = Rpc.make(WS_METHODS.providerListCommands, {
  payload: ProviderListCommandsInput,
  success: ProviderListCommandsResult,
})
export const WsProviderListPluginsRpc = Rpc.make(WS_METHODS.providerListPlugins, {
  payload: ProviderListPluginsInput,
  success: ProviderListPluginsResult,
})

export const WsProjectsSearchEntriesRpc = Rpc.make(WS_METHODS.projectsSearchEntries, {
  payload: ProjectSearchEntriesInput,
  success: ProjectSearchEntriesResult,
  error: ProjectSearchEntriesError,
})

export const WsProjectsListEntriesRpc = Rpc.make(WS_METHODS.projectsListEntries, {
  payload: ProjectListEntriesInput,
  success: ProjectListEntriesResult,
  error: ProjectListEntriesError,
})

export const WsProjectsWriteFileRpc = Rpc.make(WS_METHODS.projectsWriteFile, {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
  error: ProjectWriteFileError,
})

export const WsProjectsReadFileRpc = Rpc.make(WS_METHODS.projectsReadFile, {
  payload: ProjectReadFileInput,
  success: ProjectReadFileResult,
  error: ProjectReadFileError,
})

export const WsShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: OpenInEditorInput,
  error: OpenError,
})

// prettier-ignore
export const WsGitStatusRpc = Rpc.make(WS_METHODS.gitStatus, { payload: GitStatusInput, success: GitStatusResult, error: GitManagerServiceError })
// prettier-ignore
export const WsGitPullRpc = Rpc.make(WS_METHODS.gitPull, { payload: GitPullInput, success: GitPullResult, error: GitCommandError })

export const WsGitRunStackedActionRpc = Rpc.make(WS_METHODS.gitRunStackedAction, {
  payload: GitRunStackedActionInput,
  success: GitActionProgressEvent,
  error: GitManagerServiceError,
  stream: true,
})

export const WsGitResolvePullRequestRpc = Rpc.make(WS_METHODS.gitResolvePullRequest, {
  payload: GitPullRequestRefInput,
  success: GitResolvePullRequestResult,
  error: GitManagerServiceError,
})

export const WsGitPreparePullRequestThreadRpc = Rpc.make(WS_METHODS.gitPreparePullRequestThread, {
  payload: GitPreparePullRequestThreadInput,
  success: GitPreparePullRequestThreadResult,
  error: GitManagerServiceError,
})

// prettier-ignore
export const WsGitListBranchesRpc = Rpc.make(WS_METHODS.gitListBranches, { payload: GitListBranchesInput, success: GitListBranchesResult, error: GitCommandError })
// prettier-ignore
export const WsGitCreateWorktreeRpc = Rpc.make(WS_METHODS.gitCreateWorktree, { payload: GitCreateWorktreeInput, success: GitCreateWorktreeResult, error: GitCommandError })
// prettier-ignore
export const WsGitRemoveWorktreeRpc = Rpc.make(WS_METHODS.gitRemoveWorktree, { payload: GitRemoveWorktreeInput, error: GitCommandError })
// prettier-ignore
export const WsGitCreateBranchRpc = Rpc.make(WS_METHODS.gitCreateBranch, { payload: GitCreateBranchInput, error: GitCommandError })
// prettier-ignore
export const WsGitCheckoutRpc = Rpc.make(WS_METHODS.gitCheckout, { payload: GitCheckoutInput, error: GitCommandError })
// prettier-ignore
export const WsGitInitRpc = Rpc.make(WS_METHODS.gitInit, { payload: GitInitInput, error: GitCommandError })
// prettier-ignore
export const WsGitGetDiffRpc = Rpc.make(WS_METHODS.gitGetDiff, { payload: GitGetDiffInput, success: GitGetDiffResult, error: GitCommandError })
// prettier-ignore
export const WsGitGetLogRpc = Rpc.make(WS_METHODS.gitGetLog, { payload: GitGetLogInput, success: GitGetLogResult, error: GitCommandError })
// prettier-ignore
export const WsGitGetIssuesRpc = Rpc.make(WS_METHODS.gitGetIssues, { payload: GitGetIssuesInput, success: GitGetIssuesResult, error: GitHubCliError })
// prettier-ignore
export const WsGitGetPullRequestsRpc = Rpc.make(WS_METHODS.gitGetPullRequests, { payload: GitGetPullRequestsInput, success: GitGetPullRequestsResult, error: GitHubCliError })
// prettier-ignore
export const WsGitStageAllRpc = Rpc.make(WS_METHODS.gitStageAll, { payload: GitStageAllInput, error: GitCommandError })
// prettier-ignore
export const WsGitRestoreAllUnstagedRpc = Rpc.make(WS_METHODS.gitRestoreAllUnstaged, { payload: GitRestoreAllUnstagedInput, error: GitCommandError })
// prettier-ignore
export const WsGitStagePathRpc = Rpc.make(WS_METHODS.gitStagePath, { payload: GitStagePathInput, error: GitCommandError })
// prettier-ignore
export const WsGitUnstagePathRpc = Rpc.make(WS_METHODS.gitUnstagePath, { payload: GitUnstagePathInput, error: GitCommandError })
// prettier-ignore
export const WsGitRestorePathRpc = Rpc.make(WS_METHODS.gitRestorePath, { payload: GitRestorePathInput, error: GitCommandError })
// prettier-ignore
export const WsGitDiscoverReposRpc = Rpc.make(WS_METHODS.gitDiscoverRepos, { payload: GitDiscoverReposInput, success: GitDiscoverReposResult, error: GitCommandError })

// prettier-ignore
export const WsDashboardGetSnapshotRpc = Rpc.make(WS_METHODS.dashboardGetSnapshot, { payload: DashboardGetSnapshotInput, success: DashboardGetSnapshotResult, error: DashboardQueryError })
// prettier-ignore
export const WsDashboardRefreshRpc = Rpc.make(WS_METHODS.dashboardRefresh, { payload: DashboardRefreshInput, success: DashboardRefreshResult, error: DashboardQueryError })

export const WsDashboardGetProviderUsageRpc = Rpc.make(WS_METHODS.dashboardGetProviderUsage, {
  payload: DashboardGetProviderUsageInput,
  success: DashboardGetProviderUsageResult,
  error: ProviderUsageUnavailableError,
})

// prettier-ignore
export const WsSkillsListRpc = Rpc.make(WS_METHODS.skillsList, { payload: SkillListInput, success: SkillListResult, error: SkillsServiceError })
// prettier-ignore
export const WsSkillsRefreshRpc = Rpc.make(WS_METHODS.skillsRefresh, { payload: SkillRefreshInput, success: SkillRefreshResult, error: SkillsServiceError })
// prettier-ignore
export const WsSkillsGetRootsRpc = Rpc.make(WS_METHODS.skillsGetRoots, { payload: SkillGetRootsInput, success: SkillGetRootsResult, error: SkillsServiceError })
// prettier-ignore
export const WsSkillsSetRootsRpc = Rpc.make(WS_METHODS.skillsSetRoots, { payload: SkillSetRootsInput, success: SkillSetRootsResult, error: SkillsServiceError })

// prettier-ignore
export const WsTerminalOpenRpc = Rpc.make(WS_METHODS.terminalOpen, { payload: TerminalOpenInput, success: TerminalSessionSnapshot, error: TerminalError })
// prettier-ignore
export const WsTerminalWriteRpc = Rpc.make(WS_METHODS.terminalWrite, { payload: TerminalWriteInput, error: TerminalError })
// prettier-ignore
export const WsTerminalResizeRpc = Rpc.make(WS_METHODS.terminalResize, { payload: TerminalResizeInput, error: TerminalError })
// prettier-ignore
export const WsTerminalClearRpc = Rpc.make(WS_METHODS.terminalClear, { payload: TerminalClearInput, error: TerminalError })
// prettier-ignore
export const WsTerminalRestartRpc = Rpc.make(WS_METHODS.terminalRestart, { payload: TerminalRestartInput, success: TerminalSessionSnapshot, error: TerminalError })
// prettier-ignore
export const WsTerminalCloseRpc = Rpc.make(WS_METHODS.terminalClose, { payload: TerminalCloseInput, error: TerminalError })

export const WsOrchestrationGetSnapshotRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getSnapshot, {
  payload: OrchestrationGetSnapshotInput,
  success: OrchestrationRpcSchemas.getSnapshot.output,
  error: OrchestrationGetSnapshotError,
})

export const WsOrchestrationDispatchCommandRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.dispatchCommand,
  {
    payload: ClientOrchestrationCommand,
    success: OrchestrationRpcSchemas.dispatchCommand.output,
    error: OrchestrationDispatchCommandError,
  }
)

export const WsOrchestrationGetTurnDiffRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getTurnDiff, {
  payload: OrchestrationGetTurnDiffInput,
  success: OrchestrationRpcSchemas.getTurnDiff.output,
  error: OrchestrationGetTurnDiffError,
})

export const WsOrchestrationGetFullThreadDiffRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getFullThreadDiff,
  {
    payload: OrchestrationGetFullThreadDiffInput,
    success: OrchestrationRpcSchemas.getFullThreadDiff.output,
    error: OrchestrationGetFullThreadDiffError,
  }
)

export const WsOrchestrationReplayEventsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.replayEvents, {
  payload: OrchestrationReplayEventsInput,
  success: OrchestrationRpcSchemas.replayEvents.output,
  error: OrchestrationReplayEventsError,
})

export const WsSubscribeOrchestrationDomainEventsRpc = Rpc.make(
  WS_METHODS.subscribeOrchestrationDomainEvents,
  {
    payload: Schema.Struct({}),
    success: OrchestrationEvent,
    stream: true,
  }
)

export const WsSubscribeTerminalEventsRpc = Rpc.make(WS_METHODS.subscribeTerminalEvents, {
  payload: Schema.Struct({}),
  success: TerminalEvent,
  stream: true,
})

export const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({}),
  success: ServerConfigStreamEvent,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError]),
  stream: true,
})

export const WsSubscribeServerLifecycleRpc = Rpc.make(WS_METHODS.subscribeServerLifecycle, {
  payload: Schema.Struct({}),
  success: ServerLifecycleStreamEvent,
  stream: true,
})

export const WsRpcGroup = RpcGroup.make(
  WsServerGetConfigRpc,
  WsServerRefreshProvidersRpc,
  WsServerUpsertKeybindingRpc,
  WsServerGetSettingsRpc,
  WsServerUpdateSettingsRpc,
  WsProviderListAgentsRpc,
  WsProviderGetComposerCapabilitiesRpc,
  WsProviderListCommandsRpc,
  WsProviderListPluginsRpc,
  WsProjectsListEntriesRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsReadFileRpc,
  WsProjectsWriteFileRpc,
  WsShellOpenInEditorRpc,
  WsGitStatusRpc,
  WsGitPullRpc,
  WsGitRunStackedActionRpc,
  WsGitResolvePullRequestRpc,
  WsGitPreparePullRequestThreadRpc,
  WsGitListBranchesRpc,
  WsGitCreateWorktreeRpc,
  WsGitRemoveWorktreeRpc,
  WsGitCreateBranchRpc,
  WsGitCheckoutRpc,
  WsGitInitRpc,
  WsGitGetDiffRpc,
  WsGitGetLogRpc,
  WsGitGetIssuesRpc,
  WsGitGetPullRequestsRpc,
  WsGitStageAllRpc,
  WsGitRestoreAllUnstagedRpc,
  WsGitStagePathRpc,
  WsGitUnstagePathRpc,
  WsGitRestorePathRpc,
  WsGitDiscoverReposRpc,
  WsTerminalOpenRpc,
  WsTerminalWriteRpc,
  WsTerminalResizeRpc,
  WsTerminalClearRpc,
  WsTerminalRestartRpc,
  WsTerminalCloseRpc,
  WsSubscribeOrchestrationDomainEventsRpc,
  WsSubscribeTerminalEventsRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerLifecycleRpc,
  WsOrchestrationGetSnapshotRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationReplayEventsRpc,
  WsDashboardGetSnapshotRpc,
  WsDashboardRefreshRpc,
  WsDashboardGetProviderUsageRpc,
  WsSkillsListRpc,
  WsSkillsRefreshRpc,
  WsSkillsGetRootsRpc,
  WsSkillsSetRootsRpc
)
