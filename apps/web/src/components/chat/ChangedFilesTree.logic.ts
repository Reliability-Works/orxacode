import { type TurnDiffTreeNode } from '../../lib/turnDiffTree'

export function collectDirectoryPaths(nodes: ReadonlyArray<TurnDiffTreeNode>): string[] {
  const paths: string[] = []
  for (const node of nodes) {
    if (node.kind !== 'directory') continue
    paths.push(node.path)
    paths.push(...collectDirectoryPaths(node.children))
  }
  return paths
}

export function collectFilePaths(nodes: ReadonlyArray<TurnDiffTreeNode>): string[] {
  const paths: string[] = []
  for (const node of nodes) {
    if (node.kind === 'file') {
      paths.push(node.path)
      continue
    }
    paths.push(...collectFilePaths(node.children))
  }
  return paths
}

export function buildExpansionState(
  paths: ReadonlyArray<string>,
  expanded: boolean
): Record<string, boolean> {
  const next: Record<string, boolean> = {}
  for (const pathValue of paths) {
    next[pathValue] = expanded
  }
  return next
}
