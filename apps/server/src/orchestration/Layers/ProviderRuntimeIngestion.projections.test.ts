import { afterEach, it, expect } from 'vitest'

import { ApprovalRequestId, type ProviderRuntimeEvent } from '@orxa-code/contracts'

import {
  asEventId,
  asItemId,
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

it('projects context window updates into normalized thread activities', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()

  harness.emit({
    type: 'thread.token-usage.updated',
    eventId: asEventId('evt-thread-token-usage-updated'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    payload: {
      usage: {
        usedTokens: 1075,
        totalProcessedTokens: 10_200,
        maxTokens: 128_000,
        inputTokens: 1000,
        cachedInputTokens: 500,
        outputTokens: 50,
        reasoningOutputTokens: 25,
        lastUsedTokens: 1075,
        lastInputTokens: 1000,
        lastCachedInputTokens: 500,
        lastOutputTokens: 50,
        lastReasoningOutputTokens: 25,
        compactsAutomatically: true,
      },
    },
  })

  const thread = await waitForThread(harness.engine, entry =>
    entry.activities.some(activity => activity.kind === 'context-window.updated')
  )

  const usageActivity = thread.activities.find(
    activity => activity.kind === 'context-window.updated'
  )
  expect(usageActivity).toBeDefined()
  expect(usageActivity?.payload).toMatchObject({
    usedTokens: 1075,
    totalProcessedTokens: 10_200,
    maxTokens: 128_000,
    inputTokens: 1000,
    cachedInputTokens: 500,
    outputTokens: 50,
    reasoningOutputTokens: 25,
    lastUsedTokens: 1075,
    compactsAutomatically: true,
  })
})

it('projects Codex camelCase token usage payloads into normalized thread activities', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()

  harness.emit({
    type: 'thread.token-usage.updated',
    eventId: asEventId('evt-thread-token-usage-updated-camel'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    payload: {
      usage: {
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
      },
    },
  })

  const thread = await waitForThread(harness.engine, entry =>
    entry.activities.some(activity => activity.kind === 'context-window.updated')
  )

  const usageActivity = thread.activities.find(
    activity => activity.kind === 'context-window.updated'
  )
  expect(usageActivity?.payload).toMatchObject({
    usedTokens: 126,
    totalProcessedTokens: 11_839,
    maxTokens: 258_400,
    inputTokens: 120,
    cachedInputTokens: 0,
    outputTokens: 6,
    reasoningOutputTokens: 0,
    lastUsedTokens: 126,
    lastInputTokens: 120,
    lastOutputTokens: 6,
    compactsAutomatically: true,
  })
})

it('projects Claude usage snapshots with context window into normalized thread activities', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()

  harness.emit({
    type: 'thread.token-usage.updated',
    eventId: asEventId('evt-thread-token-usage-updated-claude-window'),
    provider: 'claudeAgent',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    payload: {
      usage: {
        usedTokens: 31_251,
        lastUsedTokens: 31_251,
        maxTokens: 200_000,
        toolUses: 25,
        durationMs: 43_567,
      },
    },
    raw: {
      source: 'claude.sdk.message',
      method: 'claude/result/success',
      payload: {},
    },
  })

  const thread = await waitForThread(harness.engine, entry =>
    entry.activities.some(activity => activity.kind === 'context-window.updated')
  )

  const usageActivity = thread.activities.find(
    activity => activity.kind === 'context-window.updated'
  )
  expect(usageActivity?.payload).toMatchObject({
    usedTokens: 31_251,
    lastUsedTokens: 31_251,
    maxTokens: 200_000,
    toolUses: 25,
    durationMs: 43_567,
  })
})

it('projects compacted thread state into context compaction activities', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()

  harness.emit({
    type: 'thread.state.changed',
    eventId: asEventId('evt-thread-compacted'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-1'),
    payload: {
      state: 'compacted',
      detail: { source: 'provider' },
    },
  })

  const thread = await waitForThread(harness.engine, entry =>
    entry.activities.some(activity => activity.kind === 'context-compaction')
  )

  const activity = thread.activities.find(candidate => candidate.kind === 'context-compaction')
  expect(activity?.summary).toBe('Context compacted')
  expect(activity?.tone).toBe('info')
})

function emitTaskLifecycleEvents(harness: Awaited<ReturnType<typeof createHarness>>, now: string) {
  harness.emit({
    type: 'task.started',
    eventId: asEventId('evt-task-started'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-task-1'),
    payload: { taskId: 'turn-task-1', taskType: 'plan' },
  })
  harness.emit({
    type: 'task.progress',
    eventId: asEventId('evt-task-progress'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-task-1'),
    payload: {
      taskId: 'turn-task-1',
      description: 'Comparing the desktop rollout chunks to the app-server stream.',
      summary: 'Code reviewer is validating the desktop rollout chunks.',
    },
  })
  harness.emit({
    type: 'task.completed',
    eventId: asEventId('evt-task-completed'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-task-1'),
    payload: {
      taskId: 'turn-task-1',
      status: 'completed',
      summary: '<proposed_plan>\n# Plan title\n</proposed_plan>',
    },
  })
  harness.emit({
    type: 'turn.proposed.completed',
    eventId: asEventId('evt-task-proposed-plan-completed'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-task-1'),
    payload: { planMarkdown: '# Plan title' },
  })
}

function asActivityPayloadObject(activity: { payload?: unknown } | undefined) {
  return activity?.payload && typeof activity.payload === 'object'
    ? (activity.payload as Record<string, unknown>)
    : undefined
}

async function assertTaskLifecycleActivities(harness: Awaited<ReturnType<typeof createHarness>>) {
  const thread = await waitForThread(
    harness.engine,
    entry =>
      entry.activities.some(activity => activity.kind === 'task.completed') &&
      entry.proposedPlans.some(proposedPlan => proposedPlan.id === 'plan:thread-1:turn:turn-task-1')
  )
  const started = thread.activities.find(activity => activity.id === 'evt-task-started')
  const progress = thread.activities.find(activity => activity.id === 'evt-task-progress')
  const completed = thread.activities.find(activity => activity.id === 'evt-task-completed')
  const progressPayload = asActivityPayloadObject(progress)
  const completedPayload = asActivityPayloadObject(completed)
  expect(started?.kind).toBe('task.started')
  expect(started?.summary).toBe('Plan task started')
  expect(progress?.kind).toBe('task.progress')
  expect(progressPayload?.detail).toBe('Code reviewer is validating the desktop rollout chunks.')
  expect(progressPayload?.summary).toBe('Code reviewer is validating the desktop rollout chunks.')
  expect(completed?.kind).toBe('task.completed')
  expect(completedPayload?.detail).toBe('<proposed_plan>\n# Plan title\n</proposed_plan>')
  expect(
    thread.proposedPlans.find(entry => entry.id === 'plan:thread-1:turn:turn-task-1')?.planMarkdown
  ).toBe('# Plan title')
}

it('projects Codex task lifecycle chunks into thread activities', async () => {
  const harness = await createHarness(refs)
  emitTaskLifecycleEvents(harness, new Date().toISOString())
  await assertTaskLifecycleActivities(harness)
})

it('projects structured user input request and resolution as thread activities', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()

  harness.emit({
    type: 'user-input.requested',
    eventId: asEventId('evt-user-input-requested'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-user-input'),
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
  })

  harness.emit({
    type: 'user-input.resolved',
    eventId: asEventId('evt-user-input-resolved'),
    provider: 'codex',
    createdAt: new Date().toISOString(),
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-user-input'),
    requestId: ApprovalRequestId.makeUnsafe('req-user-input-1'),
    payload: {
      answers: {
        sandbox_mode: 'workspace-write',
      },
    },
  })

  const thread = await waitForThread(
    harness.engine,
    entry =>
      entry.activities.some(activity => activity.kind === 'user-input.requested') &&
      entry.activities.some(activity => activity.kind === 'user-input.resolved')
  )

  const requested = thread.activities.find(activity => activity.id === 'evt-user-input-requested')
  expect(requested?.kind).toBe('user-input.requested')

  const resolved = thread.activities.find(activity => activity.id === 'evt-user-input-resolved')
  const resolvedPayload =
    resolved?.payload && typeof resolved.payload === 'object'
      ? (resolved.payload as Record<string, unknown>)
      : undefined
  expect(resolved?.kind).toBe('user-input.resolved')
  expect(resolvedPayload?.answers).toEqual({
    sandbox_mode: 'workspace-write',
  })
})

it('continues processing runtime events after a single event handler failure', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()

  harness.emit({
    type: 'content.delta',
    eventId: asEventId('evt-invalid-delta'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-invalid'),
    itemId: asItemId('item-invalid'),
    payload: {
      streamKind: 'assistant_text',
      delta: undefined,
    },
  } as unknown as ProviderRuntimeEvent)

  harness.emit({
    type: 'runtime.error',
    eventId: asEventId('evt-runtime-error-after-failure'),
    provider: 'codex',
    createdAt: new Date().toISOString(),
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-after-failure'),
    payload: {
      message: 'runtime still processed',
    },
  })

  const thread = await waitForThread(
    harness.engine,
    entry =>
      entry.session?.status === 'error' &&
      entry.session?.activeTurnId === 'turn-after-failure' &&
      entry.session?.lastError === 'runtime still processed'
  )
  expect(thread.session?.status).toBe('error')
  expect(thread.session?.lastError).toBe('runtime still processed')
})
