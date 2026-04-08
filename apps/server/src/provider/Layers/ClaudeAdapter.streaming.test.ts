import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { assert, it } from '@effect/vitest'
import { Effect, Fiber, Random, Stream } from 'effect'

import { ClaudeAdapter } from '../Services/ClaudeAdapter.ts'
import {
  canonicalRuntimeMessages,
  earlyAssistantWithLateDeltaMessages,
  fallbackAssistantTextMessages,
  interleavedAssistantToolMessages,
  reusedTextIndexMessages,
  toolStreamMessages,
} from './ClaudeAdapter.streaming.fixtures.ts'
import {
  makeDeterministicRandomService,
  makeHarness,
  THREAD_ID,
} from './ClaudeAdapter.test.helpers.ts'

function emitMessages(
  harness: ReturnType<typeof makeHarness>,
  messages: ReadonlyArray<SDKMessage>
) {
  for (const message of messages) {
    harness.query.emit(message)
  }
}

function startStreamingScenario(input: {
  eventCount: number
  input: string
  modelSelection?: { provider: 'claudeAgent'; model: string }
}) {
  const harness = makeHarness()

  const effect = Effect.gen(function* () {
    const adapter = yield* ClaudeAdapter
    const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, input.eventCount).pipe(
      Stream.runCollect,
      Effect.forkChild
    )

    const session = yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: 'claudeAgent',
      runtimeMode: 'full-access',
      ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
    })

    const turn = yield* adapter.sendTurn({
      threadId: session.threadId,
      input: input.input,
      attachments: [],
    })

    return { adapter, runtimeEventsFiber, session, turn } as const
  }).pipe(
    Effect.provideService(Random.Random, makeDeterministicRandomService()),
    Effect.provide(harness.layer)
  )

  return { effect, harness } as const
}

function assertRuntimeEventTypes(
  runtimeEvents: ReadonlyArray<{ type: string }>,
  expected: ReadonlyArray<string>
) {
  assert.deepEqual(
    runtimeEvents.map(event => event.type),
    expected
  )
}

it.effect('maps Claude stream/runtime messages to canonical provider runtime events', () => {
  const { effect, harness } = startStreamingScenario({
    eventCount: 10,
    input: 'hello',
    modelSelection: {
      provider: 'claudeAgent',
      model: 'claude-sonnet-4-5',
    },
  })

  return Effect.gen(function* () {
    const started = yield* effect
    const { runtimeEventsFiber, turn } = started

    emitMessages(harness, canonicalRuntimeMessages())

    const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber))
    assertRuntimeEventTypes(runtimeEvents, [
      'session.started',
      'session.configured',
      'session.state.changed',
      'turn.started',
      'thread.started',
      'content.delta',
      'item.completed',
      'item.started',
      'item.completed',
      'turn.completed',
    ])

    const turnStarted = runtimeEvents[3]
    assert.equal(turnStarted?.type, 'turn.started')
    if (turnStarted?.type === 'turn.started') {
      assert.equal(String(turnStarted.turnId), String(turn.turnId))
    }

    const deltaEvent = runtimeEvents.find(event => event.type === 'content.delta')
    assert.equal(deltaEvent?.type, 'content.delta')
    if (deltaEvent?.type === 'content.delta') {
      assert.equal(deltaEvent.payload.delta, 'Hi')
      assert.equal(String(deltaEvent.turnId), String(turn.turnId))
    }

    const toolStarted = runtimeEvents.find(event => event.type === 'item.started')
    assert.equal(toolStarted?.type, 'item.started')
    if (toolStarted?.type === 'item.started') {
      assert.equal(toolStarted.payload.itemType, 'command_execution')
    }

    const assistantCompletedIndex = runtimeEvents.findIndex(
      event => event.type === 'item.completed' && event.payload.itemType === 'assistant_message'
    )
    const toolStartedIndex = runtimeEvents.findIndex(event => event.type === 'item.started')
    assert.equal(
      assistantCompletedIndex >= 0 &&
        toolStartedIndex >= 0 &&
        assistantCompletedIndex < toolStartedIndex,
      true
    )

    const turnCompleted = runtimeEvents[runtimeEvents.length - 1]
    assert.equal(turnCompleted?.type, 'turn.completed')
    if (turnCompleted?.type === 'turn.completed') {
      assert.equal(String(turnCompleted.turnId), String(turn.turnId))
      assert.equal(turnCompleted.payload.state, 'completed')
    }
  }).pipe(Effect.provide(harness.layer))
})

it.effect('maps Claude reasoning deltas, streamed tool inputs, and tool results', () => {
  const { effect, harness } = startStreamingScenario({
    eventCount: 11,
    input: 'hello',
  })

  return Effect.gen(function* () {
    const started = yield* effect
    const { runtimeEventsFiber, turn } = started

    emitMessages(harness, toolStreamMessages())

    const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber))
    assertRuntimeEventTypes(runtimeEvents, [
      'session.started',
      'session.configured',
      'session.state.changed',
      'turn.started',
      'thread.started',
      'content.delta',
      'item.started',
      'item.updated',
      'item.updated',
      'item.completed',
      'turn.completed',
    ])

    const reasoningDelta = runtimeEvents.find(
      event => event.type === 'content.delta' && event.payload.streamKind === 'reasoning_text'
    )
    assert.equal(reasoningDelta?.type, 'content.delta')
    if (reasoningDelta?.type === 'content.delta') {
      assert.equal(reasoningDelta.payload.delta, 'Let')
      assert.equal(String(reasoningDelta.turnId), String(turn.turnId))
    }

    const toolStarted = runtimeEvents.find(event => event.type === 'item.started')
    assert.equal(toolStarted?.type, 'item.started')
    if (toolStarted?.type === 'item.started') {
      assert.equal(toolStarted.payload.itemType, 'dynamic_tool_call')
    }

    const toolInputUpdated = runtimeEvents.find(
      event =>
        event.type === 'item.updated' &&
        (event.payload.data as { input?: { pattern?: string; path?: string } } | undefined)?.input
          ?.pattern === 'foo'
    )
    assert.equal(toolInputUpdated?.type, 'item.updated')
    if (toolInputUpdated?.type === 'item.updated') {
      assert.deepEqual(toolInputUpdated.payload.data, {
        toolName: 'Grep',
        input: { pattern: 'foo', path: 'src' },
      })
    }

    const toolResultUpdated = runtimeEvents.find(
      event =>
        event.type === 'item.updated' &&
        (event.payload.data as { result?: { tool_use_id?: string } } | undefined)?.result
          ?.tool_use_id === 'tool-grep-1'
    )
    assert.equal(toolResultUpdated?.type, 'item.updated')
    if (toolResultUpdated?.type === 'item.updated') {
      assert.equal(
        (toolResultUpdated.payload.data as { result?: { content?: string } }).result?.content,
        'src/example.ts:1:foo'
      )
    }
  }).pipe(Effect.provide(harness.layer))
})

it.effect(
  'emits completion only after turn result when assistant frames arrive before deltas',
  () => {
    const { effect, harness } = startStreamingScenario({
      eventCount: 8,
      input: 'hello',
    })

    return Effect.gen(function* () {
      const started = yield* effect
      const { runtimeEventsFiber, turn } = started

      emitMessages(harness, earlyAssistantWithLateDeltaMessages())

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber))
      assertRuntimeEventTypes(runtimeEvents, [
        'session.started',
        'session.configured',
        'session.state.changed',
        'turn.started',
        'thread.started',
        'content.delta',
        'item.completed',
        'turn.completed',
      ])

      const deltaIndex = runtimeEvents.findIndex(event => event.type === 'content.delta')
      const completedIndex = runtimeEvents.findIndex(event => event.type === 'item.completed')
      assert.equal(deltaIndex >= 0 && completedIndex >= 0 && deltaIndex < completedIndex, true)

      const deltaEvent = runtimeEvents[deltaIndex]
      assert.equal(deltaEvent?.type, 'content.delta')
      if (deltaEvent?.type === 'content.delta') {
        assert.equal(deltaEvent.payload.delta, 'Late text')
        assert.equal(String(deltaEvent.turnId), String(turn.turnId))
      }
    }).pipe(Effect.provide(harness.layer))
  }
)

type RuntimeEvent = { readonly type: string; readonly itemId?: unknown; readonly payload?: unknown }

function assertReusedTextIndexEvents(runtimeEvents: ReadonlyArray<RuntimeEvent>) {
  assertRuntimeEventTypes(runtimeEvents, [
    'session.started',
    'session.configured',
    'session.state.changed',
    'turn.started',
    'thread.started',
    'content.delta',
    'item.completed',
    'content.delta',
    'item.completed',
  ])

  const assistantDeltas = runtimeEvents.filter(
    event =>
      event.type === 'content.delta' &&
      (event.payload as { streamKind?: string } | undefined)?.streamKind === 'assistant_text'
  )
  assert.equal(assistantDeltas.length, 2)
  if (assistantDeltas.length !== 2) return
  const [firstAssistantDelta, secondAssistantDelta] = assistantDeltas
  if (!firstAssistantDelta || !secondAssistantDelta) return
  assert.equal((firstAssistantDelta.payload as { delta: string }).delta, 'First')
  assert.equal((secondAssistantDelta.payload as { delta: string }).delta, 'Second')
  assert.notEqual(firstAssistantDelta.itemId, secondAssistantDelta.itemId)

  const assistantCompletions = runtimeEvents.filter(
    event =>
      event.type === 'item.completed' &&
      (event.payload as { itemType?: string } | undefined)?.itemType === 'assistant_message'
  )
  assert.equal(assistantCompletions.length, 2)
  assert.equal(String(assistantCompletions[0]?.itemId), String(firstAssistantDelta.itemId))
  assert.equal(String(assistantCompletions[1]?.itemId), String(secondAssistantDelta.itemId))
  assert.notEqual(String(assistantCompletions[0]?.itemId), String(assistantCompletions[1]?.itemId))
}

it.effect('creates a fresh assistant message when Claude reuses a text block index', () => {
  const { effect, harness } = startStreamingScenario({
    eventCount: 9,
    input: 'hello',
  })

  return Effect.gen(function* () {
    const started = yield* effect
    const { runtimeEventsFiber } = started
    emitMessages(harness, reusedTextIndexMessages())
    const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber))
    assertReusedTextIndexEvents(runtimeEvents as ReadonlyArray<RuntimeEvent>)
  }).pipe(Effect.provide(harness.layer))
})

it.effect('falls back to assistant payload text when stream deltas are absent', () => {
  const { effect, harness } = startStreamingScenario({
    eventCount: 8,
    input: 'hello',
  })

  return Effect.gen(function* () {
    const started = yield* effect
    const { runtimeEventsFiber, turn } = started

    emitMessages(harness, fallbackAssistantTextMessages())

    const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber))
    assertRuntimeEventTypes(runtimeEvents, [
      'session.started',
      'session.configured',
      'session.state.changed',
      'turn.started',
      'thread.started',
      'content.delta',
      'item.completed',
      'turn.completed',
    ])

    const deltaEvent = runtimeEvents.find(event => event.type === 'content.delta')
    assert.equal(deltaEvent?.type, 'content.delta')
    if (deltaEvent?.type === 'content.delta') {
      assert.equal(deltaEvent.payload.delta, 'Fallback hello')
      assert.equal(String(deltaEvent.turnId), String(turn.turnId))
    }
  }).pipe(Effect.provide(harness.layer))
})

function assertInterleavedAssistantToolEvents(runtimeEvents: ReadonlyArray<RuntimeEvent>) {
  assertRuntimeEventTypes(runtimeEvents, [
    'session.started',
    'session.configured',
    'session.state.changed',
    'turn.started',
    'thread.started',
    'content.delta',
    'item.completed',
    'item.started',
    'item.updated',
    'item.completed',
    'content.delta',
    'item.completed',
    'turn.completed',
  ])

  const assistantTextDeltas = runtimeEvents.filter(
    event =>
      event.type === 'content.delta' &&
      (event.payload as { streamKind?: string } | undefined)?.streamKind === 'assistant_text'
  )
  assert.equal(assistantTextDeltas.length, 2)
  if (assistantTextDeltas.length !== 2) return
  const [firstAssistantDelta, secondAssistantDelta] = assistantTextDeltas
  if (!firstAssistantDelta || !secondAssistantDelta) return
  assert.notEqual(String(firstAssistantDelta.itemId), String(secondAssistantDelta.itemId))

  const firstAssistantCompletedIndex = runtimeEvents.findIndex(
    event =>
      event.type === 'item.completed' &&
      (event.payload as { itemType?: string } | undefined)?.itemType === 'assistant_message' &&
      String(event.itemId) === String(firstAssistantDelta.itemId)
  )
  const toolStartedIndex = runtimeEvents.findIndex(event => event.type === 'item.started')
  const secondAssistantDeltaIndex = runtimeEvents.findIndex(
    event =>
      event.type === 'content.delta' &&
      (event.payload as { streamKind?: string } | undefined)?.streamKind === 'assistant_text' &&
      String(event.itemId) === String(secondAssistantDelta.itemId)
  )

  assert.equal(
    firstAssistantCompletedIndex >= 0 &&
      toolStartedIndex >= 0 &&
      secondAssistantDeltaIndex >= 0 &&
      firstAssistantCompletedIndex < toolStartedIndex &&
      toolStartedIndex < secondAssistantDeltaIndex,
    true
  )
}

it.effect('segments Claude assistant text blocks around tool calls', () => {
  const { effect, harness } = startStreamingScenario({
    eventCount: 13,
    input: 'hello',
  })

  return Effect.gen(function* () {
    const started = yield* effect
    const { runtimeEventsFiber } = started
    emitMessages(harness, interleavedAssistantToolMessages())
    const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber))
    assertInterleavedAssistantToolEvents(runtimeEvents as ReadonlyArray<RuntimeEvent>)
  }).pipe(Effect.provide(harness.layer))
})
