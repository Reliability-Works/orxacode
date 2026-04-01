import { describe, expect, it } from 'vitest'
import { buildFileTree, filterTreeNodes } from './git-file-tree'

type MockFile = {
  path: string
  key: string
}

describe('git-file-tree', () => {
  it('builds a sorted folder-first tree', () => {
    const files: MockFile[] = [
      { path: 'z.ts', key: 'z.ts' },
      { path: 'a/c.ts', key: 'a/c.ts' },
      { path: 'a/b.ts', key: 'a/b.ts' },
      { path: 'b/a.ts', key: 'b/a.ts' },
    ]

    const tree = buildFileTree(files)

    expect(tree.map(node => `${node.type}:${node.name}`)).toEqual([
      'folder:a',
      'folder:b',
      'file:z.ts',
    ])
    expect(tree[0]?.children.map(node => node.name)).toEqual(['b.ts', 'c.ts'])
  })

  it('filters file and full path matches while preserving folder ancestors', () => {
    const files: MockFile[] = [
      { path: 'src/components/Pane.tsx', key: 'pane' },
      { path: 'src/hooks/usePane.ts', key: 'usePane' },
      { path: 'docs/readme.md', key: 'readme' },
    ]

    const tree = buildFileTree(files)
    const filtered = filterTreeNodes(tree, 'usepane')

    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.name).toBe('src')
    expect(filtered[0]?.children[0]?.name).toBe('hooks')
    expect(filtered[0]?.children[0]?.children[0]?.name).toBe('usePane.ts')
  })

  it('returns original nodes when query is empty', () => {
    const files: MockFile[] = [
      { path: 'src/a.ts', key: 'a' },
      { path: 'src/b.ts', key: 'b' },
    ]
    const tree = buildFileTree(files)
    const filtered = filterTreeNodes(tree, '  ')
    expect(filtered).toBe(tree)
  })
})
