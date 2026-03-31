/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { worktreeCoordinatorTestExports } from './worktree-coordinator-service'

describe('worktree-coordinator-service', () => {
  it('parses git worktree porcelain output into workspace worktrees', () => {
    const repoRoot = '/repo/project'
    const parsed = worktreeCoordinatorTestExports.parseWorktreeList(
      [
        'worktree /repo/project',
        'HEAD abc123',
        'branch refs/heads/main',
        '',
        'worktree /repo/project/.worktrees/feature__alpha',
        'HEAD def456',
        'branch refs/heads/feature/alpha',
        'locked',
      ].join('\n'),
      repoRoot
    )

    expect(parsed).toEqual([
      expect.objectContaining({
        directory: '/repo/project',
        repoRoot,
        branch: 'main',
        isMain: true,
      }),
      expect.objectContaining({
        directory: '/repo/project/.worktrees/feature__alpha',
        repoRoot,
        branch: 'feature/alpha',
        isMain: false,
        locked: true,
      }),
    ])
  })

  it('sanitizes worktree names for branch-safe and path-safe usage', () => {
    expect(worktreeCoordinatorTestExports.sanitizeWorktreeName(' Fix Login Redirect Loop ')).toBe(
      'Fix-Login-Redirect-Loop'
    )
    expect(worktreeCoordinatorTestExports.toWorktreeDirectoryName('feat/login-redirect-loop')).toBe(
      'feat__login-redirect-loop'
    )
  })
})
