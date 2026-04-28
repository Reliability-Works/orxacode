import { Effect, Layer } from 'effect'
import { FetchHttpClient, HttpRouter, HttpServer } from 'effect/unstable/http'
import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer'
import * as NodeServices from '@effect/platform-node/NodeServices'
import * as NodeHttp from 'node:http'

import { ServerConfig } from './config'
import {
  attachmentsRouteLayer,
  projectFaviconRouteLayer,
  serverEnvironmentGetRouteLayer,
  serverEnvironmentRouteLayer,
  staticAndDevRouteLayer,
} from './http'
import {
  mobileSyncBootstrapRouteLayer,
  mobileSyncLogRouteLayer,
  mobileSyncPreflightRouteLayer,
} from './mobileSync/http'
import {
  authBearerBootstrapRouteLayer,
  authBootstrapRouteLayer,
  authClientsRevokeOthersRouteLayer,
  authClientsRevokeRouteLayer,
  authClientsRouteLayer,
  authPreflightRouteLayer,
  authSessionRouteLayer,
} from './auth/http'
import { fixPath } from './os-jank'
import { websocketRpcRouteLayer } from './ws'
import { OpenLive } from './open'
import { layerConfig as SqlitePersistenceLayerLive } from './persistence/Layers/Sqlite'
import { ServerLifecycleEventsLive } from './serverLifecycleEvents'
import { AnalyticsServiceLayerLive } from './telemetry/Layers/AnalyticsService'
import { makeEventNdjsonLogger } from './provider/Layers/EventNdjsonLogger'
import { isDevBuild } from './runtimeMode'
import { ProviderSessionDirectoryLive } from './provider/Layers/ProviderSessionDirectory'
import { ProviderSessionRuntimeRepositoryLive } from './persistence/Layers/ProviderSessionRuntime'
import { makeCodexAdapterLive } from './provider/Layers/CodexAdapter'
import { makeClaudeAdapterLive } from './provider/Layers/ClaudeAdapter'
import { makeOpencodeAdapterLive } from './provider/Layers/OpencodeAdapter'
import { ProviderAdapterRegistryLive } from './provider/Layers/ProviderAdapterRegistry'
import { makeProviderServiceLive } from './provider/Layers/ProviderService'
import { OrchestrationEngineLive } from './orchestration/Layers/OrchestrationEngine'
import { OrchestrationProjectionPipelineLive } from './orchestration/Layers/ProjectionPipeline'
import { OrchestrationEventStoreLive } from './persistence/Layers/OrchestrationEventStore'
import { OrchestrationCommandReceiptRepositoryLive } from './persistence/Layers/OrchestrationCommandReceipts'
import { CheckpointDiffQueryLive } from './checkpointing/Layers/CheckpointDiffQuery'
import { OrchestrationProjectionSnapshotQueryLive } from './orchestration/Layers/ProjectionSnapshotQuery'
import { DashboardQueryLive } from './orchestration/Layers/DashboardQuery'
import { ProviderUsageQueryLive } from './orchestration/Layers/ProviderUsageQuery'
import { SkillsServiceLive } from './skills/Layers/SkillsService'
import { CheckpointStoreLive } from './checkpointing/Layers/CheckpointStore'
import { GitCoreLive } from './git/Layers/GitCore'
import { GitHubCliLive } from './git/Layers/GitHubCli'
import { RoutingTextGenerationLive } from './git/Layers/RoutingTextGeneration'
import { TerminalManagerLive } from './terminal/Layers/Manager'
import { GitManagerLive } from './git/Layers/GitManager'
import { KeybindingsLive } from './keybindings'
import { ObservabilityLive } from './observability/Layers/Observability'
import { ServerRuntimeStartup, ServerRuntimeStartupLive } from './serverRuntimeStartup'
import { OrchestrationReactorLive } from './orchestration/Layers/OrchestrationReactor'
import { RuntimeReceiptBusLive } from './orchestration/Layers/RuntimeReceiptBus'
import { ProviderRuntimeIngestionLive } from './orchestration/Layers/ProviderRuntimeIngestion'
import { ProviderCommandReactorLive } from './orchestration/Layers/ProviderCommandReactor'
import { CheckpointReactorLive } from './orchestration/Layers/CheckpointReactor'
import { ProviderRegistryLive } from './provider/Layers/ProviderRegistry'
import { ProviderDiscoveryServiceLive } from './provider/Layers/ProviderDiscoveryService'
import { ServerSettingsLive } from './serverSettings'
import { ProjectFaviconResolverLive } from './project/Layers/ProjectFaviconResolver'
import { WorkspaceEntriesLive } from './workspace/Layers/WorkspaceEntries'
import { WorkspaceFileSystemLive } from './workspace/Layers/WorkspaceFileSystem'
import { WorkspacePathsLive } from './workspace/Layers/WorkspacePaths'
import { layer as NodePtyAdapterLive } from './terminal/Layers/NodePTY'
import { ServerAuthLive } from './auth/service'

const PtyAdapterLive = NodePtyAdapterLive

const HttpServerLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig
    return NodeHttpServer.layer(NodeHttp.createServer, {
      host: config.host,
      port: config.port,
    })
  })
)

const PlatformServicesLive = NodeServices.layer

const ReactorLayerLive = Layer.empty.pipe(
  Layer.provideMerge(OrchestrationReactorLive),
  Layer.provideMerge(ProviderRuntimeIngestionLive),
  Layer.provideMerge(ProviderCommandReactorLive),
  Layer.provideMerge(CheckpointReactorLive),
  Layer.provideMerge(RuntimeReceiptBusLive)
)

const OrchestrationEventInfrastructureLayerLive = Layer.mergeAll(
  OrchestrationEventStoreLive,
  OrchestrationCommandReceiptRepositoryLive
)

const OrchestrationProjectionPipelineLayerLive = OrchestrationProjectionPipelineLive.pipe(
  Layer.provide(OrchestrationEventStoreLive)
)

const OrchestrationInfrastructureLayerLive = Layer.mergeAll(
  OrchestrationProjectionSnapshotQueryLive,
  DashboardQueryLive,
  ProviderUsageQueryLive,
  SkillsServiceLive,
  OrchestrationEventInfrastructureLayerLive,
  OrchestrationProjectionPipelineLayerLive
)

const OrchestrationLayerLive = Layer.mergeAll(
  OrchestrationInfrastructureLayerLive,
  OrchestrationEngineLive.pipe(Layer.provide(OrchestrationInfrastructureLayerLive))
)

const CheckpointingLayerLive = Layer.empty.pipe(
  Layer.provideMerge(CheckpointDiffQueryLive),
  Layer.provideMerge(CheckpointStoreLive)
)

const ProviderLayerLive = Layer.unwrap(
  Effect.gen(function* () {
    const { providerEventLogPath } = yield* ServerConfig
    // NDJSON event logging is a dev-only diagnostic: it retains full raw
    // provider payloads on disk (MB/min on busy sessions) and in-memory via
    // the batched logger. In packaged builds we skip it entirely — adapters
    // and ProviderService accept undefined loggers and no-op.
    const nativeEventLogger = isDevBuild()
      ? yield* makeEventNdjsonLogger(providerEventLogPath, { stream: 'native' })
      : undefined
    const canonicalEventLogger = isDevBuild()
      ? yield* makeEventNdjsonLogger(providerEventLogPath, { stream: 'canonical' })
      : undefined
    const providerSessionDirectoryLayer = ProviderSessionDirectoryLive.pipe(
      Layer.provide(ProviderSessionRuntimeRepositoryLive)
    )
    const codexAdapterLayer = makeCodexAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined
    )
    const claudeAdapterLayer = makeClaudeAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined
    )
    const opencodeAdapterLayer = makeOpencodeAdapterLive()
    const adapterRegistryLayer = ProviderAdapterRegistryLive.pipe(
      Layer.provide(codexAdapterLayer),
      Layer.provide(claudeAdapterLayer),
      // The websocket RPC handler for `provider.listAgents` reaches into the
      // OpencodeAdapter directly, so we expose it upward via `provideMerge`
      // alongside the registry instead of consuming it inline here.
      Layer.provideMerge(opencodeAdapterLayer),
      Layer.provideMerge(providerSessionDirectoryLayer)
    )
    return makeProviderServiceLive(
      canonicalEventLogger ? { canonicalEventLogger } : undefined
    ).pipe(Layer.provideMerge(adapterRegistryLayer), Layer.provide(providerSessionDirectoryLayer))
  })
)

const PersistenceLayerLive = Layer.empty.pipe(Layer.provideMerge(SqlitePersistenceLayerLive))

const GitLayerLive = Layer.empty.pipe(
  Layer.provideMerge(
    GitManagerLive.pipe(
      Layer.provideMerge(GitCoreLive),
      Layer.provideMerge(GitHubCliLive),
      Layer.provideMerge(RoutingTextGenerationLive)
    )
  ),
  Layer.provideMerge(GitCoreLive)
)

const TerminalLayerLive = TerminalManagerLive.pipe(Layer.provide(PtyAdapterLive))

const WorkspaceLayerLive = Layer.mergeAll(
  WorkspacePathsLive,
  WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive)),
  WorkspaceFileSystemLive.pipe(
    Layer.provide(WorkspacePathsLive),
    Layer.provide(WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive)))
  )
)

const RuntimeServicesLive = Layer.empty.pipe(
  Layer.provideMerge(ServerRuntimeStartupLive),
  Layer.provideMerge(ReactorLayerLive),

  // Core Services
  Layer.provideMerge(CheckpointingLayerLive),
  Layer.provideMerge(OrchestrationLayerLive),
  Layer.provideMerge(ProviderLayerLive),
  Layer.provideMerge(GitLayerLive),
  Layer.provideMerge(TerminalLayerLive),
  Layer.provideMerge(PersistenceLayerLive),
  Layer.provideMerge(KeybindingsLive),
  Layer.provideMerge(ProviderRegistryLive),
  Layer.provideMerge(ProviderDiscoveryServiceLive),
  Layer.provideMerge(ServerSettingsLive),
  Layer.provideMerge(ServerAuthLive),
  Layer.provideMerge(WorkspaceLayerLive),
  Layer.provideMerge(ProjectFaviconResolverLive),

  // Misc.
  Layer.provideMerge(AnalyticsServiceLayerLive),
  Layer.provideMerge(OpenLive),
  Layer.provideMerge(ServerLifecycleEventsLive)
)

export const makeRoutesLayer = Layer.mergeAll(
  authPreflightRouteLayer,
  authSessionRouteLayer,
  authBootstrapRouteLayer,
  authBearerBootstrapRouteLayer,
  authClientsRouteLayer,
  authClientsRevokeRouteLayer,
  authClientsRevokeOthersRouteLayer,
  attachmentsRouteLayer,
  projectFaviconRouteLayer,
  serverEnvironmentRouteLayer,
  serverEnvironmentGetRouteLayer,
  mobileSyncPreflightRouteLayer,
  mobileSyncBootstrapRouteLayer,
  mobileSyncLogRouteLayer,
  staticAndDevRouteLayer,
  websocketRpcRouteLayer
)

export const makeServerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig

    fixPath()

    const httpListeningLayer = Layer.effectDiscard(
      Effect.gen(function* () {
        yield* HttpServer.HttpServer
        const startup = yield* ServerRuntimeStartup
        yield* startup.markHttpListening
      })
    )

    const serverApplicationLayer = Layer.mergeAll(
      HttpRouter.serve(makeRoutesLayer, {
        disableLogger: !config.logWebSocketEvents,
      }),
      httpListeningLayer
    )

    return serverApplicationLayer.pipe(
      Layer.provideMerge(RuntimeServicesLive),
      Layer.provideMerge(HttpServerLive),
      Layer.provide(ObservabilityLive),
      Layer.provideMerge(FetchHttpClient.layer),
      Layer.provideMerge(PlatformServicesLive)
    )
  })
)

// Important: Only `ServerConfig` should be provided by the CLI layer!!! Don't let other requirements leak into the launch layer.
export const runServer = Layer.launch(makeServerLayer) satisfies Effect.Effect<
  never,
  unknown,
  ServerConfig
>
