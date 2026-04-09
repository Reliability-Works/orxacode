import { PatchDiff } from '@pierre/diffs/react'
import type { GitDiffFile, GitDiffResult } from '@orxa-code/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { AlignJustifyIcon, Columns2Icon, ListIcon, PlusIcon, RotateCcwIcon } from 'lucide-react'
import { useState, type ComponentType, type ReactNode } from 'react'

import { invalidateGitQueries } from '../../lib/gitReactQuery'
import { getWsRpcClient } from '../../wsRpcClient'
import { useTheme } from '../../hooks/useTheme'
import { Button } from '../ui/button'
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

  if (props.file.section === 'untracked' || props.file.patch.trim().length === 0) {
    return (
      <div className="flex items-center justify-center p-6">
        <p className="text-xs text-muted-foreground">No rendered diff available</p>
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

function GitDiffControls(props: {
  mode: GitDiffViewMode
  setMode: (mode: GitDiffViewMode) => void
  fileListOpen: boolean
  showFileToggle: boolean
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
      </div>
    </div>
  )
}

export interface GitDiffTabProps {
  cwd: string
  data: GitDiffResult | undefined
  isPending: boolean
  onRefresh: () => void
}

function GitDiffDetailPane(props: {
  activeFile: GitDiffFile | null
  mode: Exclude<GitDiffViewMode, 'list'>
}) {
  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      {props.activeFile ? (
        <>
          <div className="sticky top-0 z-10 border-b border-border bg-background px-3 py-1.5">
            <p className="truncate font-mono text-xs font-medium text-foreground">
              {props.activeFile.path}
            </p>
          </div>
          <PatchModeDiffView file={props.activeFile} mode={props.mode} />
        </>
      ) : null}
    </div>
  )
}

function GitDiffTabContent({
  data,
  actions,
  mode,
  setMode,
  fileListOpen,
  onToggleFileList,
  selectedPath,
  onSelectPath,
}: {
  data: GitDiffResult
  actions: ReturnType<typeof useGitDiffActions>
  mode: GitDiffViewMode
  setMode: (mode: GitDiffViewMode) => void
  fileListOpen: boolean
  onToggleFileList: () => void
  selectedPath: string | null
  onSelectPath: (path: string) => void
}) {
  const allFiles = [...data.staged, ...data.unstaged, ...data.untracked]
  const activeFile = allFiles.find(file => file.path === selectedPath) ?? allFiles[0] ?? null
  const canStageAll = data.unstaged.length > 0 || data.untracked.length > 0
  const canRestoreAll = data.unstaged.length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <GitDiffControls
        mode={mode}
        setMode={setMode}
        fileListOpen={fileListOpen}
        showFileToggle={mode !== 'list'}
        canStageAll={canStageAll}
        canRestoreAll={canRestoreAll}
        pendingAction={actions.pendingAction}
        onToggleFileList={onToggleFileList}
        onStageAll={() => void actions.stageAll()}
        onRestoreAll={() => void actions.restoreAllUnstaged()}
      />
      {mode === 'list' ? (
        <GitDiffListView data={data} pendingAction={actions.pendingAction} actions={actions} />
      ) : (
        <div className="flex min-h-0 flex-1">
          {fileListOpen ? (
            <GitDiffTreePane
              data={data}
              activePath={activeFile?.path ?? null}
              pendingAction={actions.pendingAction}
              onSelectPath={onSelectPath}
              actions={actions}
            />
          ) : null}
          <GitDiffDetailPane activeFile={activeFile} mode={mode} />
        </div>
      )}
    </div>
  )
}

export function GitDiffTab({ cwd, data, isPending, onRefresh }: GitDiffTabProps): ReactNode {
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

  if (!data) {
    return null
  }

  const allFiles = [...data.staged, ...data.unstaged, ...data.untracked]

  if (allFiles.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-xs text-muted-foreground">Working tree is clean.</p>
      </div>
    )
  }

  return (
    <GitDiffTabContent
      data={data}
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
