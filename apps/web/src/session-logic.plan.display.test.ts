import { TurnId } from '@orxa-code/contracts'
import { describe, expect, it } from 'vitest'

import { deriveDisplayActivePlanState } from './session-logic.plan'

describe('deriveDisplayActivePlanState interrupt handling', () => {
  it('marks in-progress steps as paused when the session is interrupted', () => {
    expect(
      deriveDisplayActivePlanState(
        {
          createdAt: '2026-02-23T00:00:08.000Z',
          turnId: TurnId.makeUnsafe('turn-6'),
          steps: [
            { step: 'Inspect server events', status: 'inProgress' },
            { step: 'Trace renderer state', status: 'pending' },
          ],
        },
        {
          orchestrationStatus: 'interrupted',
          latestTurnState: 'interrupted',
        }
      )
    ).toEqual({
      createdAt: '2026-02-23T00:00:08.000Z',
      turnId: 'turn-6',
      steps: [
        { step: 'Inspect server events', status: 'paused' },
        { step: 'Trace renderer state', status: 'pending' },
      ],
    })
  })
})

describe('deriveDisplayActivePlanState running handling', () => {
  it('leaves active plans unchanged while the session is still running', () => {
    expect(
      deriveDisplayActivePlanState(
        {
          createdAt: '2026-02-23T00:00:08.000Z',
          turnId: TurnId.makeUnsafe('turn-6'),
          steps: [{ step: 'Inspect server events', status: 'inProgress' }],
        },
        {
          orchestrationStatus: 'running',
          latestTurnState: 'running',
        }
      )
    ).toEqual({
      createdAt: '2026-02-23T00:00:08.000Z',
      turnId: 'turn-6',
      steps: [{ step: 'Inspect server events', status: 'inProgress' }],
    })
  })

  it('infers the first pending step as in progress while the session is running', () => {
    expect(
      deriveDisplayActivePlanState(
        {
          createdAt: '2026-02-23T00:00:08.000Z',
          turnId: TurnId.makeUnsafe('turn-6'),
          steps: [
            { step: 'Inspect server events', status: 'pending' },
            { step: 'Trace renderer state', status: 'pending' },
          ],
        },
        {
          orchestrationStatus: 'running',
          latestTurnState: 'running',
        }
      )
    ).toEqual({
      createdAt: '2026-02-23T00:00:08.000Z',
      turnId: 'turn-6',
      steps: [
        { step: 'Inspect server events', status: 'inProgress' },
        { step: 'Trace renderer state', status: 'pending' },
      ],
    })
  })
})

describe('deriveDisplayActivePlanState non-running handling', () => {
  it('marks in-progress steps as paused when only the latest turn is interrupted', () => {
    expect(
      deriveDisplayActivePlanState(
        {
          createdAt: '2026-02-23T00:00:08.000Z',
          turnId: TurnId.makeUnsafe('turn-6'),
          steps: [{ step: 'Inspect server events', status: 'inProgress' }],
        },
        {
          orchestrationStatus: 'ready',
          latestTurnState: 'interrupted',
        }
      )
    ).toEqual({
      createdAt: '2026-02-23T00:00:08.000Z',
      turnId: 'turn-6',
      steps: [{ step: 'Inspect server events', status: 'paused' }],
    })
  })

  it('marks in-progress steps as paused when the session is ready and no longer running', () => {
    expect(
      deriveDisplayActivePlanState(
        {
          createdAt: '2026-02-23T00:00:08.000Z',
          turnId: TurnId.makeUnsafe('turn-6'),
          steps: [{ step: 'Inspect server events', status: 'inProgress' }],
        },
        {
          orchestrationStatus: 'ready',
          latestTurnState: 'completed',
        }
      )
    ).toEqual({
      createdAt: '2026-02-23T00:00:08.000Z',
      turnId: 'turn-6',
      steps: [{ step: 'Inspect server events', status: 'paused' }],
    })
  })

  it('infers the first pending step as paused when the session is no longer running', () => {
    expect(
      deriveDisplayActivePlanState(
        {
          createdAt: '2026-02-23T00:00:08.000Z',
          turnId: TurnId.makeUnsafe('turn-6'),
          steps: [
            { step: 'Inspect server events', status: 'pending' },
            { step: 'Trace renderer state', status: 'pending' },
          ],
        },
        {
          orchestrationStatus: 'ready',
          latestTurnState: 'completed',
        }
      )
    ).toEqual({
      createdAt: '2026-02-23T00:00:08.000Z',
      turnId: 'turn-6',
      steps: [
        { step: 'Inspect server events', status: 'paused' },
        { step: 'Trace renderer state', status: 'pending' },
      ],
    })
  })
})
