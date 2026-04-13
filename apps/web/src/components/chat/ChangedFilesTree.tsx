import { type ThreadId, type TurnId } from '@orxa-code/contracts'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { type TurnDiffFileChange } from '../../types'
import { buildTurnDiffTree, type TurnDiffTreeNode } from '../../lib/turnDiffTree'
import { ChevronRightIcon, FolderIcon, FolderClosedIcon } from 'lucide-react'
import { cn } from '~/lib/utils'
import { DiffStatLabel } from './DiffStatLabel'
import { hasNonZeroStat } from './DiffStatLabel.logic'
import { VscodeEntryIcon } from './VscodeEntryIcon'
import { ChangedFilesInlineDiff } from './ChangedFilesInlineDiff'
import {
  buildExpansionState,
  collectDirectoryPaths,
  collectFilePaths,
} from './ChangedFilesTree.logic'

function TreeStatLabel(props: { stat: TurnDiffTreeNode['stat'] }) {
  const { stat } = props
  if (!stat || !hasNonZeroStat(stat)) {
    return null
  }

  return (
    <span className="ml-auto shrink-0 font-mono text-mini tabular-nums">
      <DiffStatLabel additions={stat.additions} deletions={stat.deletions} />
    </span>
  )
}

function DirectoryTreeNodeRow(props: {
  node: Extract<TurnDiffTreeNode, { kind: 'directory' }>
  depth: number
  isExpanded: boolean
  onToggle: () => void
}) {
  const { node, depth, isExpanded, onToggle } = props
  const leftPadding = 8 + depth * 14
  return (
    <button
      type="button"
      data-scroll-anchor-ignore
      className="group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-background/80"
      style={{ paddingLeft: `${leftPadding}px` }}
      onClick={onToggle}
    >
      <ChevronRightIcon
        aria-hidden="true"
        className={cn(
          'size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:text-foreground/80',
          isExpanded && 'rotate-90'
        )}
      />
      {isExpanded ? (
        <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
      ) : (
        <FolderClosedIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
      )}
      <span className="truncate font-mono text-caption text-muted-foreground/90 group-hover:text-foreground/90">
        {node.name}
      </span>
      <TreeStatLabel stat={node.stat} />
    </button>
  )
}

function FileTreeNodeRow(props: {
  node: Extract<TurnDiffTreeNode, { kind: 'file' }>
  depth: number
  threadId: ThreadId
  turnId: TurnId
  checkpointTurnCount?: number | undefined
  resolvedTheme: 'light' | 'dark'
  isExpanded: boolean
  onToggleExpanded: () => void
}) {
  const {
    checkpointTurnCount,
    depth,
    isExpanded,
    node,
    onToggleExpanded,
    resolvedTheme,
    threadId,
    turnId,
  } = props
  const leftPadding = 8 + depth * 14
  return (
    <div>
      <button
        type="button"
        className="group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-background/80"
        style={{ paddingLeft: `${leftPadding}px` }}
        onClick={onToggleExpanded}
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:text-foreground/80',
            isExpanded && 'rotate-90'
          )}
        />
        <VscodeEntryIcon
          pathValue={node.path}
          kind="file"
          theme={resolvedTheme}
          className="size-3.5 text-muted-foreground/70"
        />
        <span className="truncate font-mono text-caption text-muted-foreground/80 group-hover:text-foreground/90">
          {node.name}
        </span>
        <TreeStatLabel stat={node.stat} />
      </button>
      {isExpanded ? (
        <ChangedFilesInlineDiff
          threadId={threadId}
          turnId={turnId}
          checkpointTurnCount={checkpointTurnCount}
          filePath={node.path}
          resolvedTheme={resolvedTheme}
        />
      ) : null}
    </div>
  )
}

function useChangedFilesExpansionState(input: {
  treeNodes: ReadonlyArray<TurnDiffTreeNode>
  allDirectoriesExpanded: boolean
}) {
  const directoryPathsKey = useMemo(
    () => collectDirectoryPaths(input.treeNodes).join('\u0000'),
    [input.treeNodes]
  )
  const filePathsKey = useMemo(
    () => collectFilePaths(input.treeNodes).join('\u0000'),
    [input.treeNodes]
  )
  const allDirectoryExpansionState = useMemo(
    () =>
      buildExpansionState(
        directoryPathsKey ? directoryPathsKey.split('\u0000') : [],
        input.allDirectoriesExpanded
      ),
    [directoryPathsKey, input.allDirectoriesExpanded]
  )
  const allFileExpansionState = useMemo(
    () =>
      buildExpansionState(
        filePathsKey ? filePathsKey.split('\u0000') : [],
        input.allDirectoriesExpanded
      ),
    [filePathsKey, input.allDirectoriesExpanded]
  )
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>(() =>
    buildExpansionState(directoryPathsKey ? directoryPathsKey.split('\u0000') : [], true)
  )
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>(() =>
    buildExpansionState(filePathsKey ? filePathsKey.split('\u0000') : [], true)
  )

  useEffect(() => {
    setExpandedDirectories(allDirectoryExpansionState)
  }, [allDirectoryExpansionState])
  useEffect(() => {
    setExpandedFiles(allFileExpansionState)
  }, [allFileExpansionState])

  const toggleDirectory = useCallback((pathValue: string, fallbackExpanded: boolean) => {
    setExpandedDirectories(current => ({
      ...current,
      [pathValue]: !(current[pathValue] ?? fallbackExpanded),
    }))
  }, [])
  const toggleFileExpansion = useCallback((pathValue: string) => {
    setExpandedFiles(current => ({
      ...current,
      [pathValue]: !(current[pathValue] ?? false),
    }))
  }, [])

  return { expandedDirectories, expandedFiles, toggleDirectory, toggleFileExpansion }
}

export const ChangedFilesTree = memo(function ChangedFilesTree(props: {
  threadId: ThreadId
  turnId: TurnId
  checkpointTurnCount?: number | undefined
  files: ReadonlyArray<TurnDiffFileChange>
  allDirectoriesExpanded: boolean
  resolvedTheme: 'light' | 'dark'
}) {
  const { allDirectoriesExpanded, checkpointTurnCount, files, resolvedTheme, threadId, turnId } =
    props
  const treeNodes = useMemo(() => buildTurnDiffTree(files), [files])
  const { expandedDirectories, expandedFiles, toggleDirectory, toggleFileExpansion } =
    useChangedFilesExpansionState({
      treeNodes,
      allDirectoriesExpanded,
    })

  const renderTreeNode = (node: TurnDiffTreeNode, depth: number) => {
    if (node.kind === 'directory') {
      const isExpanded = expandedDirectories[node.path] ?? depth === 0
      return (
        <div key={`dir:${node.path}`}>
          <DirectoryTreeNodeRow
            node={node}
            depth={depth}
            isExpanded={isExpanded}
            onToggle={() => toggleDirectory(node.path, depth === 0)}
          />
          {isExpanded && (
            <div className="space-y-0.5">
              {node.children.map(childNode => renderTreeNode(childNode, depth + 1))}
            </div>
          )}
        </div>
      )
    }

    return (
      <FileTreeNodeRow
        key={`file:${node.path}`}
        node={node}
        depth={depth}
        threadId={threadId}
        turnId={turnId}
        checkpointTurnCount={checkpointTurnCount}
        resolvedTheme={resolvedTheme}
        isExpanded={expandedFiles[node.path] ?? false}
        onToggleExpanded={() => toggleFileExpansion(node.path)}
      />
    )
  }

  return <div className="space-y-0.5">{treeNodes.map(node => renderTreeNode(node, 0))}</div>
})
