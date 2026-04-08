import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ApprovalRequestId } from '@orxa-code/contracts'
import { assert, it } from '@effect/vitest'
import { Effect, Fiber, Random, Stream } from 'effect'

import { ClaudeAdapter } from '../Services/ClaudeAdapter.ts'
import {
  makeDeterministicRandomService,
  makeHarness,
  RESUME_THREAD_ID,
  THREAD_ID,
} from './ClaudeAdapter.test.helpers.ts'

it.effect('does not fabricate provider thread ids before first SDK session_id', () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const adapter = yield* ClaudeAdapter

    const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 5).pipe(
      Stream.runCollect,
      Effect.forkChild
    )

    const session = yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: 'claudeAgent',
      runtimeMode: 'full-access',
    })
    assert.equal(session.threadId, THREAD_ID)

    const turn = yield* adapter.sendTurn({
      threadId: session.threadId,
      input: 'hello',
      attachments: [],
    })
    assert.equal(turn.threadId, THREAD_ID)

    harness.query.emit({
      type: 'stream_event',
      session_id: 'sdk-thread-real',
      uuid: 'stream-thread-real',
      parent_tool_use_id: null,
      event: {
        type: 'message_start',
        message: {
          id: 'msg-thread-real',
        },
      },
    } as unknown as SDKMessage)

    harness.query.emit({
      type: 'result',
      subtype: 'success',
      is_error: false,
      errors: [],
      session_id: 'sdk-thread-real',
      uuid: 'result-thread-real',
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
      ]
    )

    const sessionStarted = runtimeEvents[0]
    assert.equal(sessionStarted?.type, 'session.started')
    if (sessionStarted?.type === 'session.started') {
      assert.equal(sessionStarted.threadId, THREAD_ID)
    }

    const threadStarted = runtimeEvents[4]
    assert.equal(threadStarted?.type, 'thread.started')
    if (threadStarted?.type === 'thread.started') {
      assert.equal(threadStarted.threadId, THREAD_ID)
      assert.deepEqual(threadStarted.payload, {
        providerThreadId: 'sdk-thread-real',
      })
    }
  }).pipe(
    Effect.provideService(Random.Random, makeDeterministicRandomService()),
    Effect.provide(harness.layer)
  )
})

it.effect('classifies Agent tools and read-only Claude tools correctly for approvals', () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const adapter = yield* ClaudeAdapter

    const session = yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: 'claudeAgent',
      runtimeMode: 'approval-required',
    })

    yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain)

    const createInput = harness.getLastCreateQueryInput()
    const canUseTool = createInput?.options.canUseTool
    assert.equal(typeof canUseTool, 'function')
    if (!canUseTool) {
      return
    }

    const agentPermissionPromise = canUseTool(
      'Agent',
      {},
      {
        signal: new AbortController().signal,
        toolUseID: 'tool-agent-1',
      }
    )

    const agentRequested = yield* Stream.runHead(adapter.streamEvents)
    assert.equal(agentRequested._tag, 'Some')
    if (agentRequested._tag !== 'Some' || agentRequested.value.type !== 'request.opened') {
      return
    }
    assert.equal(agentRequested.value.payload.requestType, 'dynamic_tool_call')

    yield* adapter.respondToRequest(
      session.threadId,
      ApprovalRequestId.makeUnsafe(String(agentRequested.value.requestId)),
      'accept'
    )
    yield* Stream.runHead(adapter.streamEvents)
    yield* Effect.promise(() => agentPermissionPromise)

    const grepPermissionPromise = canUseTool(
      'Grep',
      { pattern: 'foo', path: 'src' },
      {
        signal: new AbortController().signal,
        toolUseID: 'tool-grep-approval-1',
      }
    )

    const grepRequested = yield* Stream.runHead(adapter.streamEvents)
    assert.equal(grepRequested._tag, 'Some')
    if (grepRequested._tag !== 'Some' || grepRequested.value.type !== 'request.opened') {
      return
    }
    assert.equal(grepRequested.value.payload.requestType, 'file_read_approval')

    yield* adapter.respondToRequest(
      session.threadId,
      ApprovalRequestId.makeUnsafe(String(grepRequested.value.requestId)),
      'accept'
    )
    yield* Stream.runHead(adapter.streamEvents)
    yield* Effect.promise(() => grepPermissionPromise)
  }).pipe(
    Effect.provideService(Random.Random, makeDeterministicRandomService()),
    Effect.provide(harness.layer)
  )
})

it.effect('passes Claude resume ids without pinning a stale assistant checkpoint', () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const adapter = yield* ClaudeAdapter

    const session = yield* adapter.startSession({
      threadId: RESUME_THREAD_ID,
      provider: 'claudeAgent',
      resumeCursor: {
        threadId: 'resume-thread-1',
        resume: '550e8400-e29b-41d4-a716-446655440000',
        resumeSessionAt: 'assistant-99',
        turnCount: 3,
      },
      runtimeMode: 'full-access',
    })

    assert.equal(session.threadId, RESUME_THREAD_ID)
    assert.deepEqual(session.resumeCursor, {
      threadId: RESUME_THREAD_ID,
      resume: '550e8400-e29b-41d4-a716-446655440000',
      resumeSessionAt: 'assistant-99',
      turnCount: 3,
    })

    const createInput = harness.getLastCreateQueryInput()
    assert.equal(createInput?.options.resume, '550e8400-e29b-41d4-a716-446655440000')
    assert.equal(createInput?.options.sessionId, undefined)
    assert.equal(createInput?.options.resumeSessionAt, undefined)
  }).pipe(
    Effect.provideService(Random.Random, makeDeterministicRandomService()),
    Effect.provide(harness.layer)
  )
})

it.effect('uses an app-generated Claude session id for fresh sessions', () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const adapter = yield* ClaudeAdapter

    const session = yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: 'claudeAgent',
      runtimeMode: 'full-access',
    })

    const createInput = harness.getLastCreateQueryInput()
    const sessionResumeCursor = session.resumeCursor as {
      threadId?: string
      resume?: string
      turnCount?: number
    }
    assert.equal(sessionResumeCursor.threadId, THREAD_ID)
    assert.equal(typeof sessionResumeCursor.resume, 'string')
    assert.equal(sessionResumeCursor.turnCount, 0)
    assert.match(
      sessionResumeCursor.resume ?? '',
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    assert.equal(createInput?.options.resume, undefined)
    assert.equal(createInput?.options.sessionId, sessionResumeCursor.resume)
  }).pipe(
    Effect.provideService(Random.Random, makeDeterministicRandomService()),
    Effect.provide(harness.layer)
  )
})

it.effect(
  'supports rollbackThread by trimming in-memory turns and preserving earlier turns',
  () => {
    const harness = makeHarness()
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: 'claudeAgent',
        runtimeMode: 'full-access',
      })

      const firstTurn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: 'first',
        attachments: [],
      })

      const firstCompletedFiber = yield* Stream.filter(
        adapter.streamEvents,
        event => event.type === 'turn.completed'
      ).pipe(Stream.runHead, Effect.forkChild)

      harness.query.emit({
        type: 'result',
        subtype: 'success',
        is_error: false,
        errors: [],
        session_id: 'sdk-session-rollback',
        uuid: 'result-first',
      } as unknown as SDKMessage)

      const firstCompleted = yield* Fiber.join(firstCompletedFiber)
      assert.equal(firstCompleted._tag, 'Some')
      if (firstCompleted._tag === 'Some' && firstCompleted.value.type === 'turn.completed') {
        assert.equal(String(firstCompleted.value.turnId), String(firstTurn.turnId))
      }

      const secondTurn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: 'second',
        attachments: [],
      })

      const secondCompletedFiber = yield* Stream.filter(
        adapter.streamEvents,
        event => event.type === 'turn.completed'
      ).pipe(Stream.runHead, Effect.forkChild)

      harness.query.emit({
        type: 'result',
        subtype: 'success',
        is_error: false,
        errors: [],
        session_id: 'sdk-session-rollback',
        uuid: 'result-second',
      } as unknown as SDKMessage)

      const secondCompleted = yield* Fiber.join(secondCompletedFiber)
      assert.equal(secondCompleted._tag, 'Some')
      if (secondCompleted._tag === 'Some' && secondCompleted.value.type === 'turn.completed') {
        assert.equal(String(secondCompleted.value.turnId), String(secondTurn.turnId))
      }

      const threadBeforeRollback = yield* adapter.readThread(session.threadId)
      assert.equal(threadBeforeRollback.turns.length, 2)

      const rolledBack = yield* adapter.rollbackThread(session.threadId, 1)
      assert.equal(rolledBack.turns.length, 1)
      assert.equal(rolledBack.turns[0]?.id, firstTurn.turnId)

      const threadAfterRollback = yield* adapter.readThread(session.threadId)
      assert.equal(threadAfterRollback.turns.length, 1)
      assert.equal(threadAfterRollback.turns[0]?.id, firstTurn.turnId)
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer)
    )
  }
)
