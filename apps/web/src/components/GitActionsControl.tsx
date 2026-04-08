import type { ThreadId } from '@orxa-code/contracts'
import { useEffect } from 'react'

import { Button } from '~/components/ui/button'

import { CommitDialog, DefaultBranchDialog } from './GitActionsControlDialogs'
import { useGitActions } from './GitActionsControl.actions'
import { getMenuActionDisabledReason } from './GitActionsControl.helpers'
import { type GitQuickAction } from './GitActionsControl.logic'
import { useGitActionsState } from './GitActionsControl.state'
import { GitActionsToolbar, GitActionItemIcon } from './GitActionsControlToolbar'

interface GitActionsControlProps {
  gitCwd: string | null
  activeThreadId: ThreadId | null
}

// Re-export for backwards compatibility with any tests importing directly
export { GitActionItemIcon }

function useActiveGitActionProgressInterval(state: ReturnType<typeof useGitActionsState>): void {
  const { activeGitActionProgressRef, updateActiveProgressToast } = state
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (activeGitActionProgressRef.current) updateActiveProgressToast()
    }, 1000)
    return () => {
      window.clearInterval(interval)
    }
  }, [activeGitActionProgressRef, updateActiveProgressToast])
}

interface GitActionsMainControlsProps {
  state: ReturnType<typeof useGitActionsState>
  actions: ReturnType<typeof useGitActions>
}

function GitActionsMainControls({ state: s, actions }: GitActionsMainControlsProps) {
  const quickActionDisabledReason = s.quickAction.disabled
    ? (s.quickAction.hint ?? 'This action is currently unavailable.')
    : null
  if (!s.isRepo) {
    return (
      <Button
        variant="outline"
        size="xs"
        disabled={s.initMutation.isPending}
        onClick={() => s.initMutation.mutate()}
      >
        {s.initMutation.isPending ? 'Initializing...' : 'Initialize Git'}
      </Button>
    )
  }
  return (
    <GitActionsToolbar
      quickAction={s.quickAction as GitQuickAction}
      quickActionDisabledReason={quickActionDisabledReason}
      isGitActionRunning={s.isGitActionRunning}
      onRunQuickAction={actions.runQuickAction}
      gitActionMenuItems={s.gitActionMenuItems}
      gitStatusForActions={s.gitStatusForActions}
      gitStatusError={s.gitStatusError as Error | null}
      isGitStatusOutOfSync={s.isGitStatusOutOfSync}
      hasOriginRemote={s.hasOriginRemote}
      getMenuActionDisabledReason={getMenuActionDisabledReason}
      onOpenDialogForMenuItem={actions.openDialogForMenuItem}
    />
  )
}

export default function GitActionsControl({ gitCwd, activeThreadId }: GitActionsControlProps) {
  const s = useGitActionsState(gitCwd, activeThreadId)
  const actions = useGitActions(gitCwd, s)
  useActiveGitActionProgressInterval(s)
  if (!gitCwd) return null
  return (
    <>
      <GitActionsMainControls state={s} actions={actions} />
      <CommitDialog
        isOpen={s.isCommitDialogOpen}
        gitStatusForActions={s.gitStatusForActions}
        dialogCommitMessage={s.dialogCommitMessage}
        excludedFiles={s.excludedFiles}
        isEditingFiles={s.isEditingFiles}
        isDefaultBranch={s.isDefaultBranch}
        noneSelected={s.noneSelected}
        gitCwd={gitCwd}
        threadToastData={s.threadToastData}
        allFiles={s.allFiles}
        selectedFiles={s.selectedFiles}
        onClose={() => {
          s.setIsCommitDialogOpen(false)
          s.setDialogCommitMessage('')
          s.setExcludedFiles(new Set())
          s.setIsEditingFiles(false)
        }}
        onDialogCommitMessageChange={s.setDialogCommitMessage}
        setExcludedFiles={s.setExcludedFiles}
        setIsEditingFiles={s.setIsEditingFiles}
        onRunDialogActionOnNewBranch={actions.runDialogActionOnNewBranch}
        onRunDialogAction={actions.runDialogAction}
      />
      <DefaultBranchDialog
        pendingDefaultBranchAction={s.pendingDefaultBranchAction}
        onAbort={() => s.setPendingDefaultBranchAction(null)}
        onContinue={actions.continuePendingDefaultBranchAction}
        onCheckoutFeatureBranch={actions.checkoutFeatureBranchAndContinuePendingAction}
      />
    </>
  )
}
