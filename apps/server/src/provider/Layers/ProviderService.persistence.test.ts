import { Effect, Option } from 'effect'
import { Layer } from 'effect'
import * as SqlClient from 'effect/unstable/sql/SqlClient'
import { it, assert } from '@effect/vitest'
import * as NodeServices from '@effect/platform-node/NodeServices'

import { ProviderUnsupportedError } from '../Errors.ts'
import { ProviderAdapterRegistry } from '../Services/ProviderAdapterRegistry.ts'
import { ProviderService } from '../Services/ProviderService.ts'
import { ProviderSessionDirectory } from '../Services/ProviderSessionDirectory.ts'
import { ProviderSessionRuntimeRepository } from '../../persistence/Services/ProviderSessionRuntime.ts'
import { AnalyticsService } from '../../telemetry/Services/AnalyticsService.ts'
import { makeProviderServiceLive } from './ProviderService.ts'
import {
  asThreadId,
  assertStartPayload,
  defaultServerSettingsLayer,
  makeFakeCodexAdapter,
  makeTempPersistenceHarness,
} from './ProviderService.test.helpers.ts'

function makeSingleProviderRegistry(
  provider: 'codex' | 'claudeAgent',
  fixture: ReturnType<typeof makeFakeCodexAdapter>
) {
  return {
    getByProvider: (requestedProvider: string) =>
      requestedProvider === provider
        ? Effect.succeed(fixture.adapter)
        : Effect.fail(new ProviderUnsupportedError({ provider: requestedProvider as never })),
    listProviders: () => Effect.succeed([provider]),
  } satisfies typeof ProviderAdapterRegistry.Service
}

function makeSingleProviderLayer(
  provider: 'codex' | 'claudeAgent',
  fixture: ReturnType<typeof makeFakeCodexAdapter>,
  harness: ReturnType<typeof makeTempPersistenceHarness>
) {
  return makeProviderServiceLive().pipe(
    Layer.provide(
      Layer.succeed(ProviderAdapterRegistry, makeSingleProviderRegistry(provider, fixture))
    ),
    Layer.provide(harness.directoryLayer),
    Layer.provide(defaultServerSettingsLayer),
    Layer.provide(AnalyticsService.layerTest)
  )
}

function startRestartableCodexSession(
  firstProviderLayer: ReturnType<typeof makeSingleProviderLayer>,
  firstCodex: ReturnType<typeof makeFakeCodexAdapter>,
  updatedResumeCursor: {
    readonly threadId: ReturnType<typeof asThreadId>
    readonly resume: string
    readonly resumeSessionAt: string
    readonly turnCount: number
  }
) {
  return Effect.gen(function* () {
    const provider = yield* ProviderService
    const threadId = asThreadId('thread-1')
    const session = yield* provider.startSession(threadId, {
      provider: 'codex',
      cwd: '/tmp/project',
      runtimeMode: 'full-access',
      threadId,
    })
    firstCodex.updateSession(threadId, existing => ({
      ...existing,
      status: 'ready',
      resumeCursor: updatedResumeCursor,
      updatedAt: new Date(Date.now() + 1_000).toISOString(),
    }))
    return session
  }).pipe(Effect.provide(firstProviderLayer))
}

function assertPersistedStoppedRuntime(
  harness: ReturnType<typeof makeTempPersistenceHarness>,
  threadId: ReturnType<typeof asThreadId>,
  updatedResumeCursor: unknown
) {
  return Effect.gen(function* () {
    const repository = yield* ProviderSessionRuntimeRepository
    return yield* repository.getByThreadId({ threadId })
  }).pipe(
    Effect.provide(harness.runtimeRepositoryLayer),
    Effect.tap(persistedAfterStopAll => {
      assert.equal(Option.isSome(persistedAfterStopAll), true)
      if (Option.isSome(persistedAfterStopAll)) {
        assert.equal(persistedAfterStopAll.value.status, 'stopped')
        assert.deepEqual(persistedAfterStopAll.value.resumeCursor, updatedResumeCursor)
      }
      return Effect.void
    })
  )
}

it.effect('ProviderServiceLive keeps persisted resumable sessions on startup', () =>
  Effect.gen(function* () {
    const harness = makeTempPersistenceHarness('orxa-provider-service-')
    const codex = makeFakeCodexAdapter()

    yield* Effect.gen(function* () {
      const directory = yield* ProviderSessionDirectory
      yield* directory.upsert({
        provider: 'codex',
        threadId: asThreadId('thread-stale'),
      })
    }).pipe(Effect.provide(harness.directoryLayer))

    const registry: typeof ProviderAdapterRegistry.Service = {
      getByProvider: provider =>
        provider === 'codex'
          ? Effect.succeed(codex.adapter)
          : Effect.fail(new ProviderUnsupportedError({ provider })),
      listProviders: () => Effect.succeed(['codex']),
    }

    const providerLayer = makeProviderServiceLive().pipe(
      Layer.provide(Layer.succeed(ProviderAdapterRegistry, registry)),
      Layer.provide(harness.directoryLayer),
      Layer.provide(defaultServerSettingsLayer),
      Layer.provide(AnalyticsService.layerTest)
    )

    yield* Effect.gen(function* () {
      yield* ProviderService
    }).pipe(Effect.provide(providerLayer))

    const persistedProvider = yield* Effect.gen(function* () {
      const directory = yield* ProviderSessionDirectory
      return yield* directory.getProvider(asThreadId('thread-stale'))
    }).pipe(Effect.provide(harness.directoryLayer))
    assert.equal(persistedProvider, 'codex')

    const runtime = yield* Effect.gen(function* () {
      const repository = yield* ProviderSessionRuntimeRepository
      return yield* repository.getByThreadId({ threadId: asThreadId('thread-stale') })
    }).pipe(Effect.provide(harness.runtimeRepositoryLayer))
    assert.equal(Option.isSome(runtime), true)

    const legacyTableRows = yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'provider_sessions'
      `
    }).pipe(Effect.provide(harness.persistenceLayer))
    assert.equal(legacyTableRows.length, 0)

    harness.cleanup()
  }).pipe(Effect.provide(NodeServices.layer))
)

it.effect(
  'ProviderServiceLive restores rollback routing after restart using persisted thread mapping',
  () =>
    Effect.gen(function* () {
      const harness = makeTempPersistenceHarness('orxa-provider-service-restart-')
      const firstCodex = makeFakeCodexAdapter()
      const firstProviderLayer = makeSingleProviderLayer('codex', firstCodex, harness)
      const updatedResumeCursor = {
        threadId: asThreadId('thread-1'),
        resume: 'resume-session-1',
        resumeSessionAt: 'assistant-message-1',
        turnCount: 1,
      }

      const startedSession = yield* startRestartableCodexSession(
        firstProviderLayer,
        firstCodex,
        updatedResumeCursor
      )

      yield* assertPersistedStoppedRuntime(harness, startedSession.threadId, updatedResumeCursor)

      const secondCodex = makeFakeCodexAdapter()
      const secondProviderLayer = makeSingleProviderLayer('codex', secondCodex, harness)

      secondCodex.startSession.mockClear()
      secondCodex.rollbackThread.mockClear()

      yield* Effect.gen(function* () {
        const provider = yield* ProviderService
        yield* provider.rollbackConversation({
          threadId: startedSession.threadId,
          numTurns: 1,
        })
      }).pipe(Effect.provide(secondProviderLayer))

      assert.equal(secondCodex.startSession.mock.calls.length, 1)
      assertStartPayload(secondCodex.startSession.mock.calls[0]?.[0], {
        provider: 'codex',
        cwd: '/tmp/project',
        resumeCursor: updatedResumeCursor,
        threadId: startedSession.threadId,
      })
      assert.equal(secondCodex.rollbackThread.mock.calls.length, 1)
      assert.equal(secondCodex.rollbackThread.mock.calls[0]?.[1], 1)

      harness.cleanup()
    }).pipe(Effect.provide(NodeServices.layer))
)

it.effect('reuses persisted resume cursor when startSession is called after a restart', () =>
  Effect.gen(function* () {
    const harness = makeTempPersistenceHarness('orxa-provider-service-start-')
    const firstClaude = makeFakeCodexAdapter('claudeAgent')
    const firstProviderLayer = makeSingleProviderLayer('claudeAgent', firstClaude, harness)

    const initial = yield* Effect.gen(function* () {
      const provider = yield* ProviderService
      return yield* provider.startSession(asThreadId('thread-claude-start'), {
        provider: 'claudeAgent',
        threadId: asThreadId('thread-claude-start'),
        cwd: '/tmp/project-claude-start',
        runtimeMode: 'full-access',
      })
    }).pipe(Effect.provide(firstProviderLayer))

    yield* Effect.gen(function* () {
      const provider = yield* ProviderService
      yield* provider.listSessions()
    }).pipe(Effect.provide(firstProviderLayer))

    const secondClaude = makeFakeCodexAdapter('claudeAgent')
    const secondProviderLayer = makeSingleProviderLayer('claudeAgent', secondClaude, harness)

    secondClaude.startSession.mockClear()

    yield* Effect.gen(function* () {
      const provider = yield* ProviderService
      yield* provider.startSession(initial.threadId, {
        provider: 'claudeAgent',
        threadId: initial.threadId,
        cwd: '/tmp/project-claude-start',
        runtimeMode: 'full-access',
      })
    }).pipe(Effect.provide(secondProviderLayer))

    assert.equal(secondClaude.startSession.mock.calls.length, 1)
    assertStartPayload(secondClaude.startSession.mock.calls[0]?.[0], {
      provider: 'claudeAgent',
      cwd: '/tmp/project-claude-start',
      resumeCursor: initial.resumeCursor,
      threadId: initial.threadId,
    })

    harness.cleanup()
  }).pipe(Effect.provide(NodeServices.layer))
)
