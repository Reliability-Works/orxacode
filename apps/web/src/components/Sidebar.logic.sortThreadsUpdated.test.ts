import { describe, expect, it } from 'vitest'
import { sortThreadsForSidebar } from './Sidebar.logic'
import { ThreadId } from '@orxa-code/contracts'
import { makeThread } from './Sidebar.logic.test.fixtures'

describe('sortThreadsForSidebar > updated_at sorts by latest user message', () => {
  it('sorts threads by the latest user message in recency mode', () => {
    const sorted = sortThreadsForSidebar(
      [
        makeThread({
          id: ThreadId.makeUnsafe('thread-1'),
          createdAt: '2026-03-09T10:00:00.000Z',
          updatedAt: '2026-03-09T10:10:00.000Z',
          messages: [
            {
              id: 'message-1' as never,
              role: 'user',
              text: 'older',
              createdAt: '2026-03-09T10:01:00.000Z',
              streaming: false,
              completedAt: '2026-03-09T10:01:00.000Z',
            },
          ],
        }),
        makeThread({
          id: ThreadId.makeUnsafe('thread-2'),
          createdAt: '2026-03-09T10:05:00.000Z',
          updatedAt: '2026-03-09T10:05:00.000Z',
          messages: [
            {
              id: 'message-2' as never,
              role: 'user',
              text: 'newer',
              createdAt: '2026-03-09T10:06:00.000Z',
              streaming: false,
              completedAt: '2026-03-09T10:06:00.000Z',
            },
          ],
        }),
      ],
      'updated_at'
    )
    expect(sorted.map(thread => thread.id)).toEqual([
      ThreadId.makeUnsafe('thread-2'),
      ThreadId.makeUnsafe('thread-1'),
    ])
  })
})

describe('sortThreadsForSidebar > updated_at fallbacks', () => {
  it('falls back to thread timestamps when there is no user message', () => {
    const sorted = sortThreadsForSidebar(
      [
        makeThread({
          id: ThreadId.makeUnsafe('thread-1'),
          createdAt: '2026-03-09T10:00:00.000Z',
          updatedAt: '2026-03-09T10:01:00.000Z',
          messages: [
            {
              id: 'message-1' as never,
              role: 'assistant',
              text: 'assistant only',
              createdAt: '2026-03-09T10:02:00.000Z',
              streaming: false,
              completedAt: '2026-03-09T10:02:00.000Z',
            },
          ],
        }),
        makeThread({
          id: ThreadId.makeUnsafe('thread-2'),
          createdAt: '2026-03-09T10:05:00.000Z',
          updatedAt: '2026-03-09T10:05:00.000Z',
          messages: [],
        }),
      ],
      'updated_at'
    )
    expect(sorted.map(thread => thread.id)).toEqual([
      ThreadId.makeUnsafe('thread-2'),
      ThreadId.makeUnsafe('thread-1'),
    ])
  })

  it('falls back to id ordering when threads have no sortable timestamps', () => {
    const sorted = sortThreadsForSidebar(
      [
        makeThread({
          id: ThreadId.makeUnsafe('thread-1'),
          createdAt: '' as never,
          updatedAt: undefined,
          messages: [],
        }),
        makeThread({
          id: ThreadId.makeUnsafe('thread-2'),
          createdAt: '' as never,
          updatedAt: undefined,
          messages: [],
        }),
      ],
      'updated_at'
    )
    expect(sorted.map(thread => thread.id)).toEqual([
      ThreadId.makeUnsafe('thread-2'),
      ThreadId.makeUnsafe('thread-1'),
    ])
  })
})

describe('sortThreadsForSidebar > created_at sort order', () => {
  it('can sort threads by createdAt when configured', () => {
    const sorted = sortThreadsForSidebar(
      [
        makeThread({
          id: ThreadId.makeUnsafe('thread-1'),
          createdAt: '2026-03-09T10:05:00.000Z',
          updatedAt: '2026-03-09T10:05:00.000Z',
        }),
        makeThread({
          id: ThreadId.makeUnsafe('thread-2'),
          createdAt: '2026-03-09T10:00:00.000Z',
          updatedAt: '2026-03-09T10:10:00.000Z',
        }),
      ],
      'created_at'
    )
    expect(sorted.map(thread => thread.id)).toEqual([
      ThreadId.makeUnsafe('thread-1'),
      ThreadId.makeUnsafe('thread-2'),
    ])
  })
})
