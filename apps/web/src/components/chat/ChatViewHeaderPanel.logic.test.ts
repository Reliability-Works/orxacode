import { describe, expect, it } from 'vitest'

import type { GitDiffResult } from '@orxa-code/contracts'
import { getHeaderDiffStats } from './ChatViewHeaderPanel.logic'

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

describe('ChatViewHeaderPanel.logic', () => {
  it('uses only unstaged file stats for the header diff badge', () => {
    expect(
      getHeaderDiffStats(
        makeDiff({
          scopeSummaries: [
            {
              scope: 'unstaged',
              label: 'Unstaged',
              available: true,
              additions: 8,
              deletions: 2,
              fileCount: 1,
              baseRef: null,
              compareLabel: null,
            },
          ],
        }),
        'unstaged'
      )
    ).toEqual({ additions: 8, deletions: 2 })
  })

  it('returns null when diff data is unavailable', () => {
    expect(getHeaderDiffStats(undefined, 'unstaged')).toBeNull()
  })
})
