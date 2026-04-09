import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer'
import * as NodeServices from '@effect/platform-node/NodeServices'
import * as NodeSocket from '@effect/platform-node/NodeSocket'
import {
  DEFAULT_SERVER_SETTINGS,
  EditorId,
  ProjectId,
  ThreadId,
  WsRpcGroup,
  type OrchestrationEvent,
} from '@orxa-code/contracts'
import { Effect, FileSystem, Layer, Path, Stream } from 'effect'
import { HttpRouter, HttpServer } from 'effect/unstable/http'
import { RpcClient, RpcSerialization } from 'effect/unstable/rpc'

import type { ServerConfigShape } from './config.ts'
import { deriveServerPaths, ServerConfig } from './config.ts'
import { makeRoutesLayer } from './server.ts'
import {
  CheckpointDiffQuery,
  type CheckpointDiffQueryShape,
} from './checkpointing/Services/CheckpointDiffQuery.ts'
import { GitCore, type GitCoreShape } from './git/Services/GitCore.ts'
import { GitHubCli, type GitHubCliShape } from './git/Services/GitHubCli.ts'
import { GitManager, type GitManagerShape } from './git/Services/GitManager.ts'
import { Keybindings, type KeybindingsShape } from './keybindings.ts'
import { Open, type OpenShape } from './open.ts'
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from './orchestration/Services/OrchestrationEngine.ts'
import {
  DashboardQuery,
  type DashboardQueryShape,
} from './orchestration/Services/DashboardQuery.ts'
import {
  ProviderUsageQuery,
  type ProviderUsageQueryShape,
} from './orchestration/Services/ProviderUsageQuery.ts'
import { emptyProviderUsageSnapshot } from './orchestration/Layers/ProviderUsageQuery.ts'
import { SkillsService, type SkillsServiceShape } from './skills/Services/SkillsService.ts'
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from './orchestration/Services/ProjectionSnapshotQuery.ts'
import { OpencodeAdapter } from './provider/Services/OpencodeAdapter.ts'
import {
  ProviderDiscoveryService,
  type ProviderDiscoveryServiceShape,
} from './provider/Services/ProviderDiscoveryService.ts'
import {
  ProviderRegistry,
  type ProviderRegistryShape,
} from './provider/Services/ProviderRegistry.ts'
import { ProjectFaviconResolverLive } from './project/Layers/ProjectFaviconResolver.ts'
import { ServerLifecycleEvents, type ServerLifecycleEventsShape } from './serverLifecycleEvents.ts'
import { ServerRuntimeStartup, type ServerRuntimeStartupShape } from './serverRuntimeStartup.ts'
import { ServerSettingsService, type ServerSettingsShape } from './serverSettings.ts'
import { TerminalManager, type TerminalManagerShape } from './terminal/Services/Manager.ts'
import { WorkspaceEntriesLive } from './workspace/Layers/WorkspaceEntries.ts'
import { WorkspaceFileSystemLive } from './workspace/Layers/WorkspaceFileSystem.ts'
import { WorkspacePathsLive } from './workspace/Layers/WorkspacePaths.ts'

export const defaultProjectId = ProjectId.makeUnsafe('project-default')
export const defaultThreadId = ThreadId.makeUnsafe('thread-default')
export const defaultModelSelection = {
  provider: 'codex',
  model: 'gpt-5-codex',
} as const

export const makeDefaultOrchestrationReadModel = () => {
  const now = new Date().toISOString()
  return {
    snapshotSequence: 0,
    updatedAt: now,
    projects: [
      {
        id: defaultProjectId,
        title: 'Default Project',
        workspaceRoot: '/tmp/default-project',
        defaultModelSelection,
        scripts: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: defaultThreadId,
        projectId: defaultProjectId,
        title: 'Default Thread',
        modelSelection: defaultModelSelection,
        interactionMode: 'default' as const,
        runtimeMode: 'full-access' as const,
        branch: null,
        worktreePath: null,
        handoff: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        latestTurn: null,
        messages: [],
        session: null,
        activities: [],
        proposedPlans: [],
        checkpoints: [],
        deletedAt: null,
      },
    ],
  }
}

const workspaceAndProjectServicesLayer = Layer.mergeAll(
  WorkspacePathsLive,
  WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive)),
  WorkspaceFileSystemLive.pipe(
    Layer.provide(WorkspacePathsLive),
    Layer.provide(WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive)))
  ),
  ProjectFaviconResolverLive
)

export interface TestServerLayerOverrides {
  readonly providerDiscoveryService?: Partial<ProviderDiscoveryServiceShape>
  readonly keybindings?: Partial<KeybindingsShape>
  readonly providerRegistry?: Partial<ProviderRegistryShape>
  readonly serverSettings?: Partial<ServerSettingsShape>
  readonly open?: Partial<OpenShape>
  readonly gitCore?: Partial<GitCoreShape>
  readonly gitHubCli?: Partial<GitHubCliShape>
  readonly gitManager?: Partial<GitManagerShape>
  readonly terminalManager?: Partial<TerminalManagerShape>
  readonly orchestrationEngine?: Partial<OrchestrationEngineShape>
  readonly projectionSnapshotQuery?: Partial<ProjectionSnapshotQueryShape>
  readonly dashboardQuery?: Partial<DashboardQueryShape>
  readonly providerUsageQuery?: Partial<ProviderUsageQueryShape>
  readonly skillsService?: Partial<SkillsServiceShape>
  readonly checkpointDiffQuery?: Partial<CheckpointDiffQueryShape>
  readonly serverLifecycleEvents?: Partial<ServerLifecycleEventsShape>
  readonly serverRuntimeStartup?: Partial<ServerRuntimeStartupShape>
}

const makeServerConfig = (
  tempBaseDir: string,
  config?: Partial<ServerConfigShape>
): Effect.Effect<ServerConfigShape, never, Path.Path> =>
  Effect.gen(function* () {
    const baseDir = config?.baseDir ?? tempBaseDir
    const devUrl = config?.devUrl
    const derivedPaths = yield* deriveServerPaths(baseDir, devUrl)
    return {
      logLevel: 'Info',
      mode: 'web',
      port: 0,
      host: '127.0.0.1',
      cwd: process.cwd(),
      baseDir,
      ...derivedPaths,
      staticDir: undefined,
      devUrl,
      noBrowser: true,
      authToken: undefined,
      autoBootstrapProjectFromCwd: false,
      logWebSocketEvents: false,
      ...config,
    } satisfies ServerConfigShape
  })

const emptyDashboardSnapshot = () => ({
  updatedAt: new Date(0).toISOString(),
  projects: 0,
  threadsTotal: 0,
  threads7d: 0,
  threads30d: 0,
  recentSessions: [],
  daySeries: [],
})

// emptyProviderUsageSnapshot imported from ProviderUsageQuery layer

const makeOrchestrationMockLayers = (overrides?: TestServerLayerOverrides) =>
  Layer.mergeAll(
    Layer.mock(OrchestrationEngineService)({
      getReadModel: () => Effect.succeed(makeDefaultOrchestrationReadModel()),
      readEvents: () => Stream.empty,
      dispatch: () => Effect.succeed({ sequence: 0 }),
      streamDomainEvents: Stream.empty,
      ...overrides?.orchestrationEngine,
    }),
    Layer.mock(ProjectionSnapshotQuery)({
      getSnapshot: () => Effect.succeed(makeDefaultOrchestrationReadModel()),
      ...overrides?.projectionSnapshotQuery,
    }),
    Layer.mock(DashboardQuery)({
      getSnapshot: () => Effect.succeed(emptyDashboardSnapshot()),
      ...overrides?.dashboardQuery,
    }),
    Layer.mock(ProviderUsageQuery)({
      getSnapshot: ({ provider }) => Effect.succeed(emptyProviderUsageSnapshot(provider)),
      ...overrides?.providerUsageQuery,
    }),
    Layer.mock(SkillsService)({
      list: () => Effect.succeed({ skills: [], updatedAt: new Date(0).toISOString() }),
      refresh: () => Effect.succeed({ skills: [], updatedAt: new Date(0).toISOString() }),
      getRoots: () =>
        Effect.succeed({
          roots: { codex: [], claudeAgent: [], opencode: [] },
        }),
      setRoots: ({ roots }) => Effect.succeed({ roots }),
      ...overrides?.skillsService,
    }),
    Layer.mock(CheckpointDiffQuery)({
      getTurnDiff: () =>
        Effect.succeed({
          threadId: defaultThreadId,
          fromTurnCount: 0,
          toTurnCount: 0,
          diff: '',
        }),
      getFullThreadDiff: () =>
        Effect.succeed({
          threadId: defaultThreadId,
          fromTurnCount: 0,
          toTurnCount: 0,
          diff: '',
        }),
      ...overrides?.checkpointDiffQuery,
    }),
    Layer.mock(ServerLifecycleEvents)({
      publish: event => Effect.succeed({ ...event, sequence: 1 }),
      snapshot: Effect.succeed({ sequence: 0, events: [] }),
      stream: Stream.empty,
      ...overrides?.serverLifecycleEvents,
    }),
    Layer.mock(ServerRuntimeStartup)({
      awaitCommandReady: Effect.void,
      markHttpListening: Effect.void,
      enqueueCommand: effect => effect,
      ...overrides?.serverRuntimeStartup,
    }),
    Layer.mock(OpencodeAdapter)({
      provider: 'opencode',
      capabilities: { sessionModelSwitch: 'in-session' },
      listPrimaryAgents: () => Effect.succeed([]),
    })
  )

const makeBaseMockLayer = (overrides?: TestServerLayerOverrides) =>
  Layer.mergeAll(
    Layer.mock(Keybindings)({
      streamChanges: Stream.empty,
      ...overrides?.keybindings,
    }),
    Layer.mock(ProviderRegistry)({
      getProviders: Effect.succeed([]),
      refresh: () => Effect.succeed([]),
      streamChanges: Stream.empty,
      ...overrides?.providerRegistry,
    }),
    Layer.mock(ProviderDiscoveryService)({
      getComposerCapabilities: ({ provider }) =>
        Effect.succeed({
          provider,
          supportsSkillMentions: true,
          supportsSkillDiscovery: true,
          supportsNativeSlashCommandDiscovery: provider === 'claudeAgent',
          supportsPluginDiscovery: provider !== 'opencode',
        }),
      listCommands: () => Effect.succeed({ commands: [], updatedAt: new Date(0).toISOString() }),
      listPlugins: () =>
        Effect.succeed({ plugins: [], warnings: [], updatedAt: new Date(0).toISOString() }),
      ...overrides?.providerDiscoveryService,
    }),
    Layer.mock(ServerSettingsService)({
      start: Effect.void,
      ready: Effect.void,
      getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
      updateSettings: () => Effect.succeed(DEFAULT_SERVER_SETTINGS),
      streamChanges: Stream.empty,
      ...overrides?.serverSettings,
    }),
    Layer.mock(Open)({
      ...overrides?.open,
    }),
    Layer.mock(GitCore)({
      ...overrides?.gitCore,
    }),
    Layer.mock(GitHubCli)({
      ...overrides?.gitHubCli,
    }),
    Layer.mock(GitManager)({
      ...overrides?.gitManager,
    }),
    Layer.mock(TerminalManager)({
      ...overrides?.terminalManager,
    }),
    makeOrchestrationMockLayers(overrides)
  )

export const buildAppUnderTest = (options?: {
  readonly config?: Partial<ServerConfigShape>
  readonly layers?: TestServerLayerOverrides
}) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const tempBaseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'orxa-router-test-' })
    const config = yield* makeServerConfig(tempBaseDir, options?.config)
    const layerConfig = Layer.succeed(ServerConfig, config)
    const appLayer = HttpRouter.serve(makeRoutesLayer, {
      disableListenLog: true,
      disableLogger: true,
    }).pipe(
      Layer.provide(makeBaseMockLayer(options?.layers)),
      Layer.provide(workspaceAndProjectServicesLayer),
      Layer.provide(layerConfig)
    )

    yield* Layer.build(appLayer)
    return config
  })

const wsRpcProtocolLayer = (wsUrl: string) =>
  RpcClient.layerProtocolSocket().pipe(
    Layer.provide(NodeSocket.layerWebSocket(wsUrl)),
    Layer.provide(RpcSerialization.layerJson)
  )

const makeWsRpcClient = RpcClient.make(WsRpcGroup)
export type WsRpcClient =
  typeof makeWsRpcClient extends Effect.Effect<infer Client, unknown, unknown> ? Client : never

export const withWsRpcClient = <A, E, R>(
  wsUrl: string,
  f: (client: WsRpcClient) => Effect.Effect<A, E, R>
) => makeWsRpcClient.pipe(Effect.flatMap(f), Effect.provide(wsRpcProtocolLayer(wsUrl)))

export const getHttpServerUrl = (pathname = '') =>
  Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer
    const address = server.address as HttpServer.TcpAddress
    return `http://127.0.0.1:${address.port}${pathname}`
  })

export const getWsServerUrl = (pathname = '') =>
  Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer
    const address = server.address as HttpServer.TcpAddress
    return `ws://127.0.0.1:${address.port}${pathname}`
  })

export const provideServerTest = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(Layer.mergeAll(NodeHttpServer.layerTest, NodeServices.layer)))

export const makeRevertedEvent = (
  threadId: ThreadId,
  now: string,
  sequence: number
): OrchestrationEvent =>
  ({
    sequence,
    eventId: `event-${sequence}`,
    aggregateKind: 'thread',
    aggregateId: threadId,
    occurredAt: now,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: 'thread.reverted',
    payload: {
      threadId,
      turnCount: sequence,
    },
  }) as OrchestrationEvent

export const asEditorId = (value: string): EditorId => value as EditorId
