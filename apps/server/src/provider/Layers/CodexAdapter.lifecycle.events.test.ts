import assert from 'node:assert/strict'
import { afterAll } from '@effect/vitest'
import { Effect, Fiber, Stream } from 'effect'
import { type ProviderEvent, ApprovalRequestId } from '@orxa-code/contracts'

import { CodexAdapter, type CodexAdapterShape } from '../Services/CodexAdapter.ts'
import {
  FakeCodexManager,
  asEventId,
  asItemId,
  asThreadId,
  asTurnId,
  makeCodexAdapterTestLayer,
} from './CodexAdapter.test.helpers.ts'

const lifecycleManager = new FakeCodexManager()
const lifecycleLayer = makeCodexAdapterTestLayer(lifecycleManager)

function forkFirstEvent(adapter: Pick<CodexAdapterShape, 'streamEvents'>) {
  return Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild)
}

function emitEvent(event: ProviderEvent) {
  lifecycleManager.emit('event', event)
}

function emitRetryableErrorEvent() {
  emitEvent({
    id: asEventId('evt-retryable-error'),
    kind: 'notification',
    provider: 'codex',
    threadId: asThreadId('thread-1'),
    createdAt: new Date().toISOString(),
    method: 'error',
    turnId: asTurnId('turn-1'),
    payload: { error: { message: 'Reconnecting... 2/5' }, willRetry: true },
  } satisfies ProviderEvent)
}

function emitProcessStderrEvent(id: string, message: string) {
  emitEvent({
    id: asEventId(id),
    kind: 'notification',
    provider: 'codex',
    threadId: asThreadId('thread-1'),
    createdAt: new Date().toISOString(),
    method: 'process/stderr',
    turnId: asTurnId('turn-1'),
    message,
  } satisfies ProviderEvent)
}

function emitResolvedRequestEvent(requestId: string, method: string) {
  emitEvent({
    id: asEventId(`evt-${requestId}`),
    kind: 'notification',
    provider: 'codex',
    threadId: asThreadId('thread-1'),
    createdAt: new Date().toISOString(),
    method: 'serverRequest/resolved',
    requestId: ApprovalRequestId.makeUnsafe(requestId),
    payload: { request: { method }, decision: 'accept' },
  } satisfies ProviderEvent)
}

function emitEmptyUserInputAnswerEvent() {
  emitEvent({
    id: asEventId('evt-user-input-empty'),
    kind: 'notification',
    provider: 'codex',
    threadId: asThreadId('thread-1'),
    createdAt: new Date().toISOString(),
    method: 'item/tool/requestUserInput/answered',
    payload: { answers: { scope: [] } },
  } satisfies ProviderEvent)
}

lifecycleLayer('CodexAdapterLive item completion events', it => {
  it.effect('maps completed agent message items to canonical item.completed events', () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter
      const firstEventFiber = yield* forkFirstEvent(adapter)

      emitEvent({
        id: asEventId('evt-msg-complete'),
        kind: 'notification',
        provider: 'codex',
        createdAt: new Date().toISOString(),
        method: 'item/completed',
        threadId: asThreadId('thread-1'),
        turnId: asTurnId('turn-1'),
        itemId: asItemId('msg_1'),
        payload: { item: { type: 'agentMessage', id: 'msg_1' } },
      } satisfies ProviderEvent)

      const firstEvent = yield* Fiber.join(firstEventFiber)
      assert.equal(firstEvent._tag, 'Some')
      if (firstEvent._tag !== 'Some' || firstEvent.value.type !== 'item.completed') return
      assert.equal(firstEvent.value.itemId, 'msg_1')
      assert.equal(firstEvent.value.turnId, 'turn-1')
      assert.equal(firstEvent.value.payload.itemType, 'assistant_message')
    })
  )

  it.effect('maps completed plan items to canonical proposed-plan completion events', () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter
      const firstEventFiber = yield* forkFirstEvent(adapter)

      emitEvent({
        id: asEventId('evt-plan-complete'),
        kind: 'notification',
        provider: 'codex',
        createdAt: new Date().toISOString(),
        method: 'item/completed',
        threadId: asThreadId('thread-1'),
        turnId: asTurnId('turn-1'),
        itemId: asItemId('plan_1'),
        payload: { item: { type: 'Plan', id: 'plan_1', text: '## Final plan\n\n- one\n- two' } },
      } satisfies ProviderEvent)

      const firstEvent = yield* Fiber.join(firstEventFiber)
      assert.equal(firstEvent._tag, 'Some')
      if (firstEvent._tag !== 'Some' || firstEvent.value.type !== 'turn.proposed.completed') return
      assert.equal(firstEvent.value.turnId, 'turn-1')
      assert.equal(firstEvent.value.payload.planMarkdown, '## Final plan\n\n- one\n- two')
    })
  )

  it.effect('maps plan deltas to canonical proposed-plan delta events', () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter
      const firstEventFiber = yield* forkFirstEvent(adapter)

      emitEvent({
        id: asEventId('evt-plan-delta'),
        kind: 'notification',
        provider: 'codex',
        createdAt: new Date().toISOString(),
        method: 'item/plan/delta',
        threadId: asThreadId('thread-1'),
        turnId: asTurnId('turn-1'),
        itemId: asItemId('plan_1'),
        payload: { delta: '## Final plan' },
      } satisfies ProviderEvent)

      const firstEvent = yield* Fiber.join(firstEventFiber)
      assert.equal(firstEvent._tag, 'Some')
      if (firstEvent._tag !== 'Some' || firstEvent.value.type !== 'turn.proposed.delta') return
      assert.equal(firstEvent.value.turnId, 'turn-1')
      assert.equal(firstEvent.value.payload.delta, '## Final plan')
    })
  )
})

lifecycleLayer('CodexAdapterLive lifecycle and stderr events', it => {
  it.effect('maps session/closed lifecycle events to canonical session.exited runtime events', () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter
      const firstEventFiber = yield* forkFirstEvent(adapter)

      emitEvent({
        id: asEventId('evt-session-closed'),
        kind: 'session',
        provider: 'codex',
        threadId: asThreadId('thread-1'),
        createdAt: new Date().toISOString(),
        method: 'session/closed',
        message: 'Session stopped',
      } satisfies ProviderEvent)

      const firstEvent = yield* Fiber.join(firstEventFiber)
      assert.equal(firstEvent._tag, 'Some')
      if (firstEvent._tag !== 'Some' || firstEvent.value.type !== 'session.exited') return
      assert.equal(firstEvent.value.threadId, 'thread-1')
      assert.equal(firstEvent.value.payload.reason, 'Session stopped')
    })
  )

  it.effect('maps retryable lifecycle errors into runtime warnings', () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter
      const firstEventFiber = yield* forkFirstEvent(adapter)

      emitRetryableErrorEvent()

      const firstEvent = yield* Fiber.join(firstEventFiber)
      assert.equal(firstEvent._tag, 'Some')
      if (firstEvent._tag !== 'Some' || firstEvent.value.type !== 'runtime.warning') return
      assert.equal(firstEvent.value.payload.message, 'Reconnecting... 2/5')
    })
  )

  it.effect('maps generic stderr failures into runtime warnings', () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter
      const firstEventFiber = yield* forkFirstEvent(adapter)

      emitProcessStderrEvent(
        'evt-process-stderr',
        'The filename or extension is too long. (os error 206)'
      )

      const firstEvent = yield* Fiber.join(firstEventFiber)
      assert.equal(firstEvent._tag, 'Some')
      if (firstEvent._tag !== 'Some' || firstEvent.value.type !== 'runtime.warning') return
      assert.equal(
        firstEvent.value.payload.message,
        'The filename or extension is too long. (os error 206)'
      )
    })
  )

  it.effect('maps websocket stderr failures into runtime errors', () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter
      const firstEventFiber = yield* forkFirstEvent(adapter)

      emitProcessStderrEvent(
        'evt-process-stderr-websocket',
        '2026-03-31T18:14:06.833399Z ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: HTTP error: 503 Service Unavailable, url: wss://chatgpt.com/backend-api/codex/responses'
      )

      const firstEvent = yield* Fiber.join(firstEventFiber)
      assert.equal(firstEvent._tag, 'Some')
      if (firstEvent._tag !== 'Some' || firstEvent.value.type !== 'runtime.error') return
      assert.match(firstEvent.value.payload.message, /failed to connect to websocket/i)
    })
  )
})

lifecycleLayer('CodexAdapterLive request lifecycle events', it => {
  it.effect('maps command approval resolution events into canonical request.resolved events', () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter
      const firstEventFiber = yield* forkFirstEvent(adapter)

      emitResolvedRequestEvent('req-1', 'item/commandExecution/requestApproval')

      const firstEvent = yield* Fiber.join(firstEventFiber)
      assert.equal(firstEvent._tag, 'Some')
      if (firstEvent._tag !== 'Some' || firstEvent.value.type !== 'request.resolved') return
      assert.equal(firstEvent.value.payload.requestType, 'command_execution_approval')
    })
  )

  it.effect(
    'maps file-read approval resolution events into canonical request.resolved events',
    () =>
      Effect.gen(function* () {
        const adapter = yield* CodexAdapter
        const firstEventFiber = yield* forkFirstEvent(adapter)

        emitResolvedRequestEvent('req-file-read-1', 'item/fileRead/requestApproval')

        const firstEvent = yield* Fiber.join(firstEventFiber)
        assert.equal(firstEvent._tag, 'Some')
        if (firstEvent._tag !== 'Some' || firstEvent.value.type !== 'request.resolved') return
        assert.equal(firstEvent.value.payload.requestType, 'file_read_approval')
      })
  )

  it.effect('maps empty user-input answers into canonical user-input resolved events', () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter
      const firstEventFiber = yield* forkFirstEvent(adapter)

      emitEmptyUserInputAnswerEvent()

      const firstEvent = yield* Fiber.join(firstEventFiber)
      assert.equal(firstEvent._tag, 'Some')
      if (firstEvent._tag !== 'Some' || firstEvent.value.type !== 'user-input.resolved') return
      assert.deepEqual(firstEvent.value.payload.answers, { scope: [] })
    })
  )
})

afterAll(() => {
  if (lifecycleManager.stopAllImpl.mock.calls.length === 0) {
    lifecycleManager.stopAll()
  }
  assert.ok(lifecycleManager.stopAllImpl.mock.calls.length >= 1)
})
