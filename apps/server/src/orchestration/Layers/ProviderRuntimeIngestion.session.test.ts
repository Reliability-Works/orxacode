import { afterEach, it, expect } from 'vitest'

import { Effect } from 'effect'

import { CommandId, ThreadId } from '@orxa-code/contracts'

import {
  asEventId,
  asThreadId,
  asTurnId,
  createHarness,
  createRuntimeRefs,
  disposeRuntimeRefs,
  waitForThread,
} from './ProviderRuntimeIngestion.test.helpers.ts'

const refs = createRuntimeRefs()
afterEach(async () => {
  await disposeRuntimeRefs(refs)
})

it('maps turn started/completed events into thread session updates', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()

  harness.emit({
    type: 'turn.started',
    eventId: asEventId('evt-turn-started'),
    provider: 'codex',
    threadId: asThreadId('thread-1'),
    createdAt: now,
    turnId: asTurnId('turn-1'),
  })

  await waitForThread(
    harness.engine,
    thread => thread.session?.status === 'running' && thread.session?.activeTurnId === 'turn-1'
  )

  harness.emit({
    type: 'turn.completed',
    eventId: asEventId('evt-turn-completed'),
    provider: 'codex',
    threadId: asThreadId('thread-1'),
    createdAt: new Date().toISOString(),
    turnId: asTurnId('turn-1'),
    payload: {
      state: 'failed',
      errorMessage: 'turn failed',
    },
  })

  const thread = await waitForThread(
    harness.engine,
    entry =>
      entry.session?.status === 'error' &&
      entry.session?.activeTurnId === null &&
      entry.session?.lastError === 'turn failed'
  )
  expect(thread.session?.status).toBe('error')
  expect(thread.session?.lastError).toBe('turn failed')
})

interface SessionStateTransition {
  readonly eventIdSuffix: string
  readonly state: 'waiting' | 'error' | 'stopped' | 'ready'
  readonly reason?: string
  readonly expectedStatus: 'running' | 'error' | 'stopped' | 'ready'
  readonly expectedLastError: string | null
}

async function applySessionStateTransition(
  harness: Awaited<ReturnType<typeof createHarness>>,
  transition: SessionStateTransition,
  createdAt: string
) {
  harness.emit({
    type: 'session.state.changed',
    eventId: asEventId(`evt-session-state-${transition.eventIdSuffix}`),
    provider: 'codex',
    threadId: asThreadId('thread-1'),
    createdAt,
    payload: {
      state: transition.state,
      ...(transition.reason !== undefined ? { reason: transition.reason } : {}),
    },
  })

  const thread = await waitForThread(
    harness.engine,
    entry =>
      entry.session?.status === transition.expectedStatus &&
      entry.session?.activeTurnId === null &&
      entry.session?.lastError === transition.expectedLastError
  )
  expect(thread.session?.status).toBe(transition.expectedStatus)
  expect(thread.session?.lastError).toBe(transition.expectedLastError)
}

it('applies provider session.state.changed transitions directly', async () => {
  const harness = await createHarness(refs)
  const transitions: ReadonlyArray<SessionStateTransition> = [
    {
      eventIdSuffix: 'waiting',
      state: 'waiting',
      reason: 'awaiting approval',
      expectedStatus: 'running',
      expectedLastError: null,
    },
    {
      eventIdSuffix: 'error',
      state: 'error',
      reason: 'provider crashed',
      expectedStatus: 'error',
      expectedLastError: 'provider crashed',
    },
    {
      eventIdSuffix: 'stopped',
      state: 'stopped',
      expectedStatus: 'stopped',
      expectedLastError: 'provider crashed',
    },
    {
      eventIdSuffix: 'ready',
      state: 'ready',
      expectedStatus: 'ready',
      expectedLastError: null,
    },
  ]
  for (const transition of transitions) {
    await applySessionStateTransition(harness, transition, new Date().toISOString())
  }
})

it('does not clear active turn when session/thread started arrives mid-turn', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()

  harness.emit({
    type: 'turn.started',
    eventId: asEventId('evt-turn-started-midturn-lifecycle'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-midturn-lifecycle'),
  })

  await waitForThread(
    harness.engine,
    thread =>
      thread.session?.status === 'running' &&
      thread.session?.activeTurnId === 'turn-midturn-lifecycle'
  )

  harness.emit({
    type: 'thread.started',
    eventId: asEventId('evt-thread-started-midturn-lifecycle'),
    provider: 'codex',
    createdAt: new Date().toISOString(),
    threadId: asThreadId('thread-1'),
  })
  harness.emit({
    type: 'session.started',
    eventId: asEventId('evt-session-started-midturn-lifecycle'),
    provider: 'codex',
    createdAt: new Date().toISOString(),
    threadId: asThreadId('thread-1'),
  })

  await harness.drain()
  const midReadModel = await Effect.runPromise(harness.engine.getReadModel())
  const midThread = midReadModel.threads.find(entry => entry.id === ThreadId.makeUnsafe('thread-1'))
  expect(midThread?.session?.status).toBe('running')
  expect(midThread?.session?.activeTurnId).toBe('turn-midturn-lifecycle')

  harness.emit({
    type: 'turn.completed',
    eventId: asEventId('evt-turn-completed-midturn-lifecycle'),
    provider: 'codex',
    createdAt: new Date().toISOString(),
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-midturn-lifecycle'),
    status: 'completed',
  })

  await waitForThread(
    harness.engine,
    thread => thread.session?.status === 'ready' && thread.session?.activeTurnId === null
  )
})

it('accepts claude turn lifecycle when seeded thread id is a synthetic placeholder', async () => {
  const harness = await createHarness(refs)
  const seededAt = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.session.set',
      commandId: CommandId.makeUnsafe('cmd-session-seed-claude-placeholder'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      session: {
        threadId: ThreadId.makeUnsafe('thread-1'),
        status: 'ready',
        providerName: 'claudeAgent',
        runtimeMode: 'approval-required',
        activeTurnId: null,
        updatedAt: seededAt,
        lastError: null,
      },
      createdAt: seededAt,
    })
  )

  harness.emit({
    type: 'turn.started',
    eventId: asEventId('evt-turn-started-claude-placeholder'),
    provider: 'claudeAgent',
    createdAt: new Date().toISOString(),
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-claude-placeholder'),
  })

  await waitForThread(
    harness.engine,
    thread =>
      thread.session?.status === 'running' &&
      thread.session?.activeTurnId === 'turn-claude-placeholder'
  )

  harness.emit({
    type: 'turn.completed',
    eventId: asEventId('evt-turn-completed-claude-placeholder'),
    provider: 'claudeAgent',
    createdAt: new Date().toISOString(),
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-claude-placeholder'),
    status: 'completed',
  })

  await waitForThread(
    harness.engine,
    thread => thread.session?.status === 'ready' && thread.session?.activeTurnId === null
  )
})

it('ignores auxiliary turn completions from a different provider thread', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()

  harness.emit({
    type: 'turn.started',
    eventId: asEventId('evt-turn-started-primary'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-primary'),
  })

  await waitForThread(
    harness.engine,
    thread =>
      thread.session?.status === 'running' && thread.session?.activeTurnId === 'turn-primary'
  )

  harness.emit({
    type: 'turn.completed',
    eventId: asEventId('evt-turn-completed-aux'),
    provider: 'codex',
    createdAt: new Date().toISOString(),
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-aux'),
    status: 'completed',
  })

  await harness.drain()
  const midReadModel = await Effect.runPromise(harness.engine.getReadModel())
  const midThread = midReadModel.threads.find(entry => entry.id === ThreadId.makeUnsafe('thread-1'))
  expect(midThread?.session?.status).toBe('running')
  expect(midThread?.session?.activeTurnId).toBe('turn-primary')

  harness.emit({
    type: 'turn.completed',
    eventId: asEventId('evt-turn-completed-primary'),
    provider: 'codex',
    createdAt: new Date().toISOString(),
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-primary'),
    status: 'completed',
  })

  await waitForThread(
    harness.engine,
    thread => thread.session?.status === 'ready' && thread.session?.activeTurnId === null
  )
})

it('ignores non-active turn completion when runtime omits thread id', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()

  harness.emit({
    type: 'turn.started',
    eventId: asEventId('evt-turn-started-guarded'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-guarded-main'),
  })

  await waitForThread(
    harness.engine,
    thread =>
      thread.session?.status === 'running' && thread.session?.activeTurnId === 'turn-guarded-main'
  )

  harness.emit({
    type: 'turn.completed',
    eventId: asEventId('evt-turn-completed-guarded-other'),
    provider: 'codex',
    createdAt: new Date().toISOString(),
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-guarded-other'),
    status: 'completed',
  })

  await harness.drain()
  const midReadModel = await Effect.runPromise(harness.engine.getReadModel())
  const midThread = midReadModel.threads.find(entry => entry.id === ThreadId.makeUnsafe('thread-1'))
  expect(midThread?.session?.status).toBe('running')
  expect(midThread?.session?.activeTurnId).toBe('turn-guarded-main')

  harness.emit({
    type: 'turn.completed',
    eventId: asEventId('evt-turn-completed-guarded-main'),
    provider: 'codex',
    createdAt: new Date().toISOString(),
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-guarded-main'),
    status: 'completed',
  })

  await waitForThread(
    harness.engine,
    thread => thread.session?.status === 'ready' && thread.session?.activeTurnId === null
  )
})
