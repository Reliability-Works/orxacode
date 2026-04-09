import { describe, expect, it } from 'vitest'

import { buildFilesTree, filterFilesTree } from './filesTree'

describe('filesTree', () => {
  it('builds a directory-first tree from flat project entries', () => {
    const tree = buildFilesTree([
      { path: 'src/app/page.tsx', kind: 'file', parentPath: 'src/app' },
      { path: 'src', kind: 'directory' },
      { path: 'src/app', kind: 'directory', parentPath: 'src' },
      { path: 'README.md', kind: 'file' },
    ])

    expect(tree.map(node => node.path)).toEqual(['src', 'README.md'])
    expect(tree[0]?.children.map(node => node.path)).toEqual(['src/app'])
    expect(tree[0]?.children[0]?.children.map(node => node.path)).toEqual(['src/app/page.tsx'])
  })

  it('filters to matching paths while preserving parent folders', () => {
    const tree = buildFilesTree([
      { path: 'src/components/Button.tsx', kind: 'file', parentPath: 'src/components' },
      { path: 'src/components', kind: 'directory', parentPath: 'src' },
      { path: 'src/utils/date.ts', kind: 'file', parentPath: 'src/utils' },
      { path: 'src/utils', kind: 'directory', parentPath: 'src' },
      { path: 'src', kind: 'directory' },
    ])

    const filtered = filterFilesTree(tree, 'button')

    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.path).toBe('src')
    expect(filtered[0]?.children[0]?.path).toBe('src/components')
    expect(filtered[0]?.children[0]?.children.map(node => node.path)).toEqual([
      'src/components/Button.tsx',
    ])
  })
})
