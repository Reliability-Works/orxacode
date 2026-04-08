import type { GitResolvePullRequestResult } from '@orxa-code/contracts'
import { cn } from '~/lib/utils'

import { Button } from './ui/button'
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'
import { Spinner } from './ui/spinner'

function PullRequestReferenceField({
  referenceInputRef,
  reference,
  setReferenceDirty,
  setReference,
  isResolving,
  isPending,
  onConfirm,
}: {
  referenceInputRef: React.RefObject<HTMLInputElement | null>
  reference: string
  setReferenceDirty: (dirty: boolean) => void
  setReference: (value: string) => void
  isResolving: boolean
  isPending: boolean
  onConfirm: (mode: 'local' | 'worktree') => void
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-foreground">Pull request</span>
      <Input
        ref={referenceInputRef}
        placeholder="https://github.com/owner/repo/pull/42, gh pr checkout 42, or #42"
        value={reference}
        onChange={event => {
          setReferenceDirty(true)
          setReference(event.target.value)
        }}
        onKeyDown={event => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          if (!isResolving && !isPending) {
            void onConfirm('local')
          }
        }}
      />
    </label>
  )
}

function PullRequestResolutionSummary(props: {
  resolvedPullRequest: GitResolvePullRequestResult['pullRequest'] | null
  isResolving: boolean
  errorMessage: string | null
  statusTone: string
}) {
  return (
    <>
      {props.resolvedPullRequest ? (
        <div className="rounded-xl border border-border/70 bg-muted/24 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium text-sm">{props.resolvedPullRequest.title}</p>
              <p className="truncate text-muted-foreground text-xs">
                #{props.resolvedPullRequest.number} · {props.resolvedPullRequest.headBranch} to{' '}
                {props.resolvedPullRequest.baseBranch}
              </p>
            </div>
            <span className={cn('shrink-0 text-xs capitalize', props.statusTone)}>
              {props.resolvedPullRequest.state}
            </span>
          </div>
        </div>
      ) : null}

      {props.isResolving ? (
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <Spinner className="size-3.5" />
          Resolving pull request...
        </div>
      ) : null}

      {props.errorMessage ? <p className="text-destructive text-xs">{props.errorMessage}</p> : null}
    </>
  )
}

function PullRequestDialogFooter(props: {
  cwd: string | null
  resolvedPullRequest: GitResolvePullRequestResult['pullRequest'] | null
  isResolving: boolean
  isPending: boolean
  preparingMode: 'local' | 'worktree' | null
  onOpenChange: (open: boolean) => void
  onConfirm: (mode: 'local' | 'worktree') => void
}) {
  const controlsDisabled =
    !props.cwd || !props.resolvedPullRequest || props.isResolving || props.isPending
  return (
    <DialogFooter>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => props.onOpenChange(false)}
        disabled={props.isPending}
      >
        Cancel
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          void props.onConfirm('local')
        }}
        disabled={controlsDisabled}
      >
        {props.preparingMode === 'local' ? 'Preparing local...' : 'Local'}
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={() => {
          void props.onConfirm('worktree')
        }}
        disabled={controlsDisabled}
      >
        {props.preparingMode === 'worktree' ? 'Preparing worktree...' : 'Worktree'}
      </Button>
    </DialogFooter>
  )
}

export function PullRequestDialogBody(props: {
  referenceInputRef: React.RefObject<HTMLInputElement | null>
  reference: string
  setReferenceDirty: (dirty: boolean) => void
  setReference: (value: string) => void
  resolvedPullRequest: GitResolvePullRequestResult['pullRequest'] | null
  isResolving: boolean
  errorMessage: string | null
  statusTone: string
  isPending: boolean
  cwd: string | null
  preparingMode: 'local' | 'worktree' | null
  onOpenChange: (open: boolean) => void
  onConfirm: (mode: 'local' | 'worktree') => void
}) {
  return (
    <DialogPopup className="max-w-xl">
      <DialogHeader>
        <DialogTitle>Checkout Pull Request</DialogTitle>
        <DialogDescription>
          Resolve a GitHub pull request, then create the draft thread in the main repo or in a
          dedicated worktree.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="space-y-4">
        <PullRequestReferenceField
          referenceInputRef={props.referenceInputRef}
          reference={props.reference}
          setReferenceDirty={props.setReferenceDirty}
          setReference={props.setReference}
          isResolving={props.isResolving}
          isPending={props.isPending}
          onConfirm={props.onConfirm}
        />
        <PullRequestResolutionSummary
          resolvedPullRequest={props.resolvedPullRequest}
          isResolving={props.isResolving}
          errorMessage={props.errorMessage}
          statusTone={props.statusTone}
        />
      </DialogPanel>
      <PullRequestDialogFooter
        cwd={props.cwd}
        resolvedPullRequest={props.resolvedPullRequest}
        isResolving={props.isResolving}
        isPending={props.isPending}
        preparingMode={props.preparingMode}
        onOpenChange={props.onOpenChange}
        onConfirm={props.onConfirm}
      />
    </DialogPopup>
  )
}
