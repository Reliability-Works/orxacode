import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import type { ProviderKind, ProviderRuntimeEvent, ProviderSession } from '@orxa-code/contracts'
import { ProjectId, ThreadId, TurnId } from '@orxa-code/contracts'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { Effect, Exit, Layer, ManagedRuntime, PubSub, Scope, Stream } from 'effect'
import { vi } from 'vitest'

import { CheckpointStoreLive } from '../../checkpointing/Layers/CheckpointStore.ts'
import { CheckpointStore } from '../../checkpointing/Services/CheckpointStore.ts'
import { GitCoreLive } from '../../git/Layers/GitCore.ts'
import { CheckpointReactorLive } from './CheckpointReactor.ts'
import { OrchestrationEngineLive } from './OrchestrationEngine.ts'
import { OrchestrationProjectionPipelineLive } from './ProjectionPipeline.ts'
import { OrchestrationProjectionSnapshotQueryLive } from './ProjectionSnapshotQuery.ts'
import { RuntimeReceiptBusLive } from './RuntimeReceiptBus.ts'
import { OrchestrationEventStoreLive } from '../../persistence/Layers/OrchestrationEventStore.ts'
import { OrchestrationCommandReceiptRepositoryLive } from '../../persistence/Layers/OrchestrationCommandReceipts.ts'
import { SqlitePersistenceMemory } from '../../persistence/Layers/Sqlite.ts'
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from '../Services/OrchestrationEngine.ts'
import { CheckpointReactor } from '../Services/CheckpointReactor.ts'
import {
  ProviderService,
  type ProviderServiceShape,
} from '../../provider/Services/ProviderService.ts'
import { checkpointRefForThreadTurn } from '../../checkpointing/Utils.ts'
import { ServerConfig } from '../../config.ts'
import { WorkspaceEntriesLive } from '../../workspace/Layers/WorkspaceEntries.ts'
import { WorkspacePathsLive } from '../../workspace/Layers/WorkspacePaths.ts'
import {
  dispatchProjectAndThreadCreate,
  type LegacyProviderRuntimeEvent as SharedLegacyProviderRuntimeEvent,
  unsupportedProviderMethods,
} from './Reactor.test.shared-helpers.ts'

export const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value)
export const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value)

type LegacyProviderRuntimeEvent = SharedLegacyProviderRuntimeEvent

export interface CheckpointHarnessProvider {
  readonly service: ProviderServiceShape
  readonly rollbackConversation: ReturnType<typeof vi.fn>
  readonly emit: (event: LegacyProviderRuntimeEvent) => void
}

export interface CheckpointHarness {
  readonly engine: OrchestrationEngineShape
  readonly provider: CheckpointHarnessProvider
  readonly cwd: string
  readonly drain: () => Promise<void>
}

function createProviderServiceHarness(
  cwd: string,
  hasSession = true,
  sessionCwd = cwd,
  providerName: ProviderSession['provider'] = 'codex'
): CheckpointHarnessProvider {
  const now = new Date().toISOString()
  const runtimeEventPubSub = Effect.runSync(PubSub.unbounded<ProviderRuntimeEvent>())
  const rollbackConversation = vi.fn(
    (input: { readonly threadId: ThreadId; readonly numTurns: number }) =>
      Effect.sync(() => {
        void input
      })
  )

  const listSessions = () =>
    hasSession
      ? Effect.succeed([
          {
            provider: providerName,
            status: 'ready',
            runtimeMode: 'full-access',
            threadId: ThreadId.makeUnsafe('thread-1'),
            cwd: sessionCwd,
            createdAt: now,
            updatedAt: now,
          },
        ] satisfies ReadonlyArray<ProviderSession>)
      : Effect.succeed([] as ReadonlyArray<ProviderSession>)

  const service: ProviderServiceShape = {
    ...unsupportedProviderMethods,
    listSessions,
    getCapabilities: () => Effect.succeed({ sessionModelSwitch: 'in-session' }),
    rollbackConversation,
    streamEvents: Stream.fromPubSub(runtimeEventPubSub),
  }

  return {
    service,
    rollbackConversation,
    emit: event => {
      Effect.runSync(PubSub.publish(runtimeEventPubSub, event as unknown as ProviderRuntimeEvent))
    },
  }
}

export async function waitForThread(
  engine: OrchestrationEngineShape,
  predicate: (thread: {
    latestTurn: { turnId: string } | null
    checkpoints: ReadonlyArray<{ checkpointTurnCount: number }>
    activities: ReadonlyArray<{ kind: string }>
  }) => boolean,
  timeoutMs = 15_000
) {
  const deadline = Date.now() + timeoutMs
  const poll = async (): Promise<{
    latestTurn: { turnId: string } | null
    checkpoints: ReadonlyArray<{ checkpointTurnCount: number }>
    activities: ReadonlyArray<{ kind: string }>
  }> => {
    const readModel = await Effect.runPromise(engine.getReadModel())
    const thread = readModel.threads.find(entry => entry.id === ThreadId.makeUnsafe('thread-1'))
    if (thread && predicate(thread)) {
      return thread
    }
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for thread state.')
    }
    await new Promise(resolve => setTimeout(resolve, 10))
    return poll()
  }
  return poll()
}

export async function waitForEvent(
  engine: OrchestrationEngineShape,
  predicate: (event: { type: string }) => boolean,
  timeoutMs = 15_000
) {
  const deadline = Date.now() + timeoutMs
  const poll = async () => {
    const events = await Effect.runPromise(
      Stream.runCollect(engine.readEvents(0)).pipe(Effect.map(chunk => Array.from(chunk)))
    )
    if (events.some(predicate)) {
      return events
    }
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for orchestration event.')
    }
    await new Promise(resolve => setTimeout(resolve, 10))
    return poll()
  }
  return poll()
}

function runGit(cwd: string, args: ReadonlyArray<string>) {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  })
}

function createGitRepository() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'orxa-checkpoint-handler-'))
  runGit(cwd, ['init', '--initial-branch=main'])
  runGit(cwd, ['config', 'user.email', 'test@example.com'])
  runGit(cwd, ['config', 'user.name', 'Test User'])
  fs.writeFileSync(path.join(cwd, 'README.md'), 'v1\n', 'utf8')
  runGit(cwd, ['add', '.'])
  runGit(cwd, ['commit', '-m', 'Initial'])
  return cwd
}

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

export async function waitForGitRefExists(cwd: string, ref: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  const poll = async (): Promise<void> => {
    if (gitRefExists(cwd, ref)) {
      return
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for git ref '${ref}'.`)
    }
    await new Promise(resolve => setTimeout(resolve, 10))
    return poll()
  }
  return poll()
}

async function createRuntimeServices(provider: CheckpointHarnessProvider) {
  const orchestrationLayer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(SqlitePersistenceMemory)
  )

  const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: 'orxa-checkpoint-reactor-test-',
  })

  const layer = CheckpointReactorLive.pipe(
    Layer.provideMerge(orchestrationLayer),
    Layer.provideMerge(RuntimeReceiptBusLive),
    Layer.provideMerge(Layer.succeed(ProviderService, provider.service)),
    Layer.provideMerge(CheckpointStoreLive),
    Layer.provideMerge(WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive))),
    Layer.provideMerge(WorkspacePathsLive),
    Layer.provideMerge(GitCoreLive),
    Layer.provideMerge(serverConfigLayer),
    Layer.provideMerge(NodeServices.layer)
  )

  const runtime = ManagedRuntime.make(layer)
  return {
    runtime,
    engine: await runtime.runPromise(Effect.service(OrchestrationEngineService)),
    reactor: await runtime.runPromise(Effect.service(CheckpointReactor)),
    checkpointStore: await runtime.runPromise(Effect.service(CheckpointStore)),
  }
}

async function seedProjectAndThread(
  engine: OrchestrationEngineShape,
  cwd: string,
  worktreePath: string | null
) {
  await dispatchProjectAndThreadCreate(engine, {
    projectId: asProjectId('project-1'),
    projectTitle: 'Test Project',
    workspaceRoot: cwd,
    threadId: ThreadId.makeUnsafe('thread-1'),
    threadTitle: 'Thread',
    modelSelection: { provider: 'codex', model: 'gpt-5-codex' },
    runtimeMode: 'approval-required',
    worktreePath,
    createdAt: new Date().toISOString(),
  })
}

async function seedFilesystemCheckpoints(
  runtime: ManagedRuntime.ManagedRuntime<
    OrchestrationEngineService | CheckpointReactor | CheckpointStore,
    unknown
  >,
  checkpointStore: CheckpointStore['Service'],
  cwd: string
) {
  await runtime.runPromise(
    checkpointStore.captureCheckpoint({
      cwd,
      checkpointRef: checkpointRefForThreadTurn(ThreadId.makeUnsafe('thread-1'), 0),
    })
  )
  fs.writeFileSync(path.join(cwd, 'README.md'), 'v2\n', 'utf8')
  await runtime.runPromise(
    checkpointStore.captureCheckpoint({
      cwd,
      checkpointRef: checkpointRefForThreadTurn(ThreadId.makeUnsafe('thread-1'), 1),
    })
  )
  fs.writeFileSync(path.join(cwd, 'README.md'), 'v3\n', 'utf8')
  await runtime.runPromise(
    checkpointStore.captureCheckpoint({
      cwd,
      checkpointRef: checkpointRefForThreadTurn(ThreadId.makeUnsafe('thread-1'), 2),
    })
  )
}

export function createCheckpointHarnessController() {
  let runtime: ManagedRuntime.ManagedRuntime<
    OrchestrationEngineService | CheckpointReactor | CheckpointStore,
    unknown
  > | null = null
  let scope: Scope.Closeable | null = null
  const tempDirs: string[] = []

  const cleanup = async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
    scope = null
    if (runtime) {
      await runtime.dispose()
    }
    runtime = null
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    }
  }

  const createHarness = async (options?: {
    readonly hasSession?: boolean
    readonly seedFilesystemCheckpoints?: boolean
    readonly projectWorkspaceRoot?: string
    readonly threadWorktreePath?: string | null
    readonly providerSessionCwd?: string
    readonly providerName?: ProviderKind
  }): Promise<CheckpointHarness> => {
    const cwd = createGitRepository()
    tempDirs.push(cwd)
    const provider = createProviderServiceHarness(
      cwd,
      options?.hasSession ?? true,
      options?.providerSessionCwd ?? cwd,
      options?.providerName ?? 'codex'
    )
    const services = await createRuntimeServices(provider)
    runtime = services.runtime
    scope = await Effect.runPromise(Scope.make('sequential'))
    await Effect.runPromise(services.reactor.start().pipe(Scope.provide(scope)))
    await seedProjectAndThread(
      services.engine,
      options?.projectWorkspaceRoot ?? cwd,
      options?.threadWorktreePath ?? cwd
    )

    if (options?.seedFilesystemCheckpoints ?? true) {
      await seedFilesystemCheckpoints(runtime, services.checkpointStore, cwd)
    }

    return {
      engine: services.engine,
      provider,
      cwd,
      drain: () => Effect.runPromise(services.reactor.drain),
    }
  }

  return {
    createHarness,
    cleanup,
  }
}
