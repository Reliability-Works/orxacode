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
  FIXTURE_ASSISTANT_MESSAGE_ID,
  FIXTURE_PROVIDER_SESSION_ID,
  fixtureMessageUpdatedCompleted,
  fixtureMessageUpdatedInProgress,
  fixtureSessionIdle,
  fixtureTextPartDelta,
  fixtureTextPartUpdatedCompleted,
  fixtureTextPartUpdatedInProgress,
  fixtureToolPartUpdatedCompleted,
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

          expect(types).toContain('task.progress')
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

          const taskProgressSummaries = events
            .filter(
              (event): event is Extract<(typeof events)[number], { type: 'task.progress' }> =>
                event.type === 'task.progress'
            )
            .map(event => event.payload.summary ?? event.payload.description)
          expect(taskProgressSummaries).toContain('Dispatching prompt to Opencode.')
          expect(
            taskProgressSummaries.some(summary =>
              summary.includes('Prompt accepted by Opencode after ')
            )
          ).toBe(true)
          expect(
            taskProgressSummaries.some(summary =>
              summary.includes('First runtime event received after ')
            )
          ).toBe(true)
          expect(
            taskProgressSummaries.some(summary =>
              summary.includes('First response token received after ')
            )
          ).toBe(true)
        })
      )
    },
    STREAMING_TIMEOUT_MS
  )
})

describe('OpencodeAdapter streaming integration - tool payloads', () => {
  it(
    'maps opencode tool metadata into rich lifecycle payloads for the existing work log UI',
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
            input: 'read a file',
          })
          yield* collectEvents(harness.runtimeEventQueue, 3)

          fakeRuntime.pushEvent(fixtureToolPartUpdatedCompleted)
          fakeRuntime.pushEvent(fixtureSessionIdle)

          for (let i = 0; i < 8; i += 1) {
            yield* Effect.yieldNow
          }

          const events = yield* drainEvents(harness.runtimeEventQueue)
          const completedTool = events.find(
            (event): event is Extract<(typeof events)[number], { type: 'item.completed' }> =>
              event.type === 'item.completed'
          )

          expect(completedTool).toBeDefined()
          expect(completedTool?.payload.itemType).toBe('mcp_tool_call')
          expect(completedTool?.payload.title).toBe('Read')
          expect(completedTool?.payload.detail).toBe('/tmp/fixture/file.txt offset=0 limit=120')
          expect(completedTool?.payload.data).toMatchObject({
            input: {
              filePath: '/tmp/fixture/file.txt',
              offset: 0,
              limit: 120,
            },
            result: {
              loaded: ['/tmp/fixture/file.txt'],
              title: 'Read file',
            },
          })
        })
      )
    },
    STREAMING_TIMEOUT_MS
  )
})

describe('OpencodeAdapter streaming integration - sparse running tools', () => {
  it(
    'does not emit an empty item.updated row when a running tool has no useful detail yet',
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
            input: 'run a command',
          })
          yield* collectEvents(harness.runtimeEventQueue, 3)

          fakeRuntime.pushEvent({
            type: 'message.part.updated',
            properties: {
              sessionID: FIXTURE_PROVIDER_SESSION_ID,
              part: {
                id: 'part_tool_blank_running',
                sessionID: FIXTURE_PROVIDER_SESSION_ID,
                messageID: FIXTURE_ASSISTANT_MESSAGE_ID,
                type: 'tool',
                callID: 'call_blank_running',
                tool: 'bash',
                state: {
                  status: 'running',
                  input: {},
                  time: { start: 1_700_000_001_200 },
                },
              },
              time: 1_700_000_001_300,
            },
          })

          for (let i = 0; i < 8; i += 1) {
            yield* Effect.yieldNow
          }

          const events = yield* drainEvents(harness.runtimeEventQueue)
          const started = events.filter(event => event.type === 'item.started')
          const updated = events.filter(event => event.type === 'item.updated')

          expect(started).toHaveLength(1)
          expect(updated).toHaveLength(0)
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
