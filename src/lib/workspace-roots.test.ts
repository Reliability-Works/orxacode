import { describe, expect, it } from 'vitest'
import { collapseProjectsByWorkspaceRoot } from './workspace-roots'

describe('collapseProjectsByWorkspaceRoot', () => {
  it('prefers the root workspace entry and hides associated worktree project rows', () => {
    const projects = [
      {
        id: 'root',
        worktree: '/repo/project',
        name: 'project',
        source: 'local' as const,
      },
      {
        id: 'worktree',
        worktree: '/repo/project/.worktrees/feature-a',
        name: 'feature-a',
        source: 'local' as const,
      },
    ]

    expect(
      collapseProjectsByWorkspaceRoot(projects, {
        '/repo/project': '/repo/project',
        '/repo/project/.worktrees/feature-a': '/repo/project',
      })
    ).toEqual([
      expect.objectContaining({
        id: 'root',
        worktree: '/repo/project',
      }),
    ])
  })
})
