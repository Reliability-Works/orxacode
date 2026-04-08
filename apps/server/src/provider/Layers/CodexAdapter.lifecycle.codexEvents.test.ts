import assert from 'node:assert/strict'
import { afterAll } from '@effect/vitest'
import { ApprovalRequestId, type ProviderEvent } from '@orxa-code/contracts'
import { Effect, Fiber, Stream } from 'effect'

import { CodexAdapter, type CodexAdapterShape } from '../Services/CodexAdapter.ts'
import {
  FakeCodexManager,
  asEventId,
  asThreadId,
  asTurnId,
  makeCodexAdapterTestLayer,
} from './CodexAdapter.test.helpers.ts'

const lifecycleManager = new FakeCodexManager()
const lifecycleLayer = makeCodexAdapterTestLayer(lifecycleManager)

function collectEvents(adapter: Pick<CodexAdapterShape, 'streamEvents'>, count: number) {
  return Stream.runCollect(Stream.take(adapter.streamEvents, count)).pipe(Effect.forkChild)
}

function forkFirstEvent(adapter: Pick<CodexAdapterShape, 'streamEvents'>) {
  return Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild)
}

function emitEvent(event: ProviderEvent) {
  lifecycleManager.emit('event', event)
}

function emitCodexTaskStartedEvent(overrides?: {
  turnId?: string
  taskId?: string
  parentTurnId?: string
  collaborationModeKind?: 'plan' | 'default'
  conversationId?: string
}) {
  const taskId = overrides?.taskId ?? 'turn-structured-1'
  emitEvent({
    id: asEventId(`evt-${taskId}-task-started`),
    kind: 'notification',
    provider: 'codex',
    threadId: asThreadId('thread-1'),
    turnId: overrides?.parentTurnId ? asTurnId(overrides.parentTurnId) : undefined,
    createdAt: new Date().toISOString(),
    method: 'codex/event/task_started',
    payload: {
      id: taskId,
      msg: {
        type: 'task_started',
        turn_id: overrides?.turnId ?? taskId,
        collaboration_mode_kind: overrides?.collaborationModeKind ?? 'plan',
      },
      conversationId: overrides?.conversationId,
    },
  } satisfies ProviderEvent)
}

function emitCodexAgentReasoningEvent() {
  emitEvent({
    id: asEventId('evt-codex-agent-reasoning'),
    kind: 'notification',
    provider: 'codex',
    threadId: asThreadId('thread-1'),
    createdAt: new Date().toISOString(),
    method: 'codex/event/agent_reasoning',
    payload: {
      id: 'turn-structured-1',
      msg: {
        type: 'agent_reasoning',
        text: 'Need to compare both transport layers before finalizing the plan.',
      },
    },
  } satisfies ProviderEvent)
}

function emitCodexReasoningDeltaEvent() {
  emitEvent({
    id: asEventId('evt-codex-reasoning-delta'),
    kind: 'notification',
    provider: 'codex',
    threadId: asThreadId('thread-1'),
    createdAt: new Date().toISOString(),
    method: 'codex/event/reasoning_content_delta',
    payload: {
      id: 'turn-structured-1',
      msg: {
        type: 'reasoning_content_delta',
        turn_id: 'turn-structured-1',
        item_id: 'rs_reasoning_1',
        delta: '**Compare** transport boundaries',
        summary_index: 0,
      },
    },
  } satisfies ProviderEvent)
}

function emitCodexTaskCompleteEvent() {
  emitEvent({
    id: asEventId('evt-codex-task-complete'),
    kind: 'notification',
    provider: 'codex',
    threadId: asThreadId('thread-1'),
    createdAt: new Date().toISOString(),
    method: 'codex/event/task_complete',
    payload: {
      id: 'turn-structured-1',
      msg: {
        type: 'task_complete',
        turn_id: 'turn-structured-1',
        last_agent_message: '<proposed_plan>\n# Ship it\n</proposed_plan>',
      },
    },
  } satisfies ProviderEvent)
}

lifecycleLayer('CodexAdapterLive Codex sandbox events', it => {
  it.effect('maps windowsSandbox/setupCompleted to session state and warning on failure', () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter
      const eventsFiber = yield* collectEvents(adapter, 2)

      emitEvent({
        id: asEventId('evt-windows-sandbox-failed'),
        kind: 'notification',
        provider: 'codex',
        threadId: asThreadId('thread-1'),
        createdAt: new Date().toISOString(),
        method: 'windowsSandbox/setupCompleted',
        message: 'Sandbox setup failed',
        payload: {
          success: false,
          detail: 'unsupported environment',
        },
      } satisfies ProviderEvent)

      const events = Array.from(yield* Fiber.join(eventsFiber))
      assert.equal(events[0]?.type, 'session.state.changed')
      if (events[0]?.type === 'session.state.changed') {
        assert.equal(events[0].payload.state, 'error')
        assert.equal(events[0].payload.reason, 'Sandbox setup failed')
      }
      assert.equal(events[1]?.type, 'runtime.warning')
    })
  )
})

lifecycleLayer('CodexAdapterLive Codex user input events', it => {
  it.effect(
    'maps requestUserInput requests and answered notifications to canonical user-input events',
    () =>
      Effect.gen(function* () {
        const adapter = yield* CodexAdapter
        const eventsFiber = yield* collectEvents(adapter, 2)

        emitEvent({
          id: asEventId('evt-user-input-requested'),
          kind: 'request',
          provider: 'codex',
          threadId: asThreadId('thread-1'),
          createdAt: new Date().toISOString(),
          method: 'item/tool/requestUserInput',
          requestId: ApprovalRequestId.makeUnsafe('req-user-input-1'),
          payload: {
            questions: [
              {
                id: 'sandbox_mode',
                header: 'Sandbox',
                question: 'Which mode should be used?',
                options: [
                  {
                    label: 'workspace-write',
                    description: 'Allow workspace writes only',
                  },
                ],
              },
            ],
          },
        } satisfies ProviderEvent)
        emitEvent({
          id: asEventId('evt-user-input-resolved'),
          kind: 'notification',
          provider: 'codex',
          threadId: asThreadId('thread-1'),
          createdAt: new Date().toISOString(),
          method: 'item/tool/requestUserInput/answered',
          requestId: ApprovalRequestId.makeUnsafe('req-user-input-1'),
          payload: {
            answers: {
              sandbox_mode: {
                answers: ['workspace-write'],
              },
            },
          },
        } satisfies ProviderEvent)

        const events = Array.from(yield* Fiber.join(eventsFiber))
        assert.equal(events[0]?.type, 'user-input.requested')
        if (events[0]?.type === 'user-input.requested') {
          assert.equal(events[0].requestId, 'req-user-input-1')
          assert.equal(events[0].payload.questions[0]?.id, 'sandbox_mode')
        }
        assert.equal(events[1]?.type, 'user-input.resolved')
        if (events[1]?.type === 'user-input.resolved') {
          assert.equal(events[1].requestId, 'req-user-input-1')
          assert.deepEqual(events[1].payload.answers, { sandbox_mode: 'workspace-write' })
        }
      })
  )
})

lifecycleLayer('CodexAdapterLive Codex task lifecycle events', it => {
  it.effect('maps Codex task_started notifications into task.started events', () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter
      const firstEventFiber = yield* forkFirstEvent(adapter)

      emitCodexTaskStartedEvent()

      const firstEvent = yield* Fiber.join(firstEventFiber)
      assert.equal(firstEvent._tag, 'Some')
      if (firstEvent._tag !== 'Some' || firstEvent.value.type !== 'task.started') return
      assert.equal(firstEvent.value.payload.taskId, 'turn-structured-1')
      assert.equal(firstEvent.value.payload.taskType, 'plan')
    })
  )

  it.effect('maps Codex agent reasoning notifications into task.progress events', () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter
      const firstEventFiber = yield* forkFirstEvent(adapter)

      emitCodexAgentReasoningEvent()

      const firstEvent = yield* Fiber.join(firstEventFiber)
      assert.equal(firstEvent._tag, 'Some')
      if (firstEvent._tag !== 'Some' || firstEvent.value.type !== 'task.progress') return
      assert.match(firstEvent.value.payload.description, /compare both transport layers/i)
    })
  )

  it.effect('maps Codex reasoning deltas into content.delta events', () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter
      const firstEventFiber = yield* forkFirstEvent(adapter)

      emitCodexReasoningDeltaEvent()

      const firstEvent = yield* Fiber.join(firstEventFiber)
      assert.equal(firstEvent._tag, 'Some')
      if (firstEvent._tag !== 'Some' || firstEvent.value.type !== 'content.delta') return
      assert.equal(firstEvent.value.payload.delta, '**Compare** transport boundaries')
    })
  )

  it.effect('maps Codex task completion into task and proposed-plan completion events', () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter
      const eventsFiber = yield* collectEvents(adapter, 2)

      emitCodexTaskCompleteEvent()

      const events = Array.from(yield* Fiber.join(eventsFiber))
      assert.equal(events[0]?.type, 'task.completed')
      assert.equal(events[1]?.type, 'turn.proposed.completed')
    })
  )

  it.effect('prefers manager-assigned turn ids for Codex task events', () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter
      const firstEventFiber = yield* forkFirstEvent(adapter)

      emitCodexTaskStartedEvent({
        taskId: 'turn-child',
        turnId: 'turn-child',
        parentTurnId: 'turn-parent',
        collaborationModeKind: 'default',
        conversationId: 'child-provider-thread',
      })

      const firstEvent = yield* Fiber.join(firstEventFiber)
      assert.equal(firstEvent._tag, 'Some')
      if (firstEvent._tag !== 'Some' || firstEvent.value.type !== 'task.started') return
      assert.equal(firstEvent.value.turnId, 'turn-parent')
      assert.equal(firstEvent.value.providerRefs?.providerTurnId, 'turn-parent')
      assert.equal(firstEvent.value.payload.taskId, 'turn-child')
    })
  )
})

lifecycleLayer('CodexAdapterLive Codex token usage events', it => {
  it.effect('unwraps Codex token usage payloads for context window events', () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter
      const firstEventFiber = yield* forkFirstEvent(adapter)

      emitEvent({
        id: asEventId('evt-codex-thread-token-usage-updated'),
        kind: 'notification',
        provider: 'codex',
        threadId: asThreadId('thread-1'),
        turnId: asTurnId('turn-1'),
        createdAt: new Date().toISOString(),
        method: 'thread/tokenUsage/updated',
        payload: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          tokenUsage: {
            total: {
              inputTokens: 11_833,
              cachedInputTokens: 3456,
              outputTokens: 6,
              reasoningOutputTokens: 0,
              totalTokens: 11_839,
            },
            last: {
              inputTokens: 120,
              cachedInputTokens: 0,
              outputTokens: 6,
              reasoningOutputTokens: 0,
              totalTokens: 126,
            },
            modelContextWindow: 258_400,
          },
        },
      } satisfies ProviderEvent)

      const firstEvent = yield* Fiber.join(firstEventFiber)
      assert.equal(firstEvent._tag, 'Some')
      if (firstEvent._tag !== 'Some' || firstEvent.value.type !== 'thread.token-usage.updated') {
        return
      }

      assert.deepEqual(firstEvent.value.payload.usage, {
        usedTokens: 126,
        totalProcessedTokens: 11_839,
        maxTokens: 258_400,
        inputTokens: 120,
        cachedInputTokens: 0,
        outputTokens: 6,
        reasoningOutputTokens: 0,
        lastUsedTokens: 126,
        lastInputTokens: 120,
        lastCachedInputTokens: 0,
        lastOutputTokens: 6,
        lastReasoningOutputTokens: 0,
        compactsAutomatically: true,
      })
    })
  )
})

afterAll(() => {
  if (lifecycleManager.stopAllImpl.mock.calls.length === 0) {
    lifecycleManager.stopAll()
  }
  assert.ok(lifecycleManager.stopAllImpl.mock.calls.length >= 1)
})
