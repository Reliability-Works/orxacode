import { ThreadId, ProjectId } from '@orxa-code/contracts'
import { describe, expect, it } from 'vitest'

import { getFallbackThreadIdAfterArchive } from './useThreadActions.logic'

describe('getFallbackThreadIdAfterArchive', () => {
  it('returns the next visible thread in the same project when one exists', () => {
    const projectId = ProjectId.makeUnsafe('project-1')
    const archivedThreadId = ThreadId.makeUnsafe('thread-1')
    const fallbackThreadId = ThreadId.makeUnsafe('thread-2')

    expect(
      getFallbackThreadIdAfterArchive({
        threads: [
          {
            id: archivedThreadId,
            projectId,
            createdAt: '2026-04-10T10:00:00.000Z',
            updatedAt: '2026-04-10T10:00:00.000Z',
            archivedAt: null,
            latestUserMessageAt: null,
            messages: [],
          },
          {
            id: fallbackThreadId,
            projectId,
            createdAt: '2026-04-10T10:01:00.000Z',
            updatedAt: '2026-04-10T10:01:00.000Z',
            archivedAt: null,
            latestUserMessageAt: null,
            messages: [],
          },
        ],
        archivedThreadId,
        sortOrder: 'created_at',
      })
    ).toBe(fallbackThreadId)
  })

  it('returns null when archiving the last visible thread in a project', () => {
    const projectId = ProjectId.makeUnsafe('project-1')
    const archivedThreadId = ThreadId.makeUnsafe('thread-1')
    const alreadyArchivedThreadId = ThreadId.makeUnsafe('thread-archived')

    expect(
      getFallbackThreadIdAfterArchive({
        threads: [
          {
            id: archivedThreadId,
            projectId,
            createdAt: '2026-04-10T10:00:00.000Z',
            updatedAt: '2026-04-10T10:00:00.000Z',
            archivedAt: null,
            latestUserMessageAt: null,
            messages: [],
          },
          {
            id: alreadyArchivedThreadId,
            projectId,
            createdAt: '2026-04-10T09:00:00.000Z',
            updatedAt: '2026-04-10T09:00:00.000Z',
            archivedAt: '2026-04-10T09:30:00.000Z',
            latestUserMessageAt: null,
            messages: [],
          },
        ],
        archivedThreadId,
        sortOrder: 'created_at',
      })
    ).toBeNull()
  })
})
