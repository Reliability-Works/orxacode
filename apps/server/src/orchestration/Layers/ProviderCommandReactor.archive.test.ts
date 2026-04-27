import { CommandId, ThreadId } from '@orxa-code/contracts'
import { Effect } from 'effect'
import { expect, it } from 'vitest'

import { asTurnId, createHarness, waitFor } from './ProviderCommandReactor.test.helpers.ts'

const setRunningSession = async (
  harness: Awaited<ReturnType<typeof createHarness>>,
  commandId: string,
  now: string
) => {
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.session.set',
      commandId: CommandId.makeUnsafe(commandId),
      threadId: ThreadId.makeUnsafe('thread-1'),
      session: {
        threadId: ThreadId.makeUnsafe('thread-1'),
        status: 'running',
        providerName: 'codex',
        runtimeMode: 'approval-required',
        activeTurnId: asTurnId('turn-1'),
        lastError: null,
        updatedAt: now,
      },
      createdAt: now,
    })
  )
}

const findThread = async (harness: Awaited<ReturnType<typeof createHarness>>) =>
  (await Effect.runPromise(harness.engine.getReadModel())).threads.find(
    entry => entry.id === ThreadId.makeUnsafe('thread-1')
  )

it('stops the provider session when a thread is archived', async () => {
  const harness = await createHarness()
  const now = new Date().toISOString()

  await setRunningSession(harness, 'cmd-session-set-for-archive', now)

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.archive',
      commandId: CommandId.makeUnsafe('cmd-thread-archive'),
      threadId: ThreadId.makeUnsafe('thread-1'),
    })
  )

  await waitFor(() => harness.stopSession.mock.calls.length === 1)
  expect(harness.stopSession.mock.calls[0]?.[0]).toEqual({ threadId: 'thread-1' })

  await waitFor(async () => {
    const thread = await findThread(harness)
    return thread?.session?.status === 'stopped'
  })
  const thread = await findThread(harness)
  expect(thread?.session?.status).toBe('stopped')
  expect(thread?.archivedAt).not.toBeNull()
})

it('stops the provider session when a thread is deleted', async () => {
  const harness = await createHarness()
  const now = new Date().toISOString()

  await setRunningSession(harness, 'cmd-session-set-for-delete', now)

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.delete',
      commandId: CommandId.makeUnsafe('cmd-thread-delete'),
      threadId: ThreadId.makeUnsafe('thread-1'),
    })
  )

  await waitFor(() => harness.stopSession.mock.calls.length === 1)
  expect(harness.stopSession.mock.calls[0]?.[0]).toEqual({ threadId: 'thread-1' })
})

it('does not call stopSession when archiving a thread without an active session', async () => {
  const harness = await createHarness()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.archive',
      commandId: CommandId.makeUnsafe('cmd-thread-archive-no-session'),
      threadId: ThreadId.makeUnsafe('thread-1'),
    })
  )

  await harness.drain()
  expect(harness.stopSession.mock.calls.length).toBe(0)
})
