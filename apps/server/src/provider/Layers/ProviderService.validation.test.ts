import { Effect, Option } from 'effect'
import { assert } from '@effect/vitest'

import { ProviderService } from '../Services/ProviderService.ts'
import { ProviderSessionRuntimeRepository } from '../../persistence/Services/ProviderSessionRuntime.ts'
import { asThreadId, makeProviderServiceLayer } from './ProviderService.test.helpers.ts'

const validation = makeProviderServiceLayer()
const codex = validation.codex!

validation.layer('ProviderServiceLive validation', it => {
  it.effect('returns ProviderValidationError for invalid input payloads', () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService

      const failure = yield* Effect.result(
        provider.startSession(asThreadId('thread-validation'), {
          threadId: asThreadId('thread-validation'),
          provider: 'invalid-provider',
          runtimeMode: 'full-access',
        } as never)
      )

      assert.equal(failure._tag, 'Failure')
      if (failure._tag !== 'Failure') {
        return
      }
      assert.equal(failure.failure._tag, 'ProviderValidationError')
      if (failure.failure._tag !== 'ProviderValidationError') {
        return
      }
      assert.equal(failure.failure.operation, 'ProviderService.startSession')
      assert.equal(failure.failure.issue.includes('invalid-provider'), true)
    })
  )

  it.effect('accepts startSession when adapter has not emitted provider thread id yet', () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService
      const runtimeRepository = yield* ProviderSessionRuntimeRepository

      codex.startSession.mockImplementationOnce(input =>
        Effect.sync(() => {
          const now = new Date().toISOString()
          return {
            provider: 'codex',
            status: 'ready',
            threadId: input.threadId,
            runtimeMode: input.runtimeMode,
            cwd: input.cwd ?? process.cwd(),
            createdAt: now,
            updatedAt: now,
          }
        })
      )

      const session = yield* provider.startSession(asThreadId('thread-missing'), {
        provider: 'codex',
        threadId: asThreadId('thread-missing'),
        cwd: '/tmp/project',
        runtimeMode: 'full-access',
      })

      assert.equal(session.threadId, asThreadId('thread-missing'))

      const runtime = yield* runtimeRepository.getByThreadId({
        threadId: session.threadId,
      })
      assert.equal(Option.isSome(runtime), true)
      if (Option.isSome(runtime)) {
        assert.equal(runtime.value.threadId, session.threadId)
      }
    })
  )
})
