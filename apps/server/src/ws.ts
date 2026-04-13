import { Effect, Layer, Queue, Ref, Schema, Stream } from 'effect'
import {
  type ClientOrchestrationCommand, type OrchestrationGetFullThreadDiffInput,
  OrchestrationDispatchCommandError,
  type OrchestrationGetTurnDiffInput, type OrchestrationEvent, type OrchestrationReplayEventsInput,
  type OpenInEditorInput, OrchestrationGetFullThreadDiffError, OrchestrationGetSnapshotError,
  OrchestrationGetTurnDiffError, ORCHESTRATION_WS_METHODS, type ProjectListEntriesInput,
  ProjectListEntriesError, type ProjectReadFileInput, ProjectReadFileError,
  type ProjectSearchEntriesInput, ProjectSearchEntriesError, type ProjectWriteFileInput,
  ProjectWriteFileError, type ProviderListAgentsInput, type ProviderListAgentsResult,
  OrchestrationReplayEventsError, type ServerSettingsPatch, type ServerUpsertKeybindingInput,
  type TerminalEvent, type TerminalClearInput, type TerminalCloseInput, type TerminalOpenInput,
  type TerminalResizeInput, type TerminalRestartInput,
  type TerminalWriteInput,
  WS_METHODS,
  WsRpcGroup,
} from '@orxa-code/contracts'
import { clamp } from 'effect/Number'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { RpcSerialization, RpcServer } from 'effect/unstable/rpc'
import * as Socket from 'effect/unstable/socket/Socket'
import { CheckpointDiffQuery } from './checkpointing/Services/CheckpointDiffQuery'
import { respondToAuthError } from './auth/http'
import { ServerAuth } from './auth/service'
import { ServerConfig } from './config'
import { DashboardQuery } from './orchestration/Services/DashboardQuery'
import { ProviderUsageQuery } from './orchestration/Services/ProviderUsageQuery'
import { GitCore } from './git/Services/GitCore'
import { GitHubCli } from './git/Services/GitHubCli'
import { GitManager } from './git/Services/GitManager'
import { Keybindings } from './keybindings'
import { Open } from './open'
import { normalizeDispatchCommand } from './orchestration/Normalizer'
import { OrchestrationEngineService } from './orchestration/Services/OrchestrationEngine'
import { OpencodeAdapter } from './provider/Services/OpencodeAdapter'
import { ProviderDiscoveryService } from './provider/Services/ProviderDiscoveryService'
import { ProviderRegistry } from './provider/Services/ProviderRegistry'
import { ServerLifecycleEvents } from './serverLifecycleEvents'
import { ServerRuntimeStartup } from './serverRuntimeStartup'
import { ServerSettingsService } from './serverSettings'
import { TerminalManager } from './terminal/Services/Manager'
import { WorkspaceEntries } from './workspace/Services/WorkspaceEntries'
import { WorkspaceFileSystem } from './workspace/Services/WorkspaceFileSystem'
import { SkillsService } from './skills/Services/SkillsService'
import { WorkspacePathOutsideRootError } from './workspace/Services/WorkspacePaths'
import { createDashboardMethods } from './ws.dashboard'
import { createGitMethods } from './ws.git'
import { loadServerConfigSnapshot } from './mobileSync/bootstrap'
import { logWebSocketUpgradeAuthenticated, logWebSocketUpgradeAuthError, logWebSocketUpgradeRequest } from './ws.mobileSyncLog'
import { logWsRpcError, logWsRpcInfo } from './ws.rpc.mobileSyncLog'
import { createServerConfigStream, createServerLifecycleStream } from './ws.serverStreams'
import { createProviderMethods } from './ws.provider'
import { createSkillsMethods } from './ws.skills'
import { createTrackedWebSocketProtocol } from './ws.protocol'

type WsRpcDependencies = {
  readonly dashboardQuery: typeof DashboardQuery.Service; readonly providerUsageQuery: typeof ProviderUsageQuery.Service
  readonly skillsService: typeof SkillsService.Service; readonly orchestrationEngine: typeof OrchestrationEngineService.Service
  readonly checkpointDiffQuery: typeof CheckpointDiffQuery.Service; readonly keybindings: typeof Keybindings.Service
  readonly open: typeof Open.Service; readonly gitManager: typeof GitManager.Service
  readonly git: typeof GitCore.Service; readonly gitHubCli: typeof GitHubCli.Service
  readonly terminalManager: typeof TerminalManager.Service; readonly providerRegistry: typeof ProviderRegistry.Service
  readonly opencodeAdapter: typeof OpencodeAdapter.Service; readonly providerDiscoveryService: typeof ProviderDiscoveryService.Service
  readonly config: typeof ServerConfig.Service; readonly lifecycleEvents: typeof ServerLifecycleEvents.Service
  readonly serverSettings: typeof ServerSettingsService.Service; readonly startup: typeof ServerRuntimeStartup.Service
  readonly workspaceEntries: typeof WorkspaceEntries.Service
  readonly workspaceFileSystem: typeof WorkspaceFileSystem.Service
}
const createLoadServerConfig = ({
  config,
  keybindings,
  providerRegistry,
  serverSettings,
}: Pick<WsRpcDependencies, 'config' | 'keybindings' | 'providerRegistry' | 'serverSettings'>) =>
  loadServerConfigSnapshot().pipe(
    Effect.provideService(ServerConfig, config),
    Effect.provideService(Keybindings, keybindings),
    Effect.provideService(ProviderRegistry, providerRegistry),
    Effect.provideService(ServerSettingsService, serverSettings)
  )

const createOrchestrationDomainEventStream = (
  orchestrationEngine: WsRpcDependencies['orchestrationEngine']
) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const snapshot = yield* orchestrationEngine.getReadModel()
      const fromSequenceExclusive = snapshot.snapshotSequence
      const replayEvents: Array<OrchestrationEvent> = yield* Stream.runCollect(
        orchestrationEngine.readEvents(fromSequenceExclusive)
      ).pipe(
        Effect.map(events => Array.from(events)),
        Effect.catch(() => Effect.succeed([] as Array<OrchestrationEvent>))
      )
      const replayStream = Stream.fromIterable(replayEvents)
      const source = Stream.merge(replayStream, orchestrationEngine.streamDomainEvents)
      type SequenceState = {
        readonly nextSequence: number
        readonly pendingBySequence: Map<number, OrchestrationEvent>
      }
      const state = yield* Ref.make<SequenceState>({
        nextSequence: fromSequenceExclusive + 1,
        pendingBySequence: new Map<number, OrchestrationEvent>(),
      })
      return source.pipe(
        Stream.mapEffect(event =>
          Ref.modify(
            state,
            ({ nextSequence, pendingBySequence }): [Array<OrchestrationEvent>, SequenceState] => {
              if (event.sequence < nextSequence || pendingBySequence.has(event.sequence)) {
                return [[], { nextSequence, pendingBySequence }]
              }
              const updatedPending = new Map(pendingBySequence)
              updatedPending.set(event.sequence, event)
              const emit: Array<OrchestrationEvent> = []
              let expected = nextSequence
              for (;;) {
                const expectedEvent = updatedPending.get(expected)
                if (!expectedEvent) {
                  break
                }
                emit.push(expectedEvent)
                updatedPending.delete(expected)
                expected += 1
              }
              return [emit, { nextSequence: expected, pendingBySequence: updatedPending }]
            }
          )
        ),
        Stream.flatMap(events => Stream.fromIterable(events))
      )
    })
  )

const createDispatchCommandHandler =
  ({ orchestrationEngine, startup }: Pick<WsRpcDependencies, 'orchestrationEngine' | 'startup'>) =>
  (command: ClientOrchestrationCommand) =>
    Effect.gen(function* () {
      const normalizedCommand = yield* normalizeDispatchCommand(command)
      return yield* startup.enqueueCommand(orchestrationEngine.dispatch(normalizedCommand))
    }).pipe(
      Effect.mapError(cause =>
        Schema.is(OrchestrationDispatchCommandError)(cause)
          ? cause
          : new OrchestrationDispatchCommandError({
              message: 'Failed to dispatch orchestration command',
              cause,
            })
      )
    )
const createReplayEventsHandler =
  (orchestrationEngine: WsRpcDependencies['orchestrationEngine']) =>
  (input: OrchestrationReplayEventsInput) =>
    Stream.runCollect(
      orchestrationEngine.readEvents(
        clamp(input.fromSequenceExclusive, { maximum: Number.MAX_SAFE_INTEGER, minimum: 0 })
      )
    ).pipe(
      Effect.map(events => Array.from(events)),
      Effect.mapError(
        cause =>
          new OrchestrationReplayEventsError({
            message: 'Failed to replay orchestration events',
            cause,
          })
      )
    )
const createServerGetSettingsHandler = (
  serverSettings: WsRpcDependencies['serverSettings']
) =>
  Effect.sync(() => {
    logWsRpcInfo('serverGetSettings:start', {})
  }).pipe(
    Effect.flatMap(() => serverSettings.getSettings),
    Effect.tap(settings =>
      Effect.sync(() => {
        logWsRpcInfo('serverGetSettings:done', {
          defaultThreadEnvMode: settings.defaultThreadEnvMode,
          enableAssistantStreaming: settings.enableAssistantStreaming,
        })
      })
    ),
    Effect.tapError(cause =>
      Effect.sync(() => {
        logWsRpcError('serverGetSettings:error', {
          cause,
        })
        })
      )
    )
const createOrchestrationMethods = ({
  checkpointDiffQuery,
  orchestrationEngine,
  startup,
}: Pick<
  WsRpcDependencies,
  'checkpointDiffQuery' | 'orchestrationEngine' | 'startup'
>) => ({
  [ORCHESTRATION_WS_METHODS.getSnapshot]: () =>
    Effect.sync(() => {
      logWsRpcInfo('orchestration.getSnapshot:start', {})
    }).pipe(
      Effect.flatMap(() => orchestrationEngine.getReadModel()),
      Effect.tap(snapshot =>
        Effect.sync(() => {
          logWsRpcInfo('orchestration.getSnapshot:done', {
            projects: snapshot.projects.filter(project => project.deletedAt === null).length,
            threads: snapshot.threads.filter(thread => thread.deletedAt === null).length,
            snapshotSequence: snapshot.snapshotSequence,
          })
        })
      ),
      Effect.tapError(cause =>
        Effect.sync(() => {
          logWsRpcError('orchestration.getSnapshot:error', {
            cause,
          })
        })
      ),
      Effect.mapError(
        cause =>
          new OrchestrationGetSnapshotError({
            message: 'Failed to load orchestration snapshot',
            cause,
          })
      )
    ),
  [ORCHESTRATION_WS_METHODS.dispatchCommand]: createDispatchCommandHandler({
    orchestrationEngine,
    startup,
  }),
  [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input: OrchestrationGetTurnDiffInput) =>
    checkpointDiffQuery.getTurnDiff(input).pipe(
      Effect.mapError(
        cause =>
          new OrchestrationGetTurnDiffError({
            message: 'Failed to load turn diff',
            cause,
          })
      )
    ),
  [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input: OrchestrationGetFullThreadDiffInput) =>
    checkpointDiffQuery.getFullThreadDiff(input).pipe(
      Effect.mapError(
        cause =>
          new OrchestrationGetFullThreadDiffError({
            message: 'Failed to load full thread diff',
            cause,
          })
      )
    ),
  [ORCHESTRATION_WS_METHODS.replayEvents]: createReplayEventsHandler(orchestrationEngine),
  [WS_METHODS.subscribeOrchestrationDomainEvents]: () =>
    createOrchestrationDomainEventStream(orchestrationEngine),
})
const createServerMethods = ({
  keybindings,
  loadServerConfig,
  lifecycleEvents,
  opencodeAdapter,
  providerRegistry,
  serverSettings,
}: Pick<WsRpcDependencies, 'keybindings' | 'lifecycleEvents' | 'opencodeAdapter' | 'providerRegistry' | 'serverSettings'> & {
  readonly loadServerConfig: ReturnType<typeof createLoadServerConfig>
}) => ({
  [WS_METHODS.serverGetConfig]: () =>
    Effect.sync(() => {
      logWsRpcInfo('serverGetConfig:start', {})
    }).pipe(
      Effect.flatMap(() => loadServerConfig),
      Effect.tap(config =>
        Effect.sync(() => {
          logWsRpcInfo('serverGetConfig:done', {
            issues: config.issues.length,
            keybindings: config.keybindings.length,
            providers: config.providers.length,
          })
        })
      ),
      Effect.tapError(cause =>
        Effect.sync(() => {
          logWsRpcError('serverGetConfig:error', {
            cause,
          })
        })
      )
    ),
  [WS_METHODS.serverRefreshProviders]: () =>
    providerRegistry.refresh().pipe(Effect.map(providers => ({ providers }))),
  [WS_METHODS.providerListAgents]: (
    input: ProviderListAgentsInput
  ): Effect.Effect<ProviderListAgentsResult> => {
    if (input.provider !== 'opencode') {
      return Effect.succeed({ agents: [] satisfies ProviderListAgentsResult['agents'] })
    }
    return opencodeAdapter
      .listPrimaryAgents()
      .pipe(Effect.map(agents => ({ agents }) satisfies ProviderListAgentsResult))
  },
  [WS_METHODS.serverUpsertKeybinding]: (rule: ServerUpsertKeybindingInput) =>
    Effect.gen(function* () {
      const keybindingsConfig = yield* keybindings.upsertKeybindingRule(rule)
      return { keybindings: keybindingsConfig, issues: [] }
    }),
  [WS_METHODS.serverGetSettings]: () => createServerGetSettingsHandler(serverSettings),
  [WS_METHODS.serverUpdateSettings]: ({ patch }: { readonly patch: ServerSettingsPatch }) =>
    serverSettings.updateSettings(patch),
  [WS_METHODS.subscribeServerConfig]: () =>
    createServerConfigStream({
      keybindings,
      loadServerConfig,
      providerRegistry,
      serverSettings,
    }),
  [WS_METHODS.subscribeServerLifecycle]: () => createServerLifecycleStream(lifecycleEvents),
})
const createProjectMethods = ({
  open,
  workspaceEntries,
  workspaceFileSystem,
}: Pick<WsRpcDependencies, 'open' | 'workspaceEntries' | 'workspaceFileSystem'>) => ({
  [WS_METHODS.projectsListEntries]: (input: ProjectListEntriesInput) =>
    workspaceEntries.list(input.cwd).pipe(
      Effect.mapError(
        cause =>
          new ProjectListEntriesError({
            message: `Failed to list workspace entries: ${cause.detail}`,
          })
      )
    ),
  [WS_METHODS.projectsSearchEntries]: (input: ProjectSearchEntriesInput) =>
    workspaceEntries.search(input).pipe(
      Effect.mapError(
        cause =>
          new ProjectSearchEntriesError({
            message: `Failed to search workspace entries: ${cause.detail}`,
          })
      )
    ),
  [WS_METHODS.projectsReadFile]: (input: ProjectReadFileInput) =>
    workspaceFileSystem.readFile(input).pipe(
      Effect.mapError(cause => {
        if (cause._tag === 'WorkspacePathOutsideRootError') {
          return new ProjectReadFileError({
            message: 'Workspace file path must stay within the project root.',
            cause,
          })
        }
        return new ProjectReadFileError({
          message: cause.detail,
          cause,
        })
      })
    ),
  [WS_METHODS.projectsWriteFile]: (input: ProjectWriteFileInput) =>
    workspaceFileSystem.writeFile(input).pipe(
      Effect.mapError(cause => {
        const message = Schema.is(WorkspacePathOutsideRootError)(cause)
          ? 'Workspace file path must stay within the project root.'
          : 'Failed to write workspace file'
        return new ProjectWriteFileError({
          message,
          cause,
        })
      })
    ),
  [WS_METHODS.shellOpenInEditor]: (input: OpenInEditorInput) => open.openInEditor(input),
})
const createTerminalMethods = ({
  terminalManager,
}: Pick<WsRpcDependencies, 'terminalManager'>) => ({
  [WS_METHODS.terminalOpen]: (input: TerminalOpenInput) => terminalManager.open(input),
  [WS_METHODS.terminalWrite]: (input: TerminalWriteInput) => terminalManager.write(input),
  [WS_METHODS.terminalResize]: (input: TerminalResizeInput) => terminalManager.resize(input),
  [WS_METHODS.terminalClear]: (input: TerminalClearInput) => terminalManager.clear(input),
  [WS_METHODS.terminalRestart]: (input: TerminalRestartInput) => terminalManager.restart(input),
  [WS_METHODS.terminalClose]: (input: TerminalCloseInput) => terminalManager.close(input),
  [WS_METHODS.subscribeTerminalEvents]: () =>
    Stream.callback<TerminalEvent>(queue =>
      Effect.acquireRelease(
        terminalManager.subscribe(event => Queue.offer(queue, event)),
        unsubscribe => Effect.sync(unsubscribe)
      )
    ),
})
const WsRpcLayer = WsRpcGroup.toLayer(
  Effect.gen(function* () {
    const dependencies: WsRpcDependencies = {
      dashboardQuery: yield* DashboardQuery,
      providerUsageQuery: yield* ProviderUsageQuery,
      skillsService: yield* SkillsService,
      orchestrationEngine: yield* OrchestrationEngineService,
      checkpointDiffQuery: yield* CheckpointDiffQuery,
      keybindings: yield* Keybindings,
      open: yield* Open,
      gitManager: yield* GitManager,
      git: yield* GitCore,
      gitHubCli: yield* GitHubCli,
      terminalManager: yield* TerminalManager,
      providerRegistry: yield* ProviderRegistry,
      opencodeAdapter: yield* OpencodeAdapter,
      providerDiscoveryService: yield* ProviderDiscoveryService,
      config: yield* ServerConfig,
      lifecycleEvents: yield* ServerLifecycleEvents,
      serverSettings: yield* ServerSettingsService,
      startup: yield* ServerRuntimeStartup,
      workspaceEntries: yield* WorkspaceEntries,
      workspaceFileSystem: yield* WorkspaceFileSystem,
    }
    const loadServerConfig = createLoadServerConfig(dependencies)
    return WsRpcGroup.of({
      ...createOrchestrationMethods(dependencies),
      ...createServerMethods({ ...dependencies, loadServerConfig }),
      ...createProjectMethods(dependencies),
      ...createGitMethods(dependencies),
      ...createTerminalMethods(dependencies),
      ...createDashboardMethods(dependencies),
      ...createProviderMethods(dependencies),
      ...createSkillsMethods(dependencies),
    })
  })
)
export const websocketRpcRouteLayer = HttpRouter.add(
  'GET',
  '/ws',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    logWebSocketUpgradeRequest(request)
    return yield* Effect.gen(function* () {
      const serverAuth = yield* ServerAuth
      const session = yield* serverAuth.authenticateWebSocketUpgrade(request)
      logWebSocketUpgradeAuthenticated(session)
      const { onSocket, protocol } = yield* createTrackedWebSocketProtocol(serverAuth)
      if (session.role === 'client') {
        yield* serverAuth.closeOtherLiveSessionsForRole(
          'client',
          session.sessionId,
          new Socket.CloseEvent(4001, 'Superseded by new mobile session')
        )
      }
      yield* RpcServer.make(WsRpcGroup).pipe(
        Effect.provideService(RpcServer.Protocol, protocol),
        Effect.provide(Layer.mergeAll(WsRpcLayer, RpcSerialization.layerJson)),
        Effect.forkScoped
      )
      return yield* Effect.acquireUseRelease(
        serverAuth.markConnected(session.sessionId),
        () =>
          Effect.withFiber(connectionFiber =>
            Effect.gen(function* () {
              const socket = yield* Effect.orDie(request.upgrade)
              yield* onSocket(socket, Object.entries(request.headers), session, connectionFiber)
              return HttpServerResponse.empty()
            }).pipe(
              Effect.tapError(cause =>
                Effect.sync(() => {
                  logWsRpcError('ws-upgrade:error', {
                    sessionId: session.sessionId,
                    role: session.role,
                    cause,
                  })
                })
              )
            )
          ),
        () => serverAuth.markDisconnected(session.sessionId)
      )
    }).pipe(
      Effect.catchTag('AuthError', error => {
        logWebSocketUpgradeAuthError({
          message: error.message,
          status: error.status ?? 500,
        })
        return respondToAuthError(request, error)
      })
    )
  })
)
