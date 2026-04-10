import { describe, expect, it } from 'vitest'

import { deriveChatThreadRouteState } from './chatThreadRouteState'

describe('deriveChatThreadRouteState', () => {
  it('derives route existence for an existing thread', () => {
    const result = deriveChatThreadRouteState({
      threadExists: true,
      draftThreadExists: false,
    })

    expect(result.routeThreadExists).toBe(true)
  })

  it('treats an existing draft thread as a valid route target', () => {
    const result = deriveChatThreadRouteState({
      threadExists: false,
      draftThreadExists: true,
    })

    expect(result.routeThreadExists).toBe(true)
  })
})
