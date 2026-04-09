import { expect, it } from 'vitest'

import type { GitDiffResult } from '@orxa-code/contracts'
import { getVisibleDiffSections } from './GitDiffFileSections.logic'

function makeDiff(overrides: Partial<GitDiffResult> = {}): GitDiffResult {
  return {
    staged: [],
    unstaged: [],
    untracked: [],
    branch: null,
    scopeSummaries: [],
    totalAdditions: 0,
    totalDeletions: 0,
    ...overrides,
  }
}

it('shows unstaged and untracked sections for the unstaged scope', () => {
  const sections = getVisibleDiffSections(
    makeDiff({
      unstaged: [
        {
          path: 'src/app.ts',
          status: 'M',
          section: 'unstaged',
          additions: 1,
          deletions: 0,
          isBinary: false,
          patch: '',
          hunks: [],
        },
      ],
      untracked: [
        {
          path: 'notes.md',
          status: '?',
          section: 'untracked',
          additions: 0,
          deletions: 0,
          isBinary: false,
          patch: '',
          hunks: [],
        },
      ],
    }),
    'unstaged'
  )

  expect(sections.map(section => section.kind)).toEqual(['unstaged', 'untracked'])
})

it('shows only staged files for the staged scope', () => {
  const sections = getVisibleDiffSections(
    makeDiff({
      staged: [
        {
          path: 'src/app.ts',
          status: 'M',
          section: 'staged',
          additions: 1,
          deletions: 0,
          isBinary: false,
          patch: '',
          hunks: [],
        },
      ],
    }),
    'staged'
  )

  expect(sections.map(section => section.kind)).toEqual(['staged'])
})

it('shows branch compare files for the branch scope', () => {
  const sections = getVisibleDiffSections(
    makeDiff({
      branch: {
        headRef: 'feature/test',
        baseRef: 'origin/main',
        compareLabel: 'feature/test -> origin/main',
        files: [
          {
            path: 'src/app.ts',
            status: 'M',
            section: 'branch',
            additions: 1,
            deletions: 0,
            isBinary: false,
            patch: '',
            hunks: [],
          },
        ],
        additions: 1,
        deletions: 0,
        fileCount: 1,
      },
    }),
    'branch'
  )

  expect(sections.map(section => section.kind)).toEqual(['branch'])
  expect(sections[0]?.files[0]?.path).toBe('src/app.ts')
})
