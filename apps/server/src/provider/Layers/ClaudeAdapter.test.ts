import * as NodeServices from '@effect/platform-node/NodeServices'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ProviderRuntimeEvent } from '@orxa-code/contracts'
import { assert, it } from '@effect/vitest'
import { Effect, Fiber, Layer, Random, Stream } from 'effect'
import { ServerConfig } from '../../config.ts'
import { ServerSettingsService } from '../../serverSettings.ts'
import { ClaudeAdapter } from '../Services/ClaudeAdapter.ts'
import { makeClaudeAdapterLive } from './ClaudeAdapter.ts'
import {
  FakeClaudeQuery,
  makeDeterministicRandomService,
  makeHarness,
  THREAD_ID,
} from './ClaudeAdapter.test.helpers.ts'

it.effect('classifies Claude Task tool invocations as collaboration agent work', () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const adapter = yield* ClaudeAdapter

    const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 8).pipe(
      Stream.runCollect,
      Effect.forkChild
    )

    const session = yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: 'claudeAgent',
      runtimeMode: 'full-access',
    })

    yield* adapter.sendTurn({
      threadId: session.threadId,
      input: 'delegate this',
      attachments: [],
    })

    harness.query.emit({
      type: 'stream_event',
      session_id: 'sdk-session-task',
      uuid: 'stream-task-1',
      parent_tool_use_id: null,
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'tool-task-1',
          name: 'Task',
          input: {
            description: 'Review the database layer',
            prompt: 'Audit the SQL changes',
            subagent_type: 'code-reviewer',
          },
        },
      },
    } as unknown as SDKMessage)

    harness.query.emit({
      type: 'assistant',
      session_id: 'sdk-session-task',
      uuid: 'assistant-task-1',
      parent_tool_use_id: null,
      message: {
        id: 'assistant-message-task-1',
        content: [{ type: 'text', text: 'Delegated' }],
      },
    } as unknown as SDKMessage)

    harness.query.emit({
      type: 'result',
      subtype: 'success',
      is_error: false,
      errors: [],
      session_id: 'sdk-session-task',
      uuid: 'result-task-1',
    } as unknown as SDKMessage)

    const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber))
    const toolStarted = runtimeEvents.find(event => event.type === 'item.started')
    assert.equal(toolStarted?.type, 'item.started')
    if (toolStarted?.type === 'item.started') {
      assert.equal(toolStarted.payload.itemType, 'collab_agent_tool_call')
      assert.equal(toolStarted.payload.title, 'Subagent task')
    }
  }).pipe(
    Effect.provideService(Random.Random, makeDeterministicRandomService()),
    Effect.provide(harness.layer)
  )
})

it.effect('treats user-aborted Claude results as interrupted without a runtime error', () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const adapter = yield* ClaudeAdapter

    const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 6).pipe(
      Stream.runCollect,
      Effect.forkChild
    )

    const session = yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: 'claudeAgent',
      runtimeMode: 'full-access',
    })

    const turn = yield* adapter.sendTurn({
      threadId: session.threadId,
      input: 'hello',
      attachments: [],
    })

    harness.query.emit({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: false,
      errors: ['Error: Request was aborted.'],
      stop_reason: 'tool_use',
      session_id: 'sdk-session-abort',
      uuid: 'result-abort',
    } as unknown as SDKMessage)

    const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber))
    assert.deepEqual(
      runtimeEvents.map(event => event.type),
      [
        'session.started',
        'session.configured',
        'session.state.changed',
        'turn.started',
        'thread.started',
        'turn.completed',
      ]
    )

    const turnCompleted = runtimeEvents[runtimeEvents.length - 1]
    assert.equal(turnCompleted?.type, 'turn.completed')
    if (turnCompleted?.type === 'turn.completed') {
      assert.equal(String(turnCompleted.turnId), String(turn.turnId))
      assert.equal(turnCompleted.payload.state, 'interrupted')
      assert.equal(turnCompleted.payload.errorMessage, 'Error: Request was aborted.')
      assert.equal(turnCompleted.payload.stopReason, 'tool_use')
    }
  }).pipe(
    Effect.provideService(Random.Random, makeDeterministicRandomService()),
    Effect.provide(harness.layer)
  )
})

it.effect('closes the session when the Claude stream aborts after a turn starts', () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const services = yield* Effect.services()
    const runFork = Effect.runForkWith(services)

    const adapter = yield* ClaudeAdapter
    const runtimeEvents: Array<ProviderRuntimeEvent> = []

    const runtimeEventsFiber = runFork(
      Stream.runForEach(adapter.streamEvents, event =>
        Effect.sync(() => {
          runtimeEvents.push(event)
        })
      )
    )

    yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: 'claudeAgent',
      runtimeMode: 'full-access',
    })

    const turn = yield* adapter.sendTurn({
      threadId: THREAD_ID,
      input: 'hello',
      attachments: [],
    })

    harness.query.fail(new Error('All fibers interrupted without error'))

    yield* Effect.yieldNow
    yield* Effect.yieldNow
    yield* Effect.yieldNow
    runtimeEventsFiber.interruptUnsafe()
    assert.deepEqual(
      runtimeEvents.map(event => event.type),
      [
        'session.started',
        'session.configured',
        'session.state.changed',
        'turn.started',
        'turn.completed',
        'session.exited',
      ]
    )

    const turnCompleted = runtimeEvents[4]
    assert.equal(turnCompleted?.type, 'turn.completed')
    if (turnCompleted?.type === 'turn.completed') {
      assert.equal(String(turnCompleted.turnId), String(turn.turnId))
      assert.equal(turnCompleted.payload.state, 'interrupted')
      assert.equal(turnCompleted.payload.errorMessage, 'Claude runtime interrupted.')
    }

    const sessionExited = runtimeEvents[5]
    assert.equal(sessionExited?.type, 'session.exited')

    assert.equal(yield* adapter.hasSession(THREAD_ID), false)
    const sessions = yield* adapter.listSessions()
    assert.equal(sessions.length, 0)
    assert.equal(harness.query.closeCalls, 1)
  }).pipe(
    Effect.provideService(Random.Random, makeDeterministicRandomService()),
    Effect.provide(harness.layer)
  )
})

it.effect('stopSession does not throw into the SDK prompt consumer', () => {
  // The SDK consumes user messages via `for await (... of prompt)`.
  // Stopping a session must end that loop cleanly — not throw an error.
  //
  // FakeClaudeQuery.close() masks this by resolving pending iterators
  // before the shutdown propagates. Override it to match real SDK behavior
  // where close() does not resolve the prompt consumer.
  const query = new FakeClaudeQuery()
  ;(query as { close: () => void }).close = () => {
    query.closeCalls += 1
  }

  let promptConsumerError: unknown = undefined

  const layer = makeClaudeAdapterLive({
    createQuery: input => {
      // Simulate the SDK consuming the prompt iterable
      ;(async () => {
        try {
          for await (const message of input.prompt) {
            void message
            /* SDK processes user messages */
          }
        } catch (error) {
          promptConsumerError = error
        }
      })()
      return query
    },
  }).pipe(
    Layer.provideMerge(ServerConfig.layerTest('/tmp/claude-adapter-test', '/tmp')),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(NodeServices.layer)
  )

  return Effect.gen(function* () {
    const services = yield* Effect.services()
    const runFork = Effect.runForkWith(services)

    const adapter = yield* ClaudeAdapter

    const runtimeEventsFiber = runFork(Stream.runForEach(adapter.streamEvents, () => Effect.void))

    yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: 'claudeAgent',
      runtimeMode: 'full-access',
    })

    yield* adapter.stopSession(THREAD_ID)

    yield* Effect.yieldNow
    yield* Effect.yieldNow
    yield* Effect.yieldNow
    yield* Effect.promise(() => new Promise(resolve => setTimeout(resolve, 50)))

    runtimeEventsFiber.interruptUnsafe()

    assert.equal(
      promptConsumerError,
      undefined,
      `Prompt consumer should not receive a thrown error on session stop, ` +
        `but got: "${promptConsumerError instanceof Error ? promptConsumerError.message : String(promptConsumerError)}"`
    )
  }).pipe(
    Effect.provideService(Random.Random, makeDeterministicRandomService()),
    Effect.provide(layer)
  )
})

it.effect('forwards Claude task progress summaries for subagent updates', () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const adapter = yield* ClaudeAdapter

    const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 6).pipe(
      Stream.runCollect,
      Effect.forkChild
    )

    yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: 'claudeAgent',
      runtimeMode: 'full-access',
    })

    harness.query.emit({
      type: 'system',
      subtype: 'task_progress',
      task_id: 'task-subagent-1',
      description: 'Running background teammate',
      summary: 'Code reviewer checked the migration edge cases.',
      usage: {
        total_tokens: 123,
        tool_uses: 4,
        duration_ms: 987,
      },
      session_id: 'sdk-session-task-summary',
      uuid: 'task-progress-1',
    } as unknown as SDKMessage)

    const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber))
    const progressEvent = runtimeEvents.find(event => event.type === 'task.progress')
    assert.equal(progressEvent?.type, 'task.progress')
    if (progressEvent?.type === 'task.progress') {
      assert.equal(progressEvent.payload.summary, 'Code reviewer checked the migration edge cases.')
      assert.equal(progressEvent.payload.description, 'Running background teammate')
    }
  }).pipe(
    Effect.provideService(Random.Random, makeDeterministicRandomService()),
    Effect.provide(harness.layer)
  )
})

it.effect('emits thread token usage updates from Claude task progress', () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const adapter = yield* ClaudeAdapter

    const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 6).pipe(
      Stream.runCollect,
      Effect.forkChild
    )

    yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: 'claudeAgent',
      runtimeMode: 'full-access',
    })

    harness.query.emit({
      type: 'system',
      subtype: 'task_progress',
      task_id: 'task-usage-1',
      description: 'Thinking through the patch',
      usage: {
        total_tokens: 321,
        tool_uses: 2,
        duration_ms: 654,
      },
      session_id: 'sdk-session-task-usage',
      uuid: 'task-usage-progress-1',
    } as unknown as SDKMessage)

    const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber))
    const usageEvent = runtimeEvents.find(event => event.type === 'thread.token-usage.updated')
    const progressEvent = runtimeEvents.find(event => event.type === 'task.progress')
    assert.equal(usageEvent?.type, 'thread.token-usage.updated')
    if (usageEvent?.type === 'thread.token-usage.updated') {
      assert.deepEqual(usageEvent.payload, {
        usage: {
          usedTokens: 321,
          lastUsedTokens: 321,
          toolUses: 2,
          durationMs: 654,
        },
      })
    }
    assert.equal(progressEvent?.type, 'task.progress')
    if (usageEvent && progressEvent) {
      assert.notStrictEqual(usageEvent.eventId, progressEvent.eventId)
    }
  }).pipe(
    Effect.provideService(Random.Random, makeDeterministicRandomService()),
    Effect.provide(harness.layer)
  )
})

it.effect('emits Claude context window on result completion usage snapshots', () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const adapter = yield* ClaudeAdapter

    const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 7).pipe(
      Stream.runCollect,
      Effect.forkChild
    )

    yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: 'claudeAgent',
      runtimeMode: 'full-access',
    })

    yield* adapter.sendTurn({
      threadId: THREAD_ID,
      input: 'hello',
      attachments: [],
    })

    harness.query.emit({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 1234,
      duration_api_ms: 1200,
      num_turns: 1,
      result: 'done',
      stop_reason: 'end_turn',
      session_id: 'sdk-session-result-usage',
      usage: {
        input_tokens: 4,
        cache_creation_input_tokens: 2715,
        cache_read_input_tokens: 21144,
        output_tokens: 679,
      },
      modelUsage: {
        'claude-opus-4-6': {
          contextWindow: 200000,
          maxOutputTokens: 64000,
        },
      },
    } as unknown as SDKMessage)
    harness.query.finish()

    const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber))
    const usageEvent = runtimeEvents.find(event => event.type === 'thread.token-usage.updated')
    assert.equal(usageEvent?.type, 'thread.token-usage.updated')
    if (usageEvent?.type === 'thread.token-usage.updated') {
      assert.deepEqual(usageEvent.payload, {
        usage: {
          usedTokens: 24542,
          lastUsedTokens: 24542,
          inputTokens: 23863,
          outputTokens: 679,
          maxTokens: 200000,
        },
      })
    }
  }).pipe(
    Effect.provideService(Random.Random, makeDeterministicRandomService()),
    Effect.provide(harness.layer)
  )
})
