import { describe, expect, it } from 'vitest'
import {
  buildDelegationEventBlocks,
  buildTimelineBlocks,
  type InternalEvent,
  type TimelineEvent,
} from './message-feed-timeline'

describe('message-feed-timeline helpers', () => {
  it('groups contiguous exploration timeline events into summary blocks', () => {
    const events: TimelineEvent[] = [
      { id: 'read-1', kind: 'read', label: 'Read src/App.tsx' },
      { id: 'search-1', kind: 'search', label: 'Searched for MessageFeed' },
      { id: 'edit-1', kind: 'edit', label: 'Edited src/components/MessageFeed.tsx' },
      { id: 'list-1', kind: 'list', label: 'Scanned src/components' },
    ]

    const blocks = buildTimelineBlocks(events)

    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toMatchObject({
      type: 'exploration',
      summary: 'Explored 1 file, 1 search',
    })
    expect(blocks[1]).toMatchObject({
      type: 'event',
      entry: { id: 'edit-1' },
    })
    expect(blocks[2]).toMatchObject({
      type: 'exploration',
      summary: 'Explored 1 search',
    })
  })

  it('builds delegation blocks with exploration summaries and normal events', () => {
    const events: InternalEvent[] = [
      { id: 'read-1', summary: 'Read file', kind: 'read' },
      { id: 'list-1', summary: 'Scanned folder', kind: 'list' },
      { id: 'event-1', summary: 'Step finished' },
      { id: 'search-1', summary: 'Found match', kind: 'search' },
    ]

    const blocks = buildDelegationEventBlocks(events)

    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toMatchObject({
      type: 'exploration',
      summary: 'Explored 1 file, 1 search',
    })
    expect(blocks[1]).toMatchObject({
      type: 'event',
      entry: { id: 'event-1', summary: 'Step finished' },
    })
    expect(blocks[2]).toMatchObject({
      type: 'exploration',
      summary: 'Explored 1 search',
    })
  })
})
