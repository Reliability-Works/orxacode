import { describe, expect, it } from 'vitest'

import { buildTurnDiffTree } from '../../lib/turnDiffTree'
import {
  buildExpansionState,
  collectDirectoryPaths,
  collectFilePaths,
} from './ChangedFilesTree.logic'

const TREE = buildTurnDiffTree([
  { path: 'docs/readme.md', additions: 1, deletions: 0 },
  { path: 'apps/web/src/app.tsx', additions: 2, deletions: 1 },
])

describe('ChangedFilesTree.logic', () => {
  it('collects nested directory and file paths from the diff tree', () => {
    expect(collectDirectoryPaths(TREE)).toEqual(['apps/web/src', 'docs'])
    expect(collectFilePaths(TREE)).toEqual(['apps/web/src/app.tsx', 'docs/readme.md'])
  })

  it('builds expansion state for every collected path', () => {
    expect(buildExpansionState(['a', 'b'], true)).toEqual({ a: true, b: true })
    expect(buildExpansionState(['a', 'b'], false)).toEqual({ a: false, b: false })
  })
})
