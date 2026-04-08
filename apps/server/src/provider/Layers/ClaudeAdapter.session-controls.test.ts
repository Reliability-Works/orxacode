import type { PermissionResult, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ProviderItemId } from '@orxa-code/contracts'
import { assert, it } from '@effect/vitest'
import { Effect, Fiber, Random, Stream } from 'effect'

import { ClaudeAdapter } from '../Services/ClaudeAdapter.ts'
import {
  makeDeterministicRandomService,
  makeHarness,
  THREAD_ID,
} from './ClaudeAdapter.test.helpers.ts'

it.effect('updates model on sendTurn when model override is provided', () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const adapter = yield* ClaudeAdapter

    const session = yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: 'claudeAgent',
      runtimeMode: 'full-access',
    })
    yield* adapter.sendTurn({
      threadId: session.threadId,
      input: 'hello',
      modelSelection: {
        provider: 'claudeAgent',
        model: 'claude-opus-4-6',
      },
      attachments: [],
    })

    assert.deepEqual(harness.query.setModelCalls, ['claude-opus-4-6'])
  }).pipe(
    Effect.provideService(Random.Random, makeDeterministicRandomService()),
    Effect.provide(harness.layer)
  )
})

it.effect(
  'does not re-set the Claude model when the session already uses the same effective API model',
  () => {
    const harness = makeHarness()
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter
      const modelSelection = {
        provider: 'claudeAgent' as const,
        model: 'claude-opus-4-6',
      }

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: 'claudeAgent',
        modelSelection,
        runtimeMode: 'full-access',
      })

      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: 'hello',
        modelSelection,
        attachments: [],
      })
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: 'hello again',
        modelSelection,
        attachments: [],
      })

      assert.deepEqual(harness.query.setModelCalls, [])
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer)
    )
  }
)

it.effect('re-sets the Claude model when the effective API model changes', () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const adapter = yield* ClaudeAdapter

    const session = yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: 'claudeAgent',
      runtimeMode: 'full-access',
    })

    yield* adapter.sendTurn({
      threadId: session.threadId,
      input: 'hello',
      modelSelection: {
        provider: 'claudeAgent',
        model: 'claude-opus-4-6',
        options: {
          contextWindow: '1m',
        },
      },
      attachments: [],
    })
    yield* adapter.sendTurn({
      threadId: session.threadId,
      input: 'hello again',
      modelSelection: {
        provider: 'claudeAgent',
        model: 'claude-opus-4-6',
      },
      attachments: [],
    })

    assert.deepEqual(harness.query.setModelCalls, ['claude-opus-4-6[1m]', 'claude-opus-4-6'])
  }).pipe(
    Effect.provideService(Random.Random, makeDeterministicRandomService()),
    Effect.provide(harness.layer)
  )
})

it.effect('sets plan permission mode on sendTurn when interactionMode is plan', () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const adapter = yield* ClaudeAdapter

    const session = yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: 'claudeAgent',
      runtimeMode: 'full-access',
    })
    yield* adapter.sendTurn({
      threadId: session.threadId,
      input: 'plan this for me',
      interactionMode: 'plan',
      attachments: [],
    })

    assert.deepEqual(harness.query.setPermissionModeCalls, ['plan'])
  }).pipe(
    Effect.provideService(Random.Random, makeDeterministicRandomService()),
    Effect.provide(harness.layer)
  )
})

it.effect('restores base permission mode on sendTurn when interactionMode is default', () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const adapter = yield* ClaudeAdapter

    const session = yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: 'claudeAgent',
      runtimeMode: 'full-access',
    })

    yield* adapter.sendTurn({
      threadId: session.threadId,
      input: 'plan this',
      interactionMode: 'plan',
      attachments: [],
    })

    const turnCompletedFiber = yield* Stream.filter(
      adapter.streamEvents,
      event => event.type === 'turn.completed'
    ).pipe(Stream.runHead, Effect.forkChild)

    harness.query.emit({
      type: 'result',
      subtype: 'success',
      is_error: false,
      errors: [],
      session_id: 'sdk-session-plan-restore',
      uuid: 'result-plan',
    } as unknown as SDKMessage)

    yield* Fiber.join(turnCompletedFiber)

    yield* adapter.sendTurn({
      threadId: session.threadId,
      input: 'now do it',
      interactionMode: 'default',
      attachments: [],
    })

    assert.deepEqual(harness.query.setPermissionModeCalls, ['plan', 'bypassPermissions'])
  }).pipe(
    Effect.provideService(Random.Random, makeDeterministicRandomService()),
    Effect.provide(harness.layer)
  )
})

it.effect('does not call setPermissionMode when interactionMode is absent', () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const adapter = yield* ClaudeAdapter

    const session = yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: 'claudeAgent',
      runtimeMode: 'full-access',
    })
    yield* adapter.sendTurn({
      threadId: session.threadId,
      input: 'hello',
      attachments: [],
    })

    assert.deepEqual(harness.query.setPermissionModeCalls, [])
  }).pipe(
    Effect.provideService(Random.Random, makeDeterministicRandomService()),
    Effect.provide(harness.layer)
  )
})

it.effect('captures ExitPlanMode as a proposed plan and denies auto-exit', () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const adapter = yield* ClaudeAdapter

    const session = yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: 'claudeAgent',
      runtimeMode: 'full-access',
    })

    yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain)

    yield* adapter.sendTurn({
      threadId: session.threadId,
      input: 'plan this',
      interactionMode: 'plan',
      attachments: [],
    })
    yield* Stream.take(adapter.streamEvents, 1).pipe(Stream.runDrain)

    const createInput = harness.getLastCreateQueryInput()
    const canUseTool = createInput?.options.canUseTool
    assert.equal(typeof canUseTool, 'function')
    if (!canUseTool) {
      return
    }

    const permissionPromise = canUseTool(
      'ExitPlanMode',
      {
        plan: '# Ship it\n\n- one\n- two',
        allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }],
      },
      {
        signal: new AbortController().signal,
        toolUseID: 'tool-exit-1',
      }
    )

    const proposedEvent = yield* Stream.runHead(adapter.streamEvents)
    assert.equal(proposedEvent._tag, 'Some')
    if (proposedEvent._tag !== 'Some') {
      return
    }
    assert.equal(proposedEvent.value.type, 'turn.proposed.completed')
    if (proposedEvent.value.type !== 'turn.proposed.completed') {
      return
    }
    assert.equal(proposedEvent.value.payload.planMarkdown, '# Ship it\n\n- one\n- two')
    assert.deepEqual(proposedEvent.value.providerRefs, {
      providerItemId: ProviderItemId.makeUnsafe('tool-exit-1'),
    })

    const permissionResult = yield* Effect.promise(() => permissionPromise)
    assert.equal((permissionResult as PermissionResult).behavior, 'deny')
    const deniedResult = permissionResult as PermissionResult & {
      message?: string
    }
    assert.equal(deniedResult.message?.includes('captured your proposed plan'), true)
  }).pipe(
    Effect.provideService(Random.Random, makeDeterministicRandomService()),
    Effect.provide(harness.layer)
  )
})

it.effect('extracts proposed plans from assistant ExitPlanMode snapshots', () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const adapter = yield* ClaudeAdapter

    const session = yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: 'claudeAgent',
      runtimeMode: 'full-access',
    })

    yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain)

    yield* adapter.sendTurn({
      threadId: session.threadId,
      input: 'plan this',
      interactionMode: 'plan',
      attachments: [],
    })
    yield* Stream.take(adapter.streamEvents, 1).pipe(Stream.runDrain)

    const proposedEventFiber = yield* Stream.filter(
      adapter.streamEvents,
      event => event.type === 'turn.proposed.completed'
    ).pipe(Stream.runHead, Effect.forkChild)

    harness.query.emit({
      type: 'assistant',
      session_id: 'sdk-session-exit-plan',
      uuid: 'assistant-exit-plan',
      parent_tool_use_id: null,
      message: {
        model: 'claude-opus-4-6',
        id: 'msg-exit-plan',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-exit-2',
            name: 'ExitPlanMode',
            input: {
              plan: '# Final plan\n\n- capture it',
            },
          },
        ],
        stop_reason: null,
        stop_sequence: null,
        usage: {},
      },
    } as unknown as SDKMessage)

    const proposedEvent = yield* Fiber.join(proposedEventFiber)
    assert.equal(proposedEvent._tag, 'Some')
    if (proposedEvent._tag !== 'Some') {
      return
    }
    assert.equal(proposedEvent.value.type, 'turn.proposed.completed')
    if (proposedEvent.value.type !== 'turn.proposed.completed') {
      return
    }
    assert.equal(proposedEvent.value.payload.planMarkdown, '# Final plan\n\n- capture it')
    assert.deepEqual(proposedEvent.value.providerRefs, {
      providerItemId: ProviderItemId.makeUnsafe('tool-exit-2'),
    })
  }).pipe(
    Effect.provideService(Random.Random, makeDeterministicRandomService()),
    Effect.provide(harness.layer)
  )
})
