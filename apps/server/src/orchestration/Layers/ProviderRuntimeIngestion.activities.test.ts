import { afterEach, it, expect } from 'vitest'

import { Effect } from 'effect'

import { ApprovalRequestId, ThreadId } from '@orxa-code/contracts'

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

it('maps canonical request events into approval activities with requestKind', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()

  harness.emit({
    type: 'request.opened',
    eventId: asEventId('evt-request-opened'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    requestId: ApprovalRequestId.makeUnsafe('req-open'),
    payload: {
      requestType: 'command_execution_approval',
      detail: 'pwd',
    },
  })

  harness.emit({
    type: 'request.resolved',
    eventId: asEventId('evt-request-resolved'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    requestId: ApprovalRequestId.makeUnsafe('req-open'),
    payload: {
      requestType: 'command_execution_approval',
      decision: 'accept',
    },
  })

  await waitForThread(
    harness.engine,
    entry =>
      entry.activities.some(activity => activity.kind === 'approval.requested') &&
      entry.activities.some(activity => activity.kind === 'approval.resolved')
  )

  const readModel = await Effect.runPromise(harness.engine.getReadModel())
  const thread = readModel.threads.find(entry => entry.id === ThreadId.makeUnsafe('thread-1'))
  expect(thread).toBeDefined()

  const requested = thread?.activities.find(activity => activity.id === 'evt-request-opened')
  const requestedPayload =
    requested?.payload && typeof requested.payload === 'object'
      ? (requested.payload as Record<string, unknown>)
      : undefined
  expect(requestedPayload?.requestKind).toBe('command')
  expect(requestedPayload?.requestType).toBe('command_execution_approval')

  const resolved = thread?.activities.find(activity => activity.id === 'evt-request-resolved')
  const resolvedPayload =
    resolved?.payload && typeof resolved.payload === 'object'
      ? (resolved.payload as Record<string, unknown>)
      : undefined
  expect(resolvedPayload?.requestKind).toBe('command')
  expect(resolvedPayload?.requestType).toBe('command_execution_approval')
})

it('maps runtime.error into errored session state', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()

  harness.emit({
    type: 'runtime.error',
    eventId: asEventId('evt-runtime-error'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-3'),
    payload: {
      message: 'runtime exploded',
    },
  })

  const thread = await waitForThread(
    harness.engine,
    entry =>
      entry.session?.status === 'error' &&
      entry.session?.activeTurnId === 'turn-3' &&
      entry.session?.lastError === 'runtime exploded'
  )
  expect(thread.session?.status).toBe('error')
  expect(thread.session?.lastError).toBe('runtime exploded')
})

it('records runtime.error activities from the typed payload message', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()

  harness.emit({
    type: 'runtime.error',
    eventId: asEventId('evt-runtime-error-activity'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-runtime-error-activity'),
    payload: {
      message: 'runtime activity exploded',
    },
  })

  const thread = await waitForThread(harness.engine, entry =>
    entry.activities.some(activity => activity.id === 'evt-runtime-error-activity')
  )
  const activity = thread.activities.find(entry => entry.id === 'evt-runtime-error-activity')
  const activityPayload =
    activity?.payload && typeof activity.payload === 'object'
      ? (activity.payload as Record<string, unknown>)
      : undefined

  expect(activity?.kind).toBe('runtime.error')
  expect(activityPayload?.message).toBe('runtime activity exploded')
})

it('keeps the session running when a runtime.warning arrives during an active turn', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()

  harness.emit({
    type: 'turn.started',
    eventId: asEventId('evt-warning-turn-started'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-warning'),
    payload: {},
  })

  harness.emit({
    type: 'runtime.warning',
    eventId: asEventId('evt-warning-runtime'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-warning'),
    payload: {
      message: 'Reconnecting... 2/5',
      detail: {
        willRetry: true,
      },
    },
  })

  const thread = await waitForThread(
    harness.engine,
    entry =>
      entry.session?.status === 'running' &&
      entry.session?.activeTurnId === 'turn-warning' &&
      entry.activities.some(
        activity => activity.id === 'evt-warning-runtime' && activity.kind === 'runtime.warning'
      )
  )
  expect(thread.session?.status).toBe('running')
  expect(thread.session?.activeTurnId).toBe('turn-warning')
  expect(thread.session?.lastError).toBeNull()
})

it('maps session/thread lifecycle and item.started into session/activity projections', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()

  harness.emit({
    type: 'session.started',
    eventId: asEventId('evt-session-started'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    message: 'session started',
  })
  harness.emit({
    type: 'thread.started',
    eventId: asEventId('evt-thread-started'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
  })
  harness.emit({
    type: 'item.started',
    eventId: asEventId('evt-tool-started'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-9'),
    payload: {
      itemType: 'command_execution',
      status: 'in_progress',
      title: 'Read file',
      detail: '/tmp/file.ts',
    },
  })

  const thread = await waitForThread(
    harness.engine,
    entry =>
      entry.session?.status === 'ready' &&
      entry.session?.activeTurnId === null &&
      entry.activities.some(activity => activity.kind === 'tool.started')
  )

  expect(thread.session?.status).toBe('ready')
  expect(thread.activities.some(activity => activity.kind === 'tool.started')).toBe(true)
})

function emitP1ThreadMetadataAndPlan(
  harness: Awaited<ReturnType<typeof createHarness>>,
  now: string
) {
  harness.emit({
    type: 'thread.metadata.updated',
    eventId: asEventId('evt-thread-metadata-updated'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    payload: { name: 'Renamed by provider', metadata: { source: 'provider' } },
  })
  harness.emit({
    type: 'turn.plan.updated',
    eventId: asEventId('evt-turn-plan-updated'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-p1'),
    payload: {
      explanation: 'Working through the plan',
      plan: [
        { step: 'Inspect files', status: 'completed' },
        { step: 'Apply patch', status: 'in_progress' },
      ],
    },
  })
}

function emitP1ToolWarningAndDiff(harness: Awaited<ReturnType<typeof createHarness>>, now: string) {
  harness.emit({
    type: 'item.updated',
    eventId: asEventId('evt-item-updated'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-p1'),
    itemId: asItemId('item-p1-tool'),
    payload: {
      itemType: 'command_execution',
      status: 'in_progress',
      title: 'Run tests',
      detail: 'bun test',
      data: { pid: 123 },
    },
  })
  harness.emit({
    type: 'runtime.warning',
    eventId: asEventId('evt-runtime-warning'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-p1'),
    payload: { message: 'Provider got slow', detail: { latencyMs: 1500 } },
  })
  harness.emit({
    type: 'turn.diff.updated',
    eventId: asEventId('evt-turn-diff-updated'),
    provider: 'codex',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-p1'),
    itemId: asItemId('item-p1-assistant'),
    payload: { unifiedDiff: 'diff --git a/file.txt b/file.txt\n+hello\n' },
  })
}

function asP1PayloadObject(activity: { payload?: unknown } | undefined) {
  return activity?.payload && typeof activity.payload === 'object'
    ? (activity.payload as Record<string, unknown>)
    : undefined
}

async function assertP1ThreadProjections(harness: Awaited<ReturnType<typeof createHarness>>) {
  const thread = await waitForThread(
    harness.engine,
    entry =>
      entry.title === 'Renamed by provider' &&
      entry.activities.some(activity => activity.kind === 'turn.plan.updated') &&
      entry.activities.some(activity => activity.kind === 'tool.updated') &&
      entry.activities.some(activity => activity.kind === 'runtime.warning') &&
      entry.checkpoints.some(checkpoint => checkpoint.turnId === 'turn-p1')
  )
  expect(thread.title).toBe('Renamed by provider')
  const planActivity = thread.activities.find(activity => activity.id === 'evt-turn-plan-updated')
  const planPayload = asP1PayloadObject(planActivity)
  expect(planActivity?.kind).toBe('turn.plan.updated')
  expect(Array.isArray(planPayload?.plan)).toBe(true)
  const toolUpdate = thread.activities.find(activity => activity.id === 'evt-item-updated')
  const toolUpdatePayload = asP1PayloadObject(toolUpdate)
  expect(toolUpdate?.kind).toBe('tool.updated')
  expect(toolUpdatePayload?.itemType).toBe('command_execution')
  expect(toolUpdatePayload?.status).toBe('in_progress')
  const warning = thread.activities.find(activity => activity.id === 'evt-runtime-warning')
  const warningPayload = asP1PayloadObject(warning)
  expect(warning?.kind).toBe('runtime.warning')
  expect(warningPayload?.message).toBe('Provider got slow')
  const checkpoint = thread.checkpoints.find(entry => entry.turnId === 'turn-p1')
  expect(checkpoint?.status).toBe('missing')
  expect(checkpoint?.assistantMessageId).toBe('assistant:item-p1-assistant')
  expect(checkpoint?.checkpointRef).toBe('provider-diff:evt-turn-diff-updated')
}

it('consumes P1 runtime events into thread metadata, diff checkpoints, and activities', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()
  emitP1ThreadMetadataAndPlan(harness, now)
  emitP1ToolWarningAndDiff(harness, now)
  await assertP1ThreadProjections(harness)
})

it('preserves completed tool data on activities so the web work log can extract commands and file changes', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()

  harness.emit({
    type: 'item.completed',
    eventId: asEventId('evt-opencode-tool-completed'),
    provider: 'opencode',
    createdAt: now,
    threadId: asThreadId('thread-1'),
    turnId: asTurnId('turn-opencode-tool'),
    itemId: asItemId('item-opencode-tool'),
    payload: {
      itemType: 'file_change',
      status: 'completed',
      title: 'Patch',
      detail: 'apps/web/src/session-logic.ts +1 more',
      data: {
        input: {
          filePath: 'apps/web/src/session-logic.ts',
        },
        result: {
          files: [
            { relativePath: 'apps/web/src/session-logic.ts' },
            { relativePath: 'apps/server/src/provider/Layers/OpencodeAdapter.pure.ts' },
          ],
        },
      },
    },
  })

  const thread = await waitForThread(harness.engine, entry =>
    entry.activities.some(activity => activity.id === 'evt-opencode-tool-completed')
  )
  const activity = thread.activities.find(entry => entry.id === 'evt-opencode-tool-completed')
  const activityPayload =
    activity?.payload && typeof activity.payload === 'object'
      ? (activity.payload as Record<string, unknown>)
      : undefined

  expect(activity?.kind).toBe('tool.completed')
  expect(activityPayload?.itemType).toBe('file_change')
  expect(activityPayload?.detail).toBe('apps/web/src/session-logic.ts +1 more')
  expect(activityPayload?.data).toMatchObject({
    input: {
      filePath: 'apps/web/src/session-logic.ts',
    },
    result: {
      files: [
        { relativePath: 'apps/web/src/session-logic.ts' },
        { relativePath: 'apps/server/src/provider/Layers/OpencodeAdapter.pure.ts' },
      ],
    },
  })
})
