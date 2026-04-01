import { describe, expect, it } from 'vitest'
import {
  extractMetaFileDiffSummary,
  extractPatchSummary,
  extractWriteFileSummary,
} from './message-feed-patch-summary'

describe('message-feed-patch-summary', () => {
  it('summarizes apply_patch style multi-file diffs', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/a.ts',
      '-old',
      '+new',
      '*** Add File: src/b.ts',
      '+hello',
      '*** End Patch',
    ].join('\n')

    expect(extractPatchSummary(patch, null, '/repo')).toBe('src/a.ts +1 | -1 (+1 more file)')
  })

  it('summarizes git-style diffs', () => {
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '+const a = 1;',
      '-const a = 0;',
    ].join('\n')

    expect(extractPatchSummary(null, patch, '/repo')).toBe('src/a.ts +1 | -1')
  })

  it('returns null when no patch content is present', () => {
    expect(extractPatchSummary({ command: 'ls -la' }, 'done', '/repo')).toBeNull()
  })

  it('summarizes nested metadata file diffs and merges duplicate file stats', () => {
    const metadata = {
      filediff: { file: '/repo/src/a.ts', additions: 1.2, deletions: 2.8 },
      metadata: {
        files: [
          { filepath: '/repo/src/a.ts', added: 2, removed: -3 },
          { path: '/repo/src/b.ts', insertions: 3, removals: 1 },
        ],
      },
    }

    expect(extractMetaFileDiffSummary(metadata, '/repo')).toBe('src/a.ts +3 | -3 (+1 more file)')
  })

  it('summarizes created file writes using normalized content line count', () => {
    const summary = extractWriteFileSummary(
      { filePath: '/repo/new.ts', content: 'a\r\nb\r\n' },
      { exists: false, filepath: '/repo/new.ts' },
      '/repo'
    )

    expect(summary).toEqual({
      verb: 'Created',
      summary: 'new.ts +3 | -0',
    })
  })

  it('summarizes edited file writes when file already exists', () => {
    const summary = extractWriteFileSummary(
      { path: '/repo/new.ts', content: 'x' },
      { exists: true, filepath: '/repo/new.ts' },
      '/repo'
    )

    expect(summary).toEqual({
      verb: 'Edited',
      summary: 'new.ts',
    })
  })

  it('returns null for write-file summary when file path is unavailable', () => {
    expect(extractWriteFileSummary({ content: 'x' }, { exists: false }, '/repo')).toBeNull()
  })
})
