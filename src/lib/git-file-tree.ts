export type FileTreeNode<T extends { path: string }> = {
  name: string
  fullPath: string
  type: 'file' | 'folder'
  children: Array<FileTreeNode<T>>
  file?: T
}

export function buildFileTree<T extends { path: string }>(files: T[]): Array<FileTreeNode<T>> {
  const root: Array<FileTreeNode<T>> = []
  for (const file of files) {
    const parts = file.path.split('/')
    let siblings = root
    for (let i = 0; i < parts.length; i += 1) {
      const name = parts[i]!
      const isFile = i === parts.length - 1
      const fullPath = parts.slice(0, i + 1).join('/')
      let node = siblings.find(
        entry => entry.name === name && entry.type === (isFile ? 'file' : 'folder')
      )
      if (!node) {
        node = {
          name,
          fullPath,
          type: isFile ? 'file' : 'folder',
          children: [],
          file: isFile ? file : undefined,
        }
        siblings.push(node)
      }
      siblings = node.children
    }
  }

  const sortNodes = (nodes: Array<FileTreeNode<T>>) => {
    nodes.sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === 'folder' ? -1 : 1
      }
      return left.name.localeCompare(right.name)
    })
    for (const node of nodes) {
      sortNodes(node.children)
    }
  }
  sortNodes(root)
  return root
}

export function filterTreeNodes<T extends { path: string }>(
  nodes: Array<FileTreeNode<T>>,
  query: string
): Array<FileTreeNode<T>> {
  if (!query.trim()) {
    return nodes
  }
  const lower = query.toLowerCase()
  const result: Array<FileTreeNode<T>> = []
  for (const node of nodes) {
    if (node.type === 'file') {
      if (node.name.toLowerCase().includes(lower) || node.fullPath.toLowerCase().includes(lower)) {
        result.push(node)
      }
      continue
    }
    const filtered = filterTreeNodes(node.children, query)
    if (filtered.length > 0) {
      result.push({ ...node, children: filtered })
    }
  }
  return result
}
