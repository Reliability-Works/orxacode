import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type {
  OrchestrationReadModel,
  ProviderRuntimeEvent,
  ProviderSession,
} from '@orxa-code/contracts'
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderItemId,
  type ServerSettings,
  ThreadId,
  TurnId,
} from '@orxa-code/contracts'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { Effect, Exit, Layer, ManagedRuntime, PubSub, Scope, Stream } from 'effect'

import { OrchestrationEventStoreLive } from '../../persistence/Layers/OrchestrationEventStore.ts'
import { OrchestrationCommandReceiptRepositoryLive } from '../../persistence/Layers/OrchestrationCommandReceipts.ts'
import { SqlitePersistenceMemory } from '../../persistence/Layers/Sqlite.ts'
import {
  ProviderService,
  type ProviderServiceShape,
} from '../../provider/Services/ProviderService.ts'
import { OrchestrationEngineLive } from './OrchestrationEngine.ts'
import { OrchestrationProjectionPipelineLive } from './ProjectionPipeline.ts'
import { OrchestrationProjectionSnapshotQueryLive } from './ProjectionSnapshotQuery.ts'
import { ProviderRuntimeIngestionLive } from './ProviderRuntimeIngestion.ts'
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from '../Services/OrchestrationEngine.ts'
import { ProviderRuntimeIngestionService } from '../Services/ProviderRuntimeIngestion.ts'
import { ServerConfig } from '../../config.ts'
import { ServerSettingsService } from '../../serverSettings.ts'
import {
  dispatchProjectAndThreadCreate,
  type LegacyProviderRuntimeEvent as SharedLegacyProviderRuntimeEvent,
  unsupportedProviderMethods,
} from './Reactor.test.shared-helpers.ts'

export const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value)
export const asItemId = (value: string): ProviderItemId => ProviderItemId.makeUnsafe(value)
export const asEventId = (value: string): EventId => EventId.makeUnsafe(value)
export const asMessageId = (value: string): MessageId => MessageId.makeUnsafe(value)
export const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value)
export const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value)

export type LegacyProviderRuntimeEvent = SharedLegacyProviderRuntimeEvent

type LegacyTurnCompletedEvent = LegacyProviderRuntimeEvent & {
  readonly type: 'turn.completed'
  readonly payload?: undefined
  readonly status: 'completed' | 'failed' | 'interrupted' | 'cancelled'
  readonly errorMessage?: string | undefined
}

function isLegacyTurnCompletedEvent(
  event: LegacyProviderRuntimeEvent
): event is LegacyTurnCompletedEvent {
  return (
    event.type === 'turn.completed' &&
    event.payload === undefined &&
    typeof event.status === 'string'
  )
}

export interface ProviderHarness {
  readonly service: ProviderServiceShape
  readonly emit: (event: LegacyProviderRuntimeEvent) => void
  readonly setSession: (session: ProviderSession) => void
}

export function createProviderServiceHarness(): ProviderHarness {
  const runtimeEventPubSub = Effect.runSync(PubSub.unbounded<ProviderRuntimeEvent>())
  const runtimeSessions: ProviderSession[] = []

  const service: ProviderServiceShape = {
    ...unsupportedProviderMethods,
    listSessions: () => Effect.succeed([...runtimeSessions]),
    getCapabilities: () => Effect.succeed({ sessionModelSwitch: 'in-session' }),
    rollbackConversation: () => unsupportedProviderMethods.startSession() as never,
    streamEvents: Stream.fromPubSub(runtimeEventPubSub),
  }

  const setSession = (session: ProviderSession): void => {
    const existingIndex = runtimeSessions.findIndex(entry => entry.threadId === session.threadId)
    if (existingIndex >= 0) {
      runtimeSessions[existingIndex] = session
      return
    }
    runtimeSessions.push(session)
  }

  const normalizeLegacyEvent = (event: LegacyProviderRuntimeEvent): ProviderRuntimeEvent => {
    if (isLegacyTurnCompletedEvent(event)) {
      const normalized: Extract<ProviderRuntimeEvent, { type: 'turn.completed' }> = {
        ...(event as Omit<Extract<ProviderRuntimeEvent, { type: 'turn.completed' }>, 'payload'>),
        payload: {
          state: event.status,
          ...(typeof event.errorMessage === 'string' ? { errorMessage: event.errorMessage } : {}),
        },
      }
      return normalized
    }

    return event as ProviderRuntimeEvent
  }

  const emit = (event: LegacyProviderRuntimeEvent): void => {
    Effect.runSync(PubSub.publish(runtimeEventPubSub, normalizeLegacyEvent(event)))
  }

  return { service, emit, setSession }
}

export type ProviderRuntimeTestReadModel = OrchestrationReadModel
export type ProviderRuntimeTestThread = ProviderRuntimeTestReadModel['threads'][number]
export type ProviderRuntimeTestMessage = ProviderRuntimeTestThread['messages'][number]
export type ProviderRuntimeTestProposedPlan = ProviderRuntimeTestThread['proposedPlans'][number]
export type ProviderRuntimeTestActivity = ProviderRuntimeTestThread['activities'][number]
export type ProviderRuntimeTestCheckpoint = ProviderRuntimeTestThread['checkpoints'][number]

export async function waitForThread(
  engine: OrchestrationEngineShape,
  predicate: (thread: ProviderRuntimeTestThread) => boolean,
  timeoutMs = 2000,
  threadId: ThreadId = asThreadId('thread-1')
): Promise<ProviderRuntimeTestThread> {
  const deadline = Date.now() + timeoutMs
  const poll = async (): Promise<ProviderRuntimeTestThread> => {
    const readModel = await Effect.runPromise(engine.getReadModel())
    const thread = readModel.threads.find(entry => entry.id === threadId)
    if (thread && predicate(thread)) {
      return thread
    }
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for thread state')
    }
    await new Promise(resolve => setTimeout(resolve, 10))
    return poll()
  }
  return poll()
}

export interface RuntimeRefs {
  runtime: ManagedRuntime.ManagedRuntime<
    OrchestrationEngineService | ProviderRuntimeIngestionService,
    unknown
  > | null
  scope: Scope.Closeable | null
  tempDirs: string[]
}

export function createRuntimeRefs(): RuntimeRefs {
  return { runtime: null, scope: null, tempDirs: [] }
}

export async function disposeRuntimeRefs(refs: RuntimeRefs): Promise<void> {
  if (refs.scope) {
    await Effect.runPromise(Scope.close(refs.scope, Exit.void))
  }
  refs.scope = null
  if (refs.runtime) {
    await refs.runtime.dispose()
  }
  refs.runtime = null
  for (const dir of refs.tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function makeTempDir(refs: RuntimeRefs, prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  refs.tempDirs.push(dir)
  return dir
}

function makeIngestionLayer(provider: ProviderHarness, settings?: Partial<ServerSettings>) {
  const orchestrationLayer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(SqlitePersistenceMemory)
  )
  return ProviderRuntimeIngestionLive.pipe(
    Layer.provideMerge(orchestrationLayer),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(Layer.succeed(ProviderService, provider.service)),
    Layer.provideMerge(ServerSettingsService.layerTest(settings)),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
    Layer.provideMerge(NodeServices.layer)
  )
}

async function seedHarnessWorkspace(
  engine: OrchestrationEngineShape,
  workspaceRoot: string,
  createdAt: string
) {
  await dispatchProjectAndThreadCreate(engine, {
    projectId: asProjectId('project-1'),
    projectTitle: 'Provider Project',
    workspaceRoot,
    threadId: ThreadId.makeUnsafe('thread-1'),
    threadTitle: 'Thread',
    modelSelection: { provider: 'codex', model: 'gpt-5-codex' },
    runtimeMode: 'approval-required',
    worktreePath: null,
    createdAt,
  })
  await Effect.runPromise(
    engine.dispatch({
      type: 'thread.session.set',
      commandId: CommandId.makeUnsafe('cmd-session-seed'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      session: {
        threadId: ThreadId.makeUnsafe('thread-1'),
        status: 'ready',
        providerName: 'codex',
        runtimeMode: 'approval-required',
        activeTurnId: null,
        updatedAt: createdAt,
        lastError: null,
      },
      createdAt,
    })
  )
}

export interface IngestionHarness {
  readonly engine: OrchestrationEngineShape
  readonly emit: (event: LegacyProviderRuntimeEvent) => void
  readonly setProviderSession: (session: ProviderSession) => void
  readonly drain: () => Promise<void>
}

export async function createHarness(
  refs: RuntimeRefs,
  options?: { serverSettings?: Partial<ServerSettings> }
): Promise<IngestionHarness> {
  const workspaceRoot = makeTempDir(refs, 'orxa-provider-project-')
  fs.mkdirSync(path.join(workspaceRoot, '.git'))
  const provider = createProviderServiceHarness()
  const layer = makeIngestionLayer(provider, options?.serverSettings)
  refs.runtime = ManagedRuntime.make(layer)
  const engine = await refs.runtime.runPromise(Effect.service(OrchestrationEngineService))
  const ingestion = await refs.runtime.runPromise(Effect.service(ProviderRuntimeIngestionService))
  refs.scope = await Effect.runPromise(Scope.make('sequential'))
  await Effect.runPromise(ingestion.start().pipe(Scope.provide(refs.scope)))
  const drain = () => Effect.runPromise(ingestion.drain)

  const createdAt = new Date().toISOString()
  await seedHarnessWorkspace(engine, workspaceRoot, createdAt)
  provider.setSession({
    provider: 'codex',
    status: 'ready',
    runtimeMode: 'approval-required',
    threadId: ThreadId.makeUnsafe('thread-1'),
    createdAt,
    updatedAt: createdAt,
  })

  return {
    engine,
    emit: provider.emit,
    setProviderSession: provider.setSession,
    drain,
  }
}
