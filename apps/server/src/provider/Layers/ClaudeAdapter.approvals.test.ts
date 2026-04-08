import type { PermissionResult, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ApprovalRequestId, ProviderItemId } from '@orxa-code/contracts'
import { assert, it } from '@effect/vitest'
import { Effect, Random, Stream } from 'effect'

import { ClaudeAdapter } from '../Services/ClaudeAdapter.ts'
import {
  makeDeterministicRandomService,
  makeHarness,
  THREAD_ID,
} from './ClaudeAdapter.test.helpers.ts'

function startApprovalRequest() {
  const harness = makeHarness()

  const effect = Effect.gen(function* () {
    const adapter = yield* ClaudeAdapter

    const session = yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: 'claudeAgent',
      runtimeMode: 'approval-required',
    })

    yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain)

    yield* adapter.sendTurn({
      threadId: session.threadId,
      input: 'approve this',
      attachments: [],
    })
    yield* Stream.take(adapter.streamEvents, 1).pipe(Stream.runDrain)

    harness.query.emit({
      type: 'stream_event',
      session_id: 'sdk-session-approval-1',
      uuid: 'stream-approval-thread',
      parent_tool_use_id: null,
      event: {
        type: 'message_start',
        message: {
          id: 'msg-approval-thread',
        },
      },
    } as unknown as SDKMessage)

    const threadStarted = yield* Stream.runHead(adapter.streamEvents)
    assert.equal(threadStarted._tag, 'Some')
    if (threadStarted._tag !== 'Some' || threadStarted.value.type !== 'thread.started') {
      return
    }

    const createInput = harness.getLastCreateQueryInput()
    const canUseTool = createInput?.options.canUseTool
    assert.equal(typeof canUseTool, 'function')
    if (!canUseTool) {
      return
    }

    const permissionPromise = canUseTool(
      'Bash',
      { command: 'pwd' },
      {
        signal: new AbortController().signal,
        suggestions: [
          {
            type: 'setMode',
            mode: 'default',
            destination: 'session',
          },
        ],
        toolUseID: 'tool-use-1',
      }
    )

    const requested = yield* Stream.runHead(adapter.streamEvents)
    assert.equal(requested._tag, 'Some')
    if (requested._tag !== 'Some') {
      return
    }
    assert.equal(requested.value.type, 'request.opened')
    if (requested.value.type !== 'request.opened') {
      return
    }

    return { permissionPromise, requested, session } as const
  }).pipe(
    Effect.provideService(Random.Random, makeDeterministicRandomService()),
    Effect.provide(harness.layer)
  )

  return { effect, harness } as const
}

it.effect('bridges approval request/response lifecycle through canUseTool', () => {
  const { effect, harness } = startApprovalRequest()
  return Effect.gen(function* () {
    const started = yield* effect
    if (!started) {
      return
    }

    const { permissionPromise, requested, session } = started
    const adapter = yield* ClaudeAdapter

    assert.deepEqual(requested.value.providerRefs, {
      providerItemId: ProviderItemId.makeUnsafe('tool-use-1'),
    })
    const runtimeRequestId = requested.value.requestId
    assert.equal(typeof runtimeRequestId, 'string')
    if (runtimeRequestId === undefined) {
      return
    }

    yield* adapter.respondToRequest(
      session.threadId,
      ApprovalRequestId.makeUnsafe(runtimeRequestId),
      'accept'
    )

    const resolved = yield* Stream.runHead(adapter.streamEvents)
    assert.equal(resolved._tag, 'Some')
    if (resolved._tag !== 'Some') {
      return
    }
    assert.equal(resolved.value.type, 'request.resolved')
    if (resolved.value.type !== 'request.resolved') {
      return
    }
    assert.equal(resolved.value.requestId, requested.value.requestId)
    assert.equal(resolved.value.payload.decision, 'accept')
    assert.deepEqual(resolved.value.providerRefs, {
      providerItemId: ProviderItemId.makeUnsafe('tool-use-1'),
    })

    const permissionResult = yield* Effect.promise(() => permissionPromise)
    assert.equal((permissionResult as PermissionResult).behavior, 'allow')
  }).pipe(Effect.provide(harness.layer))
})
