import { EventId, type OrchestrationThreadActivity, TurnId } from '@orxa-code/contracts'
import { describe, expect, it } from 'vitest'

import { deriveLatestRateLimitSnapshot } from './rateLimits'

function makeActivity(
  id: string,
  kind: string,
  payload: unknown,
  createdAt = '2026-04-09T00:00:00.000Z'
): OrchestrationThreadActivity {
  return {
    id: EventId.makeUnsafe(id),
    tone: 'info',
    kind,
    summary: kind,
    payload,
    turnId: TurnId.makeUnsafe('turn-1'),
    createdAt,
  }
}

describe('deriveLatestRateLimitSnapshot', () => {
  it('uses the latest valid rate-limit activity summary', () => {
    const snapshot = deriveLatestRateLimitSnapshot([
      makeActivity('activity-1', 'rate-limits.updated', {
        remaining_requests: 9,
        reset_seconds: 300,
      }),
      makeActivity('activity-2', 'tool.started', {}),
      makeActivity(
        'activity-3',
        'rate-limits.updated',
        {
          remainingRequests: 4,
          resetSeconds: 45,
        },
        '2026-04-09T00:01:00.000Z'
      ),
    ])

    expect(snapshot).toEqual({
      summary: '4 requests left · resets in 45s',
      updatedAt: '2026-04-09T00:01:00.000Z',
    })
  })

  it('supports nested provider payloads and skips malformed newer entries', () => {
    const snapshot = deriveLatestRateLimitSnapshot([
      makeActivity(
        'activity-1',
        'rate-limits.updated',
        {
          opencode: {
            requests_remaining: 2,
            seconds_until_reset: 120,
          },
        },
        '2026-04-09T00:02:00.000Z'
      ),
      makeActivity(
        'activity-2',
        'rate-limits.updated',
        {
          provider: {
            remaining_requests: 'not-a-number',
          },
        },
        '2026-04-09T00:03:00.000Z'
      ),
    ])

    expect(snapshot).toEqual({
      summary: '2 requests left · resets in 2m',
      updatedAt: '2026-04-09T00:02:00.000Z',
    })
  })

  it('returns null when no usable rate-limit activity exists', () => {
    const snapshot = deriveLatestRateLimitSnapshot([
      makeActivity('activity-1', 'tool.started', {}),
      makeActivity('activity-2', 'rate-limits.updated', null),
    ])

    expect(snapshot).toBeNull()
  })
})
