import { Effect, Layer, Option, Queue, Ref, Schema, Stream } from 'effect'
import {
  type ClientOrchestrationCommand,
  type GitActionProgressEvent,
  type GitCheckoutInput,
  type GitCreateBranchInput,
  type GitCreateWorktreeInput,
  type GitInitInput,
  type GitListBranchesInput,
  type GitPreparePullRequestThreadInput,
  type GitPullInput,
  type GitPullRequestRefInput,
  type GitRemoveWorktreeInput,
  type GitRunStackedActionInput,
  type GitStatusInput,
  type GitManagerServiceError,
  type OrchestrationGetFullThreadDiffInput,
  OrchestrationDispatchCommandError,
  type OrchestrationGetTurnDiffInput,
  type OrchestrationEvent,
  type OrchestrationReplayEventsInput,
  type OpenInEditorInput,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetSnapshotError,
  OrchestrationGetTurnDiffError,
  ORCHESTRATION_WS_METHODS,
  type ProjectSearchEntriesInput,
  ProjectSearchEntriesError,
  type ProjectWriteFileInput,
  ProjectWriteFileError,
  OrchestrationReplayEventsError,
  type ServerSettingsPatch,
  type ServerUpsertKeybindingInput,
  type TerminalEvent,
  type TerminalClearInput,
  type TerminalCloseInput,
  type TerminalOpenInput,
  type TerminalResizeInput,
  type TerminalRestartInput,
  type TerminalWriteInput,
  WS_METHODS,
  WsRpcGroup,
} from '@orxa-code/contracts'
import { clamp } from 'effect/Number'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { RpcSerialization, RpcServer } from 'effect/unstable/rpc'

import { CheckpointDiffQuery } from './checkpointing/Services/CheckpointDiffQuery'
import { ServerConfig } from './config'
import { GitCore } from './git/Services/GitCore'
import { GitManager } from './git/Services/GitManager'
import { Keybindings } from './keybindings'
import { Open, resolveAvailableEditors } from './open'
import { normalizeDispatchCommand } from './orchestration/Normalizer'
import { OrchestrationEngineService } from './orchestration/Services/OrchestrationEngine'
import { ProjectionSnapshotQuery } from './orchestration/Services/ProjectionSnapshotQuery'
import { ProviderRegistry } from './provider/Services/ProviderRegistry'
import { ServerLifecycleEvents } from './serverLifecycleEvents'
import { ServerRuntimeStartup } from './serverRuntimeStartup'
import { ServerSettingsService } from './serverSettings'
import { TerminalManager } from './terminal/Services/Manager'
import { WorkspaceEntries } from './workspace/Services/WorkspaceEntries'
import { WorkspaceFileSystem } from './workspace/Services/WorkspaceFileSystem'
import { WorkspacePathOutsideRootError } from './workspace/Services/WorkspacePaths'

type WsRpcDependencies = {
  readonly projectionSnapshotQuery: typeof ProjectionSnapshotQuery.Service
  readonly orchestrationEngine: typeof OrchestrationEngineService.Service
  readonly checkpointDiffQuery: typeof CheckpointDiffQuery.Service
  readonly keybindings: typeof Keybindings.Service
  readonly open: typeof Open.Service
  readonly gitManager: typeof GitManager.Service
  readonly git: typeof GitCore.Service
  readonly terminalManager: typeof TerminalManager.Service
  readonly providerRegistry: typeof ProviderRegistry.Service
  readonly config: typeof ServerConfig.Service
  readonly lifecycleEvents: typeof ServerLifecycleEvents.Service
  readonly serverSettings: typeof ServerSettingsService.Service
  readonly startup: typeof ServerRuntimeStartup.Service
  readonly workspaceEntries: typeof WorkspaceEntries.Service
  readonly workspaceFileSystem: typeof WorkspaceFileSystem.Service
}

const createLoadServerConfig = ({
  config,
  keybindings,
  providerRegistry,
  serverSettings,
}: Pick<WsRpcDependencies, 'config' | 'keybindings' | 'providerRegistry' | 'serverSettings'>) =>
  Effect.gen(function* () {
    const keybindingsConfig = yield* keybindings.loadConfigState
    const providers = yield* providerRegistry.getProviders
    const settings = yield* serverSettings.getSettings

    return {
      cwd: config.cwd,
      keybindingsConfigPath: config.keybindingsConfigPath,
      keybindings: keybindingsConfig.keybindings,
      issues: keybindingsConfig.issues,
      providers,
      availableEditors: resolveAvailableEditors(),
      settings,
    }
  })

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

const createServerConfigStream = ({
  keybindings,
  loadServerConfig,
  providerRegistry,
  serverSettings,
}: Pick<WsRpcDependencies, 'keybindings' | 'providerRegistry' | 'serverSettings'> & {
  readonly loadServerConfig: ReturnType<typeof createLoadServerConfig>
}) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const keybindingsUpdates = keybindings.streamChanges.pipe(
        Stream.map(event => ({
          version: 1 as const,
          type: 'keybindingsUpdated' as const,
          payload: {
            issues: event.issues,
          },
        }))
      )
      const providerStatuses = providerRegistry.streamChanges.pipe(
        Stream.map(providers => ({
          version: 1 as const,
          type: 'providerStatuses' as const,
          payload: { providers },
        }))
      )
      const settingsUpdates = serverSettings.streamChanges.pipe(
        Stream.map(settings => ({
          version: 1 as const,
          type: 'settingsUpdated' as const,
          payload: { settings },
        }))
      )

      return Stream.concat(
        Stream.make({
          version: 1 as const,
          type: 'snapshot' as const,
          config: yield* loadServerConfig,
        }),
        Stream.merge(keybindingsUpdates, Stream.merge(providerStatuses, settingsUpdates))
      )
    })
  )

const createServerLifecycleStream = (lifecycleEvents: WsRpcDependencies['lifecycleEvents']) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const snapshot = yield* lifecycleEvents.snapshot
      const snapshotEvents = Array.from(snapshot.events).toSorted(
        (left, right) => left.sequence - right.sequence
      )
      const liveEvents = lifecycleEvents.stream.pipe(
        Stream.filter(event => event.sequence > snapshot.sequence)
      )
      return Stream.concat(Stream.fromIterable(snapshotEvents), liveEvents)
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

const createOrchestrationMethods = ({
  checkpointDiffQuery,
  orchestrationEngine,
  projectionSnapshotQuery,
  startup,
}: Pick<
  WsRpcDependencies,
  'checkpointDiffQuery' | 'orchestrationEngine' | 'projectionSnapshotQuery' | 'startup'
>) => ({
  [ORCHESTRATION_WS_METHODS.getSnapshot]: () =>
    projectionSnapshotQuery.getSnapshot().pipe(
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
  providerRegistry,
  serverSettings,
}: Pick<
  WsRpcDependencies,
  'keybindings' | 'lifecycleEvents' | 'providerRegistry' | 'serverSettings'
> & {
  readonly loadServerConfig: ReturnType<typeof createLoadServerConfig>
}) => ({
  [WS_METHODS.serverGetConfig]: () => loadServerConfig,
  [WS_METHODS.serverRefreshProviders]: () =>
    providerRegistry.refresh().pipe(Effect.map(providers => ({ providers }))),
  [WS_METHODS.serverUpsertKeybinding]: (rule: ServerUpsertKeybindingInput) =>
    Effect.gen(function* () {
      const keybindingsConfig = yield* keybindings.upsertKeybindingRule(rule)
      return { keybindings: keybindingsConfig, issues: [] }
    }),
  [WS_METHODS.serverGetSettings]: () => serverSettings.getSettings,
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
  [WS_METHODS.projectsSearchEntries]: (input: ProjectSearchEntriesInput) =>
    workspaceEntries.search(input).pipe(
      Effect.mapError(
        cause =>
          new ProjectSearchEntriesError({
            message: `Failed to search workspace entries: ${cause.detail}`,
          })
      )
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

const createGitMethods = ({ git, gitManager }: Pick<WsRpcDependencies, 'git' | 'gitManager'>) => ({
  [WS_METHODS.gitStatus]: (input: GitStatusInput) => gitManager.status(input),
  [WS_METHODS.gitPull]: (input: GitPullInput) => git.pullCurrentBranch(input.cwd),
  [WS_METHODS.gitRunStackedAction]: (input: GitRunStackedActionInput) =>
    Stream.callback<GitActionProgressEvent, GitManagerServiceError>(queue =>
      gitManager
        .runStackedAction(input, {
          actionId: input.actionId,
          progressReporter: {
            publish: event => Queue.offer(queue, event).pipe(Effect.asVoid),
          },
        })
        .pipe(
          Effect.matchCauseEffect({
            onFailure: cause => Queue.failCause(queue, cause),
            onSuccess: () => Queue.end(queue).pipe(Effect.asVoid),
          })
        )
    ),
  [WS_METHODS.gitResolvePullRequest]: (input: GitPullRequestRefInput) =>
    gitManager.resolvePullRequest(input),
  [WS_METHODS.gitPreparePullRequestThread]: (input: GitPreparePullRequestThreadInput) =>
    gitManager.preparePullRequestThread(input),
  [WS_METHODS.gitListBranches]: (input: GitListBranchesInput) => git.listBranches(input),
  [WS_METHODS.gitCreateWorktree]: (input: GitCreateWorktreeInput) => git.createWorktree(input),
  [WS_METHODS.gitRemoveWorktree]: (input: GitRemoveWorktreeInput) => git.removeWorktree(input),
  [WS_METHODS.gitCreateBranch]: (input: GitCreateBranchInput) => git.createBranch(input),
  [WS_METHODS.gitCheckout]: (input: GitCheckoutInput) => Effect.scoped(git.checkoutBranch(input)),
  [WS_METHODS.gitInit]: (input: GitInitInput) => git.initRepo(input),
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
      projectionSnapshotQuery: yield* ProjectionSnapshotQuery,
      orchestrationEngine: yield* OrchestrationEngineService,
      checkpointDiffQuery: yield* CheckpointDiffQuery,
      keybindings: yield* Keybindings,
      open: yield* Open,
      gitManager: yield* GitManager,
      git: yield* GitCore,
      terminalManager: yield* TerminalManager,
      providerRegistry: yield* ProviderRegistry,
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
    })
  })
)

export const websocketRpcRouteLayer = Layer.unwrap(
  Effect.gen(function* () {
    const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup).pipe(
      Effect.provide(Layer.mergeAll(WsRpcLayer, RpcSerialization.layerJson))
    )
    return HttpRouter.add(
      'GET',
      '/ws',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const config = yield* ServerConfig
        if (config.authToken) {
          const url = HttpServerRequest.toURL(request)
          if (Option.isNone(url)) {
            return HttpServerResponse.text('Invalid WebSocket URL', { status: 400 })
          }
          const token = url.value.searchParams.get('token')
          if (token !== config.authToken) {
            return HttpServerResponse.text('Unauthorized WebSocket connection', { status: 401 })
          }
        }
        return yield* rpcWebSocketHttpEffect
      })
    )
  })
)
