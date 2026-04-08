import { describe, expect, it } from 'vitest'

import { resolveThreadStatusPill } from './Sidebar.logic'
import { OrchestrationLatestTurn } from '@orxa-code/contracts'

function makeLatestTurn(overrides?: {
  completedAt?: string | null
  startedAt?: string | null
}): OrchestrationLatestTurn {
  return {
    turnId: 'turn-1' as never,
    state: 'completed',
    assistantMessageId: null,
    requestedAt: '2026-03-09T10:00:00.000Z',
    startedAt: overrides?.startedAt ?? '2026-03-09T10:00:00.000Z',
    completedAt: overrides?.completedAt ?? '2026-03-09T10:05:00.000Z',
  }
}

const baseThread = {
  interactionMode: 'plan' as const,
  latestTurn: null,
  lastVisitedAt: undefined,
  proposedPlans: [],
  session: {
    provider: 'codex' as const,
    status: 'running' as const,
    createdAt: '2026-03-09T10:00:00.000Z',
    updatedAt: '2026-03-09T10:00:00.000Z',
    orchestrationStatus: 'running' as const,
  },
}

const settledSession = {
  ...baseThread.session,
  status: 'ready' as const,
  orchestrationStatus: 'ready' as const,
}

describe('resolveThreadStatusPill > running thread states', () => {
  it('shows pending approval before all other statuses', () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: true,
        hasPendingUserInput: true,
      })
    ).toMatchObject({ label: 'Pending Approval', pulse: false })
  })

  it('shows awaiting input when plan mode is blocked on user answers', () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: false,
        hasPendingUserInput: true,
      })
    ).toMatchObject({ label: 'Awaiting Input', pulse: false })
  })

  it('falls back to working when the thread is actively running without blockers', () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      })
    ).toMatchObject({ label: 'Working', pulse: true })
  })
})

describe('resolveThreadStatusPill > settled thread states', () => {
  it('shows plan ready when a settled plan turn has a proposed plan ready for follow-up', () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          latestTurn: makeLatestTurn(),
          proposedPlans: [
            {
              id: 'plan-1' as never,
              turnId: 'turn-1' as never,
              createdAt: '2026-03-09T10:00:00.000Z',
              updatedAt: '2026-03-09T10:05:00.000Z',
              planMarkdown: '# Plan',
              implementedAt: null,
              implementationThreadId: null,
            },
          ],
          session: settledSession,
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      })
    ).toMatchObject({ label: 'Plan Ready', pulse: false })
  })

  it('does not show plan ready after the proposed plan was implemented elsewhere', () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          latestTurn: makeLatestTurn(),
          proposedPlans: [
            {
              id: 'plan-1' as never,
              turnId: 'turn-1' as never,
              createdAt: '2026-03-09T10:00:00.000Z',
              updatedAt: '2026-03-09T10:05:00.000Z',
              planMarkdown: '# Plan',
              implementedAt: '2026-03-09T10:06:00.000Z',
              implementationThreadId: 'thread-implement' as never,
            },
          ],
          session: settledSession,
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      })
    ).toMatchObject({ label: 'Completed', pulse: false })
  })

  it('shows completed when there is an unseen completion and no active blocker', () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          interactionMode: 'default',
          latestTurn: makeLatestTurn(),
          lastVisitedAt: '2026-03-09T10:04:00.000Z',
          session: settledSession,
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      })
    ).toMatchObject({ label: 'Completed', pulse: false })
  })
})
