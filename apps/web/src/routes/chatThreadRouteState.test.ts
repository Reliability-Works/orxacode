import { ThreadId } from '@orxa-code/contracts'
import { describe, expect, it } from 'vitest'

import { deriveChatThreadRouteState } from './chatThreadRouteState'

describe('deriveChatThreadRouteState', () => {
  it('derives route existence and picks the most recently visited secondary thread', () => {
    const activeThreadId = ThreadId.makeUnsafe('thread-active')
    const secondaryThreadId = ThreadId.makeUnsafe('thread-secondary')

    const result = deriveChatThreadRouteState({
      threadId: activeThreadId,
      threadIds: [activeThreadId, secondaryThreadId],
      threadLastVisitedAtById: {
        [activeThreadId]: '2026-04-09T11:00:00.000Z',
        [secondaryThreadId]: '2026-04-09T12:00:00.000Z',
      },
      threadExists: true,
      draftThreadExists: false,
    })

    expect(result.routeThreadExists).toBe(true)
    expect(result.defaultSecondaryThreadId).toBe(secondaryThreadId)
  })

  it('treats an existing draft thread as a valid route target', () => {
    const activeThreadId = ThreadId.makeUnsafe('thread-draft')

    const result = deriveChatThreadRouteState({
      threadId: activeThreadId,
      threadIds: [],
      threadLastVisitedAtById: {},
      threadExists: false,
      draftThreadExists: true,
    })

    expect(result.routeThreadExists).toBe(true)
    expect(result.defaultSecondaryThreadId).toBeNull()
  })
})
