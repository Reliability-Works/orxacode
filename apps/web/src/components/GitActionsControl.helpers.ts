import type {
  GitActionProgressEvent,
  GitRunStackedActionResult,
  GitStackedAction,
  GitStatusResult,
  ThreadId,
} from '@orxa-code/contracts'
import type { MutableRefObject } from 'react'

import { toastManager } from '~/components/ui/toastState'
import { randomUUID } from '~/lib/utils'
import { readNativeApi } from '~/nativeApi'

import {
  buildGitActionProgressStages,
  type GitActionMenuItem,
  requiresDefaultBranchConfirmation,
  summarizeGitResult,
} from './GitActionsControl.logic'
import { type PendingDefaultBranchAction } from './GitActionsControlDialogs'

export type GitActionToastId = ReturnType<typeof toastManager.add>

export interface ActiveGitActionProgress {
  toastId: GitActionToastId
  actionId: string
  title: string
  phaseStartedAtMs: number | null
  hookStartedAtMs: number | null
  hookName: string | null
  lastOutputLine: string | null
  currentPhaseLabel: string | null
}

export interface RunGitActionWithToastInput {
  action: GitStackedAction
  commitMessage?: string
  forcePushOnlyProgress?: boolean
  onConfirmed?: () => void
  skipDefaultBranchPrompt?: boolean
  statusOverride?: GitStatusResult | null
  featureBranch?: boolean
  isDefaultBranchOverride?: boolean
  progressToastId?: GitActionToastId
  filePaths?: string[]
}

export interface RunGitActionContext {
  actionStatus: GitStatusResult | null
  actionIsDefaultBranch: boolean
  includesCommit: boolean
}

function formatElapsedDescription(startedAtMs: number | null): string | undefined {
  if (startedAtMs === null) return undefined
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
  if (elapsedSeconds < 60) return `Running for ${elapsedSeconds}s`
  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = elapsedSeconds % 60
  return `Running for ${minutes}m ${seconds}s`
}

export function resolveProgressDescription(progress: ActiveGitActionProgress): string | undefined {
  if (progress.lastOutputLine) return progress.lastOutputLine
  return formatElapsedDescription(progress.hookStartedAtMs ?? progress.phaseStartedAtMs)
}

function getCommitDisabledReason(hasChanges: boolean): string {
  if (!hasChanges) return 'Worktree is clean. Make changes before committing.'
  return 'Commit is currently unavailable.'
}

function getPushDisabledReason(input: {
  gitStatus: GitStatusResult
  hasBranch: boolean
  hasChanges: boolean
  isAhead: boolean
  isBehind: boolean
  hasOriginRemote: boolean
}): string {
  if (!input.hasBranch) return 'Detached HEAD: checkout a branch before pushing.'
  if (input.hasChanges) return 'Commit or stash local changes before pushing.'
  if (input.isBehind) return 'Branch is behind upstream. Pull/rebase before pushing.'
  if (!input.gitStatus.hasUpstream && !input.hasOriginRemote)
    return 'Add an "origin" remote before pushing.'
  if (!input.isAhead) return 'No local commits to push.'
  return 'Push is currently unavailable.'
}

function getPullRequestDisabledReason(input: {
  gitStatus: GitStatusResult
  hasBranch: boolean
  hasChanges: boolean
  hasOpenPr: boolean
  isAhead: boolean
  isBehind: boolean
  hasOriginRemote: boolean
}): string {
  if (input.hasOpenPr) return 'View PR is currently unavailable.'
  if (!input.hasBranch) return 'Detached HEAD: checkout a branch before creating a PR.'
  if (input.hasChanges) return 'Commit local changes before creating a PR.'
  if (!input.gitStatus.hasUpstream && !input.hasOriginRemote)
    return 'Add an "origin" remote before creating a PR.'
  if (!input.isAhead) return 'No local commits to include in a PR.'
  if (input.isBehind) return 'Branch is behind upstream. Pull/rebase before creating a PR.'
  return 'Create PR is currently unavailable.'
}

export function queueDefaultBranchActionPrompt(input: {
  action: GitStackedAction
  commitMessage?: string | undefined
  filePaths?: string[] | undefined
  forcePushOnlyProgress: boolean
  onConfirmed?: (() => void) | undefined
  setPendingDefaultBranchAction: (value: PendingDefaultBranchAction | null) => void
  skipDefaultBranchPrompt: boolean
  runContext: RunGitActionContext
}): boolean {
  const actionBranch = input.runContext.actionStatus?.branch ?? null
  if (
    input.skipDefaultBranchPrompt ||
    !requiresDefaultBranchConfirmation(input.action, input.runContext.actionIsDefaultBranch) ||
    !actionBranch
  )
    return false
  if (input.action !== 'commit_push' && input.action !== 'commit_push_pr') return true
  input.setPendingDefaultBranchAction({
    action: input.action,
    branchName: actionBranch,
    includesCommit: input.runContext.includesCommit,
    ...(input.commitMessage ? { commitMessage: input.commitMessage } : {}),
    forcePushOnlyProgress: input.forcePushOnlyProgress,
    ...(input.onConfirmed ? { onConfirmed: input.onConfirmed } : {}),
    ...(input.filePaths ? { filePaths: input.filePaths } : {}),
  })
  return true
}

export function createRunGitActionContext(input: {
  action: GitStackedAction
  forcePushOnlyProgress: boolean
  gitStatusForActions: GitStatusResult | null
  isDefaultBranch: boolean
  isDefaultBranchOverride?: boolean | undefined
  featureBranch: boolean
  statusOverride?: GitStatusResult | null | undefined
}): RunGitActionContext {
  const actionStatus = input.statusOverride ?? input.gitStatusForActions
  return {
    actionStatus,
    actionIsDefaultBranch:
      input.isDefaultBranchOverride ?? (input.featureBranch ? false : input.isDefaultBranch),
    includesCommit:
      !input.forcePushOnlyProgress &&
      (input.action === 'commit' || !!actionStatus?.hasWorkingTreeChanges),
  }
}

export function initializeGitActionProgress(input: {
  action: GitStackedAction
  commitMessage?: string | undefined
  featureBranch: boolean
  forcePushOnlyProgress: boolean
  progressToastId?: GitActionToastId | undefined
  runContext: RunGitActionContext
  threadToastData: { threadId: ThreadId } | undefined
}): { actionId: string; progressStages: string[]; resolvedProgressToastId: GitActionToastId } {
  const progressStages = buildGitActionProgressStages({
    action: input.action,
    hasCustomCommitMessage: !!input.commitMessage?.trim(),
    hasWorkingTreeChanges: !!input.runContext.actionStatus?.hasWorkingTreeChanges,
    forcePushOnly: input.forcePushOnlyProgress,
    featureBranch: input.featureBranch,
  })
  const resolvedProgressToastId =
    input.progressToastId ??
    toastManager.add({
      type: 'loading',
      title: progressStages[0] ?? 'Running git action...',
      description: 'Waiting for Git...',
      timeout: 0,
      data: input.threadToastData,
    })
  if (input.progressToastId) {
    toastManager.update(input.progressToastId, {
      type: 'loading',
      title: progressStages[0] ?? 'Running git action...',
      description: 'Waiting for Git...',
      timeout: 0,
      data: input.threadToastData,
    })
  }
  return { actionId: randomUUID(), progressStages, resolvedProgressToastId }
}

export function createGitActionMutationInput(input: {
  action: GitStackedAction
  actionId: string
  commitMessage?: string | undefined
  featureBranch: boolean
  filePaths?: string[] | undefined
  gitCwd: string | null
  progressRef: MutableRefObject<ActiveGitActionProgress | null>
  updateToast: () => void
}) {
  return {
    action: input.action,
    actionId: input.actionId,
    ...(input.commitMessage ? { commitMessage: input.commitMessage } : {}),
    ...(input.featureBranch ? { featureBranch: input.featureBranch } : {}),
    ...(input.filePaths ? { filePaths: input.filePaths } : {}),
    onProgress: (event: GitActionProgressEvent) =>
      applyGitActionProgressEvent({
        event,
        gitCwd: input.gitCwd,
        progressRef: input.progressRef,
        updateToast: input.updateToast,
      }),
  }
}

function applyGitActionProgressEvent(input: {
  event: GitActionProgressEvent
  gitCwd: string | null
  progressRef: MutableRefObject<ActiveGitActionProgress | null>
  updateToast: () => void
}): void {
  const progress = input.progressRef.current
  if (!progress) return
  if (input.gitCwd && input.event.cwd !== input.gitCwd) return
  if (progress.actionId !== input.event.actionId) return
  const now = Date.now()
  switch (input.event.kind) {
    case 'action_started':
      progress.phaseStartedAtMs = now
      progress.hookStartedAtMs = null
      progress.hookName = null
      progress.lastOutputLine = null
      break
    case 'phase_started':
      progress.title = input.event.label
      progress.currentPhaseLabel = input.event.label
      progress.phaseStartedAtMs = now
      progress.hookStartedAtMs = null
      progress.hookName = null
      progress.lastOutputLine = null
      break
    case 'hook_started':
      progress.title = `Running ${input.event.hookName}...`
      progress.hookName = input.event.hookName
      progress.hookStartedAtMs = now
      progress.lastOutputLine = null
      break
    case 'hook_output':
      progress.lastOutputLine = input.event.text
      break
    case 'hook_finished':
      progress.title = progress.currentPhaseLabel ?? 'Committing...'
      progress.hookName = null
      progress.hookStartedAtMs = null
      progress.lastOutputLine = null
      break
    case 'action_failed':
    case 'action_finished':
      return
  }
  input.updateToast()
}

export function setActiveGitActionProgress(input: {
  actionId: string
  progressRef: MutableRefObject<ActiveGitActionProgress | null>
  progressStages: string[]
  resolvedProgressToastId: GitActionToastId
}): void {
  input.progressRef.current = {
    toastId: input.resolvedProgressToastId,
    actionId: input.actionId,
    title: input.progressStages[0] ?? 'Running git action...',
    phaseStartedAtMs: null,
    hookStartedAtMs: null,
    hookName: null,
    lastOutputLine: null,
    currentPhaseLabel: input.progressStages[0] ?? 'Running git action...',
  }
}

function buildGitActionSuccessActionProps(input: {
  action: GitStackedAction
  actionIsDefaultBranch: boolean
  actionStatus: GitStatusResult | null
  closeResultToast: () => void
  prUrl?: string | undefined
  rerunAction: (
    next: Partial<RunGitActionWithToastInput> & Pick<RunGitActionWithToastInput, 'action'>
  ) => void
  result: GitRunStackedActionResult
}): { actionProps: { children: string; onClick: () => void } } | undefined {
  const shouldOfferPushCta = input.action === 'commit' && input.result.commit.status === 'created'
  const shouldOfferOpenPrCta =
    (input.action === 'commit_push' || input.action === 'commit_push_pr') &&
    !!input.prUrl &&
    (!input.actionIsDefaultBranch ||
      input.result.pr.status === 'created' ||
      input.result.pr.status === 'opened_existing')
  const shouldOfferCreatePrCta =
    input.action === 'commit_push' &&
    !input.prUrl &&
    input.result.push.status === 'pushed' &&
    !input.actionIsDefaultBranch
  if (shouldOfferPushCta) {
    return {
      actionProps: {
        children: 'Push',
        onClick: () => {
          input.rerunAction({
            action: 'commit_push',
            forcePushOnlyProgress: true,
            onConfirmed: input.closeResultToast,
            statusOverride: input.actionStatus,
            isDefaultBranchOverride: input.actionIsDefaultBranch,
          })
        },
      },
    }
  }
  if (shouldOfferOpenPrCta && input.prUrl) {
    const prUrl = input.prUrl
    return {
      actionProps: {
        children: 'View PR',
        onClick: () => {
          const api = readNativeApi()
          if (!api) return
          input.closeResultToast()
          void api.shell.openExternal(prUrl)
        },
      },
    }
  }
  if (shouldOfferCreatePrCta) {
    return {
      actionProps: {
        children: 'Create PR',
        onClick: () => {
          input.closeResultToast()
          input.rerunAction({
            action: 'commit_push_pr',
            forcePushOnlyProgress: true,
            statusOverride: input.actionStatus,
            isDefaultBranchOverride: input.actionIsDefaultBranch,
          })
        },
      },
    }
  }
  return undefined
}

export function completeGitActionSuccess(input: {
  action: GitStackedAction
  actionIsDefaultBranch: boolean
  actionStatus: GitStatusResult | null
  resolvedProgressToastId: GitActionToastId
  result: GitRunStackedActionResult
  rerunAction: (
    next: Partial<RunGitActionWithToastInput> & Pick<RunGitActionWithToastInput, 'action'>
  ) => void
  threadToastData: { threadId: ThreadId } | undefined
}): void {
  const resultToast = summarizeGitResult(input.result)
  const existingOpenPrUrl =
    input.actionStatus?.pr?.state === 'open' ? input.actionStatus.pr.url : undefined
  const prUrl = input.result.pr.url ?? existingOpenPrUrl
  const closeResultToast = () => {
    toastManager.close(input.resolvedProgressToastId)
  }
  toastManager.update(input.resolvedProgressToastId, {
    type: 'success',
    title: resultToast.title,
    description: resultToast.description,
    timeout: 0,
    data: { ...input.threadToastData, dismissAfterVisibleMs: 10_000 },
    ...buildGitActionSuccessActionProps({
      action: input.action,
      actionIsDefaultBranch: input.actionIsDefaultBranch,
      actionStatus: input.actionStatus,
      closeResultToast,
      prUrl,
      rerunAction: input.rerunAction,
      result: input.result,
    }),
  })
}

export function completeGitActionFailure(input: {
  error: unknown
  resolvedProgressToastId: GitActionToastId
  threadToastData: { threadId: ThreadId } | undefined
}): void {
  toastManager.update(input.resolvedProgressToastId, {
    type: 'error',
    title: 'Action failed',
    description: input.error instanceof Error ? input.error.message : 'An error occurred.',
    data: input.threadToastData,
  })
}

export function getMenuActionDisabledReason({
  item,
  gitStatus,
  isBusy,
  hasOriginRemote,
}: {
  item: GitActionMenuItem
  gitStatus: GitStatusResult | null
  isBusy: boolean
  hasOriginRemote: boolean
}): string | null {
  if (!item.disabled) return null
  if (isBusy) return 'Git action in progress.'
  if (!gitStatus) return 'Git status is unavailable.'
  const hasBranch = gitStatus.branch !== null
  const hasChanges = gitStatus.hasWorkingTreeChanges
  const hasOpenPr = gitStatus.pr?.state === 'open'
  const isAhead = gitStatus.aheadCount > 0
  const isBehind = gitStatus.behindCount > 0
  if (item.id === 'commit') return getCommitDisabledReason(hasChanges)
  if (item.id === 'push')
    return getPushDisabledReason({
      gitStatus,
      hasBranch,
      hasChanges,
      isAhead,
      isBehind,
      hasOriginRemote,
    })
  if (item.id === 'push_to_parent') {
    if (!hasBranch) return 'Detached HEAD: checkout a branch before pushing.'
    if (hasChanges) return 'Commit local changes before pushing into parent.'
    if (isBehind) return 'Branch is behind upstream. Pull/rebase before pushing.'
    if (!isAhead) return 'No local commits to push into parent.'
    return 'Push into parent is currently unavailable.'
  }
  return getPullRequestDisabledReason({
    gitStatus,
    hasBranch,
    hasChanges,
    hasOpenPr,
    isAhead,
    isBehind,
    hasOriginRemote,
  })
}
