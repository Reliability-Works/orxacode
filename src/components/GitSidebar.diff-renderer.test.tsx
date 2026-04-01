import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { GitSidebar } from './GitSidebar'

const patchDiffSpy = vi.hoisted(() => vi.fn())

vi.mock('@pierre/diffs/react', () => ({
  PatchDiff: (props: { patch: string; options?: { diffStyle?: string } }) => {
    patchDiffSpy(props)
    return (
      <div data-testid="pierre-diff" data-diff-style={props.options?.diffStyle ?? 'unknown'}>
        {props.patch}
      </div>
    )
  },
}))

const splitProps = {
  sidebarPanelTab: 'git' as const,
  setSidebarPanelTab: vi.fn(),
  gitPanelTab: 'diff' as const,
  setGitPanelTab: vi.fn(),
  gitPanelOutput: [
    '## Unstaged',
    'diff --git a/src/app.ts b/src/app.ts',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1 +1 @@',
    '-const a = 1;',
    '+const a = 2;',
    '## Staged',
    'diff --git a/src/app.ts b/src/app.ts',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -2 +2 @@',
    '-const b = 1;',
    '+const b = 2;',
  ].join('\n'),
  branchState: null,
  branchQuery: '',
  setBranchQuery: vi.fn(),
  activeProjectDir: '/repo',
  onLoadGitDiff: vi.fn(async () => undefined),
  onLoadGitLog: vi.fn(async () => undefined),
  onLoadGitIssues: vi.fn(async () => undefined),
  onLoadGitPrs: vi.fn(async () => undefined),
  gitDiffViewMode: 'split' as const,
  setGitDiffViewMode: vi.fn(),
  onStageAllChanges: vi.fn(async () => undefined),
  onDiscardAllChanges: vi.fn(async () => undefined),
  onStageFile: vi.fn(async () => undefined),
  onRestoreFile: vi.fn(async () => undefined),
  onUnstageFile: vi.fn(async () => undefined),
  onAddToChatPath: vi.fn(),
  onStatusChange: vi.fn(),
  fileProvenanceByPath: {},
}

describe('GitSidebar diff renderer', () => {
  beforeEach(() => {
    patchDiffSpy.mockClear()
    document.documentElement.setAttribute('data-theme', 'glass')
  })

  it('renders split sidebar sections with @pierre/diffs while keeping the file shell', () => {
    render(<GitSidebar {...splitProps} />)

    expect(screen.getByText('src/app.ts')).toBeInTheDocument()
    expect(screen.getByText('Unstaged')).toBeInTheDocument()
    expect(screen.getByText('Staged')).toBeInTheDocument()
    expect(screen.getByText(/Why this changed: Unknown provenance/i)).toBeInTheDocument()
    expect(screen.getAllByTitle('Stage')).toHaveLength(1)
    expect(screen.getAllByTitle('Restore')).toHaveLength(1)
    expect(screen.getAllByTitle('Unstage')).toHaveLength(1)
    expect(screen.getAllByTestId('pierre-diff')).toHaveLength(2)
    expect(patchDiffSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          diffStyle: 'split',
          disableFileHeader: true,
        }),
        disableWorkerPool: true,
        patch: expect.stringContaining('diff --git a/src/app.ts b/src/app.ts'),
      })
    )
  })

  it('switches the renderer to unified mode', () => {
    render(<GitSidebar {...splitProps} gitDiffViewMode="unified" />)

    expect(screen.getAllByTestId('pierre-diff')).toHaveLength(2)
    expect(screen.getAllByTestId('pierre-diff')[0]).toHaveAttribute('data-diff-style', 'unified')
  })

  it('keeps list mode on the custom Orxa view and does not render @pierre/diffs', () => {
    render(<GitSidebar {...splitProps} gitDiffViewMode="list" />)

    expect(screen.queryByTestId('pierre-diff')).not.toBeInTheDocument()
    expect(screen.getByText('app.ts')).toBeInTheDocument()
  })
})
