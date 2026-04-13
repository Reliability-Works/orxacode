import { useQuery } from '@tanstack/react-query'
import { ChevronDownIcon, ChevronRightIcon, FolderIcon, FolderOpenIcon } from 'lucide-react'
import { useMemo, useState, type Dispatch, type MouseEvent, type SetStateAction } from 'react'

import { projectListEntriesQueryOptions } from '../../lib/projectReactQuery'
import { useTheme } from '../../hooks/useTheme'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { VscodeEntryIcon } from '../chat/VscodeEntryIcon'
import { buildFilesTree, filterFilesTree, type FilesTreeNode } from './filesTree'
import { cn } from '~/lib/utils'

function FilesSidebarSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-2 p-3">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="h-7 animate-pulse rounded bg-muted/60" />
      ))}
    </div>
  )
}

type FilesTreeRowProps = {
  node: FilesTreeNode
  depth: number
  expandedFolders: Record<string, boolean>
  setExpandedFolders: Dispatch<SetStateAction<Record<string, boolean>>>
  selectedFilePath: string | null
  onOpenFile: (path: string) => void
  onInsertPath: (path: string) => void
  resolvedTheme: 'light' | 'dark'
}

function FilesTreeDirectoryRow(props: FilesTreeRowProps) {
  const isExpanded = props.expandedFolders[props.node.path] === true

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-foreground transition-colors hover:bg-accent/50"
        style={{ paddingLeft: `${props.depth * 14 + 8}px` }}
        onClick={() =>
          props.setExpandedFolders(current => ({ ...current, [props.node.path]: !isExpanded }))
        }
      >
        {isExpanded ? (
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
        )}
        <VscodeEntryIcon pathValue={props.node.path} kind="directory" theme={props.resolvedTheme} />
        <span className="truncate">{props.node.name}</span>
      </button>
      {isExpanded ? (
        <div>
          {props.node.children.map(child => (
            <FilesTreeRow
              key={child.path}
              node={child}
              depth={props.depth + 1}
              expandedFolders={props.expandedFolders}
              setExpandedFolders={props.setExpandedFolders}
              selectedFilePath={props.selectedFilePath}
              onOpenFile={props.onOpenFile}
              onInsertPath={props.onInsertPath}
              resolvedTheme={props.resolvedTheme}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function FilesTreeFileRow(props: {
  node: FilesTreeNode
  depth: number
  selectedFilePath: string | null
  onOpenFile: (path: string) => void
  onInsertPath: (path: string) => void
  resolvedTheme: 'light' | 'dark'
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-foreground transition-colors hover:bg-accent/50',
        props.selectedFilePath === props.node.path && 'bg-accent text-foreground'
      )}
      style={{ paddingLeft: `${props.depth * 14 + 25}px` }}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (event.altKey) {
          props.onInsertPath(props.node.path)
          return
        }
        props.onOpenFile(props.node.path)
      }}
      title={`Click to open • Alt-click to insert @${props.node.path}`}
    >
      <VscodeEntryIcon pathValue={props.node.path} kind="file" theme={props.resolvedTheme} />
      <span className="truncate">{props.node.name}</span>
    </button>
  )
}

function FilesTreeRow(props: FilesTreeRowProps) {
  if (props.node.kind === 'directory') {
    return <FilesTreeDirectoryRow {...props} />
  }

  return (
    <FilesTreeFileRow
      node={props.node}
      depth={props.depth}
      selectedFilePath={props.selectedFilePath}
      onOpenFile={props.onOpenFile}
      onInsertPath={props.onInsertPath}
      resolvedTheme={props.resolvedTheme}
    />
  )
}

function collectDirectoryPaths(nodes: readonly FilesTreeNode[]): string[] {
  const directoryPaths: string[] = []

  const visit = (node: FilesTreeNode) => {
    if (node.kind !== 'directory') return
    directoryPaths.push(node.path)
    node.children.forEach(visit)
  }

  nodes.forEach(visit)
  return directoryPaths
}

function FilesSidebarTreeToolbar(props: {
  query: string
  setQuery: (value: string) => void
  directoryPaths: readonly string[]
  setExpandedFolders: Dispatch<SetStateAction<Record<string, boolean>>>
}) {
  const setAllFoldersExpanded = (expanded: boolean) =>
    props.setExpandedFolders(Object.fromEntries(props.directoryPaths.map(path => [path, expanded])))

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
      <Input
        value={props.query}
        onChange={event => props.setQuery(event.target.value)}
        placeholder="Filter files..."
        className="h-7 w-[178px] text-caption placeholder:text-mini placeholder:text-muted-foreground/80"
      />
      <div className="ms-auto flex items-center gap-1">
        <Button
          size="xs"
          variant="ghost"
          type="button"
          className="h-7 w-7 p-0"
          aria-label="Collapse all folders"
          title="Collapse all folders"
          onClick={() => setAllFoldersExpanded(false)}
          disabled={props.directoryPaths.length === 0}
        >
          <FolderIcon className="size-3" />
        </Button>
        <Button
          size="xs"
          variant="ghost"
          type="button"
          className="h-7 w-7 p-0"
          aria-label="Expand all folders"
          title="Expand all folders"
          onClick={() => setAllFoldersExpanded(true)}
          disabled={props.directoryPaths.length === 0}
        >
          <FolderOpenIcon className="size-3" />
        </Button>
      </div>
    </div>
  )
}

function FilesSidebarTreeBody(props: {
  entriesCount: number
  filteredTree: readonly FilesTreeNode[]
  expandedFolders: Record<string, boolean>
  setExpandedFolders: Dispatch<SetStateAction<Record<string, boolean>>>
  selectedFilePath: string | null
  onOpenFile: (path: string) => void
  onInsertPath: (path: string) => void
  resolvedTheme: 'light' | 'dark'
  truncated: boolean | undefined
  isPending: boolean
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {props.isPending ? <FilesSidebarSkeleton /> : null}
      {!props.isPending && props.filteredTree.length === 0 ? (
        <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
          {props.entriesCount ? 'No matching files or folders.' : 'No workspace files found.'}
        </div>
      ) : null}
      {!props.isPending && props.filteredTree.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {props.filteredTree.map(node => (
            <FilesTreeRow
              key={node.path}
              node={node}
              depth={0}
              expandedFolders={props.expandedFolders}
              setExpandedFolders={props.setExpandedFolders}
              selectedFilePath={props.selectedFilePath}
              onOpenFile={props.onOpenFile}
              onInsertPath={props.onInsertPath}
              resolvedTheme={props.resolvedTheme}
            />
          ))}
          {props.truncated ? (
            <p className="px-2 pt-2 text-mini text-muted-foreground">
              File list truncated to the indexed workspace limit.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function FilesSidebarTreePane(props: {
  cwd: string
  selectedFilePath: string | null
  onOpenFile: (path: string) => void
  onInsertPath: (path: string) => void
}) {
  const [query, setQuery] = useState('')
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({})
  const { resolvedTheme } = useTheme()
  const entriesQuery = useQuery(projectListEntriesQueryOptions({ cwd: props.cwd }))

  const tree = useMemo(
    () => buildFilesTree(entriesQuery.data?.entries ?? []),
    [entriesQuery.data?.entries]
  )
  const directoryPaths = useMemo(() => collectDirectoryPaths(tree), [tree])
  const filteredTree = useMemo(() => filterFilesTree(tree, query), [tree, query])

  return (
    <div className="flex min-h-0 w-[42%] min-w-[220px] max-w-[420px] shrink-0 flex-col border-r border-border">
      <FilesSidebarTreeToolbar
        query={query}
        setQuery={setQuery}
        directoryPaths={directoryPaths}
        setExpandedFolders={setExpandedFolders}
      />
      <FilesSidebarTreeBody
        entriesCount={entriesQuery.data?.entries.length ?? 0}
        filteredTree={filteredTree}
        expandedFolders={expandedFolders}
        setExpandedFolders={setExpandedFolders}
        selectedFilePath={props.selectedFilePath}
        onOpenFile={props.onOpenFile}
        onInsertPath={props.onInsertPath}
        resolvedTheme={resolvedTheme}
        truncated={entriesQuery.data?.truncated}
        isPending={entriesQuery.isPending}
      />
    </div>
  )
}
