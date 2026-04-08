import { useMutation } from '@tanstack/react-query'
import { useMemo } from 'react'

import { gitPreparePullRequestThreadMutationOptions } from '~/lib/gitReactQuery'
import { PullRequestDialogBody } from './PullRequestThreadDialog.body'
import { Dialog } from './ui/dialog'
import {
  resolvePullRequestDialogMessages,
  usePreparePullRequestThread,
  usePullRequestDialogState,
  useResolvedPullRequestState,
} from './PullRequestThreadDialog.logic'

interface PullRequestThreadDialogProps {
  open: boolean
  cwd: string | null
  initialReference: string | null
  onOpenChange: (open: boolean) => void
  onPrepared: (input: { branch: string; worktreePath: string | null }) => Promise<void> | void
}

function resolvePullRequestStatusTone(state: 'open' | 'closed' | 'merged' | undefined) {
  switch (state) {
    case 'merged':
      return 'text-violet-600 dark:text-violet-300/90'
    case 'closed':
      return 'text-zinc-500 dark:text-zinc-400/80'
    case 'open':
      return 'text-emerald-600 dark:text-emerald-300/90'
    default:
      return 'text-muted-foreground'
  }
}

export function PullRequestThreadDialog({
  open,
  cwd,
  initialReference,
  onOpenChange,
  onPrepared,
}: PullRequestThreadDialogProps) {
  const dialogState = usePullRequestDialogState(initialReference, open)
  const {
    queryClient,
    parsedReference,
    resolvePullRequestQuery,
    resolvedPullRequest,
    isResolving,
  } = useResolvedPullRequestState({
    cwd,
    open,
    reference: dialogState.reference,
    debouncedReference: dialogState.debouncedReference,
    referenceDebouncer: dialogState.referenceDebouncer,
  })
  const preparePullRequestThreadMutation = useMutation(
    gitPreparePullRequestThreadMutationOptions({ cwd, queryClient })
  )
  const statusTone = useMemo(
    () => resolvePullRequestStatusTone(resolvedPullRequest?.state),
    [resolvedPullRequest?.state]
  )
  const handleConfirm = usePreparePullRequestThread({
    cwd,
    parsedReference,
    resolvedPullRequest,
    preparePullRequestThreadMutation,
    onPrepared,
    onOpenChange,
    setReferenceDirty: dialogState.setReferenceDirty,
    setPreparingMode: dialogState.setPreparingMode,
  })
  const { errorMessage } = resolvePullRequestDialogMessages({
    referenceDirty: dialogState.referenceDirty,
    reference: dialogState.reference,
    parsedReference,
    resolvedPullRequest,
    resolvePullRequestQuery,
    preparePullRequestThreadMutation,
  })

  return (
    <Dialog
      open={open}
      onOpenChange={nextOpen => {
        if (!preparePullRequestThreadMutation.isPending) {
          onOpenChange(nextOpen)
        }
      }}
    >
      <PullRequestDialogBody
        referenceInputRef={dialogState.referenceInputRef}
        reference={dialogState.reference}
        setReferenceDirty={dialogState.setReferenceDirty}
        setReference={dialogState.setReference}
        resolvedPullRequest={resolvedPullRequest}
        isResolving={isResolving}
        errorMessage={errorMessage}
        statusTone={statusTone}
        isPending={preparePullRequestThreadMutation.isPending}
        cwd={cwd}
        preparingMode={dialogState.preparingMode}
        onOpenChange={onOpenChange}
        onConfirm={handleConfirm}
      />
    </Dialog>
  )
}
