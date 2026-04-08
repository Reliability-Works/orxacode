import { describe, expect, it } from 'vitest'
import { getProjectSortTimestamp, sortProjectsForSidebar } from './Sidebar.logic'
import { ProjectId, ThreadId } from '@orxa-code/contracts'
import { makeProject, makeThread } from './Sidebar.logic.test.fixtures'

describe('sortProjectsForSidebar > sorts by most recent user message', () => {
  it('sorts projects by the most recent user message across their threads', () => {
    const projects = [
      makeProject({ id: ProjectId.makeUnsafe('project-1'), name: 'Older project' }),
      makeProject({ id: ProjectId.makeUnsafe('project-2'), name: 'Newer project' }),
    ]
    const threads = [
      makeThread({
        projectId: ProjectId.makeUnsafe('project-1'),
        updatedAt: '2026-03-09T10:20:00.000Z',
        messages: [
          {
            id: 'message-1' as never,
            role: 'user',
            text: 'older project user message',
            createdAt: '2026-03-09T10:01:00.000Z',
            streaming: false,
            completedAt: '2026-03-09T10:01:00.000Z',
          },
        ],
      }),
      makeThread({
        id: ThreadId.makeUnsafe('thread-2'),
        projectId: ProjectId.makeUnsafe('project-2'),
        updatedAt: '2026-03-09T10:05:00.000Z',
        messages: [
          {
            id: 'message-2' as never,
            role: 'user',
            text: 'newer project user message',
            createdAt: '2026-03-09T10:05:00.000Z',
            streaming: false,
            completedAt: '2026-03-09T10:05:00.000Z',
          },
        ],
      }),
    ]
    const sorted = sortProjectsForSidebar(projects, threads, 'updated_at')
    expect(sorted.map(project => project.id)).toEqual([
      ProjectId.makeUnsafe('project-2'),
      ProjectId.makeUnsafe('project-1'),
    ])
  })
})

describe('sortProjectsForSidebar > project-level timestamp fallbacks', () => {
  it('falls back to project timestamps when a project has no threads', () => {
    const sorted = sortProjectsForSidebar(
      [
        makeProject({
          id: ProjectId.makeUnsafe('project-1'),
          name: 'Older project',
          updatedAt: '2026-03-09T10:01:00.000Z',
        }),
        makeProject({
          id: ProjectId.makeUnsafe('project-2'),
          name: 'Newer project',
          updatedAt: '2026-03-09T10:05:00.000Z',
        }),
      ],
      [],
      'updated_at'
    )
    expect(sorted.map(project => project.id)).toEqual([
      ProjectId.makeUnsafe('project-2'),
      ProjectId.makeUnsafe('project-1'),
    ])
  })

  it('falls back to name and id ordering when projects have no sortable timestamps', () => {
    const sorted = sortProjectsForSidebar(
      [
        makeProject({
          id: ProjectId.makeUnsafe('project-2'),
          name: 'Beta',
          createdAt: undefined,
          updatedAt: undefined,
        }),
        makeProject({
          id: ProjectId.makeUnsafe('project-1'),
          name: 'Alpha',
          createdAt: undefined,
          updatedAt: undefined,
        }),
      ],
      [],
      'updated_at'
    )
    expect(sorted.map(project => project.id)).toEqual([
      ProjectId.makeUnsafe('project-1'),
      ProjectId.makeUnsafe('project-2'),
    ])
  })
})

describe('sortProjectsForSidebar > ignores archived threads', () => {
  it('ignores archived threads when sorting projects', () => {
    const sorted = sortProjectsForSidebar(
      [
        makeProject({
          id: ProjectId.makeUnsafe('project-1'),
          name: 'Visible project',
          updatedAt: '2026-03-09T10:01:00.000Z',
        }),
        makeProject({
          id: ProjectId.makeUnsafe('project-2'),
          name: 'Archived-only project',
          updatedAt: '2026-03-09T10:00:00.000Z',
        }),
      ],
      [
        makeThread({
          id: ThreadId.makeUnsafe('thread-visible'),
          projectId: ProjectId.makeUnsafe('project-1'),
          updatedAt: '2026-03-09T10:02:00.000Z',
          archivedAt: null,
        }),
        makeThread({
          id: ThreadId.makeUnsafe('thread-archived'),
          projectId: ProjectId.makeUnsafe('project-2'),
          updatedAt: '2026-03-09T10:10:00.000Z',
          archivedAt: '2026-03-09T10:11:00.000Z',
        }),
      ].filter(thread => thread.archivedAt === null),
      'updated_at'
    )
    expect(sorted.map(project => project.id)).toEqual([
      ProjectId.makeUnsafe('project-1'),
      ProjectId.makeUnsafe('project-2'),
    ])
  })
})

describe('sortProjectsForSidebar > manual ordering and timestamp helpers', () => {
  it('preserves manual project ordering', () => {
    const sorted = sortProjectsForSidebar(
      [
        makeProject({ id: ProjectId.makeUnsafe('project-2'), name: 'Second' }),
        makeProject({ id: ProjectId.makeUnsafe('project-1'), name: 'First' }),
      ],
      [],
      'manual'
    )
    expect(sorted.map(project => project.id)).toEqual([
      ProjectId.makeUnsafe('project-2'),
      ProjectId.makeUnsafe('project-1'),
    ])
  })
})

describe('sortProjectsForSidebar > getProjectSortTimestamp', () => {
  it('returns the project timestamp when no threads are present', () => {
    const timestamp = getProjectSortTimestamp(
      makeProject({ updatedAt: '2026-03-09T10:10:00.000Z' }),
      [],
      'updated_at'
    )
    expect(timestamp).toBe(Date.parse('2026-03-09T10:10:00.000Z'))
  })
})
