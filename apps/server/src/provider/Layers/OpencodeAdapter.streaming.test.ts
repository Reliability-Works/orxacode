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
import type { ProviderRuntimeEvent } from '@orxa-code/contracts'

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

function pushChildSessionFixtureEvents(
  fakeRuntime: ReturnType<typeof createFakeOpencodeRuntime>
): void {
  fakeRuntime.pushEvent({
    type: 'message.part.updated',
    properties: {
      sessionID: FIXTURE_PROVIDER_SESSION_ID,
      time: 1,
      part: {
        id: 'part_subtask_child',
        sessionID: FIXTURE_PROVIDER_SESSION_ID,
        messageID: FIXTURE_ASSISTANT_MESSAGE_ID,
        type: 'subtask',
        prompt: 'Inspect the provider runtime.',
        description: 'Audit the runtime.',
        agent: 'review',
        model: {
          providerID: 'anthropic',
          modelID: 'claude-sonnet-4-5',
        },
      },
    },
  })
  fakeRuntime.pushEvent({
    type: 'session.created',
    properties: {
      sessionID: 'sess_child_opencode_1',
      info: {
        id: 'sess_child_opencode_1',
        slug: 'review-child',
        projectID: 'proj_fixture',
        directory: '/tmp/fixture/child',
        parentID: FIXTURE_PROVIDER_SESSION_ID,
        title: 'Review child',
        version: '1.0.0',
        time: { created: 2, updated: 2 },
      },
    },
  })
  fakeRuntime.pushEvent({
    type: 'message.part.updated',
    properties: {
      sessionID: 'sess_child_opencode_1',
      time: 3,
      part: {
        id: 'part_text_child',
        sessionID: 'sess_child_opencode_1',
        messageID: 'msg_child_1',
        type: 'text',
        text: 'Looking into it',
        time: { start: 3 },
      },
    },
  })
}

function pushChildSessionTaskToolFixtureEvents(
  fakeRuntime: ReturnType<typeof createFakeOpencodeRuntime>
): void {
  fakeRuntime.pushEvent({
    type: 'message.part.updated',
    properties: {
      sessionID: FIXTURE_PROVIDER_SESSION_ID,
      time: 1,
      part: {
        id: 'part_task_child',
        sessionID: FIXTURE_PROVIDER_SESSION_ID,
        messageID: FIXTURE_ASSISTANT_MESSAGE_ID,
        type: 'tool',
        callID: 'call_task_child',
        tool: 'task',
        state: {
          status: 'running',
          input: {
            prompt: 'Inspect the provider runtime.',
            description: 'Audit the runtime.',
            agent: 'explorer',
          },
          time: { start: 1 },
        },
      },
    },
  })
  fakeRuntime.pushEvent({
    type: 'session.created',
    properties: {
      sessionID: 'sess_child_opencode_task_1',
      info: {
        id: 'sess_child_opencode_task_1',
        slug: 'explorer-child',
        projectID: 'proj_fixture',
        directory: '/tmp/fixture/child',
        parentID: FIXTURE_PROVIDER_SESSION_ID,
        title: 'Explorer child',
        version: '1.0.0',
        time: { created: 2, updated: 2 },
      },
    },
  })
}

function expectChildSessionEvents(events: ReadonlyArray<ProviderRuntimeEvent>): void {
  expect(
    events.some(
      event => event.type === 'item.started' && event.payload.itemType === 'collab_agent_tool_call'
    )
  ).toBe(true)
  expect(
    events.some(
      event =>
        event.type === 'session.started' &&
        event.raw?.source === 'opencode.sdk.event' &&
        event.raw.messageType === 'session.created' &&
        (event.raw.payload as { info?: { id?: string } }).info?.id === 'sess_child_opencode_1'
    )
  ).toBe(true)
  expect(
    events.some(
      event =>
        event.type === 'item.updated' &&
        event.raw?.source === 'opencode.sdk.event' &&
        event.raw.messageType === 'message.part.updated' &&
        (event.raw.payload as { sessionID?: string }).sessionID === 'sess_child_opencode_1'
    )
  ).toBe(true)
}

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

describe('OpencodeAdapter streaming integration - child delegation metadata', () => {
  it(
    'carries task-tool delegation metadata into the child session.created raw payload',
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
            input: 'delegate a task',
          })
          yield* collectEvents(harness.runtimeEventQueue, 1)

          pushChildSessionTaskToolFixtureEvents(fakeRuntime)
          for (let i = 0; i < 8; i += 1) {
            yield* Effect.yieldNow
          }

          const events = yield* drainEvents(harness.runtimeEventQueue)
          const childSessionCreated = events.find(
            event =>
              event.type === 'session.started' &&
              event.raw?.source === 'opencode.sdk.event' &&
              event.raw.messageType === 'session.created' &&
              (event.raw.payload as { info?: { id?: string } }).info?.id ===
                'sess_child_opencode_task_1'
          )

          expect(childSessionCreated).toBeDefined()
          expect(childSessionCreated?.raw?.payload).toMatchObject({
            delegation: {
              agentLabel: 'explorer',
              prompt: 'Inspect the provider runtime.',
              description: 'Audit the runtime.',
            },
          })
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

describe('OpencodeAdapter streaming integration - child sessions', () => {
  it(
    'tracks delegated child sessions and emits their events through the same runtime pump',
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

          pushChildSessionFixtureEvents(fakeRuntime)

          for (let i = 0; i < 8; i += 1) {
            yield* Effect.yieldNow
          }

          const events = yield* drainEvents(harness.runtimeEventQueue)
          expectChildSessionEvents(events)
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
