import { PatchDiff } from '@pierre/diffs/react'
import type { GitDiffFile, GitDiffResult, GitDiffScopeKind } from '@orxa-code/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { AlignJustifyIcon, Columns2Icon, ListIcon, PlusIcon, RotateCcwIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'

import { invalidateGitQueries } from '../../lib/gitReactQuery'
import { getWsRpcClient } from '../../wsRpcClient'
import { useTheme } from '../../hooks/useTheme'
import { Button } from '../ui/button'
import { getVisibleDiffFiles } from './GitDiffFileSections.logic'
import { GitSidebarSkeleton } from './GitTextTab'
import { GitDiffListView, GitDiffTreePane } from './GitDiffFileSections'

type GitDiffViewMode = 'list' | 'unified' | 'split'

function useGitDiffActions(cwd: string, onRefresh: () => void) {
  const queryClient = useQueryClient()
  const [pendingAction, setPendingAction] = useState<string | null>(null)

  const runAction = async (actionKey: string, run: () => Promise<void>) => {
    setPendingAction(actionKey)
    try {
      await run()
      await invalidateGitQueries(queryClient)
      onRefresh()
    } finally {
      setPendingAction(null)
    }
  }

  return {
    pendingAction,
    stageAll: () => runAction('stage-all', () => getWsRpcClient().git.stageAll({ cwd })),
    restoreAllUnstaged: () =>
      runAction('restore-all-unstaged', () => getWsRpcClient().git.restoreAllUnstaged({ cwd })),
    stagePath: (path: string) =>
      runAction(`stage:${path}`, () => getWsRpcClient().git.stagePath({ cwd, path })),
    unstagePath: (path: string) =>
      runAction(`unstage:${path}`, () => getWsRpcClient().git.unstagePath({ cwd, path })),
    restorePath: (path: string) =>
      runAction(`restore:${path}`, () => getWsRpcClient().git.restorePath({ cwd, path })),
  }
}

function PatchModeDiffView(props: { file: GitDiffFile; mode: Exclude<GitDiffViewMode, 'list'> }) {
  const { resolvedTheme } = useTheme()

  if (props.file.isBinary) {
    return (
      <div className="flex items-center justify-center p-6">
        <p className="text-xs text-muted-foreground">Binary file</p>
      </div>
    )
  }

  if (props.file.patch.trim().length === 0) {
    return (
      <div className="flex items-center justify-center p-6">
        <p className="text-xs text-muted-foreground">
          {props.file.section === 'untracked'
            ? 'Preview unavailable for this untracked file'
            : 'No rendered diff available'}
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <PatchDiff
        patch={props.file.patch}
        className="min-w-full"
        disableWorkerPool={true}
        options={{
          diffStyle: props.mode,
          disableFileHeader: true,
          overflow: 'scroll',
          expandUnchanged: false,
          hunkSeparators: 'line-info-basic',
          themeType: resolvedTheme,
        }}
      />
    </div>
  )
}

function GitDiffModeButton(props: {
  active: boolean
  label: string
  onClick: () => void
  icon: ComponentType<{ className?: string }>
}) {
  const Icon = props.icon
  return (
    <Button
      type="button"
      size="xs"
      variant={props.active ? 'secondary' : 'ghost'}
      className="h-7 gap-1.5 rounded-full px-2.5 text-[11px]"
      onClick={props.onClick}
    >
      <Icon className="size-3" />
      <span>{props.label}</span>
    </Button>
  )
}

function GitDiffBulkActions(props: {
  showLocalActions: boolean
  canStageAll: boolean
  canRestoreAll: boolean
  pendingAction: string | null
  onStageAll: () => void
  onRestoreAll: () => void
}) {
  if (!props.showLocalActions) return null
  return (
    <>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="h-7 gap-1.5 rounded-full px-2.5 text-[11px]"
        disabled={!props.canStageAll || props.pendingAction !== null}
        onClick={props.onStageAll}
      >
        <PlusIcon className="size-3" />
        <span>Stage all</span>
      </Button>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="h-7 gap-1.5 rounded-full px-2.5 text-[11px] text-destructive hover:text-destructive"
        disabled={!props.canRestoreAll || props.pendingAction !== null}
        onClick={props.onRestoreAll}
      >
        <RotateCcwIcon className="size-3" />
        <span>Revert all</span>
      </Button>
    </>
  )
}

function GitDiffControls(props: {
  mode: GitDiffViewMode
  compareLabel: string | null
  setMode: (mode: GitDiffViewMode) => void
  fileListOpen: boolean
  showFileToggle: boolean
  showLocalActions: boolean
  canStageAll: boolean
  canRestoreAll: boolean
  pendingAction: string | null
  onToggleFileList: () => void
  onStageAll: () => void
  onRestoreAll: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      <div className="flex items-center gap-1">
        <GitDiffModeButton
          active={props.mode === 'list'}
          label="List"
          icon={ListIcon}
          onClick={() => props.setMode('list')}
        />
        <GitDiffModeButton
          active={props.mode === 'unified'}
          label="Unified"
          icon={AlignJustifyIcon}
          onClick={() => props.setMode('unified')}
        />
        <GitDiffModeButton
          active={props.mode === 'split'}
          label="Split"
          icon={Columns2Icon}
          onClick={() => props.setMode('split')}
        />
      </div>
      {props.compareLabel ? (
        <p className="truncate text-[11px] text-muted-foreground">{props.compareLabel}</p>
      ) : null}
      <div className="ms-auto flex items-center gap-1">
        {props.showFileToggle ? (
          <Button
            type="button"
            size="xs"
            variant={props.fileListOpen ? 'secondary' : 'ghost'}
            className="h-7 rounded-full px-2.5 text-[11px]"
            onClick={props.onToggleFileList}
          >
            {props.fileListOpen ? 'Hide files' : 'Show files'}
          </Button>
        ) : null}
        <GitDiffBulkActions
          showLocalActions={props.showLocalActions}
          canStageAll={props.canStageAll}
          canRestoreAll={props.canRestoreAll}
          pendingAction={props.pendingAction}
          onStageAll={props.onStageAll}
          onRestoreAll={props.onRestoreAll}
        />
      </div>
    </div>
  )
}

export interface GitDiffTabProps {
  cwd: string
  data: GitDiffResult | undefined
  scope: GitDiffScopeKind
  isPending: boolean
  isError?: boolean
  errorMessage?: string
  onRefresh: () => void
}

function GitDiffDetailPane(props: {
  files: ReadonlyArray<GitDiffFile>
  selectedPath: string | null
  mode: Exclude<GitDiffViewMode, 'list'>
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!props.selectedPath || !containerRef.current) return
    const escapedPath =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(props.selectedPath)
        : props.selectedPath.replaceAll('"', '\\"')
    const target = containerRef.current.querySelector<HTMLElement>(
      `[data-git-diff-path="${escapedPath}"]`
    )
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [props.selectedPath])

  return (
    <div ref={containerRef} className="min-w-0 flex-1 overflow-y-auto">
      {props.files.map(file => (
        <section
          key={`${file.section}:${file.path}`}
          data-git-diff-path={file.path}
          className="border-b border-border last:border-b-0"
        >
          <div className="sticky top-0 z-10 border-b border-border bg-background px-3 py-1.5">
            <p className="truncate font-mono text-xs font-medium text-foreground">{file.path}</p>
          </div>
          <PatchModeDiffView file={file} mode={props.mode} />
        </section>
      ))}
    </div>
  )
}

function GitDiffTabContent({
  data,
  scope,
  actions,
  mode,
  setMode,
  fileListOpen,
  onToggleFileList,
  selectedPath,
  onSelectPath,
}: {
  data: GitDiffResult
  scope: GitDiffScopeKind
  actions: ReturnType<typeof useGitDiffActions>
  mode: GitDiffViewMode
  setMode: (mode: GitDiffViewMode) => void
  fileListOpen: boolean
  onToggleFileList: () => void
  selectedPath: string | null
  onSelectPath: (path: string) => void
}) {
  const allFiles = getVisibleDiffFiles(data, scope)
  const activeFile = allFiles.find(file => file.path === selectedPath) ?? allFiles[0] ?? null
  const isLocalWorkingTreeScope = scope === 'unstaged'
  const canStageAll = isLocalWorkingTreeScope && (data.unstaged.length > 0 || data.untracked.length > 0)
  const canRestoreAll = isLocalWorkingTreeScope && data.unstaged.length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <GitDiffControls
        mode={mode}
        compareLabel={scope === 'branch' ? data.branch?.compareLabel ?? null : null}
        setMode={setMode}
        fileListOpen={fileListOpen}
        showFileToggle={mode !== 'list'}
        showLocalActions={isLocalWorkingTreeScope}
        canStageAll={canStageAll}
        canRestoreAll={canRestoreAll}
        pendingAction={actions.pendingAction}
        onToggleFileList={onToggleFileList}
        onStageAll={() => void actions.stageAll()}
        onRestoreAll={() => void actions.restoreAllUnstaged()}
      />
      {mode === 'list' ? (
        <GitDiffListView
          data={data}
          scope={scope}
          pendingAction={actions.pendingAction}
          actions={actions}
        />
      ) : (
        <div className="flex min-h-0 flex-1">
          {fileListOpen ? (
            <GitDiffTreePane
              data={data}
              scope={scope}
              activePath={activeFile?.path ?? null}
              pendingAction={actions.pendingAction}
              onSelectPath={onSelectPath}
              actions={actions}
            />
          ) : null}
          <GitDiffDetailPane files={allFiles} selectedPath={selectedPath} mode={mode} />
        </div>
      )}
    </div>
  )
}

export function GitDiffTab({
  cwd,
  data,
  scope,
  isPending,
  isError = false,
  errorMessage,
  onRefresh,
}: GitDiffTabProps): ReactNode {
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [mode, setMode] = useState<GitDiffViewMode>('unified')
  const [fileListOpen, setFileListOpen] = useState(false)
  const actions = useGitDiffActions(cwd, onRefresh)

  const handleSetMode = (nextMode: GitDiffViewMode) => {
    setMode(currentMode => {
      if (currentMode === nextMode) return currentMode
      if (nextMode === 'list') {
        setFileListOpen(true)
      } else if (currentMode === 'list') {
        setFileListOpen(false)
      }
      return nextMode
    })
  }

  if (isPending) {
    return <GitSidebarSkeleton />
  }

  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="max-w-xs text-center text-xs text-muted-foreground">
          {errorMessage ?? 'Unable to load git diff.'}
        </p>
      </div>
    )
  }

  if (!data) {
    return null
  }

  const allFiles = getVisibleDiffFiles(data, scope)

  if (allFiles.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-xs text-muted-foreground">
          {scope === 'branch' ? 'No branch diff available.' : 'Working tree is clean.'}
        </p>
      </div>
    )
  }

  return (
    <GitDiffTabContent
      data={data}
      scope={scope}
      actions={actions}
      mode={mode}
      setMode={handleSetMode}
      fileListOpen={fileListOpen}
      onToggleFileList={() => setFileListOpen(open => !open)}
      selectedPath={selectedPath}
      onSelectPath={setSelectedPath}
    />
  )
}
