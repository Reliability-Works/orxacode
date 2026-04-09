/**
 * Runtime turn-control tests for the OpencodeAdapter.
 *
 * Covers: sendTurn happy path (SDK prompt dispatched, turn.started emitted,
 * turnState opened), sendTurn with an already-running turn (previous turn
 * aborted before the new prompt goes out — interrupt-first semantics matching
 * ClaudeAdapter), interruptTurn explicit (SDK abort called and turn.aborted
 * emitted), interruptTurn when no turn is running (no-op), and plan-mode
 * propagation (interactionMode='plan' dispatches the opencode `plan` agent).
 *
 * @module OpencodeAdapter.session-controls.test
 */
import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'

import { startSession, stopSessionInternal } from './OpencodeAdapter.runtime.session.ts'
import { interruptTurn, sendTurn } from './OpencodeAdapter.runtime.turns.ts'
import {
  collectEvents,
  createFakeOpencodeRuntime,
  drainEvents,
  makeFakeCreateRuntime,
  makeTestDeps,
  TEST_THREAD_ID,
} from './OpencodeAdapter.test.helpers.ts'

describe('OpencodeAdapter.runtime.turns - sendTurn - happy path', () => {
  it('dispatches a prompt through the SDK and emits turn.started', async () => {
    const fakeRuntime = createFakeOpencodeRuntime({ sessionId: 'sess-turn' })
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

        const result = yield* sendTurn(harness.deps)({
          threadId: TEST_THREAD_ID,
          input: 'hello opencode',
        })
        expect(result.threadId).toBe(TEST_THREAD_ID)

        expect(fakeRuntime.sessionPromptCalls.length).toBe(1)
        expect(fakeRuntime.sessionPromptCalls[0]?.text).toBe('hello opencode')
        expect(fakeRuntime.sessionPromptCalls[0]?.agent).toBe('build')
        expect(fakeRuntime.sessionPromptCalls[0]?.mode).toBe('promptAsync')

        const events = yield* collectEvents(harness.runtimeEventQueue, 3)
        expect(events.map(event => event.type)).toEqual([
          'turn.started',
          'task.progress',
          'task.progress',
        ])
        const progressSummaries = events
          .filter(
            (event): event is Extract<(typeof events)[number], { type: 'task.progress' }> =>
              event.type === 'task.progress'
          )
          .map(event => event.payload.summary)
        expect(progressSummaries).toEqual([
          'Dispatching prompt to Opencode.',
          expect.stringContaining('Prompt accepted by Opencode after '),
        ])

        const context = harness.sessions.get(TEST_THREAD_ID)
        if (context) yield* stopSessionInternal(harness.deps, context)
      })
    )
  })

  it('dispatches the plan agent when interactionMode is plan', async () => {
    const fakeRuntime = createFakeOpencodeRuntime({ sessionId: 'sess-plan' })
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
          input: 'plan something',
          interactionMode: 'plan',
        })
        expect(fakeRuntime.sessionPromptCalls[0]?.agent).toBe('plan')
        const context = harness.sessions.get(TEST_THREAD_ID)
        if (context) yield* stopSessionInternal(harness.deps, context)
      })
    )
  })
})

describe('OpencodeAdapter.runtime.turns - sendTurn - modelSelection', () => {
  it('passes explicit agentId and variant from modelSelection through to the SDK', async () => {
    const fakeRuntime = createFakeOpencodeRuntime({ sessionId: 'sess-agent-variant' })
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
          input: 'reasoning turn',
          interactionMode: 'plan',
          modelSelection: {
            provider: 'opencode',
            model: 'anthropic/claude-sonnet-4-5',
            agentId: 'review',
            variant: 'reasoning',
          },
        })
        const call = fakeRuntime.sessionPromptCalls[0]
        expect(call?.agent).toBe('review')
        expect(call?.variant).toBe('reasoning')
        expect(call?.providerID).toBe('anthropic')
        expect(call?.modelID).toBe('claude-sonnet-4-5')
        const context = harness.sessions.get(TEST_THREAD_ID)
        if (context) yield* stopSessionInternal(harness.deps, context)
      })
    )
  })

  it('omits variant when modelSelection has no variant set', async () => {
    const fakeRuntime = createFakeOpencodeRuntime({ sessionId: 'sess-no-variant' })
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
          input: 'plain turn',
          modelSelection: {
            provider: 'opencode',
            model: 'anthropic/claude-sonnet-4-5',
          },
        })
        expect(fakeRuntime.sessionPromptCalls[0]?.variant).toBeUndefined()
        expect(fakeRuntime.sessionPromptCalls[0]?.agent).toBe('build')
        const context = harness.sessions.get(TEST_THREAD_ID)
        if (context) yield* stopSessionInternal(harness.deps, context)
      })
    )
  })
})

describe('OpencodeAdapter.runtime.turns - sendTurn - interrupts', () => {
  it('interrupts an already-running turn before dispatching a new prompt', async () => {
    const fakeRuntime = createFakeOpencodeRuntime({ sessionId: 'sess-interrupt-first' })
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
          input: 'first turn',
        })
        yield* collectEvents(harness.runtimeEventQueue, 1)
        yield* sendTurn(harness.deps)({
          threadId: TEST_THREAD_ID,
          input: 'second turn',
        })

        expect(fakeRuntime.sessionAbortCalls.length).toBeGreaterThanOrEqual(1)
        expect(fakeRuntime.sessionPromptCalls.length).toBe(2)

        const tail = yield* drainEvents(harness.runtimeEventQueue)
        expect(tail.some(event => event.type === 'turn.aborted')).toBe(true)
        expect(tail.filter(event => event.type === 'turn.started').length).toBe(1)

        const context = harness.sessions.get(TEST_THREAD_ID)
        if (context) yield* stopSessionInternal(harness.deps, context)
      })
    )
  })
})

describe('OpencodeAdapter.runtime.turns - interruptTurn', () => {
  it('calls SDK abort and emits turn.aborted when a turn is running', async () => {
    const fakeRuntime = createFakeOpencodeRuntime({ sessionId: 'sess-explicit-abort' })
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
          input: 'please think',
        })
        yield* collectEvents(harness.runtimeEventQueue, 1)

        yield* interruptTurn(harness.deps)(TEST_THREAD_ID)
        expect(fakeRuntime.sessionAbortCalls.length).toBeGreaterThanOrEqual(1)

        const tail = yield* drainEvents(harness.runtimeEventQueue)
        expect(tail.some(event => event.type === 'turn.aborted')).toBe(true)

        const context = harness.sessions.get(TEST_THREAD_ID)
        expect(context?.turnState).toBeUndefined()
        if (context) yield* stopSessionInternal(harness.deps, context)
      })
    )
  })

  it('is a no-op when no turn is running', async () => {
    const fakeRuntime = createFakeOpencodeRuntime({ sessionId: 'sess-noop-abort' })
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
        yield* interruptTurn(harness.deps)(TEST_THREAD_ID)
        expect(fakeRuntime.sessionAbortCalls.length).toBe(0)
        const context = harness.sessions.get(TEST_THREAD_ID)
        if (context) yield* stopSessionInternal(harness.deps, context)
      })
    )
  })

  it('aborts a delegated child session when a provider child thread id is supplied', async () => {
    const fakeRuntime = createFakeOpencodeRuntime({ sessionId: 'sess-root-abort-child' })
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

        yield* interruptTurn(harness.deps)(TEST_THREAD_ID, undefined, 'sess-child-abort-1')

        expect(fakeRuntime.sessionAbortCalls).toContainEqual({
          sessionID: 'sess-child-abort-1',
        })

        const context = harness.sessions.get(TEST_THREAD_ID)
        if (context) yield* stopSessionInternal(harness.deps, context)
      })
    )
  })
})
