import { describe, expect, it } from 'vitest'
import {
  inferStatusTag,
  parseGitDiffOutput,
  toDiffSections,
  type GitDiffFile,
} from './git-diff'

describe('git-diff parsing', () => {
  it('maps status tags', () => {
    expect(inferStatusTag('added')).toBe('A')
    expect(inferStatusTag('deleted')).toBe('D')
    expect(inferStatusTag('renamed')).toBe('R')
    expect(inferStatusTag('modified')).toBe('M')
  })

  it('parses empty and sentinel output messages', () => {
    expect(parseGitDiffOutput('')).toEqual({ files: [], message: 'No local changes.' })
    expect(parseGitDiffOutput('Loading diff...')).toEqual({ files: [], message: 'Loading diff...' })
    expect(parseGitDiffOutput('Not a git repository.')).toEqual({
      files: [],
      message: 'Not a git repository.',
    })
  })

  it('merges staged and unstaged chunks for the same file', () => {
    const output = [
      '## Unstaged',
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      '-const a = 1;',
      '+const a = 2;',
      '## Staged',
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -2 +2 @@',
      '-const b = 1;',
      '+const b = 2;',
    ].join('\n')

    const parsed = parseGitDiffOutput(output)
    expect(parsed.message).toBeUndefined()
    expect(parsed.files).toHaveLength(1)
    expect(parsed.files[0]).toMatchObject({
      path: 'src/a.ts',
      hasUnstaged: true,
      hasStaged: true,
      added: 2,
      removed: 2,
    })
  })

})

describe('git-diff sidebar sections', () => {
  it('builds section patch payloads for the sidebar renderer', () => {
    const file: GitDiffFile = {
      key: 'src/a.ts',
      path: 'src/a.ts',
      status: 'modified',
      added: 1,
      removed: 1,
      hasUnstaged: true,
      hasStaged: false,
      diffLines: [
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -10,2 +10,2 @@',
        ' const keep = true;',
        '-const before = 1;',
        '+const after = 2;',
      ],
      unstagedDiffLines: [
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -10,2 +10,2 @@',
        ' const keep = true;',
        '-const before = 1;',
        '+const after = 2;',
      ],
    }

    const sections = toDiffSections(file)
    expect(sections).toHaveLength(1)
    expect(sections[0]).toEqual({
      key: 'src/a.ts:unstaged',
      label: 'Unstaged',
      patch: [
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -10,2 +10,2 @@',
        ' const keep = true;',
        '-const before = 1;',
        '+const after = 2;',
      ].join('\n'),
    })
  })

  it('preserves separate staged and unstaged patch sections', () => {
    const file: GitDiffFile = {
      key: 'src/a.ts',
      path: 'src/a.ts',
      status: 'modified',
      added: 2,
      removed: 2,
      hasUnstaged: true,
      hasStaged: true,
      diffLines: [],
      unstagedDiffLines: ['diff --git a/src/a.ts b/src/a.ts', '@@ -1 +1 @@', '-a', '+b'],
      stagedDiffLines: ['diff --git a/src/a.ts b/src/a.ts', '@@ -2 +2 @@', '-c', '+d'],
    }

    expect(toDiffSections(file)).toEqual([
      {
        key: 'src/a.ts:unstaged',
        label: 'Unstaged',
        patch: 'diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-a\n+b',
      },
      {
        key: 'src/a.ts:staged',
        label: 'Staged',
        patch: 'diff --git a/src/a.ts b/src/a.ts\n@@ -2 +2 @@\n-c\n+d',
      },
    ])
  })
})
