import assert from 'node:assert/strict'
import { Effect } from 'effect'

import { ProviderAdapterValidationError } from '../Errors.ts'
import { CodexAdapter } from '../Services/CodexAdapter.ts'
import {
  FakeCodexManager,
  asThreadId,
  makeCodexAdapterTestLayer,
} from './CodexAdapter.test.helpers.ts'

const validationManager = new FakeCodexManager()
const validationLayer = makeCodexAdapterTestLayer(validationManager)

validationLayer('CodexAdapterLive validation', it => {
  it.effect('returns validation error for non-codex provider on startSession', () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter
      const result = yield* adapter
        .startSession({
          provider: 'claudeAgent',
          threadId: asThreadId('thread-1'),
          runtimeMode: 'full-access',
        })
        .pipe(Effect.result)

      assert.equal(result._tag, 'Failure')
      assert.deepStrictEqual(
        result.failure,
        new ProviderAdapterValidationError({
          provider: 'codex',
          operation: 'startSession',
          issue: "Expected provider 'codex' but received 'claudeAgent'.",
        })
      )
      assert.equal(validationManager.startSessionImpl.mock.calls.length, 0)
    })
  )

  it.effect('maps codex model options before starting a session', () =>
    Effect.gen(function* () {
      validationManager.startSessionImpl.mockClear()
      const adapter = yield* CodexAdapter

      yield* adapter.startSession({
        provider: 'codex',
        threadId: asThreadId('thread-1'),
        modelSelection: {
          provider: 'codex',
          model: 'gpt-5.3-codex',
          options: {
            fastMode: true,
          },
        },
        runtimeMode: 'full-access',
      })

      assert.deepStrictEqual(validationManager.startSessionImpl.mock.calls[0]?.[0], {
        provider: 'codex',
        threadId: asThreadId('thread-1'),
        binaryPath: 'codex',
        model: 'gpt-5.3-codex',
        serviceTier: 'fast',
        runtimeMode: 'full-access',
      })
    })
  )
})

const sessionErrorManager = new FakeCodexManager()
sessionErrorManager.sendTurnImpl.mockImplementation(async () => {
  throw new Error('Unknown session: sess-missing')
})
const sessionErrorLayer = makeCodexAdapterTestLayer(sessionErrorManager)

sessionErrorLayer('CodexAdapterLive session errors', it => {
  it.effect('maps unknown-session sendTurn errors to ProviderAdapterSessionNotFoundError', () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter
      const result = yield* adapter
        .sendTurn({
          threadId: asThreadId('sess-missing'),
          input: 'hello',
          attachments: [],
        })
        .pipe(Effect.result)

      assert.equal(result._tag, 'Failure')
      if (result._tag !== 'Failure') {
        return
      }

      assert.equal(result.failure._tag, 'ProviderAdapterSessionNotFoundError')
      if (result.failure._tag !== 'ProviderAdapterSessionNotFoundError') {
        return
      }
      assert.equal(result.failure.provider, 'codex')
      assert.equal(result.failure.threadId, 'sess-missing')
      assert.equal(result.failure.cause instanceof Error, true)
    })
  )

  it.effect('maps codex model options before sending a turn', () =>
    Effect.gen(function* () {
      sessionErrorManager.sendTurnImpl.mockClear()
      const adapter = yield* CodexAdapter

      yield* Effect.ignore(
        adapter.sendTurn({
          threadId: asThreadId('sess-missing'),
          input: 'hello',
          modelSelection: {
            provider: 'codex',
            model: 'gpt-5.3-codex',
            options: {
              reasoningEffort: 'high',
              fastMode: true,
            },
          },
          attachments: [],
        })
      )

      assert.deepStrictEqual(sessionErrorManager.sendTurnImpl.mock.calls[0]?.[0], {
        threadId: asThreadId('sess-missing'),
        input: 'hello',
        model: 'gpt-5.3-codex',
        effort: 'high',
        serviceTier: 'fast',
      })
    })
  )
})
