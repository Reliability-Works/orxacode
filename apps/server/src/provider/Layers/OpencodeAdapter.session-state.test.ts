/**
 * Runtime session lifecycle tests for the OpencodeAdapter.
 *
 * Covers: happy-path startup (runtime acquired, SDK session created, events
 * streamed through the pure mapper into the runtime queue), spawn failure
 * (startSession returns a process error and no context is registered),
 * stopSessionInternal (interrupts the event stream fiber, aborts the SDK
 * session, shuts down the runtime, flips to closed, emits `session.exited`),
 * and scope-exit style cleanup (stopSessionInternal is idempotent).
 *
 * These tests exercise the raw exported functions from
 * `OpencodeAdapter.runtime.session.ts`; the Effect service tag is introduced
 * in f05 and a full layer integration test will live there.
 *
 * @module OpencodeAdapter.session-state.test
 */
import { describe, expect, it } from 'vitest'
import { Effect, Exit } from 'effect'

import { startSession, stopSessionInternal } from './OpencodeAdapter.runtime.session.ts'
import {
  collectEvents,
  createFakeOpencodeRuntime,
  drainEvents,
  makeFakeCreateRuntime,
  makeTestDeps,
  TEST_THREAD_ID,
} from './OpencodeAdapter.test.helpers.ts'

describe('OpencodeAdapter.runtime.session - startSession - happy path', () => {
  it('spawns the runtime, creates the SDK session, and emits session.started', async () => {
    const fakeRuntime = createFakeOpencodeRuntime({ sessionId: 'sess-happy' })
    await Effect.runPromise(
      Effect.gen(function* () {
        const harness = yield* makeTestDeps({
          createRuntime: makeFakeCreateRuntime(fakeRuntime),
        })
        const session = yield* startSession(harness.deps)({
          threadId: TEST_THREAD_ID,
          runtimeMode: 'full-access',
        })
        expect(session.threadId).toBe(TEST_THREAD_ID)
        expect(session.provider).toBe('opencode')
        expect(session.status).toBe('ready')
        expect(fakeRuntime.sessionCreateCalls.length).toBe(1)

        const events = yield* collectEvents(harness.runtimeEventQueue, 1)
        expect(events[0]?.type).toBe('session.started')
        expect(harness.sessions.get(TEST_THREAD_ID)?.providerSessionId).toBe('sess-happy')
      })
    )
  })

  it('streams mapped events through the pure mapper into the runtime queue', async () => {
    const fakeRuntime = createFakeOpencodeRuntime({ sessionId: 'sess-stream' })
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

        fakeRuntime.pushEvent({
          type: 'message.part.updated',
          properties: {
            sessionID: 'sess-stream',
            time: 1,
            part: {
              id: 'part-1',
              sessionID: 'sess-stream',
              messageID: 'msg-1',
              type: 'text',
              text: 'hello',
              time: { start: 1 },
            },
          },
        })

        const events = yield* collectEvents(harness.runtimeEventQueue, 1)
        expect(events[0]?.type).toBe('item.updated')

        const context = harness.sessions.get(TEST_THREAD_ID)
        expect(context).toBeDefined()
        if (context) yield* stopSessionInternal(harness.deps, context)
      })
    )
  })
})

describe('OpencodeAdapter.runtime.session - startSession - failures', () => {
  it('propagates a process error when createRuntime throws and leaves no session registered', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const harness = yield* makeTestDeps({
          createRuntime: makeFakeCreateRuntime(() => {
            throw new Error('binary missing')
          }),
        })
        const result = yield* Effect.exit(
          startSession(harness.deps)({
            threadId: TEST_THREAD_ID,
            runtimeMode: 'full-access',
          })
        )
        expect(Exit.isFailure(result)).toBe(true)
        if (Exit.isFailure(result)) {
          const failure = result.cause.toString()
          expect(failure).toMatch(/binary missing|opencode/)
        }
        expect(harness.sessions.size).toBe(0)
      })
    )
  })

  it('rejects an unexpected provider kind without spawning the runtime', async () => {
    const fakeRuntime = createFakeOpencodeRuntime()
    await Effect.runPromise(
      Effect.gen(function* () {
        const harness = yield* makeTestDeps({
          createRuntime: makeFakeCreateRuntime(fakeRuntime),
        })
        const result = yield* Effect.exit(
          startSession(harness.deps)({
            threadId: TEST_THREAD_ID,
            runtimeMode: 'full-access',
            provider: 'claudeAgent',
          })
        )
        expect(Exit.isFailure(result)).toBe(true)
        expect(fakeRuntime.sessionCreateCalls.length).toBe(0)
        expect(fakeRuntime.shutdownCalls.count).toBe(0)
      })
    )
  })
})

describe('OpencodeAdapter.runtime.session - stopSessionInternal', () => {
  it('shuts the runtime down, aborts the SDK session, and emits session.exited', async () => {
    const fakeRuntime = createFakeOpencodeRuntime({ sessionId: 'sess-stop' })
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

        const context = harness.sessions.get(TEST_THREAD_ID)
        expect(context).toBeDefined()
        if (!context) return
        yield* stopSessionInternal(harness.deps, context)

        expect(fakeRuntime.sessionAbortCalls.length).toBe(1)
        expect(fakeRuntime.shutdownCalls.count).toBeGreaterThanOrEqual(1)
        expect(harness.sessions.has(TEST_THREAD_ID)).toBe(false)
        expect(context.session.status).toBe('closed')
        expect(context.stopped).toBe(true)

        const tail = yield* drainEvents(harness.runtimeEventQueue)
        expect(tail.some(event => event.type === 'session.exited')).toBe(true)
      })
    )
  })

  it('is idempotent when called twice', async () => {
    const fakeRuntime = createFakeOpencodeRuntime({ sessionId: 'sess-idempotent' })
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

        const context = harness.sessions.get(TEST_THREAD_ID)
        if (!context) throw new Error('context missing')
        yield* stopSessionInternal(harness.deps, context)
        yield* stopSessionInternal(harness.deps, context)
        expect(fakeRuntime.shutdownCalls.count).toBe(1)
      })
    )
  })

  it('skips the session.exited event when emitExitEvent is false', async () => {
    const fakeRuntime = createFakeOpencodeRuntime({ sessionId: 'sess-silent' })
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
        const context = harness.sessions.get(TEST_THREAD_ID)
        if (!context) throw new Error('context missing')
        yield* stopSessionInternal(harness.deps, context, { emitExitEvent: false })
        const tail = yield* drainEvents(harness.runtimeEventQueue)
        expect(tail.some(event => event.type === 'session.exited')).toBe(false)
      })
    )
  })
})
