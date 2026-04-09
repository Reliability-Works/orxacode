import { MessageId, TurnId } from '@orxa-code/contracts'
import { describe, expect, it } from 'vitest'

import {
  deriveActiveWorkStartedAt,
  deriveCompletionDividerBeforeEntryId,
  deriveTimelineEntries,
  hasToolActivityForTurn,
  isLatestTurnSettled,
  PROVIDER_OPTIONS,
} from './session-logic'
import { makeActivity } from './session-logic.test.helpers'

describe('deriveTimelineEntries', () => {
  it('includes proposed plans alongside messages and work entries in chronological order', () => {
    const entries = deriveTimelineEntries(
      [
        {
          id: MessageId.makeUnsafe('message-1'),
          role: 'assistant',
          text: 'hello',
          createdAt: '2026-02-23T00:00:01.000Z',
          streaming: false,
        },
      ],
      [
        {
          id: 'plan:thread-1:turn:turn-1',
          turnId: TurnId.makeUnsafe('turn-1'),
          planMarkdown: '# Ship it',
          implementedAt: null,
          implementationThreadId: null,
          createdAt: '2026-02-23T00:00:02.000Z',
          updatedAt: '2026-02-23T00:00:02.000Z',
        },
      ],
      [
        {
          id: 'work-1',
          createdAt: '2026-02-23T00:00:03.000Z',
          label: 'Ran tests',
          tone: 'tool',
        },
      ]
    )

    expect(entries.map(entry => entry.kind)).toEqual(['message', 'proposed-plan', 'work'])
    expect(entries[1]).toMatchObject({
      kind: 'proposed-plan',
      proposedPlan: {
        planMarkdown: '# Ship it',
        implementedAt: null,
        implementationThreadId: null,
      },
    })
  })

  it('anchors the completion divider to latestTurn.assistantMessageId before timestamp fallback', () => {
    const entries = deriveTimelineEntries(
      [
        {
          id: MessageId.makeUnsafe('assistant-earlier'),
          role: 'assistant',
          text: 'progress update',
          createdAt: '2026-02-23T00:00:01.000Z',
          streaming: false,
        },
        {
          id: MessageId.makeUnsafe('assistant-final'),
          role: 'assistant',
          text: 'final answer',
          createdAt: '2026-02-23T00:00:01.000Z',
          streaming: false,
        },
      ],
      [],
      []
    )

    expect(
      deriveCompletionDividerBeforeEntryId(entries, {
        assistantMessageId: MessageId.makeUnsafe('assistant-final'),
        startedAt: '2026-02-23T00:00:00.000Z',
        completedAt: '2026-02-23T00:00:02.000Z',
      })
    ).toBe('assistant-final')
  })
})

describe('hasToolActivityForTurn', () => {
  it('returns false when turn id is missing', () => {
    const activities = [
      makeActivity({ id: 'tool-1', turnId: 'turn-1', kind: 'tool.completed', tone: 'tool' }),
    ]

    expect(hasToolActivityForTurn(activities, undefined)).toBe(false)
    expect(hasToolActivityForTurn(activities, null)).toBe(false)
  })

  it('returns true only for matching tool activity in the target turn', () => {
    const activities = [
      makeActivity({ id: 'tool-1', turnId: 'turn-1', kind: 'tool.completed', tone: 'tool' }),
      makeActivity({ id: 'info-1', turnId: 'turn-2', kind: 'turn.completed', tone: 'info' }),
    ]

    expect(hasToolActivityForTurn(activities, TurnId.makeUnsafe('turn-1'))).toBe(true)
    expect(hasToolActivityForTurn(activities, TurnId.makeUnsafe('turn-2'))).toBe(false)
  })
})

describe('isLatestTurnSettled', () => {
  const latestTurn = {
    turnId: TurnId.makeUnsafe('turn-1'),
    startedAt: '2026-02-27T21:10:00.000Z',
    completedAt: '2026-02-27T21:10:06.000Z',
  } as const

  it('returns true for a fresh thread with no latest turn', () => {
    expect(
      isLatestTurnSettled(null, {
        orchestrationStatus: 'ready',
        activeTurnId: undefined,
      })
    ).toBe(true)
  })

  it('returns false while the same turn is still active in a running session', () => {
    expect(
      isLatestTurnSettled(latestTurn, {
        orchestrationStatus: 'running',
        activeTurnId: TurnId.makeUnsafe('turn-1'),
      })
    ).toBe(false)
  })

  it('returns false while any turn is running to avoid stale latest-turn banners', () => {
    expect(
      isLatestTurnSettled(latestTurn, {
        orchestrationStatus: 'running',
        activeTurnId: TurnId.makeUnsafe('turn-2'),
      })
    ).toBe(false)
  })

  it('returns true once the session is no longer running that turn', () => {
    expect(
      isLatestTurnSettled(latestTurn, {
        orchestrationStatus: 'ready',
        activeTurnId: undefined,
      })
    ).toBe(true)
  })

  it('returns false when turn timestamps are incomplete', () => {
    expect(
      isLatestTurnSettled(
        {
          turnId: TurnId.makeUnsafe('turn-1'),
          startedAt: null,
          completedAt: '2026-02-27T21:10:06.000Z',
        },
        null
      )
    ).toBe(false)
  })
})

describe('deriveActiveWorkStartedAt', () => {
  const latestTurn = {
    turnId: TurnId.makeUnsafe('turn-1'),
    startedAt: '2026-02-27T21:10:00.000Z',
    completedAt: '2026-02-27T21:10:06.000Z',
  } as const

  it('prefers the in-flight turn start when the latest turn is not settled', () => {
    expect(
      deriveActiveWorkStartedAt(
        latestTurn,
        {
          orchestrationStatus: 'running',
          activeTurnId: TurnId.makeUnsafe('turn-1'),
        },
        '2026-02-27T21:11:00.000Z'
      )
    ).toBe('2026-02-27T21:10:00.000Z')
  })

  it('falls back to sendStartedAt once the latest turn is settled', () => {
    expect(
      deriveActiveWorkStartedAt(
        latestTurn,
        {
          orchestrationStatus: 'ready',
          activeTurnId: undefined,
        },
        '2026-02-27T21:11:00.000Z'
      )
    ).toBe('2026-02-27T21:11:00.000Z')
  })

  it('uses sendStartedAt for a fresh send after the prior turn completed', () => {
    expect(
      deriveActiveWorkStartedAt(
        {
          turnId: TurnId.makeUnsafe('turn-1'),
          startedAt: '2026-02-27T21:10:00.000Z',
          completedAt: '2026-02-27T21:10:06.000Z',
        },
        null,
        '2026-02-27T21:11:00.000Z'
      )
    ).toBe('2026-02-27T21:11:00.000Z')
  })
})

describe('PROVIDER_OPTIONS', () => {
  it('advertises Claude and Opencode as available while keeping Cursor as a placeholder', () => {
    const claude = PROVIDER_OPTIONS.find(option => option.value === 'claudeAgent')
    const cursor = PROVIDER_OPTIONS.find(option => option.value === 'cursor')
    expect(PROVIDER_OPTIONS).toEqual([
      { value: 'codex', label: 'Codex', available: true },
      { value: 'claudeAgent', label: 'Claude', available: true },
      { value: 'opencode', label: 'Opencode', available: true },
      { value: 'cursor', label: 'Cursor', available: false },
    ])
    expect(claude).toEqual({
      value: 'claudeAgent',
      label: 'Claude',
      available: true,
    })
    expect(cursor).toEqual({
      value: 'cursor',
      label: 'Cursor',
      available: false,
    })
  })
})
