import type { ProjectEntry } from '@orxa-code/contracts'

export interface FilesTreeNode {
  readonly name: string
  readonly path: string
  readonly kind: ProjectEntry['kind']
  readonly children: FilesTreeNode[]
}

function sortNodes(nodes: FilesTreeNode[]) {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'directory' ? -1 : 1
    }
    return left.name.localeCompare(right.name)
  })
  for (const node of nodes) {
    sortNodes(node.children)
  }
}

export function buildFilesTree(entries: readonly ProjectEntry[]): FilesTreeNode[] {
  const root: FilesTreeNode[] = []

  for (const entry of entries) {
    const parts = entry.path.split('/').filter(Boolean)
    if (parts.length === 0) {
      continue
    }

    let siblings = root
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index]!
      const path = parts.slice(0, index + 1).join('/')
      const kind: ProjectEntry['kind'] = index === parts.length - 1 ? entry.kind : 'directory'

      let node = siblings.find(candidate => candidate.path === path)
      if (!node) {
        node = {
          name,
          path,
          kind,
          children: [],
        }
        siblings.push(node)
      }
      siblings = node.children
    }
  }

  sortNodes(root)
  return root
}

function filterNode(node: FilesTreeNode, normalizedQuery: string): FilesTreeNode | null {
  const matchesSelf =
    node.name.toLowerCase().includes(normalizedQuery) ||
    node.path.toLowerCase().includes(normalizedQuery)

  if (node.kind === 'file') {
    return matchesSelf ? node : null
  }

  if (matchesSelf) {
    return node
  }

  const children = node.children
    .map(child => filterNode(child, normalizedQuery))
    .filter((child): child is FilesTreeNode => child !== null)

  return children.length > 0 ? { ...node, children } : null
}

export function filterFilesTree(nodes: readonly FilesTreeNode[], query: string): FilesTreeNode[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery.length === 0) {
    return [...nodes]
  }

  return nodes
    .map(node => filterNode(node, normalizedQuery))
    .filter((node): node is FilesTreeNode => node !== null)
}
