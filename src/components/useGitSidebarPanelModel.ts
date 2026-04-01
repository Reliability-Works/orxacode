import type { ChangeProvenanceRecord } from '@shared/ipc'
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { GitSidebarProps, GitPanelTab } from './GitSidebarPanel'
import { parseGitDiffOutput, toDiffSections, type GitDiffFile } from '../lib/git-diff'
import { buildFileTree, filterTreeNodes, type FileTreeNode } from '../lib/git-file-tree'

type DiffSection = ReturnType<typeof toDiffSections>[number]
const GIT_TAB_LABELS: Record<GitPanelTab, string> = {
  diff: 'Diff',
  log: 'Log',
  issues: 'Issues',
  prs: 'PRs',
}

export type GitSidebarPanelModel = {
  gitTabLabels: Record<GitPanelTab, string>
  gitTabMenuOpen: boolean
  gitTabMenuRef: RefObject<HTMLDivElement | null>
  setGitTabMenuOpen: Dispatch<SetStateAction<boolean>>
  selectGitTab: (tab: GitPanelTab) => void
  parsedDiff: { files: GitDiffFile[]; message?: string | null }
  gitPanelOutput: string
  hasUnstagedFiles: boolean
  fileTree: Array<FileTreeNode<GitDiffFile>>
  filteredTree: Array<FileTreeNode<GitDiffFile>>
  fileIndexByKey: Record<string, number>
  allFileSections: Array<{ file: GitDiffFile; sections: DiffSection[] }>
  selectedDiffKey: string | null
  setSelectedDiffKey: Dispatch<SetStateAction<string | null>>
  pendingAction: string | null
  actionError: string | null
  treeFilter: string
  setTreeFilter: Dispatch<SetStateAction<string>>
  showFileTree: boolean
  setShowFileTree: Dispatch<SetStateAction<boolean>>
  expandedFolders: Record<string, boolean>
  setExpandedFolders: Dispatch<SetStateAction<Record<string, boolean>>>
  collapsedFileSections: Record<string, boolean>
  setCollapsedFileSections: Dispatch<SetStateAction<Record<string, boolean>>>
  listViewFocusKey: string | null
  setListViewFocusKey: Dispatch<SetStateAction<string | null>>
  runFileAction: (actionKey: string, action: () => Promise<void>, successMessage: string) => Promise<void>
  resolveProvenance: (file: Pick<GitDiffFile, 'path' | 'oldPath'>) => ChangeProvenanceRecord | null
  formatProvenanceLabel: (record: ChangeProvenanceRecord | null) => string
  onStageAllChanges?: () => Promise<void>
  onDiscardAllChanges?: () => Promise<void>
  onStageFile?: (filePath: string) => Promise<void>
  onRestoreFile?: (filePath: string) => Promise<void>
  onUnstageFile?: (filePath: string) => Promise<void>
}

function formatProvenanceLabel(record: ChangeProvenanceRecord | null) {
  if (!record) {
    return 'Unknown provenance'
  }
  const actor = record.actorName?.trim().length ? record.actorName : record.actorType
  const reason = record.reason?.trim()
  return reason ? `${actor} • ${reason}` : `${actor} • ${record.operation}`
}

function resolveProvenance(
  file: Pick<GitDiffFile, 'path' | 'oldPath'>,
  fileProvenanceByPath?: Record<string, ChangeProvenanceRecord>
) {
  const direct = fileProvenanceByPath?.[file.path]
  if (direct) {
    return direct
  }
  if (file.oldPath) {
    return fileProvenanceByPath?.[file.oldPath] ?? null
  }
  return null
}

function useGitTabMenu(
  setGitPanelTab: (tab: GitPanelTab) => void,
  onLoadGitDiff: () => Promise<void>,
  onLoadGitLog: () => Promise<void>,
  onLoadGitIssues: () => Promise<void>,
  onLoadGitPrs: () => Promise<void>
) {
  const [gitTabMenuOpen, setGitTabMenuOpen] = useState(false)
  const gitTabMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!gitTabMenuOpen) {
      return
    }
    const handleClick = (e: MouseEvent) => {
      if (gitTabMenuRef.current && !gitTabMenuRef.current.contains(e.target as Node)) {
        setGitTabMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [gitTabMenuOpen])

  const selectGitTab = useCallback(
    (tab: GitPanelTab) => {
      setGitPanelTab(tab)
      setGitTabMenuOpen(false)
      if (tab === 'diff') void onLoadGitDiff()
      if (tab === 'log') void onLoadGitLog()
      if (tab === 'issues') void onLoadGitIssues()
      if (tab === 'prs') void onLoadGitPrs()
    },
    [onLoadGitDiff, onLoadGitIssues, onLoadGitLog, onLoadGitPrs, setGitPanelTab]
  )

  return { gitTabMenuOpen, setGitTabMenuOpen, gitTabMenuRef, selectGitTab }
}

function useGitSidebarDerivedState(gitPanelOutput: string, treeFilter: string) {
  const parsedDiff = useMemo(() => parseGitDiffOutput(gitPanelOutput), [gitPanelOutput])
  const hasUnstagedFiles = useMemo(
    () => parsedDiff.files.some(file => file.hasUnstaged),
    [parsedDiff.files]
  )
  const fileTree = useMemo(() => buildFileTree(parsedDiff.files), [parsedDiff.files])
  const filteredTree = useMemo(() => filterTreeNodes(fileTree, treeFilter), [fileTree, treeFilter])
  const fileIndexByKey = useMemo(
    () => Object.fromEntries(parsedDiff.files.map((file, index) => [file.key, index])),
    [parsedDiff.files]
  )

  const allFileSections = useMemo(
    () =>
      parsedDiff.files
        .map(file => {
          const sections = toDiffSections(file)
          return { file, sections }
        })
        .filter(({ sections }) => sections.some(section => section.patch.trim().length > 0)),
    [parsedDiff.files]
  )

  return {
    parsedDiff,
    hasUnstagedFiles,
    fileTree,
    filteredTree,
    fileIndexByKey,
    allFileSections,
  }
}

function useSelectedDiffSync(
  gitPanelTab: GitPanelTab,
  files: GitDiffFile[],
  selectedDiffKey: string | null,
  setSelectedDiffKey: Dispatch<SetStateAction<string | null>>
) {
  useEffect(() => {
    if (gitPanelTab !== 'diff') {
      return
    }
    if (files.length === 0) {
      setSelectedDiffKey(null)
      return
    }
    if (!files.some(file => file.key === selectedDiffKey)) {
      setSelectedDiffKey(files[0]?.key ?? null)
    }
  }, [files, gitPanelTab, selectedDiffKey, setSelectedDiffKey])
}

function useRunFileAction(onStatusChange: (message: string) => void) {
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const runFileAction = useCallback(
    async (actionKey: string, action: () => Promise<void>, successMessage: string) => {
      setPendingAction(actionKey)
      setActionError(null)
      try {
        await action()
        onStatusChange(successMessage)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setActionError(message)
        onStatusChange(message)
      } finally {
        setPendingAction(null)
      }
    },
    [onStatusChange]
  )

  return { pendingAction, actionError, runFileAction }
}

export function useGitSidebarPanelModel(props: GitSidebarProps): GitSidebarPanelModel {
  const {
    gitPanelTab,
    setGitPanelTab,
    gitPanelOutput,
    onLoadGitDiff,
    onLoadGitLog,
    onLoadGitIssues,
    onLoadGitPrs,
    onStatusChange,
    fileProvenanceByPath,
  } = props

  const [selectedDiffKey, setSelectedDiffKey] = useState<string | null>(null)
  const [treeFilter, setTreeFilter] = useState('')
  const [showFileTree, setShowFileTree] = useState(true)
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({})
  const [collapsedFileSections, setCollapsedFileSections] = useState<Record<string, boolean>>({})
  const [listViewFocusKey, setListViewFocusKey] = useState<string | null>(null)

  const { gitTabMenuOpen, setGitTabMenuOpen, gitTabMenuRef, selectGitTab } = useGitTabMenu(
    setGitPanelTab,
    onLoadGitDiff,
    onLoadGitLog,
    onLoadGitIssues,
    onLoadGitPrs
  )
  const {
    parsedDiff,
    hasUnstagedFiles,
    fileTree,
    filteredTree,
    fileIndexByKey,
    allFileSections,
  } = useGitSidebarDerivedState(gitPanelOutput, treeFilter)
  const { pendingAction, actionError, runFileAction } = useRunFileAction(onStatusChange)
  useSelectedDiffSync(gitPanelTab, parsedDiff.files, selectedDiffKey, setSelectedDiffKey)

  return {
    gitTabLabels: GIT_TAB_LABELS,
    gitTabMenuOpen,
    gitTabMenuRef,
    setGitTabMenuOpen,
    selectGitTab,
    parsedDiff,
    gitPanelOutput,
    hasUnstagedFiles,
    fileTree,
    filteredTree,
    fileIndexByKey,
    allFileSections,
    selectedDiffKey,
    setSelectedDiffKey,
    pendingAction,
    actionError,
    treeFilter,
    setTreeFilter,
    showFileTree,
    setShowFileTree,
    expandedFolders,
    setExpandedFolders,
    collapsedFileSections,
    setCollapsedFileSections,
    listViewFocusKey,
    setListViewFocusKey,
    runFileAction,
    resolveProvenance: file => resolveProvenance(file, fileProvenanceByPath),
    formatProvenanceLabel,
    onStageAllChanges: props.onStageAllChanges,
    onDiscardAllChanges: props.onDiscardAllChanges,
    onStageFile: props.onStageFile,
    onRestoreFile: props.onRestoreFile,
    onUnstageFile: props.onUnstageFile,
  }
}
