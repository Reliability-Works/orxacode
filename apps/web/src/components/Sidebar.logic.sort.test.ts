import { describe, expect, it } from 'vitest'
import { getFallbackThreadIdAfterDelete, getVisibleThreadsForProject } from './Sidebar.logic'
import { ProjectId, ThreadId } from '@orxa-code/contracts'
import { makeThread } from './Sidebar.logic.test.fixtures'

describe('getFallbackThreadIdAfterDelete', () => {
  it("returns the top remaining thread in the deleted thread's project sidebar order", () => {
    const fallbackThreadId = getFallbackThreadIdAfterDelete({
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe('thread-oldest'),
          projectId: ProjectId.makeUnsafe('project-1'),
          createdAt: '2026-03-09T10:00:00.000Z',
          messages: [],
        }),
        makeThread({
          id: ThreadId.makeUnsafe('thread-active'),
          projectId: ProjectId.makeUnsafe('project-1'),
          createdAt: '2026-03-09T10:05:00.000Z',
          messages: [],
        }),
        makeThread({
          id: ThreadId.makeUnsafe('thread-newest'),
          projectId: ProjectId.makeUnsafe('project-1'),
          createdAt: '2026-03-09T10:10:00.000Z',
          messages: [],
        }),
        makeThread({
          id: ThreadId.makeUnsafe('thread-other-project'),
          projectId: ProjectId.makeUnsafe('project-2'),
          createdAt: '2026-03-09T10:20:00.000Z',
          messages: [],
        }),
      ],
      deletedThreadId: ThreadId.makeUnsafe('thread-active'),
      sortOrder: 'created_at',
    })

    expect(fallbackThreadId).toBe(ThreadId.makeUnsafe('thread-newest'))
  })

  it('skips other threads being deleted in the same action', () => {
    const fallbackThreadId = getFallbackThreadIdAfterDelete({
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe('thread-active'),
          projectId: ProjectId.makeUnsafe('project-1'),
          createdAt: '2026-03-09T10:05:00.000Z',
          messages: [],
        }),
        makeThread({
          id: ThreadId.makeUnsafe('thread-newest'),
          projectId: ProjectId.makeUnsafe('project-1'),
          createdAt: '2026-03-09T10:10:00.000Z',
          messages: [],
        }),
        makeThread({
          id: ThreadId.makeUnsafe('thread-next'),
          projectId: ProjectId.makeUnsafe('project-1'),
          createdAt: '2026-03-09T10:07:00.000Z',
          messages: [],
        }),
      ],
      deletedThreadId: ThreadId.makeUnsafe('thread-active'),
      deletedThreadIds: new Set([
        ThreadId.makeUnsafe('thread-active'),
        ThreadId.makeUnsafe('thread-newest'),
      ]),
      sortOrder: 'created_at',
    })

    expect(fallbackThreadId).toBe(ThreadId.makeUnsafe('thread-next'))
  })
})

describe('getVisibleThreadsForProject', () => {
  it('includes the active thread even when it falls below the folded preview', () => {
    const threads = Array.from({ length: 8 }, (_, index) =>
      makeThread({
        id: ThreadId.makeUnsafe(`thread-${index + 1}`),
        title: `Thread ${index + 1}`,
      })
    )

    const result = getVisibleThreadsForProject({
      threads,
      activeThreadId: ThreadId.makeUnsafe('thread-8'),
      isThreadListExpanded: false,
      previewLimit: 6,
    })

    expect(result.hasHiddenThreads).toBe(true)
    expect(result.visibleThreads.map(thread => thread.id)).toEqual([
      ThreadId.makeUnsafe('thread-1'),
      ThreadId.makeUnsafe('thread-2'),
      ThreadId.makeUnsafe('thread-3'),
      ThreadId.makeUnsafe('thread-4'),
      ThreadId.makeUnsafe('thread-5'),
      ThreadId.makeUnsafe('thread-6'),
      ThreadId.makeUnsafe('thread-8'),
    ])
    expect(result.hiddenThreads.map(thread => thread.id)).toEqual([ThreadId.makeUnsafe('thread-7')])
  })

  it('returns all threads when the list is expanded', () => {
    const threads = Array.from({ length: 8 }, (_, index) =>
      makeThread({ id: ThreadId.makeUnsafe(`thread-${index + 1}`) })
    )

    const result = getVisibleThreadsForProject({
      threads,
      activeThreadId: ThreadId.makeUnsafe('thread-8'),
      isThreadListExpanded: true,
      previewLimit: 6,
    })

    expect(result.hasHiddenThreads).toBe(true)
    expect(result.visibleThreads.map(thread => thread.id)).toEqual(threads.map(thread => thread.id))
    expect(result.hiddenThreads).toEqual([])
  })
})
