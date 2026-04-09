/**
 * Layer-level integration smoke for the OpencodeAdapter entry module.
 *
 * Spins up `makeOpencodeAdapterLive` with the in-memory fakes from
 * `OpencodeAdapter.test.helpers.ts`, resolves the `OpencodeAdapter` service
 * tag, and exercises the public adapter shape: `startSession`, `sendTurn`,
 * `interruptTurn`, `hasSession`, `listSessions`, `stopSession`. Asserts that
 * the runtime event stream surfaces the expected lifecycle events end-to-end
 * through the live Layer (no direct module imports for the methods under
 * test).
 *
 * @module OpencodeAdapter.test
 */
import * as NodeServices from '@effect/platform-node/NodeServices'
import { ThreadId } from '@orxa-code/contracts'
import { describe, expect, it } from 'vitest'
import { Effect, Layer, Stream } from 'effect'

import { ServerConfig } from '../../config.ts'
import { ServerSettingsService } from '../../serverSettings.ts'
import { OpencodeAdapter } from '../Services/OpencodeAdapter.ts'
import { makeOpencodeAdapterLive } from './OpencodeAdapter.ts'
import {
  createFakeOpencodeRuntime,
  type FakeOpencodeRuntime,
} from './OpencodeAdapter.test.helpers.ts'

const ENTRY_TEST_THREAD_ID = ThreadId.makeUnsafe('thread-opencode-entry-1')

function makeLayer(fakeRuntime: FakeOpencodeRuntime) {
  return makeOpencodeAdapterLive({
    createRuntime: async () => fakeRuntime,
  }).pipe(
    Layer.provideMerge(
      ServerConfig.layerTest('/tmp/opencode-entry-test', '/tmp/opencode-entry-test-base')
    ),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(NodeServices.layer)
  )
}

describe('OpencodeAdapterLive entry layer', () => {
  it('starts a session, dispatches a turn, and stops cleanly through the service tag', async () => {
    const fakeRuntime = createFakeOpencodeRuntime({ sessionId: 'sess-entry' })
    const layer = makeLayer(fakeRuntime)

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const adapter = yield* OpencodeAdapter

          const services = yield* Effect.services()
          const runFork = Effect.runForkWith(services)
          const collected: Array<string> = []
          const eventsFiber = runFork(
            Stream.runForEach(adapter.streamEvents, event =>
              Effect.sync(() => {
                collected.push(event.type)
              })
            )
          )

          const session = yield* adapter.startSession({
            threadId: ENTRY_TEST_THREAD_ID,
            runtimeMode: 'full-access',
          })
          expect(session.threadId).toBe(ENTRY_TEST_THREAD_ID)
          expect(session.provider).toBe('opencode')
          expect(yield* adapter.hasSession(ENTRY_TEST_THREAD_ID)).toBe(true)
          expect((yield* adapter.listSessions()).length).toBe(1)

          const turn = yield* adapter.sendTurn({
            threadId: ENTRY_TEST_THREAD_ID,
            input: 'hello opencode',
          })
          expect(turn.threadId).toBe(ENTRY_TEST_THREAD_ID)
          expect(fakeRuntime.sessionPromptCalls.length).toBe(1)
          expect(fakeRuntime.sessionPromptCalls[0]?.text).toBe('hello opencode')

          yield* adapter.interruptTurn(ENTRY_TEST_THREAD_ID)
          expect(fakeRuntime.sessionAbortCalls.length).toBe(1)

          yield* adapter.stopSession(ENTRY_TEST_THREAD_ID)
          expect(fakeRuntime.shutdownCalls.count).toBeGreaterThanOrEqual(1)
          expect(yield* adapter.hasSession(ENTRY_TEST_THREAD_ID)).toBe(false)

          for (let i = 0; i < 8; i += 1) {
            yield* Effect.yieldNow
          }

          eventsFiber.interruptUnsafe()
          expect(collected).toContain('session.started')
          expect(collected).toContain('turn.started')
          expect(collected).toContain('session.exited')
        })
      ).pipe(Effect.provide(layer))
    )
  })

  it('returns a request error when respondToRequest is called (opencode unsupported)', async () => {
    const fakeRuntime = createFakeOpencodeRuntime({ sessionId: 'sess-noapprove' })
    const layer = makeLayer(fakeRuntime)

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const adapter = yield* OpencodeAdapter
          const result = yield* Effect.exit(
            adapter.respondToRequest(
              ENTRY_TEST_THREAD_ID,
              'req-unknown' as never,
              { kind: 'approve' } as never
            )
          )
          expect(result._tag).toBe('Failure')
        })
      ).pipe(Effect.provide(layer))
    )
  })
})
