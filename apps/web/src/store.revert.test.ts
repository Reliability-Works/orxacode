import { CheckpointRef, EventId, MessageId, ThreadId, TurnId } from '@orxa-code/contracts'
import { expect, it } from 'vitest'

import { applyOrchestrationEvent } from './store'
import { makeEvent, makeState, makeThread } from './store.test.helpers'

const revertMessages = [
  {
    id: MessageId.makeUnsafe('user-1'),
    role: 'user' as const,
    text: 'first',
    turnId: TurnId.makeUnsafe('turn-1'),
    createdAt: '2026-02-27T00:00:00.000Z',
    completedAt: '2026-02-27T00:00:00.000Z',
    streaming: false,
  },
  {
    id: MessageId.makeUnsafe('assistant-1'),
    role: 'assistant' as const,
    text: 'first reply',
    turnId: TurnId.makeUnsafe('turn-1'),
    createdAt: '2026-02-27T00:00:01.000Z',
    completedAt: '2026-02-27T00:00:01.000Z',
    streaming: false,
  },
  {
    id: MessageId.makeUnsafe('user-2'),
    role: 'user' as const,
    text: 'second',
    turnId: TurnId.makeUnsafe('turn-2'),
    createdAt: '2026-02-27T00:00:02.000Z',
    completedAt: '2026-02-27T00:00:02.000Z',
    streaming: false,
  },
]

const revertPlans = [
  {
    id: 'plan-1',
    turnId: TurnId.makeUnsafe('turn-1'),
    planMarkdown: 'plan 1',
    implementedAt: null,
    implementationThreadId: null,
    createdAt: '2026-02-27T00:00:00.000Z',
    updatedAt: '2026-02-27T00:00:00.000Z',
  },
  {
    id: 'plan-2',
    turnId: TurnId.makeUnsafe('turn-2'),
    planMarkdown: 'plan 2',
    implementedAt: null,
    implementationThreadId: null,
    createdAt: '2026-02-27T00:00:02.000Z',
    updatedAt: '2026-02-27T00:00:02.000Z',
  },
]

const revertActivities = [
  {
    id: EventId.makeUnsafe('activity-1'),
    tone: 'info' as const,
    kind: 'step',
    summary: 'one',
    payload: {},
    turnId: TurnId.makeUnsafe('turn-1'),
    createdAt: '2026-02-27T00:00:00.000Z',
  },
  {
    id: EventId.makeUnsafe('activity-2'),
    tone: 'info' as const,
    kind: 'step',
    summary: 'two',
    payload: {},
    turnId: TurnId.makeUnsafe('turn-2'),
    createdAt: '2026-02-27T00:00:02.000Z',
  },
]

const revertTurnDiffSummaries = [
  {
    turnId: TurnId.makeUnsafe('turn-1'),
    completedAt: '2026-02-27T00:00:01.000Z',
    status: 'ready' as const,
    checkpointTurnCount: 1,
    checkpointRef: CheckpointRef.makeUnsafe('ref-1'),
    files: [],
  },
  {
    turnId: TurnId.makeUnsafe('turn-2'),
    completedAt: '2026-02-27T00:00:03.000Z',
    status: 'ready' as const,
    checkpointTurnCount: 2,
    checkpointRef: CheckpointRef.makeUnsafe('ref-2'),
    files: [],
  },
]

function makeRevertState() {
  return makeState(
    makeThread({
      messages: revertMessages,
      proposedPlans: revertPlans,
      activities: revertActivities,
      turnDiffSummaries: revertTurnDiffSummaries,
    })
  )
}

it('reverts messages, plans, activities, and checkpoints by retained turns', () => {
  const state = makeRevertState()

  const next = applyOrchestrationEvent(
    state,
    makeEvent('thread.reverted', {
      threadId: ThreadId.makeUnsafe('thread-1'),
      turnCount: 1,
    })
  )

  expect(next.threads[0]?.messages.map(message => message.id)).toEqual(['user-1', 'assistant-1'])
  expect(next.threads[0]?.proposedPlans.map(plan => plan.id)).toEqual(['plan-1'])
  expect(next.threads[0]?.activities.map(activity => activity.id)).toEqual([
    EventId.makeUnsafe('activity-1'),
  ])
  expect(next.threads[0]?.turnDiffSummaries.map(summary => summary.turnId)).toEqual([
    TurnId.makeUnsafe('turn-1'),
  ])
})

it('clears pending source proposed plans after revert before a new session-set event', () => {
  const thread = makeThread({
    latestTurn: {
      turnId: TurnId.makeUnsafe('turn-2'),
      state: 'completed',
      requestedAt: '2026-02-27T00:00:02.000Z',
      startedAt: '2026-02-27T00:00:02.000Z',
      completedAt: '2026-02-27T00:00:03.000Z',
      assistantMessageId: MessageId.makeUnsafe('assistant-2'),
      sourceProposedPlan: {
        threadId: ThreadId.makeUnsafe('thread-source'),
        planId: 'plan-2' as never,
      },
    },
    pendingSourceProposedPlan: {
      threadId: ThreadId.makeUnsafe('thread-source'),
      planId: 'plan-2' as never,
    },
    turnDiffSummaries: [
      {
        turnId: TurnId.makeUnsafe('turn-1'),
        completedAt: '2026-02-27T00:00:01.000Z',
        status: 'ready',
        checkpointTurnCount: 1,
        checkpointRef: CheckpointRef.makeUnsafe('ref-1'),
        files: [],
      },
      {
        turnId: TurnId.makeUnsafe('turn-2'),
        completedAt: '2026-02-27T00:00:03.000Z',
        status: 'ready',
        checkpointTurnCount: 2,
        checkpointRef: CheckpointRef.makeUnsafe('ref-2'),
        files: [],
      },
    ],
  })
  const reverted = applyOrchestrationEvent(
    makeState(thread),
    makeEvent('thread.reverted', {
      threadId: thread.id,
      turnCount: 1,
    })
  )

  expect(reverted.threads[0]?.pendingSourceProposedPlan).toBeUndefined()

  const next = applyOrchestrationEvent(
    reverted,
    makeEvent('thread.session-set', {
      threadId: thread.id,
      session: {
        threadId: thread.id,
        status: 'running',
        providerName: 'codex',
        providerSessionId: null,
        providerThreadId: 'codex-thread-1',
        runtimeMode: 'full-access',
        activeTurnId: TurnId.makeUnsafe('turn-3'),
        lastError: null,
        updatedAt: '2026-02-27T00:00:04.000Z',
      },
    })
  )

  expect(next.threads[0]?.latestTurn).toMatchObject({
    turnId: TurnId.makeUnsafe('turn-3'),
    state: 'running',
  })
  expect(next.threads[0]?.latestTurn?.sourceProposedPlan).toBeUndefined()
})
