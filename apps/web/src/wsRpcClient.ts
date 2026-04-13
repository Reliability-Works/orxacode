import {
  type DashboardSnapshot,
  type GitActionProgressEvent,
  type GitDiffResult,
  type GitGetIssuesResult,
  type GitGetLogResult,
  type GitGetPullRequestsResult,
  type GitRestorePathInput,
  type GitRunStackedActionInput,
  type GitRunStackedActionResult,
  type GitStagePathInput,
  type GitUnstagePathInput,
  type NativeApi,
  ORCHESTRATION_WS_METHODS,
  type ProviderKind,
  type ProviderUsageSnapshot,
  type ServerSettingsPatch,
  type SkillListInput,
  type SkillListResult,
  type SkillRefreshResult,
  type SkillRootsConfig,
  WS_METHODS,
} from '@orxa-code/contracts'
import { Effect, Stream } from 'effect'

import { type WsRpcProtocolClient } from './rpc/protocol'
import { WsTransport } from './wsTransport'

type RpcTag = keyof WsRpcProtocolClient & string
type RpcMethod<TTag extends RpcTag> = WsRpcProtocolClient[TTag]
type RpcInput<TTag extends RpcTag> = Parameters<RpcMethod<TTag>>[0]

interface StreamSubscriptionOptions {
  readonly onResubscribe?: () => void
}

type RpcUnaryMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (...args: infer _Args) => infer TResult
    ? TResult extends Effect.Effect<infer TSuccess, unknown, unknown>
      ? (input: RpcInput<TTag>) => Promise<TSuccess>
      : never
    : never

type RpcUnaryNoArgMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (...args: infer _Args) => infer TResult
    ? TResult extends Effect.Effect<infer TSuccess, unknown, unknown>
      ? () => Promise<TSuccess>
      : never
    : never

type RpcStreamMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (...args: infer _Args) => infer TResult
    ? TResult extends Stream.Stream<infer TEvent, unknown, unknown>
      ? (listener: (event: TEvent) => void, options?: StreamSubscriptionOptions) => () => void
      : never
    : never

interface GitRunStackedActionOptions {
  readonly onProgress?: (event: GitActionProgressEvent) => void
}

export interface WsRpcClient {
  readonly dispose: () => Promise<void>
  readonly reconnect: () => Promise<void>
  readonly terminal: {
    readonly open: RpcUnaryMethod<typeof WS_METHODS.terminalOpen>
    readonly write: RpcUnaryMethod<typeof WS_METHODS.terminalWrite>
    readonly resize: RpcUnaryMethod<typeof WS_METHODS.terminalResize>
    readonly clear: RpcUnaryMethod<typeof WS_METHODS.terminalClear>
    readonly restart: RpcUnaryMethod<typeof WS_METHODS.terminalRestart>
    readonly close: RpcUnaryMethod<typeof WS_METHODS.terminalClose>
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeTerminalEvents>
  }
  readonly projects: {
    readonly listEntries: RpcUnaryMethod<typeof WS_METHODS.projectsListEntries>
    readonly searchEntries: RpcUnaryMethod<typeof WS_METHODS.projectsSearchEntries>
    readonly readFile: RpcUnaryMethod<typeof WS_METHODS.projectsReadFile>
    readonly writeFile: RpcUnaryMethod<typeof WS_METHODS.projectsWriteFile>
  }
  readonly shell: {
    readonly openInEditor: (input: {
      readonly cwd: Parameters<NativeApi['shell']['openInEditor']>[0]
      readonly editor: Parameters<NativeApi['shell']['openInEditor']>[1]
    }) => ReturnType<NativeApi['shell']['openInEditor']>
  }
  readonly git: {
    readonly pull: RpcUnaryMethod<typeof WS_METHODS.gitPull>
    readonly status: RpcUnaryMethod<typeof WS_METHODS.gitStatus>
    readonly runStackedAction: (
      input: GitRunStackedActionInput,
      options?: GitRunStackedActionOptions
    ) => Promise<GitRunStackedActionResult>
    readonly listBranches: RpcUnaryMethod<typeof WS_METHODS.gitListBranches>
    readonly createWorktree: RpcUnaryMethod<typeof WS_METHODS.gitCreateWorktree>
    readonly removeWorktree: RpcUnaryMethod<typeof WS_METHODS.gitRemoveWorktree>
    readonly createBranch: RpcUnaryMethod<typeof WS_METHODS.gitCreateBranch>
    readonly checkout: RpcUnaryMethod<typeof WS_METHODS.gitCheckout>
    readonly init: RpcUnaryMethod<typeof WS_METHODS.gitInit>
    readonly resolvePullRequest: RpcUnaryMethod<typeof WS_METHODS.gitResolvePullRequest>
    readonly preparePullRequestThread: RpcUnaryMethod<typeof WS_METHODS.gitPreparePullRequestThread>
    readonly getDiff: (input: { readonly cwd: string }) => Promise<GitDiffResult>
    readonly getLog: (input: {
      readonly cwd: string
      readonly limit?: number
    }) => Promise<GitGetLogResult>
    readonly getIssues: (input: {
      readonly cwd: string
      readonly limit?: number
    }) => Promise<GitGetIssuesResult>
    readonly getPullRequests: (input: {
      readonly cwd: string
      readonly limit?: number
    }) => Promise<GitGetPullRequestsResult>
    readonly stageAll: (input: { readonly cwd: string }) => Promise<void>
    readonly restoreAllUnstaged: (input: { readonly cwd: string }) => Promise<void>
    readonly stagePath: (input: GitStagePathInput) => Promise<void>
    readonly unstagePath: (input: GitUnstagePathInput) => Promise<void>
    readonly restorePath: (input: GitRestorePathInput) => Promise<void>
    readonly discoverRepos: RpcUnaryMethod<typeof WS_METHODS.gitDiscoverRepos>
  }
  readonly server: {
    readonly getConfig: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetConfig>
    readonly refreshProviders: RpcUnaryNoArgMethod<typeof WS_METHODS.serverRefreshProviders>
    readonly upsertKeybinding: RpcUnaryMethod<typeof WS_METHODS.serverUpsertKeybinding>
    readonly getSettings: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetSettings>
    readonly updateSettings: (
      patch: ServerSettingsPatch
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverUpdateSettings>>
    readonly subscribeConfig: RpcStreamMethod<typeof WS_METHODS.subscribeServerConfig>
    readonly subscribeLifecycle: RpcStreamMethod<typeof WS_METHODS.subscribeServerLifecycle>
  }
  readonly provider: {
    readonly listAgents: RpcUnaryMethod<typeof WS_METHODS.providerListAgents>
    readonly getComposerCapabilities: RpcUnaryMethod<
      typeof WS_METHODS.providerGetComposerCapabilities
    >
    readonly listCommands: RpcUnaryMethod<typeof WS_METHODS.providerListCommands>
    readonly listPlugins: RpcUnaryMethod<typeof WS_METHODS.providerListPlugins>
  }
  readonly skills: {
    readonly list: (input: SkillListInput) => Promise<SkillListResult>
    readonly refresh: (input: { readonly provider?: ProviderKind }) => Promise<SkillRefreshResult>
    readonly getRoots: () => Promise<{ readonly roots: SkillRootsConfig }>
    readonly setRoots: (input: {
      readonly roots: SkillRootsConfig
    }) => Promise<{ readonly roots: SkillRootsConfig }>
  }
  readonly dashboard: {
    readonly getSnapshot: () => Promise<DashboardSnapshot>
    readonly refresh: () => Promise<DashboardSnapshot>
    readonly getProviderUsage: (input: {
      readonly provider: ProviderKind
    }) => Promise<ProviderUsageSnapshot>
  }
  readonly orchestration: {
    readonly getSnapshot: RpcUnaryNoArgMethod<typeof ORCHESTRATION_WS_METHODS.getSnapshot>
    readonly dispatchCommand: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.dispatchCommand>
    readonly getTurnDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getTurnDiff>
    readonly getFullThreadDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getFullThreadDiff>
    readonly replayEvents: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.replayEvents>
    readonly onDomainEvent: RpcStreamMethod<typeof WS_METHODS.subscribeOrchestrationDomainEvents>
  }
}

let sharedWsRpcClient: WsRpcClient | null = null
let activeWsRpcClient: WsRpcClient | null = null

export function setActiveWsRpcClient(client: WsRpcClient | null) {
  activeWsRpcClient = client
}

export function getWsRpcClient(): WsRpcClient {
  if (activeWsRpcClient) {
    return activeWsRpcClient
  }
  if (sharedWsRpcClient) {
    return sharedWsRpcClient
  }
  sharedWsRpcClient = createWsRpcClient()
  return sharedWsRpcClient
}

export async function resetWsRpcClient() {
  activeWsRpcClient = null
  await sharedWsRpcClient?.dispose()
  sharedWsRpcClient = null
}

export async function resetWsRpcClientForTests() {
  await resetWsRpcClient()
}

function createTerminalApi(transport: WsTransport): WsRpcClient['terminal'] {
  return {
    open: input => transport.request(client => client[WS_METHODS.terminalOpen](input)),
    write: input => transport.request(client => client[WS_METHODS.terminalWrite](input)),
    resize: input => transport.request(client => client[WS_METHODS.terminalResize](input)),
    clear: input => transport.request(client => client[WS_METHODS.terminalClear](input)),
    restart: input => transport.request(client => client[WS_METHODS.terminalRestart](input)),
    close: input => transport.request(client => client[WS_METHODS.terminalClose](input)),
    onEvent: (listener, options) =>
      transport.subscribe(
        client => client[WS_METHODS.subscribeTerminalEvents]({}),
        listener,
        options
      ),
  }
}

function createProjectsApi(transport: WsTransport): WsRpcClient['projects'] {
  return {
    listEntries: input =>
      transport.request(client => client[WS_METHODS.projectsListEntries](input)),
    searchEntries: input =>
      transport.request(client => client[WS_METHODS.projectsSearchEntries](input)),
    readFile: input => transport.request(client => client[WS_METHODS.projectsReadFile](input)),
    writeFile: input => transport.request(client => client[WS_METHODS.projectsWriteFile](input)),
  }
}

function createShellApi(transport: WsTransport): WsRpcClient['shell'] {
  return {
    openInEditor: input => transport.request(client => client[WS_METHODS.shellOpenInEditor](input)),
  }
}

function createGitApi(transport: WsTransport): WsRpcClient['git'] {
  return {
    pull: input => transport.request(client => client[WS_METHODS.gitPull](input)),
    status: input => transport.request(client => client[WS_METHODS.gitStatus](input)),
    runStackedAction: async (input, options) => {
      let result: GitRunStackedActionResult | null = null

      await transport.requestStream(
        client => client[WS_METHODS.gitRunStackedAction](input),
        event => {
          options?.onProgress?.(event)
          if (event.kind === 'action_finished') {
            result = event.result
          }
        }
      )

      if (result) {
        return result
      }

      throw new Error('Git action stream completed without a final result.')
    },
    listBranches: input => transport.request(client => client[WS_METHODS.gitListBranches](input)),
    createWorktree: input =>
      transport.request(client => client[WS_METHODS.gitCreateWorktree](input)),
    removeWorktree: input =>
      transport.request(client => client[WS_METHODS.gitRemoveWorktree](input)),
    createBranch: input => transport.request(client => client[WS_METHODS.gitCreateBranch](input)),
    checkout: input => transport.request(client => client[WS_METHODS.gitCheckout](input)),
    init: input => transport.request(client => client[WS_METHODS.gitInit](input)),
    resolvePullRequest: input =>
      transport.request(client => client[WS_METHODS.gitResolvePullRequest](input)),
    preparePullRequestThread: input =>
      transport.request(client => client[WS_METHODS.gitPreparePullRequestThread](input)),
    getDiff: input => transport.request(client => client[WS_METHODS.gitGetDiff](input)),
    getLog: input => transport.request(client => client[WS_METHODS.gitGetLog](input)),
    getIssues: input => transport.request(client => client[WS_METHODS.gitGetIssues](input)),
    getPullRequests: input =>
      transport.request(client => client[WS_METHODS.gitGetPullRequests](input)),
    stageAll: input => transport.request(client => client[WS_METHODS.gitStageAll](input)),
    restoreAllUnstaged: input =>
      transport.request(client => client[WS_METHODS.gitRestoreAllUnstaged](input)),
    stagePath: input => transport.request(client => client[WS_METHODS.gitStagePath](input)),
    unstagePath: input => transport.request(client => client[WS_METHODS.gitUnstagePath](input)),
    restorePath: input => transport.request(client => client[WS_METHODS.gitRestorePath](input)),
    discoverRepos: input => transport.request(client => client[WS_METHODS.gitDiscoverRepos](input)),
  }
}

function createServerApi(transport: WsTransport): WsRpcClient['server'] {
  return {
    getConfig: () => transport.request(client => client[WS_METHODS.serverGetConfig]({})),
    refreshProviders: () =>
      transport.request(client => client[WS_METHODS.serverRefreshProviders]({})),
    upsertKeybinding: input =>
      transport.request(client => client[WS_METHODS.serverUpsertKeybinding](input)),
    getSettings: () => transport.request(client => client[WS_METHODS.serverGetSettings]({})),
    updateSettings: patch =>
      transport.request(client => client[WS_METHODS.serverUpdateSettings]({ patch })),
    subscribeConfig: (listener, options) =>
      transport.subscribe(
        client => client[WS_METHODS.subscribeServerConfig]({}),
        listener,
        options
      ),
    subscribeLifecycle: (listener, options) =>
      transport.subscribe(
        client => client[WS_METHODS.subscribeServerLifecycle]({}),
        listener,
        options
      ),
  }
}

function createProviderApi(transport: WsTransport): WsRpcClient['provider'] {
  return {
    listAgents: input => transport.request(client => client[WS_METHODS.providerListAgents](input)),
    getComposerCapabilities: input =>
      transport.request(client => client[WS_METHODS.providerGetComposerCapabilities](input)),
    listCommands: input =>
      transport.request(client => client[WS_METHODS.providerListCommands](input)),
    listPlugins: input =>
      transport.request(client => client[WS_METHODS.providerListPlugins](input)),
  }
}

function createSkillsApi(transport: WsTransport): WsRpcClient['skills'] {
  return {
    list: input => transport.request(client => client[WS_METHODS.skillsList](input)),
    refresh: input => transport.request(client => client[WS_METHODS.skillsRefresh](input)),
    getRoots: () => transport.request(client => client[WS_METHODS.skillsGetRoots]({})),
    setRoots: input => transport.request(client => client[WS_METHODS.skillsSetRoots](input)),
  }
}

function createDashboardApi(transport: WsTransport): WsRpcClient['dashboard'] {
  return {
    getSnapshot: () => transport.request(client => client[WS_METHODS.dashboardGetSnapshot]({})),
    refresh: () => transport.request(client => client[WS_METHODS.dashboardRefresh]({})),
    getProviderUsage: input =>
      transport.request(client => client[WS_METHODS.dashboardGetProviderUsage](input)),
  }
}

function createOrchestrationApi(transport: WsTransport): WsRpcClient['orchestration'] {
  return {
    getSnapshot: () =>
      transport.request(client => client[ORCHESTRATION_WS_METHODS.getSnapshot]({})),
    dispatchCommand: input =>
      transport.request(client => client[ORCHESTRATION_WS_METHODS.dispatchCommand](input)),
    getTurnDiff: input =>
      transport.request(client => client[ORCHESTRATION_WS_METHODS.getTurnDiff](input)),
    getFullThreadDiff: input =>
      transport.request(client => client[ORCHESTRATION_WS_METHODS.getFullThreadDiff](input)),
    replayEvents: input =>
      transport
        .request(client => client[ORCHESTRATION_WS_METHODS.replayEvents](input))
        .then(events => [...events]),
    onDomainEvent: (listener, options) =>
      transport.subscribe(
        client => client[WS_METHODS.subscribeOrchestrationDomainEvents]({}),
        listener,
        options
      ),
  }
}

export function createWsRpcClient(transport = new WsTransport()): WsRpcClient {
  return {
    dispose: () => transport.dispose(),
    reconnect: () => transport.reconnect(),
    terminal: createTerminalApi(transport),
    projects: createProjectsApi(transport),
    shell: createShellApi(transport),
    git: createGitApi(transport),
    server: createServerApi(transport),
    provider: createProviderApi(transport),
    skills: createSkillsApi(transport),
    dashboard: createDashboardApi(transport),
    orchestration: createOrchestrationApi(transport),
  }
}
