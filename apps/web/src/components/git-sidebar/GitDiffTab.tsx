import type { GitDiffFile, GitDiffResult, GitDiffSectionKind } from '@orxa-code/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { FilePlusIcon, MinusCircleIcon, RotateCcwIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { getWsRpcClient } from '../../wsRpcClient'
import { gitPanelQueryKeys } from '../../lib/gitReactQuery'
import { Button } from '../ui/button'
import { GitSidebarSkeleton } from './GitTextTab'
import { cn } from '~/lib/utils'

// ── File tree ────────────────────────────────────────────────────────

const SECTION_LABELS: Record<GitDiffSectionKind, string> = {
  staged: 'Staged',
  unstaged: 'Unstaged',
  untracked: 'Untracked',
}

function DiffStatBadge({ additions, deletions }: { additions: number; deletions: number }) {
  if (additions === 0 && deletions === 0) return null
  return (
    <span className="ml-auto shrink-0 font-mono text-[10px]">
      {additions > 0 && <span className="text-success">+{additions}</span>}
      {additions > 0 && deletions > 0 && <span className="text-muted-foreground/60"> </span>}
      {deletions > 0 && <span className="text-destructive">-{deletions}</span>}
    </span>
  )
}

function FileRow({
  file,
  selected,
  onClick,
}: {
  file: GitDiffFile
  selected: boolean
  onClick: () => void
}) {
  const name = file.path.split('/').pop() ?? file.path
  const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/') + 1) : ''
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors',
        selected ? 'bg-accent text-foreground' : 'hover:bg-accent/50 text-muted-foreground'
      )}
    >
      <span className="min-w-0 flex-1 truncate">
        {dir && <span className="opacity-50">{dir}</span>}
        <span className="font-medium text-foreground">{name}</span>
      </span>
      <DiffStatBadge additions={file.additions} deletions={file.deletions} />
    </button>
  )
}

function useFileActions(cwd: string, onRefresh: () => void) {
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: gitPanelQueryKeys.diff(cwd) })
  return {
    handleStage: async (path: string) => {
      await getWsRpcClient().git.stagePath({ cwd, path })
      await invalidate()
      onRefresh()
    },
    handleUnstage: async (path: string) => {
      await getWsRpcClient().git.unstagePath({ cwd, path })
      await invalidate()
      onRefresh()
    },
    handleRestore: async (path: string) => {
      await getWsRpcClient().git.restorePath({ cwd, path })
      await invalidate()
      onRefresh()
    },
  }
}

function FileActionButtons({
  file,
  cwd,
  onRefresh,
}: {
  file: GitDiffFile
  cwd: string
  onRefresh: () => void
}) {
  const { handleStage, handleUnstage, handleRestore } = useFileActions(cwd, onRefresh)
  return (
    <div className="flex shrink-0 gap-0.5 pr-1 opacity-0 transition-opacity group-hover:opacity-100">
      {file.section === 'unstaged' && (
        <>
          <Button
            size="xs"
            variant="ghost"
            title="Stage"
            className="h-5 w-5 p-0"
            onClick={() => void handleStage(file.path)}
          >
            <FilePlusIcon className="size-3" />
          </Button>
          <Button
            size="xs"
            variant="ghost"
            title="Restore"
            className="h-5 w-5 p-0 text-destructive hover:text-destructive"
            onClick={() => void handleRestore(file.path)}
          >
            <RotateCcwIcon className="size-3" />
          </Button>
        </>
      )}
      {file.section === 'staged' && (
        <Button
          size="xs"
          variant="ghost"
          title="Unstage"
          className="h-5 w-5 p-0"
          onClick={() => void handleUnstage(file.path)}
        >
          <MinusCircleIcon className="size-3" />
        </Button>
      )}
    </div>
  )
}

function SectionGroup({
  label,
  files,
  selectedPath,
  cwd,
  onSelect,
  onRefresh,
}: {
  label: string
  files: ReadonlyArray<GitDiffFile>
  selectedPath: string | null
  cwd: string
  onSelect: (file: GitDiffFile) => void
  onRefresh: () => void
}) {
  if (files.length === 0) return null
  return (
    <div className="flex flex-col gap-0.5">
      <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
        {label} ({files.length})
      </p>
      {files.map(file => (
        <div key={file.path} className="group flex items-center gap-0.5">
          <div className="min-w-0 flex-1">
            <FileRow
              file={file}
              selected={selectedPath === file.path}
              onClick={() => onSelect(file)}
            />
          </div>
          <FileActionButtons file={file} cwd={cwd} onRefresh={onRefresh} />
        </div>
      ))}
    </div>
  )
}

// ── Inline diff renderer ─────────────────────────────────────────────

function DiffLineRow({ type, content }: { type: 'context' | 'add' | 'del'; content: string }) {
  return (
    <div
      className={cn(
        'flex font-mono text-[11px] leading-5',
        type === 'add' && 'bg-success/8 text-success-foreground',
        type === 'del' && 'bg-destructive/8 text-destructive-foreground'
      )}
    >
      <span
        className={cn(
          'w-4 shrink-0 select-none text-center',
          type === 'add' && 'text-success',
          type === 'del' && 'text-destructive',
          type === 'context' && 'text-muted-foreground/40'
        )}
      >
        {type === 'add' ? '+' : type === 'del' ? '-' : ' '}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-all px-1">{content}</span>
    </div>
  )
}

function FileDiffView({ file }: { file: GitDiffFile }) {
  if (file.isBinary) {
    return (
      <div className="flex items-center justify-center p-6">
        <p className="text-xs text-muted-foreground">Binary file</p>
      </div>
    )
  }
  if (file.section === 'untracked') {
    return (
      <div className="flex items-center justify-center p-6">
        <p className="text-xs text-muted-foreground">Untracked — no diff available</p>
      </div>
    )
  }
  if (file.hunks.length === 0) {
    return (
      <div className="flex items-center justify-center p-6">
        <p className="text-xs text-muted-foreground">No changes</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col divide-y divide-border/50">
      {file.hunks.map((hunk, hi) => (
        <div key={hi}>
          <div className="bg-muted/30 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            {hunk.header}
          </div>
          <div>
            {hunk.lines.map((line, li) => (
              <DiffLineRow key={li} type={line.type} content={line.content} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main tab ─────────────────────────────────────────────────────────

export interface GitDiffTabProps {
  cwd: string
  data: GitDiffResult | undefined
  isPending: boolean
  onRefresh: () => void
}

export function GitDiffTab({ cwd, data, isPending, onRefresh }: GitDiffTabProps): ReactNode {
  const [selectedFile, setSelectedFile] = useState<GitDiffFile | null>(null)

  if (isPending) {
    return <GitSidebarSkeleton />
  }

  if (!data) return null

  const allFiles = [...data.staged, ...data.unstaged, ...data.untracked]

  if (allFiles.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-xs text-muted-foreground">Working tree is clean.</p>
      </div>
    )
  }

  const activeFile =
    selectedFile && allFiles.find(f => f.path === selectedFile.path)
      ? selectedFile
      : (allFiles[0] ?? null)

  return (
    <div className="flex min-h-0 flex-1">
      {/* File tree */}
      <div className="w-48 shrink-0 overflow-y-auto border-r border-border p-2">
        <SectionGroup
          label={SECTION_LABELS.staged}
          files={data.staged}
          selectedPath={activeFile?.path ?? null}
          cwd={cwd}
          onSelect={setSelectedFile}
          onRefresh={onRefresh}
        />
        <SectionGroup
          label={SECTION_LABELS.unstaged}
          files={data.unstaged}
          selectedPath={activeFile?.path ?? null}
          cwd={cwd}
          onSelect={setSelectedFile}
          onRefresh={onRefresh}
        />
        <SectionGroup
          label={SECTION_LABELS.untracked}
          files={data.untracked}
          selectedPath={activeFile?.path ?? null}
          cwd={cwd}
          onSelect={setSelectedFile}
          onRefresh={onRefresh}
        />
      </div>
      {/* Diff view */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        {activeFile ? (
          <>
            <div className="sticky top-0 border-b border-border bg-background px-3 py-1.5">
              <p className="truncate font-mono text-xs font-medium text-foreground">
                {activeFile.path}
              </p>
            </div>
            <FileDiffView file={activeFile} />
          </>
        ) : null}
      </div>
    </div>
  )
}
