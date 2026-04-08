import { execFileSync } from 'node:child_process'

import * as NodeServices from '@effect/platform-node/NodeServices'
import {
  type OrchestrationEvent,
  type OrchestrationThread,
  type ProviderKind,
} from '@orxa-code/contracts'
import { Effect, FileSystem, Layer, ManagedRuntime, Path, Ref, Scope, Stream } from 'effect'

import { CheckpointStoreLive } from '../src/checkpointing/Layers/CheckpointStore.ts'
import { CheckpointStore } from '../src/checkpointing/Services/CheckpointStore.ts'
import { deriveServerPaths, ServerConfig } from '../src/config.ts'
import { GitCoreLive } from '../src/git/Layers/GitCore.ts'
import { GitCore, type GitCoreShape } from '../src/git/Services/GitCore.ts'
import { TextGeneration, type TextGenerationShape } from '../src/git/Services/TextGeneration.ts'
import { CheckpointReactorLive } from '../src/orchestration/Layers/CheckpointReactor.ts'
import { OrchestrationEngineLive } from '../src/orchestration/Layers/OrchestrationEngine.ts'
import { OrchestrationProjectionPipelineLive } from '../src/orchestration/Layers/ProjectionPipeline.ts'
import { OrchestrationProjectionSnapshotQueryLive } from '../src/orchestration/Layers/ProjectionSnapshotQuery.ts'
import { ProviderCommandReactorLive } from '../src/orchestration/Layers/ProviderCommandReactor.ts'
import { ProviderRuntimeIngestionLive } from '../src/orchestration/Layers/ProviderRuntimeIngestion.ts'
import { RuntimeReceiptBusLive } from '../src/orchestration/Layers/RuntimeReceiptBus.ts'
import { OrchestrationReactorLive } from '../src/orchestration/Layers/OrchestrationReactor.ts'
import {
  type OrchestrationEngineShape,
  OrchestrationEngineService,
} from '../src/orchestration/Services/OrchestrationEngine.ts'
import { ProjectionSnapshotQuery } from '../src/orchestration/Services/ProjectionSnapshotQuery.ts'
import { OrchestrationReactor } from '../src/orchestration/Services/OrchestrationReactor.ts'
import {
  type OrchestrationRuntimeReceipt,
  RuntimeReceiptBus,
} from '../src/orchestration/Services/RuntimeReceiptBus.ts'
import { OrchestrationCommandReceiptRepositoryLive } from '../src/persistence/Layers/OrchestrationCommandReceipts.ts'
import { OrchestrationEventStoreLive } from '../src/persistence/Layers/OrchestrationEventStore.ts'
import { ProjectionCheckpointRepositoryLive } from '../src/persistence/Layers/ProjectionCheckpoints.ts'
import { ProjectionPendingApprovalRepositoryLive } from '../src/persistence/Layers/ProjectionPendingApprovals.ts'
import { ProviderSessionRuntimeRepositoryLive } from '../src/persistence/Layers/ProviderSessionRuntime.ts'
import { makeSqlitePersistenceLive } from '../src/persistence/Layers/Sqlite.ts'
import { ProjectionCheckpointRepository } from '../src/persistence/Services/ProjectionCheckpoints.ts'
import { ProjectionPendingApprovalRepository } from '../src/persistence/Services/ProjectionPendingApprovals.ts'
import { ProviderUnsupportedError } from '../src/provider/Errors.ts'
import { makeCodexAdapterLive } from '../src/provider/Layers/CodexAdapter.ts'
import { makeProviderServiceLive } from '../src/provider/Layers/ProviderService.ts'
import { ProviderSessionDirectoryLive } from '../src/provider/Layers/ProviderSessionDirectory.ts'
import { CodexAdapter } from '../src/provider/Services/CodexAdapter.ts'
import { ProviderAdapterRegistry } from '../src/provider/Services/ProviderAdapterRegistry.ts'
import { ProviderService } from '../src/provider/Services/ProviderService.ts'
import { ServerSettingsService } from '../src/serverSettings.ts'
import { AnalyticsService } from '../src/telemetry/Services/AnalyticsService.ts'
import { WorkspaceEntriesLive } from '../src/workspace/Layers/WorkspaceEntries.ts'
import { WorkspacePathsLive } from '../src/workspace/Layers/WorkspacePaths.ts'

import {
  makeTestProviderAdapterHarness,
  type TestProviderAdapterHarness,
} from './TestProviderAdapter.integration.ts'
import {
  createHarnessDispose,
  createHarnessWaiters,
} from './OrchestrationEngineHarness.integration.helpers.ts'

function runGit(cwd: string, args: ReadonlyArray<string>) {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  })
}

const initializeGitWorkspace = Effect.fn(function* (cwd: string) {
  runGit(cwd, ['init', '--initial-branch=main'])
  runGit(cwd, ['config', 'user.email', 'test@example.com'])
  runGit(cwd, ['config', 'user.name', 'Test User'])
  const fileSystem = yield* FileSystem.FileSystem
  const { join } = yield* Path.Path
  yield* fileSystem.writeFileString(join(cwd, 'README.md'), 'v1\n')
  runGit(cwd, ['add', '.'])
  runGit(cwd, ['commit', '-m', 'Initial'])
})

export function gitRefExists(cwd: string, ref: string): boolean {
  try {
    runGit(cwd, ['show-ref', '--verify', '--quiet', ref])
    return true
  } catch {
    return false
  }
}

export function gitShowFileAtRef(cwd: string, ref: string, filePath: string): string {
  return runGit(cwd, ['show', `${ref}:${filePath}`])
}

class OrchestrationHarnessRuntimeError extends Error {
  constructor(
    readonly operation: string,
    override readonly cause?: unknown
  ) {
    super(operation)
    this.name = 'OrchestrationHarnessRuntimeError'
  }
}

const tryRuntimePromise = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: cause => new OrchestrationHarnessRuntimeError(operation, cause),
  })

export interface OrchestrationIntegrationHarness {
  readonly rootDir: string
  readonly workspaceDir: string
  readonly dbPath: string
  readonly adapterHarness: TestProviderAdapterHarness | null
  readonly engine: OrchestrationEngineShape
  readonly snapshotQuery: ProjectionSnapshotQuery['Service']
  readonly providerService: ProviderService['Service']
  readonly checkpointStore: CheckpointStore['Service']
  readonly checkpointRepository: ProjectionCheckpointRepository['Service']
  readonly pendingApprovalRepository: ProjectionPendingApprovalRepository['Service']
  readonly waitForThread: (
    threadId: string,
    predicate: (thread: OrchestrationThread) => boolean,
    timeoutMs?: number
  ) => Effect.Effect<OrchestrationThread, never>
  readonly waitForDomainEvent: (
    predicate: (event: OrchestrationEvent) => boolean,
    timeoutMs?: number
  ) => Effect.Effect<ReadonlyArray<OrchestrationEvent>, never>
  readonly waitForPendingApproval: (
    requestId: string,
    predicate: (row: {
      readonly status: 'pending' | 'resolved'
      readonly decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel' | null
      readonly resolvedAt: string | null
    }) => boolean,
    timeoutMs?: number
  ) => Effect.Effect<
    {
      readonly status: 'pending' | 'resolved'
      readonly decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel' | null
      readonly resolvedAt: string | null
    },
    never
  >
  readonly waitForReceipt: {
    (
      predicate: (receipt: OrchestrationRuntimeReceipt) => boolean,
      timeoutMs?: number
    ): Effect.Effect<OrchestrationRuntimeReceipt, never>
    <Receipt extends OrchestrationRuntimeReceipt>(
      predicate: (receipt: OrchestrationRuntimeReceipt) => receipt is Receipt,
      timeoutMs?: number
    ): Effect.Effect<Receipt, never>
  }
  readonly dispose: Effect.Effect<void, never>
}

interface MakeOrchestrationIntegrationHarnessOptions {
  readonly provider?: ProviderKind
  readonly realCodex?: boolean
}

type HarnessBootstrap = {
  readonly provider: ProviderKind
  readonly useRealCodex: boolean
  readonly adapterHarness: TestProviderAdapterHarness | null
  readonly rootDir: string
  readonly workspaceDir: string
  readonly dbPath: string
}

const createHarnessBootstrap = Effect.fn(function* (
  options?: MakeOrchestrationIntegrationHarnessOptions
) {
  const path = yield* Path.Path
  const fileSystem = yield* FileSystem.FileSystem
  const provider = options?.provider ?? 'codex'
  const useRealCodex = options?.realCodex === true
  const adapterHarness = useRealCodex ? null : yield* makeTestProviderAdapterHarness({ provider })
  const rootDir = yield* fileSystem.makeTempDirectoryScoped({
    prefix: 'orxa-orchestration-integration-',
  })
  const workspaceDir = path.join(rootDir, 'workspace')
  const { stateDir, dbPath } = yield* deriveServerPaths(rootDir, undefined).pipe(
    Effect.provideService(Path.Path, path)
  )
  yield* fileSystem.makeDirectory(workspaceDir, { recursive: true })
  yield* fileSystem.makeDirectory(stateDir, { recursive: true })
  yield* initializeGitWorkspace(workspaceDir)

  return {
    provider,
    useRealCodex,
    adapterHarness,
    rootDir,
    workspaceDir,
    dbPath,
  }
}) as (
  options?: MakeOrchestrationIntegrationHarnessOptions
) => Effect.Effect<HarnessBootstrap, never, FileSystem.FileSystem | Path.Path>

function createProviderLayer(input: {
  readonly workspaceDir: string
  readonly rootDir: string
  readonly useRealCodex: boolean
  readonly adapterHarness: TestProviderAdapterHarness | null
}) {
  const providerSessionDirectoryLayer = ProviderSessionDirectoryLive.pipe(
    Layer.provide(ProviderSessionRuntimeRepositoryLive)
  )
  const realCodexRegistry = Layer.effect(
    ProviderAdapterRegistry,
    Effect.gen(function* () {
      const codexAdapter = yield* CodexAdapter
      return {
        getByProvider: (resolvedProvider: ProviderKind) =>
          resolvedProvider === 'codex'
            ? Effect.succeed(codexAdapter)
            : Effect.fail(new ProviderUnsupportedError({ provider: resolvedProvider })),
        listProviders: () => Effect.succeed(['codex'] as const),
      } as typeof ProviderAdapterRegistry.Service
    })
  ).pipe(
    Layer.provide(makeCodexAdapterLive()),
    Layer.provideMerge(ServerConfig.layerTest(input.workspaceDir, input.rootDir)),
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(providerSessionDirectoryLayer)
  )

  const fakeRegistry =
    input.adapterHarness === null
      ? null
      : Layer.succeed(ProviderAdapterRegistry, {
          getByProvider: (resolvedProvider: ProviderKind) =>
            resolvedProvider === input.adapterHarness!.provider
              ? Effect.succeed(input.adapterHarness!.adapter)
              : Effect.fail(new ProviderUnsupportedError({ provider: resolvedProvider })),
          listProviders: () => Effect.succeed([input.adapterHarness!.provider]),
        } as typeof ProviderAdapterRegistry.Service)

  return input.useRealCodex
    ? makeProviderServiceLive().pipe(
        Layer.provide(providerSessionDirectoryLayer),
        Layer.provide(realCodexRegistry),
        Layer.provide(AnalyticsService.layerTest)
      )
    : makeProviderServiceLive().pipe(
        Layer.provide(providerSessionDirectoryLayer),
        Layer.provide(fakeRegistry!),
        Layer.provide(AnalyticsService.layerTest)
      )
}

function createHarnessLayer(input: {
  readonly workspaceDir: string
  readonly rootDir: string
  readonly dbPath: string
  readonly providerLayer: ReturnType<typeof createProviderLayer>
}) {
  const projectionSnapshotQueryLayer = OrchestrationProjectionSnapshotQueryLive
  const orchestrationLayer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive)
  )
  const runtimeServicesLayer = Layer.mergeAll(
    projectionSnapshotQueryLayer,
    orchestrationLayer.pipe(Layer.provide(projectionSnapshotQueryLayer)),
    ProjectionCheckpointRepositoryLive,
    ProjectionPendingApprovalRepositoryLive,
    CheckpointStoreLive.pipe(Layer.provide(GitCoreLive)),
    input.providerLayer,
    RuntimeReceiptBusLive
  )
  const serverSettingsLayer = ServerSettingsService.layerTest()
  const gitCoreLayer = Layer.succeed(GitCore, {
    renameBranch: (renameInput: Parameters<GitCoreShape['renameBranch']>[0]) =>
      Effect.succeed({ branch: renameInput.newBranch }),
  } as unknown as GitCoreShape)
  const textGenerationLayer = Layer.succeed(TextGeneration, {
    generateBranchName: () => Effect.succeed({ branch: 'update' }),
    generateThreadTitle: () => Effect.succeed({ title: 'New thread' }),
  } as unknown as TextGenerationShape)
  const providerCommandReactorLayer = ProviderCommandReactorLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(gitCoreLayer),
    Layer.provideMerge(textGenerationLayer),
    Layer.provideMerge(serverSettingsLayer)
  )
  const checkpointReactorLayer = CheckpointReactorLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(
      WorkspaceEntriesLive.pipe(
        Layer.provide(WorkspacePathsLive),
        Layer.provideMerge(gitCoreLayer),
        Layer.provide(NodeServices.layer)
      )
    ),
    Layer.provideMerge(WorkspacePathsLive)
  )
  const runtimeIngestionLayer = ProviderRuntimeIngestionLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(serverSettingsLayer)
  )
  const orchestrationReactorLayer = OrchestrationReactorLive.pipe(
    Layer.provideMerge(runtimeIngestionLayer),
    Layer.provideMerge(providerCommandReactorLayer),
    Layer.provideMerge(checkpointReactorLayer)
  )

  return Layer.empty.pipe(
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(orchestrationReactorLayer),
    Layer.provide(makeSqlitePersistenceLive(input.dbPath)),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(ServerConfig.layerTest(input.workspaceDir, input.rootDir)),
    Layer.provideMerge(NodeServices.layer)
  )
}

const loadHarnessServices = (runtime: ManagedRuntime.ManagedRuntime<unknown, unknown>) =>
  Effect.all({
    engine: tryRuntimePromise('load OrchestrationEngine service', () =>
      runtime.runPromise(
        Effect.service(OrchestrationEngineService) as Effect.Effect<OrchestrationEngineShape>
      )
    ).pipe(Effect.orDie),
    reactor: tryRuntimePromise('load OrchestrationReactor service', () =>
      runtime.runPromise(
        Effect.service(OrchestrationReactor) as Effect.Effect<OrchestrationReactor['Service']>
      )
    ).pipe(Effect.orDie),
    snapshotQuery: tryRuntimePromise('load ProjectionSnapshotQuery service', () =>
      runtime.runPromise(
        Effect.service(ProjectionSnapshotQuery) as Effect.Effect<ProjectionSnapshotQuery['Service']>
      )
    ).pipe(Effect.orDie),
    providerService: tryRuntimePromise('load ProviderService service', () =>
      runtime.runPromise(
        Effect.service(ProviderService) as Effect.Effect<ProviderService['Service']>
      )
    ).pipe(Effect.orDie),
    checkpointStore: tryRuntimePromise('load CheckpointStore service', () =>
      runtime.runPromise(
        Effect.service(CheckpointStore) as Effect.Effect<CheckpointStore['Service']>
      )
    ).pipe(Effect.orDie),
    checkpointRepository: tryRuntimePromise('load ProjectionCheckpointRepository service', () =>
      runtime.runPromise(
        Effect.service(ProjectionCheckpointRepository) as Effect.Effect<
          ProjectionCheckpointRepository['Service']
        >
      )
    ).pipe(Effect.orDie),
    pendingApprovalRepository: tryRuntimePromise(
      'load ProjectionPendingApprovalRepository service',
      () =>
        runtime.runPromise(
          Effect.service(ProjectionPendingApprovalRepository) as Effect.Effect<
            ProjectionPendingApprovalRepository['Service']
          >
        )
    ).pipe(Effect.orDie),
    runtimeReceiptBus: tryRuntimePromise('load RuntimeReceiptBus service', () =>
      runtime.runPromise(
        Effect.service(RuntimeReceiptBus) as Effect.Effect<RuntimeReceiptBus['Service']>
      )
    ).pipe(Effect.orDie),
  })

export const makeOrchestrationIntegrationHarness = (
  options?: MakeOrchestrationIntegrationHarnessOptions
) =>
  Effect.gen(function* () {
    const { adapterHarness, rootDir, workspaceDir, dbPath, useRealCodex } =
      yield* createHarnessBootstrap(options)
    const providerLayer = createProviderLayer({
      workspaceDir,
      rootDir,
      useRealCodex,
      adapterHarness,
    })
    const harnessLayer = createHarnessLayer({
      workspaceDir,
      rootDir,
      dbPath,
      providerLayer,
    })
    const runtime = ManagedRuntime.make(harnessLayer)
    const {
      engine,
      reactor,
      snapshotQuery,
      providerService,
      checkpointStore,
      checkpointRepository,
      pendingApprovalRepository,
      runtimeReceiptBus,
    } = yield* loadHarnessServices(runtime as ManagedRuntime.ManagedRuntime<unknown, unknown>)

    const scope = yield* Scope.make('sequential')
    yield* tryRuntimePromise('start OrchestrationReactor', () =>
      runtime.runPromise(reactor.start().pipe(Scope.provide(scope)))
    ).pipe(Effect.orDie)
    const receiptHistory = yield* Ref.make<ReadonlyArray<OrchestrationRuntimeReceipt>>([])
    yield* Stream.runForEach(runtimeReceiptBus.stream, receipt =>
      Ref.update(receiptHistory, history => [...history, receipt]).pipe(Effect.asVoid)
    ).pipe(Effect.forkIn(scope))
    yield* Effect.sleep(10)

    const { waitForThread, waitForDomainEvent, waitForPendingApproval, waitForReceipt } =
      createHarnessWaiters({
        snapshotQuery,
        engine,
        pendingApprovalRepository,
        receiptHistory,
      })
    const dispose = createHarnessDispose(runtime, scope)

    return {
      rootDir,
      workspaceDir,
      dbPath,
      adapterHarness,
      engine,
      snapshotQuery,
      providerService,
      checkpointStore,
      checkpointRepository,
      pendingApprovalRepository,
      waitForThread,
      waitForDomainEvent,
      waitForPendingApproval,
      waitForReceipt,
      dispose,
    } satisfies OrchestrationIntegrationHarness
  })
