import { CommandId, DEFAULT_PROVIDER_INTERACTION_MODE, ThreadId } from '@orxa-code/contracts'
import { Effect } from 'effect'
import { expect, it } from 'vitest'

import { asMessageId, createHarness, waitFor } from './ProviderCommandReactor.test.helpers.ts'

const findThread = async (harness: Awaited<ReturnType<typeof createHarness>>) =>
  (await Effect.runPromise(harness.engine.getReadModel())).threads.find(
    entry => entry.id === ThreadId.makeUnsafe('thread-1')
  )

it('preserves the active session model when in-session model switching is unsupported', async () => {
  const harness = await createHarness({ sessionModelSwitch: 'unsupported' })
  const now = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.start',
      commandId: CommandId.makeUnsafe('cmd-turn-start-unsupported-1'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      message: {
        messageId: asMessageId('user-message-unsupported-1'),
        role: 'user',
        text: 'first',
        attachments: [],
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: 'approval-required',
      createdAt: now,
    })
  )
  await waitFor(() => harness.sendTurn.mock.calls.length === 1)

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.start',
      commandId: CommandId.makeUnsafe('cmd-turn-start-unsupported-2'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      message: {
        messageId: asMessageId('user-message-unsupported-2'),
        role: 'user',
        text: 'second',
        attachments: [],
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: 'approval-required',
      createdAt: now,
    })
  )

  await waitFor(() => harness.sendTurn.mock.calls.length === 2)
  expect(harness.sendTurn.mock.calls[1]?.[0]).toMatchObject({
    threadId: ThreadId.makeUnsafe('thread-1'),
    modelSelection: {
      provider: 'codex',
      model: 'gpt-5-codex',
    },
  })
})

it('reuses the same provider session when runtime mode is unchanged', async () => {
  const harness = await createHarness()
  const now = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.start',
      commandId: CommandId.makeUnsafe('cmd-turn-start-unchanged-1'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      message: {
        messageId: asMessageId('user-message-unchanged-1'),
        role: 'user',
        text: 'first',
        attachments: [],
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: 'approval-required',
      createdAt: now,
    })
  )
  await waitFor(() => harness.startSession.mock.calls.length === 1)
  await waitFor(() => harness.sendTurn.mock.calls.length === 1)

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.start',
      commandId: CommandId.makeUnsafe('cmd-turn-start-unchanged-2'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      message: {
        messageId: asMessageId('user-message-unchanged-2'),
        role: 'user',
        text: 'second',
        attachments: [],
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: 'approval-required',
      createdAt: now,
    })
  )

  await waitFor(() => harness.sendTurn.mock.calls.length === 2)
  expect(harness.startSession.mock.calls.length).toBe(1)
  expect(harness.stopSession.mock.calls.length).toBe(0)
})

it('restarts claude sessions when claude effort changes', async () => {
  const harness = await createHarness({
    threadModelSelection: { provider: 'claudeAgent', model: 'claude-sonnet-4-6' },
  })
  const now = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.start',
      commandId: CommandId.makeUnsafe('cmd-turn-start-claude-effort-1'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      message: {
        messageId: asMessageId('user-message-claude-effort-1'),
        role: 'user',
        text: 'first claude turn',
        attachments: [],
      },
      modelSelection: {
        provider: 'claudeAgent',
        model: 'claude-sonnet-4-6',
        options: {
          effort: 'medium',
        },
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: 'approval-required',
      createdAt: now,
    })
  )
  await waitFor(() => harness.startSession.mock.calls.length === 1)
  await waitFor(() => harness.sendTurn.mock.calls.length === 1)

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.start',
      commandId: CommandId.makeUnsafe('cmd-turn-start-claude-effort-2'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      message: {
        messageId: asMessageId('user-message-claude-effort-2'),
        role: 'user',
        text: 'second claude turn',
        attachments: [],
      },
      modelSelection: {
        provider: 'claudeAgent',
        model: 'claude-sonnet-4-6',
        options: {
          effort: 'max',
        },
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: 'approval-required',
      createdAt: now,
    })
  )

  await waitFor(() => harness.startSession.mock.calls.length === 2)
  await waitFor(() => harness.sendTurn.mock.calls.length === 2)
  expect(harness.startSession.mock.calls[1]?.[1]).toMatchObject({
    resumeCursor: { opaque: 'resume-1' },
    modelSelection: {
      provider: 'claudeAgent',
      model: 'claude-sonnet-4-6',
      options: {
        effort: 'max',
      },
    },
  })
})

it('restarts the provider session when runtime mode is updated on the thread', async () => {
  const harness = await createHarness()
  const now = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.runtime-mode.set',
      commandId: CommandId.makeUnsafe('cmd-runtime-mode-set-initial-full-access'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      runtimeMode: 'full-access',
      createdAt: now,
    })
  )
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.start',
      commandId: CommandId.makeUnsafe('cmd-turn-start-runtime-mode-1'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      message: {
        messageId: asMessageId('user-message-runtime-mode-1'),
        role: 'user',
        text: 'first',
        attachments: [],
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: 'full-access',
      createdAt: now,
    })
  )

  await waitFor(() => harness.startSession.mock.calls.length === 1)
  await waitFor(() => harness.sendTurn.mock.calls.length === 1)

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.runtime-mode.set',
      commandId: CommandId.makeUnsafe('cmd-runtime-mode-set-1'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      runtimeMode: 'approval-required',
      createdAt: now,
    })
  )

  await waitFor(async () => {
    return (await findThread(harness))?.runtimeMode === 'approval-required'
  })
  await waitFor(() => harness.startSession.mock.calls.length === 2)

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.start',
      commandId: CommandId.makeUnsafe('cmd-turn-start-runtime-mode-2'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      message: {
        messageId: asMessageId('user-message-runtime-mode-2'),
        role: 'user',
        text: 'second',
        attachments: [],
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: 'full-access',
      createdAt: now,
    })
  )

  await waitFor(() => harness.sendTurn.mock.calls.length === 2)
  expect(harness.stopSession.mock.calls.length).toBe(0)
  expect(harness.startSession.mock.calls[1]?.[1]).toMatchObject({
    threadId: ThreadId.makeUnsafe('thread-1'),
    resumeCursor: { opaque: 'resume-1' },
    runtimeMode: 'approval-required',
  })
  expect(harness.sendTurn.mock.calls[1]?.[0]).toMatchObject({
    threadId: ThreadId.makeUnsafe('thread-1'),
  })

  const thread = await findThread(harness)
  expect(thread?.session?.threadId).toBe('thread-1')
  expect(thread?.session?.runtimeMode).toBe('approval-required')
})

it('does not inject derived model options when restarting claude on runtime mode changes', async () => {
  const harness = await createHarness({
    threadModelSelection: { provider: 'claudeAgent', model: 'claude-opus-4-6' },
  })
  const now = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.session.set',
      commandId: CommandId.makeUnsafe('cmd-session-set-runtime-mode-claude'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      session: {
        threadId: ThreadId.makeUnsafe('thread-1'),
        status: 'ready',
        providerName: 'claudeAgent',
        runtimeMode: 'full-access',
        activeTurnId: null,
        lastError: null,
        updatedAt: now,
      },
      createdAt: now,
    })
  )
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.runtime-mode.set',
      commandId: CommandId.makeUnsafe('cmd-runtime-mode-set-claude-no-options'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      runtimeMode: 'approval-required',
      createdAt: now,
    })
  )

  await waitFor(() => harness.startSession.mock.calls.length === 1)
  expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
    modelSelection: {
      provider: 'claudeAgent',
      model: 'claude-opus-4-6',
    },
    runtimeMode: 'approval-required',
  })
})

it('rejects provider changes after a thread is already bound to a session provider', async () => {
  const harness = await createHarness()
  const now = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.start',
      commandId: CommandId.makeUnsafe('cmd-turn-start-provider-switch-1'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      message: {
        messageId: asMessageId('user-message-provider-switch-1'),
        role: 'user',
        text: 'first',
        attachments: [],
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: 'approval-required',
      createdAt: now,
    })
  )
  await waitFor(() => harness.startSession.mock.calls.length === 1)
  await waitFor(() => harness.sendTurn.mock.calls.length === 1)

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.start',
      commandId: CommandId.makeUnsafe('cmd-turn-start-provider-switch-2'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      message: {
        messageId: asMessageId('user-message-provider-switch-2'),
        role: 'user',
        text: 'second',
        attachments: [],
      },
      modelSelection: {
        provider: 'claudeAgent',
        model: 'claude-opus-4-6',
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: 'approval-required',
      createdAt: now,
    })
  )

  await waitFor(async () => {
    return (
      (await findThread(harness))?.activities.some(
        activity => activity.kind === 'provider.turn.start.failed'
      ) ?? false
    )
  })

  expect(harness.startSession.mock.calls.length).toBe(1)
  expect(harness.sendTurn.mock.calls.length).toBe(1)
  expect(harness.stopSession.mock.calls.length).toBe(0)

  const thread = await findThread(harness)
  expect(thread?.session?.threadId).toBe('thread-1')
  expect(thread?.session?.providerName).toBe('codex')
  expect(thread?.session?.runtimeMode).toBe('approval-required')
  expect(
    thread?.activities.find(activity => activity.kind === 'provider.turn.start.failed')
  ).toMatchObject({
    payload: {
      detail: expect.stringContaining("cannot switch to 'claudeAgent'"),
    },
  })
})

it('does not stop the active session when restart fails before rebind', async () => {
  const harness = await createHarness()
  const now = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.runtime-mode.set',
      commandId: CommandId.makeUnsafe('cmd-runtime-mode-set-initial-full-access-2'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      runtimeMode: 'full-access',
      createdAt: now,
    })
  )
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.start',
      commandId: CommandId.makeUnsafe('cmd-turn-start-restart-failure-1'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      message: {
        messageId: asMessageId('user-message-restart-failure-1'),
        role: 'user',
        text: 'first',
        attachments: [],
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: 'full-access',
      createdAt: now,
    })
  )

  await waitFor(() => harness.startSession.mock.calls.length === 1)
  await waitFor(() => harness.sendTurn.mock.calls.length === 1)

  harness.startSession.mockImplementationOnce((...args: [unknown, unknown]) => {
    void args
    return Effect.fail(new Error('simulated restart failure')) as never
  })

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.runtime-mode.set',
      commandId: CommandId.makeUnsafe('cmd-runtime-mode-set-restart-failure'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      runtimeMode: 'approval-required',
      createdAt: now,
    })
  )

  await waitFor(async () => {
    return (await findThread(harness))?.runtimeMode === 'approval-required'
  })
  await waitFor(() => harness.startSession.mock.calls.length === 2)
  await harness.drain()

  expect(harness.stopSession.mock.calls.length).toBe(0)
  expect(harness.sendTurn.mock.calls.length).toBe(1)

  const thread = await findThread(harness)
  expect(thread?.session?.threadId).toBe('thread-1')
  expect(thread?.session?.runtimeMode).toBe('full-access')
})
