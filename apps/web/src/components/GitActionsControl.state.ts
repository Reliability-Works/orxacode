import type { ThreadId } from '@orxa-code/contracts'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { toastManager } from '~/components/ui/toastState'
import {
  gitBranchesQueryOptions,
  gitInitMutationOptions,
  gitMutationKeys,
  gitPullMutationOptions,
  gitRunStackedActionMutationOptions,
  gitStatusQueryOptions,
  invalidateGitQueries,
} from '~/lib/gitReactQuery'

import { buildMenuItems, resolveQuickAction } from './GitActionsControl.logic'
import {
  type ActiveGitActionProgress,
  resolveProgressDescription,
} from './GitActionsControl.helpers'
import { type PendingDefaultBranchAction } from './GitActionsControlDialogs'

function useGitActionsStatusQueries(gitCwd: string | null) {
  const queryClient = useQueryClient()
  const { data: gitStatus = null, error: gitStatusError } = useQuery(gitStatusQueryOptions(gitCwd))
  const { data: branchList = null } = useQuery(gitBranchesQueryOptions(gitCwd))
  const isRepo = branchList?.isRepo ?? true
  const hasOriginRemote = branchList?.hasOriginRemote ?? false
  const currentBranch = branchList?.branches.find(branch => branch.current)?.name ?? null
  const isGitStatusOutOfSync =
    !!gitStatus?.branch && !!currentBranch && gitStatus.branch !== currentBranch
  useEffect(() => {
    if (!isGitStatusOutOfSync) return
    void invalidateGitQueries(queryClient)
  }, [isGitStatusOutOfSync, queryClient])
  const gitStatusForActions = isGitStatusOutOfSync ? null : gitStatus
  return {
    queryClient,
    gitStatus,
    gitStatusError,
    branchList,
    isRepo,
    hasOriginRemote,
    currentBranch,
    isGitStatusOutOfSync,
    gitStatusForActions,
  }
}

function useGitActionsDialogState() {
  const [isCommitDialogOpen, setIsCommitDialogOpen] = useState(false)
  const [dialogCommitMessage, setDialogCommitMessage] = useState('')
  const [excludedFiles, setExcludedFiles] = useState<ReadonlySet<string>>(new Set())
  const [isEditingFiles, setIsEditingFiles] = useState(false)
  const [pendingDefaultBranchAction, setPendingDefaultBranchAction] =
    useState<PendingDefaultBranchAction | null>(null)
  return {
    isCommitDialogOpen,
    setIsCommitDialogOpen,
    dialogCommitMessage,
    setDialogCommitMessage,
    excludedFiles,
    setExcludedFiles,
    isEditingFiles,
    setIsEditingFiles,
    pendingDefaultBranchAction,
    setPendingDefaultBranchAction,
  }
}

export function useGitActionsState(gitCwd: string | null, activeThreadId: ThreadId | null) {
  const threadToastData = useMemo(
    () => (activeThreadId ? { threadId: activeThreadId } : undefined),
    [activeThreadId]
  )
  const dialog = useGitActionsDialogState()
  const activeGitActionProgressRef = useRef<ActiveGitActionProgress | null>(null)
  const updateActiveProgressToast = useCallback(() => {
    const progress = activeGitActionProgressRef.current
    if (!progress) return
    toastManager.update(progress.toastId, {
      type: 'loading',
      title: progress.title,
      description: resolveProgressDescription(progress),
      timeout: 0,
      data: threadToastData,
    })
  }, [threadToastData])
  const statusQueries = useGitActionsStatusQueries(gitCwd)
  const { gitStatusForActions, hasOriginRemote, branchList, queryClient } = statusQueries
  const allFiles = gitStatusForActions?.workingTree.files ?? []
  const excludedFiles = dialog.excludedFiles
  const selectedFiles = allFiles.filter(f => !excludedFiles.has(f.path))
  const allSelected = excludedFiles.size === 0
  const noneSelected = selectedFiles.length === 0
  const initMutation = useMutation(gitInitMutationOptions({ cwd: gitCwd, queryClient }))
  const runImmediateGitActionMutation = useMutation(
    gitRunStackedActionMutationOptions({ cwd: gitCwd, queryClient })
  )
  const pullMutation = useMutation(gitPullMutationOptions({ cwd: gitCwd, queryClient }))
  const isRunStackedActionRunning =
    useIsMutating({ mutationKey: gitMutationKeys.runStackedAction(gitCwd) }) > 0
  const isPullRunning = useIsMutating({ mutationKey: gitMutationKeys.pull(gitCwd) }) > 0
  const isGitActionRunning = isRunStackedActionRunning || isPullRunning
  const isDefaultBranch = useMemo(() => {
    const branchName = gitStatusForActions?.branch
    if (!branchName) return false
    const current = branchList?.branches.find(branch => branch.name === branchName)
    return current?.isDefault ?? (branchName === 'main' || branchName === 'master')
  }, [branchList?.branches, gitStatusForActions?.branch])
  const gitActionMenuItems = useMemo(
    () => buildMenuItems(gitStatusForActions, isGitActionRunning, hasOriginRemote),
    [gitStatusForActions, hasOriginRemote, isGitActionRunning]
  )
  const quickAction = useMemo(
    () =>
      resolveQuickAction(gitStatusForActions, isGitActionRunning, isDefaultBranch, hasOriginRemote),
    [gitStatusForActions, hasOriginRemote, isDefaultBranch, isGitActionRunning]
  )
  return {
    threadToastData,
    ...statusQueries,
    ...dialog,
    activeGitActionProgressRef,
    updateActiveProgressToast,
    allFiles,
    selectedFiles,
    allSelected,
    noneSelected,
    initMutation,
    runImmediateGitActionMutation,
    pullMutation,
    isGitActionRunning,
    isDefaultBranch,
    gitActionMenuItems,
    quickAction,
  }
}
