import { describe, expect, it } from 'vitest'
import { formatCheckoutBranchError, parseGitDiffStats } from './useGitPanel'

describe('parseGitDiffStats', () => {
  it('counts additions/deletions from standard diff output', () => {
    const output = [
      '## Untracked',
      '',
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1,2 @@',
      '+const a = 1;',
      '+const b = 2;',
    ].join('\n')

    expect(parseGitDiffStats(output)).toEqual({
      additions: 2,
      deletions: 0,
      filesChanged: 1,
      hasChanges: true,
    })
  })

  it('counts untracked files when backend returns porcelain markers', () => {
    const output = ['## Untracked', '', '?? foo.txt', '?? src/new.ts'].join('\n')
    expect(parseGitDiffStats(output)).toEqual({
      additions: 2,
      deletions: 0,
      filesChanged: 2,
      hasChanges: true,
    })
  })

  it('counts untracked files from inline fallback output', () => {
    const output = '## Untracked ?? foo.txt ?? src/new.ts ?? src/three.ts'
    expect(parseGitDiffStats(output)).toEqual({
      additions: 3,
      deletions: 0,
      filesChanged: 3,
      hasChanges: true,
    })
  })
})

describe('formatCheckoutBranchError', () => {
  it('returns an actionable message when checkout is blocked by local changes', () => {
    const message = formatCheckoutBranchError(
      new Error(
        'git checkout staging exited with code 1: error: Your local changes to the following files would be overwritten by checkout'
      ),
      'staging'
    )
    expect(message).toContain(
      'Cannot switch to "staging" because local changes would be overwritten'
    )
  })

  it('returns a worktree-specific message when branch is checked out elsewhere', () => {
    const message = formatCheckoutBranchError(
      new Error(
        "git checkout staging exited with code 128: fatal: 'staging' is already checked out at '/Users/callumspencer/Repos/macapp/OpencodeOrxa-staging'"
      ),
      'staging'
    )
    expect(message).toContain(
      'Cannot switch to "staging" because it is already checked out in another worktree.'
    )
  })

  it('maps branch already exists errors to a retry hint', () => {
    const message = formatCheckoutBranchError(
      new Error("fatal: a branch named 'staging' already exists"),
      'staging'
    )
    expect(message).toBe('Branch "staging" already exists. Try selecting it again to switch.')
  })

  it('strips command boilerplate and returns raw fallback message', () => {
    const message = formatCheckoutBranchError(
      new Error('git checkout foo exited with code 1: fatal: something unexpected happened'),
      'foo'
    )
    expect(message).toBe('fatal: something unexpected happened')
  })
})
