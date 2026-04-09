import { CommandId, DEFAULT_PROVIDER_INTERACTION_MODE, ThreadId } from '@orxa-code/contracts'
import { Effect } from 'effect'
import { expect, it } from 'vitest'

import { asMessageId, createHarness, waitFor } from './ProviderCommandReactor.test.helpers.ts'

it('reacts to thread.turn.start by ensuring session and sending provider turn', async () => {
  const harness = await createHarness()
  const now = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.start',
      commandId: CommandId.makeUnsafe('cmd-turn-start-1'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      message: {
        messageId: asMessageId('user-message-1'),
        role: 'user',
        text: 'hello reactor',
        attachments: [],
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: 'approval-required',
      createdAt: now,
    })
  )

  await waitFor(() => harness.startSession.mock.calls.length === 1)
  await waitFor(() => harness.sendTurn.mock.calls.length === 1)
  expect(harness.startSession.mock.calls[0]?.[0]).toEqual(ThreadId.makeUnsafe('thread-1'))
  expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
    cwd: '/tmp/provider-project',
    modelSelection: {
      provider: 'codex',
      model: 'gpt-5-codex',
    },
    runtimeMode: 'approval-required',
  })

  const readModel = await Effect.runPromise(harness.engine.getReadModel())
  const thread = readModel.threads.find(entry => entry.id === ThreadId.makeUnsafe('thread-1'))
  expect(thread?.session?.threadId).toBe('thread-1')
  expect(thread?.session?.runtimeMode).toBe('approval-required')
})

it('generates a thread title on the first turn', async () => {
  const harness = await createHarness()
  const now = new Date().toISOString()
  const seededTitle = 'Please investigate reconnect failures after restar...'
  harness.generateThreadTitle.mockReturnValue(Effect.succeed({ title: 'Generated title' }))

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.meta.update',
      commandId: CommandId.makeUnsafe('cmd-thread-title-seed'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      title: seededTitle,
    })
  )
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.start',
      commandId: CommandId.makeUnsafe('cmd-turn-start-title'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      message: {
        messageId: asMessageId('user-message-title'),
        role: 'user',
        text: 'Please investigate reconnect failures after restarting the session.',
        attachments: [],
      },
      titleSeed: seededTitle,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: 'approval-required',
      createdAt: now,
    })
  )

  await waitFor(() => harness.generateThreadTitle.mock.calls.length === 1)
  expect(harness.generateThreadTitle.mock.calls[0]?.[0]).toMatchObject({
    message: 'Please investigate reconnect failures after restarting the session.',
  })
  await waitFor(async () => {
    const readModel = await Effect.runPromise(harness.engine.getReadModel())
    return (
      readModel.threads.find(entry => entry.id === ThreadId.makeUnsafe('thread-1'))?.title ===
      'Generated title'
    )
  })

  const readModel = await Effect.runPromise(harness.engine.getReadModel())
  const thread = readModel.threads.find(entry => entry.id === ThreadId.makeUnsafe('thread-1'))
  expect(thread?.title).toBe('Generated title')
})

it('does not overwrite an existing custom thread title on the first turn', async () => {
  const harness = await createHarness()
  const now = new Date().toISOString()
  const seededTitle = 'Please investigate reconnect failures after restar...'

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.meta.update',
      commandId: CommandId.makeUnsafe('cmd-thread-title-custom'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      title: 'Keep this custom title',
    })
  )
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.start',
      commandId: CommandId.makeUnsafe('cmd-turn-start-title-preserve'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      message: {
        messageId: asMessageId('user-message-title-preserve'),
        role: 'user',
        text: 'Please investigate reconnect failures after restarting the session.',
        attachments: [],
      },
      titleSeed: seededTitle,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: 'approval-required',
      createdAt: now,
    })
  )

  await waitFor(() => harness.sendTurn.mock.calls.length === 1)
  expect(harness.generateThreadTitle).not.toHaveBeenCalled()

  const readModel = await Effect.runPromise(harness.engine.getReadModel())
  const thread = readModel.threads.find(entry => entry.id === ThreadId.makeUnsafe('thread-1'))
  expect(thread?.title).toBe('Keep this custom title')
})

it('matches the client-seeded title even when the outgoing prompt is reformatted', async () => {
  const harness = await createHarness()
  const now = new Date().toISOString()
  const seededTitle = 'Fix reconnect spinner on resume'
  harness.generateThreadTitle.mockReturnValue(
    Effect.succeed({
      title: 'Reconnect spinner resume bug',
    })
  )

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.meta.update',
      commandId: CommandId.makeUnsafe('cmd-thread-title-formatted-seed'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      title: seededTitle,
    })
  )
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.start',
      commandId: CommandId.makeUnsafe('cmd-turn-start-title-formatted'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      message: {
        messageId: asMessageId('user-message-title-formatted'),
        role: 'user',
        text: '[effort:high]\\n\\nFix reconnect spinner on resume',
        attachments: [],
      },
      titleSeed: seededTitle,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: 'approval-required',
      createdAt: now,
    })
  )

  await waitFor(() => harness.generateThreadTitle.mock.calls.length === 1)
  await waitFor(async () => {
    const readModel = await Effect.runPromise(harness.engine.getReadModel())
    return (
      readModel.threads.find(entry => entry.id === ThreadId.makeUnsafe('thread-1'))?.title ===
      'Reconnect spinner resume bug'
    )
  })

  const readModel = await Effect.runPromise(harness.engine.getReadModel())
  const thread = readModel.threads.find(entry => entry.id === ThreadId.makeUnsafe('thread-1'))
  expect(thread?.title).toBe('Reconnect spinner resume bug')
})

it('generates a worktree branch name for the first turn', async () => {
  const harness = await createHarness()
  const now = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.meta.update',
      commandId: CommandId.makeUnsafe('cmd-thread-branch'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      branch: 'orxa/1234abcd',
      worktreePath: '/tmp/provider-project-worktree',
    })
  )

  harness.generateBranchName.mockImplementation((input: unknown) =>
    Effect.succeed({
      branch:
        typeof input === 'object' &&
        input !== null &&
        'modelSelection' in input &&
        typeof input.modelSelection === 'object' &&
        input.modelSelection !== null &&
        'model' in input.modelSelection &&
        typeof input.modelSelection.model === 'string'
          ? `feature/${input.modelSelection.model}`
          : 'feature/generated',
    })
  )

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.start',
      commandId: CommandId.makeUnsafe('cmd-turn-start-branch-model'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      message: {
        messageId: asMessageId('user-message-branch-model'),
        role: 'user',
        text: 'Add a safer reconnect backoff.',
        attachments: [],
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: 'approval-required',
      createdAt: now,
    })
  )

  await waitFor(() => harness.generateBranchName.mock.calls.length === 1)
  expect(harness.generateBranchName.mock.calls[0]?.[0]).toMatchObject({
    message: 'Add a safer reconnect backoff.',
  })
})

it('forwards codex model options through session start and turn send', async () => {
  const harness = await createHarness()
  const now = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.start',
      commandId: CommandId.makeUnsafe('cmd-turn-start-fast'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      message: {
        messageId: asMessageId('user-message-fast'),
        role: 'user',
        text: 'hello fast mode',
        attachments: [],
      },
      modelSelection: {
        provider: 'codex',
        model: 'gpt-5.3-codex',
        options: {
          reasoningEffort: 'high',
          fastMode: true,
        },
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: 'approval-required',
      createdAt: now,
    })
  )

  await waitFor(() => harness.startSession.mock.calls.length === 1)
  await waitFor(() => harness.sendTurn.mock.calls.length === 1)
  expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
    modelSelection: {
      provider: 'codex',
      model: 'gpt-5.3-codex',
      options: {
        reasoningEffort: 'high',
        fastMode: true,
      },
    },
  })
  expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
    threadId: ThreadId.makeUnsafe('thread-1'),
    modelSelection: {
      provider: 'codex',
      model: 'gpt-5.3-codex',
      options: {
        reasoningEffort: 'high',
        fastMode: true,
      },
    },
  })
})

it('forwards claude effort options through session start and turn send', async () => {
  const harness = await createHarness({
    threadModelSelection: { provider: 'claudeAgent', model: 'claude-sonnet-4-6' },
  })
  const now = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.start',
      commandId: CommandId.makeUnsafe('cmd-turn-start-claude-effort'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      message: {
        messageId: asMessageId('user-message-claude-effort'),
        role: 'user',
        text: 'hello with effort',
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

  await waitFor(() => harness.startSession.mock.calls.length === 1)
  await waitFor(() => harness.sendTurn.mock.calls.length === 1)
  expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
    modelSelection: {
      provider: 'claudeAgent',
      model: 'claude-sonnet-4-6',
      options: {
        effort: 'max',
      },
    },
  })
  expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
    threadId: ThreadId.makeUnsafe('thread-1'),
    modelSelection: {
      provider: 'claudeAgent',
      model: 'claude-sonnet-4-6',
      options: {
        effort: 'max',
      },
    },
  })
})

it('forwards claude fast mode options through session start and turn send', async () => {
  const harness = await createHarness({
    threadModelSelection: { provider: 'claudeAgent', model: 'claude-opus-4-6' },
  })
  const now = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.start',
      commandId: CommandId.makeUnsafe('cmd-turn-start-claude-fast-mode'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      message: {
        messageId: asMessageId('user-message-claude-fast-mode'),
        role: 'user',
        text: 'hello with fast mode',
        attachments: [],
      },
      modelSelection: {
        provider: 'claudeAgent',
        model: 'claude-opus-4-6',
        options: {
          fastMode: true,
        },
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: 'approval-required',
      createdAt: now,
    })
  )

  await waitFor(() => harness.startSession.mock.calls.length === 1)
  await waitFor(() => harness.sendTurn.mock.calls.length === 1)
  expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
    modelSelection: {
      provider: 'claudeAgent',
      model: 'claude-opus-4-6',
      options: {
        fastMode: true,
      },
    },
  })
  expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
    threadId: ThreadId.makeUnsafe('thread-1'),
    modelSelection: {
      provider: 'claudeAgent',
      model: 'claude-opus-4-6',
      options: {
        fastMode: true,
      },
    },
  })
})

it('forwards plan interaction mode to the provider turn request', async () => {
  const harness = await createHarness()
  const now = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.interaction-mode.set',
      commandId: CommandId.makeUnsafe('cmd-interaction-mode-set-plan'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      interactionMode: 'plan',
      createdAt: now,
    })
  )
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.start',
      commandId: CommandId.makeUnsafe('cmd-turn-start-plan'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      message: {
        messageId: asMessageId('user-message-plan'),
        role: 'user',
        text: 'plan this change',
        attachments: [],
      },
      interactionMode: 'plan',
      runtimeMode: 'approval-required',
      createdAt: now,
    })
  )

  await waitFor(() => harness.sendTurn.mock.calls.length === 1)
  expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
    threadId: ThreadId.makeUnsafe('thread-1'),
    interactionMode: 'plan',
  })
})

it('starts an opencode session and sends a turn for opencode threads', async () => {
  const harness = await createHarness({
    threadModelSelection: {
      provider: 'opencode',
      model: 'anthropic/claude-sonnet-4-5',
    },
  })
  const now = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.start',
      commandId: CommandId.makeUnsafe('cmd-turn-start-opencode'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      message: {
        messageId: asMessageId('user-message-opencode'),
        role: 'user',
        text: 'hello opencode',
        attachments: [],
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: 'approval-required',
      createdAt: now,
    })
  )

  await waitFor(() => harness.startSession.mock.calls.length === 1)
  await waitFor(() => harness.sendTurn.mock.calls.length === 1)
  expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
    modelSelection: {
      provider: 'opencode',
      model: 'anthropic/claude-sonnet-4-5',
    },
    runtimeMode: 'approval-required',
  })
  expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
    threadId: ThreadId.makeUnsafe('thread-1'),
  })
})

it('rejects a first turn when requested provider conflicts with the thread model', async () => {
  const harness = await createHarness({
    threadModelSelection: { provider: 'codex', model: 'gpt-5-codex' },
  })
  const now = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.start',
      commandId: CommandId.makeUnsafe('cmd-turn-start-provider-first'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      message: {
        messageId: asMessageId('user-message-provider-first'),
        role: 'user',
        text: 'hello claude',
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
    const readModel = await Effect.runPromise(harness.engine.getReadModel())
    const thread = readModel.threads.find(entry => entry.id === ThreadId.makeUnsafe('thread-1'))
    return (
      thread?.activities.some(activity => activity.kind === 'provider.turn.start.failed') ?? false
    )
  })

  expect(harness.startSession).not.toHaveBeenCalled()
  expect(harness.sendTurn).not.toHaveBeenCalled()

  const readModel = await Effect.runPromise(harness.engine.getReadModel())
  const thread = readModel.threads.find(entry => entry.id === ThreadId.makeUnsafe('thread-1'))
  expect(thread?.session).toBeNull()
  expect(
    thread?.activities.find(activity => activity.kind === 'provider.turn.start.failed')
  ).toMatchObject({
    summary: 'Provider turn start failed',
    payload: {
      detail: expect.stringContaining("cannot switch to 'claudeAgent'"),
    },
  })
})
