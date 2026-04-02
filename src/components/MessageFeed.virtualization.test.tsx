import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UnifiedProjectedSessionPresentation } from '../lib/session-presentation'
import { MessageFeed } from './MessageFeed'

const virtualizedTimelineSpy = vi.fn()

vi.mock('./chat/VirtualizedTimeline', () => ({
  VirtualizedTimeline: (props: unknown) => {
    virtualizedTimelineSpy(props)
    return <div data-testid="virtualized-timeline" />
  },
}))

function createPresentation(rowCount: number): UnifiedProjectedSessionPresentation {
  return {
    provider: 'opencode',
    rows: Array.from({ length: rowCount }, (_, index) => ({
      id: `row-${index}`,
      kind: 'message' as const,
      role: 'assistant' as const,
      label: 'Orxa',
      timestamp: Date.now() + index,
      sections: [
        {
          id: `section-${index}`,
          type: 'text' as const,
          content: `row ${index}`,
        },
      ],
    })),
    latestActivity: null,
    latestActivityContent: null,
    placeholderTimestamp: Date.now(),
  }
}

describe('MessageFeed virtualization threshold', () => {
  it('keeps virtualization disabled for short timelines', () => {
    virtualizedTimelineSpy.mockClear()
    render(<MessageFeed presentation={createPresentation(12)} />)

    const props = virtualizedTimelineSpy.mock.calls.at(-1)?.[0] as { virtualize?: boolean }
    expect(props.virtualize).toBe(false)
  })

  it('enables virtualization for long timelines and preserves session anchoring key', () => {
    virtualizedTimelineSpy.mockClear()
    render(
      <MessageFeed presentation={createPresentation(120)} sessionId="opencode::/repo::session-1" />
    )

    const props = virtualizedTimelineSpy.mock.calls.at(-1)?.[0] as {
      virtualize?: boolean
      sessionId?: string
    }
    expect(props.virtualize).toBe(true)
    expect(props.sessionId).toBe('opencode::/repo::session-1')
  })
})
