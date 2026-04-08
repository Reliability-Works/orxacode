import { afterEach, it, expect } from 'vitest'

import { Effect, Stream } from 'effect'

import { CommandId, DEFAULT_PROVIDER_INTERACTION_MODE, ThreadId } from '@orxa-code/contracts'

import {
  asEventId,
  asItemId,
  asMessageId,
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

it('maps canonical content delta/item completed into finalized assistant messages', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()

  harness.emit({
    type: 'content.delta',
    eventId: asEventId('evt-message-delta-1'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-2'),
    itemId: asItemId('item-1'),
    payload: {
      streamKind: 'assistant_text',
      delta: 'hello',
    },
  })
  harness.emit({
    type: 'content.delta',
    eventId: asEventId('evt-message-delta-2'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-2'),
    itemId: asItemId('item-1'),
    payload: {
      streamKind: 'assistant_text',
      delta: ' world',
    },
  })
  harness.emit({
    type: 'item.completed',
    eventId: asEventId('evt-message-completed'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-2'),
    itemId: asItemId('item-1'),
    payload: {
      itemType: 'assistant_message',
      status: 'completed',
    },
  })

  const thread = await waitForThread(harness.engine, entry =>
    entry.messages.some(message => message.id === 'assistant:item-1' && !message.streaming)
  )
  const message = thread.messages.find(entry => entry.id === 'assistant:item-1')
  expect(message?.text).toBe('hello world')
  expect(message?.streaming).toBe(false)
})

it('uses assistant item completion detail when no assistant deltas were streamed', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()

  harness.emit({
    type: 'item.completed',
    eventId: asEventId('evt-assistant-item-completed-no-delta'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-no-delta'),
    itemId: asItemId('item-no-delta'),
    payload: {
      itemType: 'assistant_message',
      status: 'completed',
      detail: 'assistant-only final text',
    },
  })

  const thread = await waitForThread(harness.engine, entry =>
    entry.messages.some(message => message.id === 'assistant:item-no-delta' && !message.streaming)
  )
  const message = thread.messages.find(entry => entry.id === 'assistant:item-no-delta')
  expect(message?.text).toBe('assistant-only final text')
  expect(message?.streaming).toBe(false)
})

it('projects completed plan items into first-class proposed plans', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()

  harness.emit({
    type: 'turn.proposed.completed',
    eventId: asEventId('evt-plan-item-completed'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-plan-final'),
    payload: {
      planMarkdown: '## Ship plan\n\n- wire projection\n- render follow-up',
    },
  })

  const thread = await waitForThread(harness.engine, entry =>
    entry.proposedPlans.some(
      proposedPlan => proposedPlan.id === 'plan:thread-1:turn:turn-plan-final'
    )
  )
  const proposedPlan = thread.proposedPlans.find(
    entry => entry.id === 'plan:thread-1:turn:turn-plan-final'
  )
  expect(proposedPlan?.planMarkdown).toBe('## Ship plan\n\n- wire projection\n- render follow-up')
})

it('buffers assistant deltas by default until completion', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()

  harness.emit({
    type: 'turn.started',
    eventId: asEventId('evt-turn-started-buffered'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-buffered'),
  })
  await waitForThread(
    harness.engine,
    thread =>
      thread.session?.status === 'running' && thread.session?.activeTurnId === 'turn-buffered'
  )

  harness.emit({
    type: 'content.delta',
    eventId: asEventId('evt-message-delta-buffered'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-buffered'),
    itemId: asItemId('item-buffered'),
    payload: {
      streamKind: 'assistant_text',
      delta: 'buffer me',
    },
  })

  await harness.drain()
  const midReadModel = await Effect.runPromise(harness.engine.getReadModel())
  const midThread = midReadModel.threads.find(entry => entry.id === ThreadId.makeUnsafe('thread-1'))
  expect(midThread?.messages.some(message => message.id === 'assistant:item-buffered')).toBe(false)

  harness.emit({
    type: 'item.completed',
    eventId: asEventId('evt-message-completed-buffered'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-buffered'),
    itemId: asItemId('item-buffered'),
    payload: {
      itemType: 'assistant_message',
      status: 'completed',
    },
  })

  const thread = await waitForThread(harness.engine, entry =>
    entry.messages.some(message => message.id === 'assistant:item-buffered' && !message.streaming)
  )
  const message = thread.messages.find(entry => entry.id === 'assistant:item-buffered')
  expect(message?.text).toBe('buffer me')
  expect(message?.streaming).toBe(false)
})

async function dispatchStreamingTurnStart(
  harness: Awaited<ReturnType<typeof createHarness>>,
  now: string
) {
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.start',
      commandId: CommandId.makeUnsafe('cmd-turn-start-streaming-mode'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      message: {
        messageId: asMessageId('message-streaming-mode'),
        role: 'user',
        text: 'stream please',
        attachments: [],
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: 'approval-required',
      createdAt: now,
    })
  )
  await harness.drain()
  harness.emit({
    type: 'turn.started',
    eventId: asEventId('evt-turn-started-streaming-mode'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-streaming-mode'),
  })
  await waitForThread(
    harness.engine,
    thread =>
      thread.session?.status === 'running' && thread.session?.activeTurnId === 'turn-streaming-mode'
  )
}

async function emitAndAssertStreamingDelta(
  harness: Awaited<ReturnType<typeof createHarness>>,
  now: string
) {
  harness.emit({
    type: 'content.delta',
    eventId: asEventId('evt-message-delta-streaming-mode'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-streaming-mode'),
    itemId: asItemId('item-streaming-mode'),
    payload: { streamKind: 'assistant_text', delta: 'hello live' },
  })
  const liveThread = await waitForThread(harness.engine, entry =>
    entry.messages.some(
      message =>
        message.id === 'assistant:item-streaming-mode' &&
        message.streaming &&
        message.text === 'hello live'
    )
  )
  const liveMessage = liveThread.messages.find(
    entry => entry.id === 'assistant:item-streaming-mode'
  )
  expect(liveMessage?.streaming).toBe(true)
}

async function emitAndAssertStreamingFinal(
  harness: Awaited<ReturnType<typeof createHarness>>,
  now: string
) {
  harness.emit({
    type: 'item.completed',
    eventId: asEventId('evt-message-completed-streaming-mode'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-streaming-mode'),
    itemId: asItemId('item-streaming-mode'),
    payload: { itemType: 'assistant_message', status: 'completed', detail: 'hello live' },
  })
  const finalThread = await waitForThread(harness.engine, entry =>
    entry.messages.some(
      message => message.id === 'assistant:item-streaming-mode' && !message.streaming
    )
  )
  const finalMessage = finalThread.messages.find(
    entry => entry.id === 'assistant:item-streaming-mode'
  )
  expect(finalMessage?.text).toBe('hello live')
  expect(finalMessage?.streaming).toBe(false)
}

it('streams assistant deltas when thread.turn.start requests streaming mode', async () => {
  const harness = await createHarness(refs, { serverSettings: { enableAssistantStreaming: true } })
  const now = new Date().toISOString()
  await dispatchStreamingTurnStart(harness, now)
  await emitAndAssertStreamingDelta(harness, now)
  await emitAndAssertStreamingFinal(harness, now)
})

it('spills oversized buffered deltas and still finalizes full assistant text', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()
  const oversizedText = 'x'.repeat(40_000)

  harness.emit({
    type: 'turn.started',
    eventId: asEventId('evt-turn-started-buffer-spill'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-buffer-spill'),
  })
  await waitForThread(
    harness.engine,
    thread =>
      thread.session?.status === 'running' && thread.session?.activeTurnId === 'turn-buffer-spill'
  )

  harness.emit({
    type: 'content.delta',
    eventId: asEventId('evt-message-delta-buffer-spill'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-buffer-spill'),
    itemId: asItemId('item-buffer-spill'),
    payload: {
      streamKind: 'assistant_text',
      delta: oversizedText,
    },
  })
  harness.emit({
    type: 'item.completed',
    eventId: asEventId('evt-message-completed-buffer-spill'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-buffer-spill'),
    itemId: asItemId('item-buffer-spill'),
    payload: {
      itemType: 'assistant_message',
      status: 'completed',
    },
  })

  const thread = await waitForThread(harness.engine, entry =>
    entry.messages.some(
      message => message.id === 'assistant:item-buffer-spill' && !message.streaming
    )
  )
  const message = thread.messages.find(entry => entry.id === 'assistant:item-buffer-spill')
  expect(message?.text.length).toBe(oversizedText.length)
  expect(message?.text).toBe(oversizedText)
  expect(message?.streaming).toBe(false)
})

async function emitDedupTurnLifecycle(
  harness: Awaited<ReturnType<typeof createHarness>>,
  now: string
) {
  harness.emit({
    type: 'turn.started',
    eventId: asEventId('evt-turn-started-for-complete-dedup'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-complete-dedup'),
  })
  await waitForThread(
    harness.engine,
    thread =>
      thread.session?.status === 'running' && thread.session?.activeTurnId === 'turn-complete-dedup'
  )
  harness.emit({
    type: 'content.delta',
    eventId: asEventId('evt-message-delta-for-complete-dedup'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-complete-dedup'),
    itemId: asItemId('item-complete-dedup'),
    payload: { streamKind: 'assistant_text', delta: 'done' },
  })
  harness.emit({
    type: 'item.completed',
    eventId: asEventId('evt-message-completed-for-complete-dedup'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-complete-dedup'),
    itemId: asItemId('item-complete-dedup'),
    payload: { itemType: 'assistant_message', status: 'completed' },
  })
  harness.emit({
    type: 'turn.completed',
    eventId: asEventId('evt-turn-completed-for-complete-dedup'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-complete-dedup'),
    payload: { state: 'completed' },
  })
}

async function assertSingleDedupCompletionEvent(
  harness: Awaited<ReturnType<typeof createHarness>>
) {
  await waitForThread(
    harness.engine,
    thread =>
      thread.session?.status === 'ready' &&
      thread.session?.activeTurnId === null &&
      thread.messages.some(
        message => message.id === 'assistant:item-complete-dedup' && !message.streaming
      )
  )
  const events = await Effect.runPromise(
    Stream.runCollect(harness.engine.readEvents(0)).pipe(Effect.map(chunk => Array.from(chunk)))
  )
  const completionEvents = events.filter(event => {
    if (event.type !== 'thread.message-sent') {
      return false
    }
    return (
      event.payload.messageId === 'assistant:item-complete-dedup' &&
      event.payload.streaming === false
    )
  })
  expect(completionEvents).toHaveLength(1)
}

it('does not duplicate assistant completion when item.completed is followed by turn.completed', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()
  await emitDedupTurnLifecycle(harness, now)
  await assertSingleDedupCompletionEvent(harness)
})
