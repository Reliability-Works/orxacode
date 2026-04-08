import { useCallback } from 'react'
import type { GitStatusResult } from '@orxa-code/contracts'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '~/components/ui/dialog'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Textarea } from '~/components/ui/textarea'
import { toastManager } from '~/components/ui/toastState'
import { openInPreferredEditor } from '~/editorPreferences'
import { resolvePathLinkTarget } from '~/terminal-links'
import { readNativeApi } from '~/nativeApi'
import type { ThreadId } from '@orxa-code/contracts'
import { resolveDefaultBranchActionDialogCopy } from './GitActionsControl.logic'
import type { DefaultBranchConfirmableAction } from './GitActionsControl.logic'

const COMMIT_DIALOG_TITLE = 'Commit changes'
const COMMIT_DIALOG_DESCRIPTION =
  'Review and confirm your commit. Leave the message blank to auto-generate one.'

interface ChangedFile {
  path: string
  insertions: number
  deletions: number
}

interface CommitDialogFilesProps {
  allFiles: ReadonlyArray<ChangedFile>
  selectedFiles: ReadonlyArray<ChangedFile>
  excludedFiles: ReadonlySet<string>
  isEditingFiles: boolean
  allSelected: boolean
  noneSelected: boolean
  gitCwd: string | null
  threadToastData: { threadId: ThreadId } | undefined
  setExcludedFiles: (fn: (prev: ReadonlySet<string>) => ReadonlySet<string>) => void
  setIsEditingFiles: (fn: (prev: boolean) => boolean) => void
}

function FileRow({
  file,
  isExcluded,
  isEditingFiles,
  excludedFiles,
  setExcludedFiles,
  onOpen,
}: {
  file: ChangedFile
  isExcluded: boolean
  isEditingFiles: boolean
  excludedFiles: ReadonlySet<string>
  setExcludedFiles: (fn: (prev: ReadonlySet<string>) => ReadonlySet<string>) => void
  onOpen: (path: string) => void
}) {
  return (
    <div className="flex w-full items-center gap-2 rounded-md px-2 py-1 font-mono text-xs transition-colors hover:bg-accent/50">
      {isEditingFiles && (
        <Checkbox
          checked={!excludedFiles.has(file.path)}
          onCheckedChange={() =>
            setExcludedFiles(prev => {
              const next = new Set(prev)
              if (next.has(file.path)) next.delete(file.path)
              else next.add(file.path)
              return next
            })
          }
        />
      )}
      <button
        type="button"
        className="flex flex-1 items-center justify-between gap-3 text-left truncate"
        onClick={() => onOpen(file.path)}
      >
        <span className={`truncate${isExcluded ? ' text-muted-foreground' : ''}`}>{file.path}</span>
        <span className="shrink-0">
          {isExcluded ? (
            <span className="text-muted-foreground">Excluded</span>
          ) : (
            <>
              <span className="text-success">+{file.insertions}</span>
              <span className="text-muted-foreground"> / </span>
              <span className="text-destructive">-{file.deletions}</span>
            </>
          )}
        </span>
      </button>
    </div>
  )
}

function useOpenChangedFileInEditor(
  gitCwd: string | null,
  threadToastData: CommitDialogFilesProps['threadToastData']
) {
  return useCallback(
    (filePath: string) => {
      const api = readNativeApi()
      if (!api || !gitCwd) {
        toastManager.add({
          type: 'error',
          title: 'Editor opening is unavailable.',
          data: threadToastData,
        })
        return
      }
      const target = resolvePathLinkTarget(filePath, gitCwd)
      void openInPreferredEditor(api, target).catch(error => {
        toastManager.add({
          type: 'error',
          title: 'Unable to open file',
          description: error instanceof Error ? error.message : 'An error occurred.',
          data: threadToastData,
        })
      })
    },
    [gitCwd, threadToastData]
  )
}

function CommitDialogFilesHeader({
  allFiles,
  selectedFiles,
  allSelected,
  noneSelected,
  isEditingFiles,
  setExcludedFiles,
  setIsEditingFiles,
}: Pick<
  CommitDialogFilesProps,
  | 'allFiles'
  | 'selectedFiles'
  | 'allSelected'
  | 'noneSelected'
  | 'isEditingFiles'
  | 'setExcludedFiles'
  | 'setIsEditingFiles'
>) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {isEditingFiles && allFiles.length > 0 && (
          <Checkbox
            checked={allSelected}
            indeterminate={!allSelected && !noneSelected}
            onCheckedChange={() =>
              setExcludedFiles(
                allSelected ? () => new Set(allFiles.map(f => f.path)) : () => new Set()
              )
            }
          />
        )}
        <span className="text-muted-foreground">Files</span>
        {!allSelected && !isEditingFiles && (
          <span className="text-muted-foreground">
            ({selectedFiles.length} of {allFiles.length})
          </span>
        )}
      </div>
      {allFiles.length > 0 && (
        <Button variant="ghost" size="xs" onClick={() => setIsEditingFiles(prev => !prev)}>
          {isEditingFiles ? 'Done' : 'Edit'}
        </Button>
      )}
    </div>
  )
}

function CommitDialogFilesList({
  allFiles,
  selectedFiles,
  excludedFiles,
  isEditingFiles,
  setExcludedFiles,
  openChangedFileInEditor,
}: Pick<
  CommitDialogFilesProps,
  'allFiles' | 'selectedFiles' | 'excludedFiles' | 'isEditingFiles' | 'setExcludedFiles'
> & { openChangedFileInEditor: (path: string) => void }) {
  if (allFiles.length === 0) return <p className="font-medium">none</p>
  return (
    <div className="space-y-2">
      <ScrollArea className="h-44 rounded-md border border-input bg-background">
        <div className="space-y-1 p-1">
          {allFiles.map(file => (
            <FileRow
              key={file.path}
              file={file}
              isExcluded={excludedFiles.has(file.path)}
              isEditingFiles={isEditingFiles}
              excludedFiles={excludedFiles}
              setExcludedFiles={setExcludedFiles}
              onOpen={openChangedFileInEditor}
            />
          ))}
        </div>
      </ScrollArea>
      <div className="flex justify-end font-mono">
        <span className="text-success">
          +{selectedFiles.reduce((sum, f) => sum + f.insertions, 0)}
        </span>
        <span className="text-muted-foreground"> / </span>
        <span className="text-destructive">
          -{selectedFiles.reduce((sum, f) => sum + f.deletions, 0)}
        </span>
      </div>
    </div>
  )
}

function CommitDialogFiles(props: CommitDialogFilesProps) {
  const openChangedFileInEditor = useOpenChangedFileInEditor(props.gitCwd, props.threadToastData)
  return (
    <div className="space-y-1">
      <CommitDialogFilesHeader
        allFiles={props.allFiles}
        selectedFiles={props.selectedFiles}
        allSelected={props.allSelected}
        noneSelected={props.noneSelected}
        isEditingFiles={props.isEditingFiles}
        setExcludedFiles={props.setExcludedFiles}
        setIsEditingFiles={props.setIsEditingFiles}
      />
      <CommitDialogFilesList
        allFiles={props.allFiles}
        selectedFiles={props.selectedFiles}
        excludedFiles={props.excludedFiles}
        isEditingFiles={props.isEditingFiles}
        setExcludedFiles={props.setExcludedFiles}
        openChangedFileInEditor={openChangedFileInEditor}
      />
    </div>
  )
}

export interface CommitDialogProps {
  isOpen: boolean
  gitStatusForActions: GitStatusResult | null
  dialogCommitMessage: string
  excludedFiles: ReadonlySet<string>
  isEditingFiles: boolean
  isDefaultBranch: boolean
  noneSelected: boolean
  gitCwd: string | null
  threadToastData: { threadId: ThreadId } | undefined
  allFiles: ReadonlyArray<ChangedFile>
  selectedFiles: ReadonlyArray<ChangedFile>
  onClose: () => void
  onDialogCommitMessageChange: (value: string) => void
  setExcludedFiles: (fn: (prev: ReadonlySet<string>) => ReadonlySet<string>) => void
  setIsEditingFiles: (fn: (prev: boolean) => boolean) => void
  onRunDialogActionOnNewBranch: () => void
  onRunDialogAction: () => void
}

function CommitDialogBranchRow({
  branch,
  isDefaultBranch,
}: {
  branch: string
  isDefaultBranch: boolean
}) {
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
      <span className="text-muted-foreground">Branch</span>
      <span className="flex items-center justify-between gap-2">
        <span className="font-medium">{branch}</span>
        {isDefaultBranch && (
          <span className="text-right text-warning text-xs">Warning: default branch</span>
        )}
      </span>
    </div>
  )
}

function CommitDialogFooter({
  noneSelected,
  onClose,
  onRunDialogActionOnNewBranch,
  onRunDialogAction,
}: Pick<
  CommitDialogProps,
  'noneSelected' | 'onClose' | 'onRunDialogActionOnNewBranch' | 'onRunDialogAction'
>) {
  return (
    <DialogFooter>
      <Button variant="outline" size="sm" onClick={onClose}>
        Cancel
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={noneSelected}
        onClick={onRunDialogActionOnNewBranch}
      >
        Commit on new branch
      </Button>
      <Button size="sm" disabled={noneSelected} onClick={onRunDialogAction}>
        Commit
      </Button>
    </DialogFooter>
  )
}

export function CommitDialog(props: CommitDialogProps) {
  const {
    isOpen,
    gitStatusForActions,
    dialogCommitMessage,
    excludedFiles,
    isDefaultBranch,
    noneSelected,
    onClose,
    onDialogCommitMessageChange,
  } = props
  const allSelected = excludedFiles.size === 0
  const branch = gitStatusForActions?.branch ?? '(detached HEAD)'
  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) onClose()
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{COMMIT_DIALOG_TITLE}</DialogTitle>
          <DialogDescription>{COMMIT_DIALOG_DESCRIPTION}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="space-y-3 rounded-lg border border-input bg-muted/40 p-3 text-xs">
            <CommitDialogBranchRow branch={branch} isDefaultBranch={isDefaultBranch} />
            {gitStatusForActions ? (
              <CommitDialogFiles {...props} allSelected={allSelected} />
            ) : (
              <div className="space-y-1">
                <div className="text-muted-foreground">Files</div>
                <p className="font-medium">none</p>
              </div>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium">Commit message (optional)</p>
            <Textarea
              value={dialogCommitMessage}
              onChange={event => onDialogCommitMessageChange(event.target.value)}
              placeholder="Leave empty to auto-generate"
              size="sm"
            />
          </div>
        </DialogPanel>
        <CommitDialogFooter
          noneSelected={noneSelected}
          onClose={onClose}
          onRunDialogActionOnNewBranch={props.onRunDialogActionOnNewBranch}
          onRunDialogAction={props.onRunDialogAction}
        />
      </DialogPopup>
    </Dialog>
  )
}

export interface PendingDefaultBranchAction {
  action: DefaultBranchConfirmableAction
  branchName: string
  includesCommit: boolean
  commitMessage?: string
  forcePushOnlyProgress: boolean
  onConfirmed?: () => void
  filePaths?: string[]
}

export interface DefaultBranchDialogProps {
  pendingDefaultBranchAction: PendingDefaultBranchAction | null
  onAbort: () => void
  onContinue: () => void
  onCheckoutFeatureBranch: () => void
}

export function DefaultBranchDialog({
  pendingDefaultBranchAction,
  onAbort,
  onContinue,
  onCheckoutFeatureBranch,
}: DefaultBranchDialogProps) {
  const copy = pendingDefaultBranchAction
    ? resolveDefaultBranchActionDialogCopy({
        action: pendingDefaultBranchAction.action,
        branchName: pendingDefaultBranchAction.branchName,
        includesCommit: pendingDefaultBranchAction.includesCommit,
      })
    : null

  return (
    <Dialog
      open={pendingDefaultBranchAction !== null}
      onOpenChange={open => {
        if (!open) onAbort()
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{copy?.title ?? 'Run action on default branch?'}</DialogTitle>
          <DialogDescription>{copy?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onAbort}>
            Abort
          </Button>
          <Button variant="outline" size="sm" onClick={onContinue}>
            {copy?.continueLabel ?? 'Continue'}
          </Button>
          <Button size="sm" onClick={onCheckoutFeatureBranch}>
            Checkout feature branch & continue
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
