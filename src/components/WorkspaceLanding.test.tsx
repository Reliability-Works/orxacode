import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceLanding } from './WorkspaceLanding'

describe('WorkspaceLanding', () => {
  it('opens workspace details from the landing actions', () => {
    const onOpenWorkspaceDetail = vi.fn()

    render(
      <WorkspaceLanding
        workspaceName="project"
        activeWorkspaceWorktree={{
          directory: '/tmp/project/.worktrees/feature-a',
          label: 'feature-a',
          branch: 'feature-a',
          isMain: false,
        }}
        onPickSession={vi.fn()}
        onOpenWorkspaceDetail={onOpenWorkspaceDetail}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /workspace details/i }))

    expect(onOpenWorkspaceDetail).toHaveBeenCalledTimes(1)
  })
})
