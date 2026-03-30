import { ChevronDown, ChevronRight, FileText, Folder, Search } from 'lucide-react'
import type { GitDiffFile } from '../lib/git-diff'
import type { FileTreeNode } from '../lib/git-file-tree'

type GitSidebarTreeNodeProps = {
  node: FileTreeNode<GitDiffFile>
  depth: number
  expandedFolders: Record<string, boolean>
  setExpandedFolders: (updater: (current: Record<string, boolean>) => Record<string, boolean>) => void
  selectedDiffKey: string | null
  fileIndexByKey: Record<string, number>
  onSelectFile: (fileKey: string) => void
}

function GitSidebarTreeNode({
  node,
  depth,
  expandedFolders,
  setExpandedFolders,
  selectedDiffKey,
  fileIndexByKey,
  onSelectFile,
}: GitSidebarTreeNodeProps) {
  if (node.type === 'folder') {
    const isExpanded = expandedFolders[node.fullPath] !== false
    return (
      <div className="git-tree-group">
        <button
          type="button"
          className="git-tree-folder"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => setExpandedFolders(current => ({ ...current, [node.fullPath]: !isExpanded }))}
        >
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Folder size={14} />
          <span className="git-tree-name">{node.name}</span>
        </button>
        {isExpanded ? (
          <div>
            {node.children.map(child => (
              <GitSidebarTreeNode
                key={child.fullPath}
                node={child}
                depth={depth + 1}
                expandedFolders={expandedFolders}
                setExpandedFolders={setExpandedFolders}
                selectedDiffKey={selectedDiffKey}
                fileIndexByKey={fileIndexByKey}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <button
      type="button"
      className={`git-tree-file ${node.file && selectedDiffKey === node.file.key ? 'active' : ''}`.trim()}
      style={{ paddingLeft: `${depth * 16 + 22}px` }}
      onClick={() => {
        if (!node.file) {
          return
        }
        onSelectFile(node.file.key)
        const fileIndex = fileIndexByKey[node.file.key]
        if (typeof fileIndex === 'number') {
          document
            .getElementById(`diff-file-${fileIndex}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }}
    >
      <FileText size={14} />
      <span className="git-tree-name">{node.name}</span>
    </button>
  )
}

type GitSidebarTreeViewProps = {
  nodes: Array<FileTreeNode<GitDiffFile>>
  treeFilter: string
  setTreeFilter: (value: string) => void
  expandedFolders: Record<string, boolean>
  setExpandedFolders: (updater: (current: Record<string, boolean>) => Record<string, boolean>) => void
  selectedDiffKey: string | null
  fileIndexByKey: Record<string, number>
  onSelectFile: (fileKey: string) => void
}

export function GitSidebarTreeView({
  nodes,
  treeFilter,
  setTreeFilter,
  expandedFolders,
  setExpandedFolders,
  selectedDiffKey,
  fileIndexByKey,
  onSelectFile,
}: GitSidebarTreeViewProps) {
  return (
    <>
      <div className="git-tree-filter-wrap">
        <Search size={13} className="git-tree-filter-icon" />
        <input
          type="text"
          className="git-tree-filter"
          placeholder="Filter files..."
          value={treeFilter}
          onChange={event => setTreeFilter(event.target.value)}
        />
      </div>
      <div className="git-tree-scroll">
        {nodes.map(node => (
          <GitSidebarTreeNode
            key={node.fullPath}
            node={node}
            depth={0}
            expandedFolders={expandedFolders}
            setExpandedFolders={setExpandedFolders}
            selectedDiffKey={selectedDiffKey}
            fileIndexByKey={fileIndexByKey}
            onSelectFile={onSelectFile}
          />
        ))}
      </div>
    </>
  )
}
