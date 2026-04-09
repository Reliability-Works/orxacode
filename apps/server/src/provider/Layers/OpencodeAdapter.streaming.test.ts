/**
 * End-to-end streaming integration test for the OpencodeAdapter runtime pump.
 *
 * Feeds the canned `streaming.fixtures.ts` event sequences through the full
 * runtime pump (fake server -> fake SDK runtime -> subscribeEvents iterable
 * -> attachEventStreamFiber -> mapOpencodeEvent -> runtimeEventQueue) and
 * asserts the resulting `ProviderRuntimeEvent` sequence is correct. Exercises
 * the wiring introduced in f05's `runtime.events.ts` extraction without
 * spinning up the full Layer (the layer-level smoke lives in
 * `OpencodeAdapter.test.ts`).
 *
 * @module OpencodeAdapter.streaming.test
 */
import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'

import {
  FIXTURE_PROVIDER_SESSION_ID,
  fixtureMessageUpdatedCompleted,
  fixtureMessageUpdatedInProgress,
  fixtureSessionIdle,
  fixtureTextPartDelta,
  fixtureTextPartUpdatedCompleted,
  fixtureTextPartUpdatedInProgress,
} from './OpencodeAdapter.streaming.fixtures.ts'
import { startSession } from './OpencodeAdapter.runtime.session.ts'
import { sendTurn } from './OpencodeAdapter.runtime.turns.ts'
import {
  collectEvents,
  createFakeOpencodeRuntime,
  drainEvents,
  makeFakeCreateRuntime,
  makeTestDeps,
  TEST_THREAD_ID,
} from './OpencodeAdapter.test.helpers.ts'

const STREAMING_TIMEOUT_MS = 5_000

describe('OpencodeAdapter streaming integration - happy path', () => {
  it(
    'drives the fixture sequence through the pump end-to-end',
    async () => {
      const fakeRuntime = createFakeOpencodeRuntime({
        sessionId: FIXTURE_PROVIDER_SESSION_ID,
      })
      await Effect.runPromise(
        Effect.gen(function* () {
          const harness = yield* makeTestDeps({
            createRuntime: makeFakeCreateRuntime(fakeRuntime),
          })

          yield* startSession(harness.deps)({
            threadId: TEST_THREAD_ID,
            runtimeMode: 'full-access',
          })
          // Drain the synchronous session.started so subsequent collectEvents
          // calls only see streaming-pump output.
          yield* collectEvents(harness.runtimeEventQueue, 1)

          // Open a turn so the mapper has an active turnId for the in-progress
          // assistant message events. sendTurn issues an additional SDK call
          // and emits its own turn.started which we drain immediately.
          yield* sendTurn(harness.deps)({
            threadId: TEST_THREAD_ID,
            input: 'hello',
          })
          yield* collectEvents(harness.runtimeEventQueue, 1)

          fakeRuntime.pushEvent(fixtureMessageUpdatedInProgress)
          fakeRuntime.pushEvent(fixtureTextPartUpdatedInProgress)
          fakeRuntime.pushEvent(fixtureTextPartDelta)
          fakeRuntime.pushEvent(fixtureTextPartUpdatedCompleted)
          fakeRuntime.pushEvent(fixtureMessageUpdatedCompleted)
          fakeRuntime.pushEvent(fixtureSessionIdle)

          // Yield repeatedly so the forked pump fiber can drain the buffered
          // events and offer them onto the runtime queue before we sample it.
          for (let i = 0; i < 8; i += 1) {
            yield* Effect.yieldNow
          }

          const events = yield* drainEvents(harness.runtimeEventQueue)
          const types = events.map(event => event.type)

          expect(types).toContain('item.started')
          expect(types).toContain('content.delta')
          expect(types).toContain('item.completed')
          expect(types).toContain('thread.token-usage.updated')
          expect(types).toContain('turn.completed')

          const delta = events.find(event => event.type === 'content.delta')
          expect(delta?.type).toBe('content.delta')
          if (delta?.type === 'content.delta') {
            expect(delta.payload.streamKind).toBe('assistant_text')
            expect(delta.payload.delta).toBe('world')
          }
        })
      )
    },
    STREAMING_TIMEOUT_MS
  )
})

describe('OpencodeAdapter streaming integration - error path', () => {
  it(
    'routes session.error through the mapper to runtime.error + turn.completed',
    async () => {
      const fakeRuntime = createFakeOpencodeRuntime({
        sessionId: FIXTURE_PROVIDER_SESSION_ID,
      })
      await Effect.runPromise(
        Effect.gen(function* () {
          const harness = yield* makeTestDeps({
            createRuntime: makeFakeCreateRuntime(fakeRuntime),
          })
          yield* startSession(harness.deps)({
            threadId: TEST_THREAD_ID,
            runtimeMode: 'full-access',
          })
          yield* collectEvents(harness.runtimeEventQueue, 1)
          yield* sendTurn(harness.deps)({
            threadId: TEST_THREAD_ID,
            input: 'cause an error',
          })
          yield* collectEvents(harness.runtimeEventQueue, 1)

          fakeRuntime.pushEvent({
            type: 'session.error',
            properties: {
              sessionID: FIXTURE_PROVIDER_SESSION_ID,
              error: {
                name: 'ProviderAuthError',
                data: { providerID: 'anthropic', message: 'Missing API key' },
              },
            },
          })

          for (let i = 0; i < 8; i += 1) {
            yield* Effect.yieldNow
          }

          const events = yield* drainEvents(harness.runtimeEventQueue)
          const types = events.map(event => event.type)
          expect(types).toContain('runtime.error')
          expect(types).toContain('turn.completed')
        })
      )
    },
    STREAMING_TIMEOUT_MS
  )
})
