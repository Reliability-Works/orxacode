import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type {
  ProviderApprovalDecision,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderTurnStartResult,
} from '@orxa-code/contracts'
import {
  ApprovalRequestId,
  EventId,
  type ProviderKind,
  ProviderSessionStartInput,
  ThreadId,
  TurnId,
} from '@orxa-code/contracts'
import { it, assert, vi } from '@effect/vitest'
import { Effect, Layer, PubSub, Stream } from 'effect'

import {
  ProviderAdapterSessionNotFoundError,
  ProviderUnsupportedError,
  type ProviderAdapterError,
} from '../Errors.ts'
import type { ProviderAdapterShape } from '../Services/ProviderAdapter.ts'
import { ProviderAdapterRegistry } from '../Services/ProviderAdapterRegistry.ts'
import { makeProviderServiceLive } from './ProviderService.ts'
import { ProviderSessionDirectoryLive } from './ProviderSessionDirectory.ts'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { ProviderSessionRuntimeRepositoryLive } from '../../persistence/Layers/ProviderSessionRuntime.ts'
import {
  makeSqlitePersistenceLive,
  SqlitePersistenceMemory,
} from '../../persistence/Layers/Sqlite.ts'
import { ServerSettingsService } from '../../serverSettings.ts'
import { AnalyticsService } from '../../telemetry/Services/AnalyticsService.ts'

export const defaultServerSettingsLayer = ServerSettingsService.layerTest()

export const asRequestId = (value: string): ApprovalRequestId => ApprovalRequestId.makeUnsafe(value)
export const asEventId = (value: string): EventId => EventId.makeUnsafe(value)
export const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value)
export const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value)

import type { LegacyProviderRuntimeEvent } from '../../orchestration/Layers/Reactor.test.shared-helpers.ts'

export type { LegacyProviderRuntimeEvent }

function makeStartSessionMock(provider: ProviderKind, sessions: Map<ThreadId, ProviderSession>) {
  return vi.fn((input: ProviderSessionStartInput) =>
    Effect.sync(() => {
      const now = new Date().toISOString()
      const session: ProviderSession = {
        provider,
        status: 'ready',
        runtimeMode: input.runtimeMode,
        threadId: input.threadId,
        resumeCursor: input.resumeCursor ?? { opaque: `resume-${String(input.threadId)}` },
        cwd: input.cwd ?? process.cwd(),
        createdAt: now,
        updatedAt: now,
      }
      sessions.set(session.threadId, session)
      return session
    })
  )
}

function makeSendTurnMock(provider: ProviderKind, sessions: Map<ThreadId, ProviderSession>) {
  return vi.fn(
    (
      input: ProviderSendTurnInput
    ): Effect.Effect<ProviderTurnStartResult, ProviderAdapterError> => {
      if (!sessions.has(input.threadId)) {
        return Effect.fail(
          new ProviderAdapterSessionNotFoundError({
            provider,
            threadId: input.threadId,
          })
        )
      }

      return Effect.succeed({
        threadId: input.threadId,
        turnId: TurnId.makeUnsafe(`turn-${String(input.threadId)}`),
      })
    }
  )
}

function makeVoidMock<A extends ReadonlyArray<unknown>>() {
  return vi.fn((...args: A): Effect.Effect<void, ProviderAdapterError> => {
    void args
    return Effect.void
  })
}

function makeStopSessionMock(sessions: Map<ThreadId, ProviderSession>) {
  return vi.fn(
    (threadId: ThreadId): Effect.Effect<void, ProviderAdapterError> =>
      Effect.sync(() => {
        sessions.delete(threadId)
      })
  )
}

function makeListSessionsMock(sessions: Map<ThreadId, ProviderSession>) {
  return vi.fn(
    (): Effect.Effect<ReadonlyArray<ProviderSession>> =>
      Effect.sync(() => Array.from(sessions.values()))
  )
}

function makeHasSessionMock(sessions: Map<ThreadId, ProviderSession>) {
  return vi.fn(
    (threadId: ThreadId): Effect.Effect<boolean> => Effect.succeed(sessions.has(threadId))
  )
}

function makeReadThreadMock() {
  return vi.fn(
    (
      threadId: ThreadId
    ): Effect.Effect<
      {
        threadId: ThreadId
        turns: ReadonlyArray<{ id: TurnId; items: readonly [] }>
      },
      ProviderAdapterError
    > =>
      Effect.succeed({
        threadId,
        turns: [{ id: asTurnId('turn-1'), items: [] }],
      })
  )
}

function makeRollbackThreadMock() {
  return vi.fn(
    (
      threadId: ThreadId,
      numTurns: number
    ): Effect.Effect<{ threadId: ThreadId; turns: readonly [] }, ProviderAdapterError> => {
      void numTurns
      return Effect.succeed({ threadId, turns: [] })
    }
  )
}

function makeStopAllMock(sessions: Map<ThreadId, ProviderSession>) {
  return vi.fn(
    (): Effect.Effect<void, ProviderAdapterError> =>
      Effect.sync(() => {
        sessions.clear()
      })
  )
}

export function makeFakeCodexAdapter(provider: ProviderKind = 'codex') {
  const sessions = new Map<ThreadId, ProviderSession>()
  const runtimeEventPubSub = Effect.runSync(PubSub.unbounded<ProviderRuntimeEvent>())

  const startSession = makeStartSessionMock(provider, sessions)
  const sendTurn = makeSendTurnMock(provider, sessions)
  const interruptTurn = makeVoidMock<[ThreadId, TurnId | undefined]>()
  const respondToRequest = makeVoidMock<[ThreadId, string, ProviderApprovalDecision]>()
  const respondToUserInput = makeVoidMock<[ThreadId, string, Record<string, unknown>]>()
  const stopSession = makeStopSessionMock(sessions)
  const listSessions = makeListSessionsMock(sessions)
  const hasSession = makeHasSessionMock(sessions)
  const readThread = makeReadThreadMock()
  const rollbackThread = makeRollbackThreadMock()
  const stopAll = makeStopAllMock(sessions)

  const adapter: ProviderAdapterShape<ProviderAdapterError> = {
    provider,
    capabilities: {
      sessionModelSwitch: 'in-session',
    },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread,
    stopAll,
    streamEvents: Stream.fromPubSub(runtimeEventPubSub),
  }

  const emit = (event: LegacyProviderRuntimeEvent): void => {
    Effect.runSync(PubSub.publish(runtimeEventPubSub, event as unknown as ProviderRuntimeEvent))
  }

  const updateSession = (
    threadId: ThreadId,
    update: (session: ProviderSession) => ProviderSession
  ): void => {
    const existing = sessions.get(threadId)
    if (!existing) {
      return
    }
    sessions.set(threadId, update(existing))
  }

  return {
    adapter,
    emit,
    updateSession,
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread,
    stopAll,
  }
}

type FakeAdapterFixture = ReturnType<typeof makeFakeCodexAdapter>

function makeRegistry(fixtures: Partial<Record<ProviderKind, FakeAdapterFixture>>) {
  const providerFixtures = Object.entries(fixtures).filter(
    (entry): entry is [ProviderKind, FakeAdapterFixture] => entry[1] !== undefined
  )

  return {
    getByProvider: (provider: ProviderKind) => {
      const fixture = fixtures[provider]
      return fixture
        ? Effect.succeed(fixture.adapter)
        : Effect.fail(new ProviderUnsupportedError({ provider }))
    },
    listProviders: () => Effect.succeed(providerFixtures.map(([provider]) => provider)),
  } satisfies typeof ProviderAdapterRegistry.Service
}

export function makeProviderServiceLayer() {
  const adapters: Partial<Record<ProviderKind, FakeAdapterFixture>> = {
    codex: makeFakeCodexAdapter(),
    claudeAgent: makeFakeCodexAdapter('claudeAgent'),
  }
  const providerAdapterLayer = Layer.succeed(ProviderAdapterRegistry, makeRegistry(adapters))
  const runtimeRepositoryLayer = ProviderSessionRuntimeRepositoryLive.pipe(
    Layer.provide(SqlitePersistenceMemory)
  )
  const directoryLayer = ProviderSessionDirectoryLive.pipe(Layer.provide(runtimeRepositoryLayer))
  const layer = it.layer(
    Layer.mergeAll(
      makeProviderServiceLive().pipe(
        Layer.provide(providerAdapterLayer),
        Layer.provide(directoryLayer),
        Layer.provide(defaultServerSettingsLayer),
        Layer.provideMerge(AnalyticsService.layerTest)
      ),
      directoryLayer,
      runtimeRepositoryLayer,
      NodeServices.layer
    )
  )

  return {
    layer,
    directoryLayer,
    runtimeRepositoryLayer,
    codex: adapters.codex,
    claude: adapters.claudeAgent,
  }
}

export function makeTempPersistenceHarness(prefix: string) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const dbPath = path.join(tempDir, 'orchestration.sqlite')
  const persistenceLayer = makeSqlitePersistenceLive(dbPath)
  const runtimeRepositoryLayer = ProviderSessionRuntimeRepositoryLive.pipe(
    Layer.provide(persistenceLayer)
  )
  const directoryLayer = ProviderSessionDirectoryLive.pipe(Layer.provide(runtimeRepositoryLayer))

  return {
    tempDir,
    dbPath,
    persistenceLayer,
    runtimeRepositoryLayer,
    directoryLayer,
    cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
  }
}

export function assertStartPayload(
  value: unknown,
  expected: {
    readonly provider: string
    readonly cwd: string
    readonly threadId: string
    readonly resumeCursor?: unknown
    readonly modelSelection?: unknown
  }
) {
  assert.equal(typeof value === 'object' && value !== null, true)
  if (!value || typeof value !== 'object') {
    return
  }

  const payload = value as {
    provider?: string
    cwd?: string
    resumeCursor?: unknown
    threadId?: string
    modelSelection?: unknown
  }

  assert.equal(payload.provider, expected.provider)
  assert.equal(payload.cwd, expected.cwd)
  assert.equal(payload.threadId, expected.threadId)
  if (expected.resumeCursor !== undefined) {
    assert.deepEqual(payload.resumeCursor, expected.resumeCursor)
  }
  if (expected.modelSelection !== undefined) {
    assert.deepEqual(payload.modelSelection, expected.modelSelection)
  }
}

export const sleep = (ms: number) =>
  Effect.promise(() => new Promise<void>(resolve => setTimeout(resolve, ms)))
