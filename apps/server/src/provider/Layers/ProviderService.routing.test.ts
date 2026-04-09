import { Effect, Option } from 'effect'
import { assert } from '@effect/vitest'
import { assertFailure } from '@effect/vitest/utils'

import { ProviderValidationError } from '../Errors.ts'
import { ProviderService } from '../Services/ProviderService.ts'
import { ProviderSessionRuntimeRepository } from '../../persistence/Services/ProviderSessionRuntime.ts'
import {
  asRequestId,
  asThreadId,
  asTurnId,
  assertStartPayload,
  makeProviderServiceLayer,
} from './ProviderService.test.helpers.ts'

const routing = makeProviderServiceLayer()
const codex = routing.codex!
const claude = routing.claude!

routing.layer('ProviderServiceLive send/interrupt routing', it => {
  it.effect('routes sendTurn and interrupt operations', () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService

      const session = yield* provider.startSession(asThreadId('thread-1'), {
        provider: 'codex',
        threadId: asThreadId('thread-1'),
        cwd: '/tmp/project',
        runtimeMode: 'full-access',
      })
      assert.equal(session.provider, 'codex')

      yield* provider.sendTurn({
        threadId: session.threadId,
        input: 'hello',
        attachments: [],
      })
      assert.equal(codex.sendTurn.mock.calls.length, 1)

      yield* provider.interruptTurn({ threadId: session.threadId })
      assert.deepEqual(codex.interruptTurn.mock.calls, [[session.threadId, undefined, undefined]])
    })
  )
})

routing.layer('ProviderServiceLive request routing', it => {
  it.effect('routes approval and user-input responses', () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService

      const session = yield* provider.startSession(asThreadId('thread-approval-1'), {
        provider: 'codex',
        threadId: asThreadId('thread-approval-1'),
        cwd: '/tmp/project',
        runtimeMode: 'full-access',
      })

      yield* provider.respondToRequest({
        threadId: session.threadId,
        requestId: asRequestId('req-1'),
        decision: 'accept',
      })
      assert.deepEqual(codex.respondToRequest.mock.calls, [
        [session.threadId, asRequestId('req-1'), 'accept'],
      ])

      yield* provider.respondToUserInput({
        threadId: session.threadId,
        requestId: asRequestId('req-user-input-1'),
        answers: {
          sandbox_mode: 'workspace-write',
        },
      })
      assert.deepEqual(codex.respondToUserInput.mock.calls, [
        [
          session.threadId,
          asRequestId('req-user-input-1'),
          {
            sandbox_mode: 'workspace-write',
          },
        ],
      ])
    })
  )
})

routing.layer('ProviderServiceLive rollback/stop routing', it => {
  it.effect('routes rollback and stop session operations', () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService

      const session = yield* provider.startSession(asThreadId('thread-stop-1'), {
        provider: 'codex',
        threadId: asThreadId('thread-stop-1'),
        cwd: '/tmp/project',
        runtimeMode: 'full-access',
      })

      const sessions = yield* provider.listSessions()
      assert.equal(sessions.length >= 1, true)

      yield* provider.rollbackConversation({
        threadId: session.threadId,
        numTurns: 0,
      })

      yield* provider.stopSession({ threadId: session.threadId })
      const sendAfterStop = yield* Effect.result(
        provider.sendTurn({
          threadId: session.threadId,
          input: 'after-stop',
          attachments: [],
        })
      )
      assertFailure(
        sendAfterStop,
        new ProviderValidationError({
          operation: 'ProviderService.sendTurn',
          issue: `Cannot route thread '${session.threadId}' because no persisted provider binding exists.`,
        })
      )
    })
  )

  it.effect('passes provider child thread overrides through interrupt routing', () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService

      const session = yield* provider.startSession(asThreadId('thread-interrupt-child'), {
        provider: 'codex',
        threadId: asThreadId('thread-interrupt-child'),
        runtimeMode: 'full-access',
      })

      yield* provider.interruptTurn({
        threadId: session.threadId,
        turnId: asTurnId('turn-child-1'),
        providerThreadId: 'child-provider-1',
      })

      assert.deepEqual(codex.interruptTurn.mock.calls.at(-1), [
        session.threadId,
        asTurnId('turn-child-1'),
        'child-provider-1',
      ])
    })
  )
})

routing.layer('ProviderServiceLive routing claude sessions', it => {
  it.effect('routes explicit claudeAgent provider session starts to the claude adapter', () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService

      const session = yield* provider.startSession(asThreadId('thread-claude'), {
        provider: 'claudeAgent',
        threadId: asThreadId('thread-claude'),
        cwd: '/tmp/project-claude',
        runtimeMode: 'full-access',
      })

      assert.equal(session.provider, 'claudeAgent')
      assert.equal(claude.startSession.mock.calls.length, 1)
      assertStartPayload(claude.startSession.mock.calls[0]?.[0], {
        provider: 'claudeAgent',
        cwd: '/tmp/project-claude',
        threadId: 'thread-claude',
      })
    })
  )

  it.effect('lists no sessions after adapter runtime clears', () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService

      yield* provider.startSession(asThreadId('thread-1'), {
        provider: 'codex',
        threadId: asThreadId('thread-1'),
        runtimeMode: 'full-access',
      })
      yield* provider.startSession(asThreadId('thread-2'), {
        provider: 'codex',
        threadId: asThreadId('thread-2'),
        runtimeMode: 'full-access',
      })

      yield* codex.stopAll()
      yield* claude.stopAll()

      const remaining = yield* provider.listSessions()
      assert.equal(remaining.length, 0)
    })
  )
})

routing.layer('ProviderServiceLive rollback recovery', it => {
  it.effect('recovers stale persisted sessions for rollback by resuming thread identity', () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService

      const initial = yield* provider.startSession(asThreadId('thread-1'), {
        provider: 'codex',
        threadId: asThreadId('thread-1'),
        cwd: '/tmp/project',
        runtimeMode: 'full-access',
      })
      yield* codex.stopSession(initial.threadId)
      codex.startSession.mockClear()
      codex.rollbackThread.mockClear()

      yield* provider.rollbackConversation({
        threadId: initial.threadId,
        numTurns: 1,
      })

      assert.equal(codex.startSession.mock.calls.length, 1)
      assertStartPayload(codex.startSession.mock.calls[0]?.[0], {
        provider: 'codex',
        cwd: '/tmp/project',
        resumeCursor: initial.resumeCursor,
        threadId: initial.threadId,
      })
      assert.equal(codex.rollbackThread.mock.calls.length, 1)
      assert.equal(codex.rollbackThread.mock.calls[0]?.[1], 1)
    })
  )
})

routing.layer('ProviderServiceLive codex sendTurn recovery', it => {
  it.effect('recovers stale sessions for sendTurn using persisted cwd', () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService

      const initial = yield* provider.startSession(asThreadId('thread-1'), {
        provider: 'codex',
        threadId: asThreadId('thread-1'),
        cwd: '/tmp/project-send-turn',
        runtimeMode: 'full-access',
      })

      yield* codex.stopAll()
      codex.startSession.mockClear()
      codex.sendTurn.mockClear()

      yield* provider.sendTurn({
        threadId: initial.threadId,
        input: 'resume',
        attachments: [],
      })

      assert.equal(codex.startSession.mock.calls.length, 1)
      assertStartPayload(codex.startSession.mock.calls[0]?.[0], {
        provider: 'codex',
        cwd: '/tmp/project-send-turn',
        resumeCursor: initial.resumeCursor,
        threadId: initial.threadId,
      })
      assert.equal(codex.sendTurn.mock.calls.length, 1)
    })
  )
})

routing.layer('ProviderServiceLive claude sendTurn recovery', it => {
  it.effect('recovers stale claudeAgent sessions for sendTurn using persisted cwd', () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService

      const initial = yield* provider.startSession(asThreadId('thread-claude-send-turn'), {
        provider: 'claudeAgent',
        threadId: asThreadId('thread-claude-send-turn'),
        cwd: '/tmp/project-claude-send-turn',
        modelSelection: {
          provider: 'claudeAgent',
          model: 'claude-opus-4-6',
          options: {
            effort: 'max',
          },
        },
        runtimeMode: 'full-access',
      })

      yield* claude.stopAll()
      claude.startSession.mockClear()
      claude.sendTurn.mockClear()

      yield* provider.sendTurn({
        threadId: initial.threadId,
        input: 'resume with claude',
        attachments: [],
      })

      assert.equal(claude.startSession.mock.calls.length, 1)
      assertStartPayload(claude.startSession.mock.calls[0]?.[0], {
        provider: 'claudeAgent',
        cwd: '/tmp/project-claude-send-turn',
        modelSelection: {
          provider: 'claudeAgent',
          model: 'claude-opus-4-6',
          options: {
            effort: 'max',
          },
        },
        resumeCursor: initial.resumeCursor,
        threadId: initial.threadId,
      })
      assert.equal(claude.sendTurn.mock.calls.length, 1)
    })
  )
})

routing.layer('ProviderServiceLive runtime persistence', it => {
  it.effect('persists runtime status transitions in provider_session_runtime', () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService
      const runtimeRepository = yield* ProviderSessionRuntimeRepository

      const session = yield* provider.startSession(asThreadId('thread-1'), {
        provider: 'codex',
        threadId: asThreadId('thread-1'),
        runtimeMode: 'full-access',
      })
      yield* provider.sendTurn({
        threadId: session.threadId,
        input: 'hello',
        attachments: [],
      })

      const runningRuntime = yield* runtimeRepository.getByThreadId({
        threadId: session.threadId,
      })
      assert.equal(Option.isSome(runningRuntime), true)
      if (!Option.isSome(runningRuntime)) {
        return
      }

      assert.equal(runningRuntime.value.status, 'running')
      assert.deepEqual(runningRuntime.value.resumeCursor, session.resumeCursor)
      const payload = runningRuntime.value.runtimePayload
      assert.equal(payload !== null && typeof payload === 'object', true)
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        return
      }

      const runtimePayload = payload as {
        cwd: string
        model: string | null
        activeTurnId: string | null
        lastError: string | null
        lastRuntimeEvent: string | null
      }
      assert.equal(runtimePayload.cwd, process.cwd())
      assert.equal(runtimePayload.model, null)
      assert.equal(runtimePayload.activeTurnId, `turn-${String(session.threadId)}`)
      assert.equal(runtimePayload.lastError, null)
      assert.equal(runtimePayload.lastRuntimeEvent, 'provider.sendTurn')
    })
  )
})
