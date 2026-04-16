import { useCallback } from 'react'

import { toastManager } from '~/components/ui/toastState'
import { readNativeApi } from '~/nativeApi'

import {
  completeGitActionFailure,
  completeGitActionSuccess,
  createGitActionMutationInput,
  createRunGitActionContext,
  initializeGitActionProgress,
  queueDefaultBranchActionPrompt,
  type RunGitActionWithToastInput,
  setActiveGitActionProgress,
} from './GitActionsControl.helpers'
import { type GitActionMenuItem } from './GitActionsControl.logic'
import { useGitActionsState } from './GitActionsControl.state'

async function executeGitActionMutation(input: {
  action: RunGitActionWithToastInput['action']
  actionId: string
  commitMessage: string | undefined
  featureBranch: boolean
  filePaths: string[] | undefined
  gitCwd: string | null
  progressRef: ReturnType<typeof useGitActionsState>['activeGitActionProgressRef']
  updateActiveProgressToast: () => void
  runImmediateGitActionMutation: ReturnType<
    typeof useGitActionsState
  >['runImmediateGitActionMutation']
  resolvedProgressToastId: ReturnType<typeof initializeGitActionProgress>['resolvedProgressToastId']
  runContext: ReturnType<typeof createRunGitActionContext>
  threadToastData: ReturnType<typeof useGitActionsState>['threadToastData']
  rerunAction: (next: RunGitActionWithToastInput) => void
}): Promise<void> {
  const promise = input.runImmediateGitActionMutation.mutateAsync(
    createGitActionMutationInput({
      action: input.action,
      actionId: input.actionId,
      commitMessage: input.commitMessage,
      featureBranch: input.featureBranch,
      filePaths: input.filePaths,
      gitCwd: input.gitCwd,
      progressRef: input.progressRef,
      updateToast: input.updateActiveProgressToast,
    })
  )
  try {
    const result = await promise
    input.progressRef.current = null
    completeGitActionSuccess({
      action: input.action,
      actionIsDefaultBranch: input.runContext.actionIsDefaultBranch,
      actionStatus: input.runContext.actionStatus,
      resolvedProgressToastId: input.resolvedProgressToastId,
      result,
      rerunAction: next => {
        input.rerunAction({ ...next, action: next.action })
      },
      threadToastData: input.threadToastData,
    })
  } catch (err) {
    input.progressRef.current = null
    completeGitActionFailure({
      error: err,
      resolvedProgressToastId: input.resolvedProgressToastId,
      threadToastData: input.threadToastData,
    })
  }
}

function prepareGitAction(
  input: RunGitActionWithToastInput,
  deps: {
    gitStatusForActions: ReturnType<typeof useGitActionsState>['gitStatusForActions']
    isDefaultBranch: boolean
    setPendingDefaultBranchAction: ReturnType<
      typeof useGitActionsState
    >['setPendingDefaultBranchAction']
    threadToastData: ReturnType<typeof useGitActionsState>['threadToastData']
    activeGitActionProgressRef: ReturnType<typeof useGitActionsState>['activeGitActionProgressRef']
  }
): {
  runContext: ReturnType<typeof createRunGitActionContext>
  actionId: string
  resolvedProgressToastId: ReturnType<typeof initializeGitActionProgress>['resolvedProgressToastId']
} | null {
  const {
    action,
    commitMessage,
    forcePushOnlyProgress = false,
    onConfirmed,
    skipDefaultBranchPrompt = false,
    statusOverride,
    featureBranch = false,
    isDefaultBranchOverride,
    progressToastId,
    filePaths,
  } = input
  const runContext = createRunGitActionContext({
    action,
    forcePushOnlyProgress,
    gitStatusForActions: deps.gitStatusForActions,
    isDefaultBranch: deps.isDefaultBranch,
    isDefaultBranchOverride,
    featureBranch,
    statusOverride,
  })
  if (
    queueDefaultBranchActionPrompt({
      action,
      commitMessage,
      filePaths,
      forcePushOnlyProgress,
      onConfirmed,
      setPendingDefaultBranchAction: deps.setPendingDefaultBranchAction,
      skipDefaultBranchPrompt,
      runContext,
    })
  )
    return null
  onConfirmed?.()
  const { actionId, progressStages, resolvedProgressToastId } = initializeGitActionProgress({
    action,
    featureBranch,
    commitMessage,
    forcePushOnlyProgress,
    progressToastId,
    runContext,
    threadToastData: deps.threadToastData,
  })
  setActiveGitActionProgress({
    actionId,
    progressRef: deps.activeGitActionProgressRef,
    progressStages,
    resolvedProgressToastId,
  })
  return { runContext, actionId, resolvedProgressToastId }
}

function useRunGitActionWithToast(
  gitCwd: string | null,
  state: ReturnType<typeof useGitActionsState>
) {
  const {
    threadToastData,
    setPendingDefaultBranchAction,
    activeGitActionProgressRef,
    updateActiveProgressToast,
    runImmediateGitActionMutation,
    gitStatusForActions,
    isDefaultBranch,
  } = state
  return useCallback(
    async function runGitActionWithToastInternal(input: RunGitActionWithToastInput) {
      const prepared = prepareGitAction(input, {
        gitStatusForActions,
        isDefaultBranch,
        setPendingDefaultBranchAction,
        threadToastData,
        activeGitActionProgressRef,
      })
      if (!prepared) return
      const { runContext, actionId, resolvedProgressToastId } = prepared
      await executeGitActionMutation({
        action: input.action,
        actionId,
        commitMessage: input.commitMessage,
        featureBranch: input.featureBranch ?? false,
        filePaths: input.filePaths,
        gitCwd,
        progressRef: activeGitActionProgressRef,
        updateActiveProgressToast,
        runImmediateGitActionMutation,
        resolvedProgressToastId,
        runContext,
        threadToastData,
        rerunAction: next => {
          void runGitActionWithToastInternal(next)
        },
      })
    },
    [
      gitCwd,
      gitStatusForActions,
      isDefaultBranch,
      runImmediateGitActionMutation,
      threadToastData,
      updateActiveProgressToast,
      activeGitActionProgressRef,
      setPendingDefaultBranchAction,
    ]
  )
}

function useOpenExistingPr(state: ReturnType<typeof useGitActionsState>) {
  const { threadToastData, gitStatusForActions } = state
  return useCallback(async () => {
    const api = readNativeApi()
    if (!api) {
      toastManager.add({
        type: 'error',
        title: 'Link opening is unavailable.',
        data: threadToastData,
      })
      return
    }
    const prUrl = gitStatusForActions?.pr?.state === 'open' ? gitStatusForActions.pr.url : null
    if (!prUrl) {
      toastManager.add({ type: 'error', title: 'No open PR found.', data: threadToastData })
      return
    }
    void api.shell.openExternal(prUrl).catch(err => {
      toastManager.add({
        type: 'error',
        title: 'Unable to open PR link',
        description: err instanceof Error ? err.message : 'An error occurred.',
        data: threadToastData,
      })
    })
  }, [gitStatusForActions, threadToastData])
}

function usePendingDefaultBranchActionHandlers(
  state: ReturnType<typeof useGitActionsState>,
  runGitActionWithToast: (input: RunGitActionWithToastInput) => Promise<void>
) {
  const { pendingDefaultBranchAction, setPendingDefaultBranchAction } = state
  const dispatchPending = useCallback(
    (extra: { featureBranch?: true }) => {
      if (!pendingDefaultBranchAction) return
      const { action, commitMessage, forcePushOnlyProgress, onConfirmed, filePaths } =
        pendingDefaultBranchAction
      setPendingDefaultBranchAction(null)
      void runGitActionWithToast({
        action,
        ...(commitMessage ? { commitMessage } : {}),
        forcePushOnlyProgress,
        ...(onConfirmed ? { onConfirmed } : {}),
        ...(filePaths ? { filePaths } : {}),
        ...extra,
        skipDefaultBranchPrompt: true,
      })
    },
    [pendingDefaultBranchAction, runGitActionWithToast, setPendingDefaultBranchAction]
  )
  const continuePendingDefaultBranchAction = useCallback(
    () => dispatchPending({}),
    [dispatchPending]
  )
  const checkoutFeatureBranchAndContinuePendingAction = useCallback(
    () => dispatchPending({ featureBranch: true }),
    [dispatchPending]
  )
  return { continuePendingDefaultBranchAction, checkoutFeatureBranchAndContinuePendingAction }
}

function useQuickActionRunner(
  state: ReturnType<typeof useGitActionsState>,
  runGitActionWithToast: (input: RunGitActionWithToastInput) => Promise<void>,
  openExistingPr: () => Promise<void>,
  pushWorktreeIntoParent: (parentBranch: string) => Promise<void>
) {
  const { quickAction, pullMutation, threadToastData } = state
  return useCallback(() => {
    if (quickAction.kind === 'open_pr') {
      void openExistingPr()
      return
    }
    if (quickAction.kind === 'push_to_parent' && quickAction.parentBranch) {
      void pushWorktreeIntoParent(quickAction.parentBranch)
      return
    }
    if (quickAction.kind === 'run_pull') {
      const promise = pullMutation.mutateAsync()
      toastManager.promise(promise, {
        loading: { title: 'Pulling...', data: threadToastData },
        success: result => ({
          title: result.status === 'pulled' ? 'Pulled' : 'Already up to date',
          description:
            result.status === 'pulled'
              ? `Updated ${result.branch} from ${result.upstreamBranch ?? 'upstream'}`
              : `${result.branch} is already synchronized.`,
          data: threadToastData,
        }),
        error: err => ({
          title: 'Pull failed',
          description: err instanceof Error ? err.message : 'An error occurred.',
          data: threadToastData,
        }),
      })
      void promise.catch(() => undefined)
      return
    }
    if (quickAction.kind === 'show_hint') {
      toastManager.add({
        type: 'info',
        title: quickAction.label,
        description: quickAction.hint,
        data: threadToastData,
      })
      return
    }
    if (quickAction.action) void runGitActionWithToast({ action: quickAction.action })
  }, [
    openExistingPr,
    pullMutation,
    pushWorktreeIntoParent,
    quickAction,
    runGitActionWithToast,
    threadToastData,
  ])
}

function usePushWorktreeIntoParent(state: ReturnType<typeof useGitActionsState>) {
  const { threadToastData, worktreeParent } = state
  return useCallback(
    async (parentBranch: string) => {
      const api = readNativeApi()
      if (!api || !worktreeParent) {
        toastManager.add({
          type: 'error',
          title: 'Push into parent is unavailable.',
          data: threadToastData,
        })
        return
      }
      const toastId = toastManager.add({
        type: 'loading',
        title: `Pushing into ${parentBranch}...`,
        timeout: 0,
        data: threadToastData,
      })
      try {
        const result = await api.git.pushWorktreeToParent({
          cwd: worktreeParent.worktreePath,
          sourceBranch: 'HEAD',
          parentBranch,
        })
        if (result.ok) {
          toastManager.update(toastId, {
            type: 'success',
            title: `Pushed into ${parentBranch}`,
            data: { ...threadToastData, dismissAfterVisibleMs: 6_000 },
          })
          return
        }
        const title =
          result.reason === 'non_fast_forward'
            ? `${parentBranch} moved ahead`
            : result.reason === 'protected'
              ? `${parentBranch} is protected`
              : 'Push into parent failed'
        toastManager.update(toastId, {
          type: 'error',
          title,
          description: result.message,
          data: threadToastData,
        })
      } catch (err) {
        toastManager.update(toastId, {
          type: 'error',
          title: 'Push into parent failed',
          description: err instanceof Error ? err.message : 'An error occurred.',
          data: threadToastData,
        })
      }
    },
    [threadToastData, worktreeParent]
  )
}

function useOpenDialogForMenuItem(
  state: ReturnType<typeof useGitActionsState>,
  runGitActionWithToast: (input: RunGitActionWithToastInput) => Promise<void>,
  openExistingPr: () => Promise<void>,
  pushWorktreeIntoParent: (parentBranch: string) => Promise<void>
) {
  const { setIsCommitDialogOpen, setExcludedFiles, setIsEditingFiles } = state
  return useCallback(
    (item: GitActionMenuItem) => {
      if (item.disabled) return
      if (item.kind === 'open_pr') {
        void openExistingPr()
        return
      }
      if (item.kind === 'push_to_parent' && item.parentBranch) {
        void pushWorktreeIntoParent(item.parentBranch)
        return
      }
      if (item.dialogAction === 'push') {
        void runGitActionWithToast({ action: 'commit_push', forcePushOnlyProgress: true })
        return
      }
      if (item.dialogAction === 'create_pr') {
        void runGitActionWithToast({ action: 'commit_push_pr' })
        return
      }
      setExcludedFiles(new Set())
      setIsEditingFiles(false)
      setIsCommitDialogOpen(true)
    },
    [
      openExistingPr,
      pushWorktreeIntoParent,
      runGitActionWithToast,
      setIsCommitDialogOpen,
      setExcludedFiles,
      setIsEditingFiles,
    ]
  )
}

function useRunCommitDialogAction(
  state: ReturnType<typeof useGitActionsState>,
  runGitActionWithToast: (input: RunGitActionWithToastInput) => Promise<void>,
  overrides: { featureBranch: boolean; skipDefaultBranchPrompt: boolean }
) {
  const {
    isCommitDialogOpen,
    dialogCommitMessage,
    setIsCommitDialogOpen,
    setDialogCommitMessage,
    setExcludedFiles,
    setIsEditingFiles,
    allSelected,
    selectedFiles,
  } = state
  const { featureBranch, skipDefaultBranchPrompt } = overrides
  return useCallback(() => {
    if (!isCommitDialogOpen) return
    const commitMessage = dialogCommitMessage.trim()
    setIsCommitDialogOpen(false)
    setDialogCommitMessage('')
    setExcludedFiles(new Set())
    setIsEditingFiles(false)
    void runGitActionWithToast({
      action: 'commit',
      ...(commitMessage ? { commitMessage } : {}),
      ...(!allSelected ? { filePaths: selectedFiles.map(f => f.path) } : {}),
      ...(featureBranch ? { featureBranch } : {}),
      ...(skipDefaultBranchPrompt ? { skipDefaultBranchPrompt } : {}),
    })
  }, [
    allSelected,
    dialogCommitMessage,
    featureBranch,
    isCommitDialogOpen,
    runGitActionWithToast,
    selectedFiles,
    setDialogCommitMessage,
    setExcludedFiles,
    setIsCommitDialogOpen,
    setIsEditingFiles,
    skipDefaultBranchPrompt,
  ])
}

function useDialogActionHandlers(
  state: ReturnType<typeof useGitActionsState>,
  runGitActionWithToast: (input: RunGitActionWithToastInput) => Promise<void>,
  openExistingPr: () => Promise<void>,
  pushWorktreeIntoParent: (parentBranch: string) => Promise<void>
) {
  const openDialogForMenuItem = useOpenDialogForMenuItem(
    state,
    runGitActionWithToast,
    openExistingPr,
    pushWorktreeIntoParent
  )
  const runDialogAction = useRunCommitDialogAction(state, runGitActionWithToast, {
    featureBranch: false,
    skipDefaultBranchPrompt: false,
  })
  const runDialogActionOnNewBranch = useRunCommitDialogAction(state, runGitActionWithToast, {
    featureBranch: true,
    skipDefaultBranchPrompt: true,
  })
  return { openDialogForMenuItem, runDialogAction, runDialogActionOnNewBranch }
}

export function useGitActions(gitCwd: string | null, state: ReturnType<typeof useGitActionsState>) {
  const runGitActionWithToast = useRunGitActionWithToast(gitCwd, state)
  const openExistingPr = useOpenExistingPr(state)
  const pushWorktreeIntoParent = usePushWorktreeIntoParent(state)
  const pending = usePendingDefaultBranchActionHandlers(state, runGitActionWithToast)
  const runQuickAction = useQuickActionRunner(
    state,
    runGitActionWithToast,
    openExistingPr,
    pushWorktreeIntoParent
  )
  const dialogHandlers = useDialogActionHandlers(
    state,
    runGitActionWithToast,
    openExistingPr,
    pushWorktreeIntoParent
  )
  return {
    runGitActionWithToast,
    openExistingPr,
    pushWorktreeIntoParent,
    ...pending,
    runQuickAction,
    ...dialogHandlers,
  }
}
