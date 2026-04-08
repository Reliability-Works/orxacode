import type { GitBranch } from '@orxa-code/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import { invalidateGitQueries } from '../lib/gitReactQuery'
import { readNativeApi } from '../nativeApi'
import {
  deriveLocalBranchNameFromRemoteRef,
  resolveBranchSelectionTarget,
} from './BranchToolbar.logic'
import { toastManager } from './ui/toastState'

type NativeApi = NonNullable<ReturnType<typeof readNativeApi>>
type BranchSelectionTarget = ReturnType<typeof resolveBranchSelectionTarget>
type QueryClient = ReturnType<typeof useQueryClient>

function toBranchActionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An error occurred.'
}

async function runBranchCheckout(input: {
  api: NativeApi
  branch: GitBranch
  branchCwd: string
  selectionTarget: BranchSelectionTarget
  selectedBranchName: string
  queryClient: QueryClient
  setOptimisticBranch: (branch: string | null) => void
  onSetThreadBranch: (branch: string | null, worktreePath: string | null) => void
}): Promise<void> {
  const {
    api,
    branch,
    branchCwd,
    selectionTarget,
    selectedBranchName,
    queryClient,
    setOptimisticBranch,
    onSetThreadBranch,
  } = input
  setOptimisticBranch(selectedBranchName)
  try {
    await api.git.checkout({ cwd: selectionTarget.checkoutCwd, branch: branch.name })
    await invalidateGitQueries(queryClient)
  } catch (error) {
    toastManager.add({
      type: 'error',
      title: 'Failed to checkout branch.',
      description: toBranchActionErrorMessage(error),
    })
    return
  }
  let nextBranchName = selectedBranchName
  if (branch.isRemote) {
    const status = await api.git.status({ cwd: branchCwd }).catch(() => null)
    if (status?.branch) nextBranchName = status.branch
  }
  setOptimisticBranch(nextBranchName)
  onSetThreadBranch(nextBranchName, selectionTarget.nextWorktreePath)
}

export interface UseBranchActionsInput {
  activeProjectCwd: string
  activeWorktreePath: string | null
  branchCwd: string | null
  isSelectingWorktreeBase: boolean
  isBranchActionPending: boolean
  queryClient: QueryClient
  setOptimisticBranch: (branch: string | null) => void
  setBranchQuery: (query: string) => void
  setIsBranchMenuOpen: (open: boolean) => void
  onSetThreadBranch: (branch: string | null, worktreePath: string | null) => void
  onComposerFocusRequest?: () => void
  startBranchActionTransition: (fn: () => Promise<void>) => void
}

type RunBranchAction = (action: () => Promise<void>) => void

function useSelectBranchAction(
  input: UseBranchActionsInput & { runBranchAction: RunBranchAction }
) {
  const {
    activeProjectCwd,
    activeWorktreePath,
    branchCwd,
    isSelectingWorktreeBase,
    isBranchActionPending,
    queryClient,
    setOptimisticBranch,
    setIsBranchMenuOpen,
    onSetThreadBranch,
    onComposerFocusRequest,
    runBranchAction,
  } = input
  return useCallback(
    (branch: GitBranch) => {
      const api = readNativeApi()
      if (!api || !branchCwd || isBranchActionPending) return
      if (isSelectingWorktreeBase) {
        onSetThreadBranch(branch.name, null)
        setIsBranchMenuOpen(false)
        onComposerFocusRequest?.()
        return
      }
      const selectionTarget = resolveBranchSelectionTarget({
        activeProjectCwd,
        activeWorktreePath,
        branch,
      })
      if (selectionTarget.reuseExistingWorktree) {
        onSetThreadBranch(branch.name, selectionTarget.nextWorktreePath)
        setIsBranchMenuOpen(false)
        onComposerFocusRequest?.()
        return
      }
      const selectedBranchName = branch.isRemote
        ? deriveLocalBranchNameFromRemoteRef(branch.name)
        : branch.name
      setIsBranchMenuOpen(false)
      onComposerFocusRequest?.()
      runBranchAction(() =>
        runBranchCheckout({
          api,
          branch,
          branchCwd,
          selectionTarget,
          selectedBranchName,
          queryClient,
          setOptimisticBranch,
          onSetThreadBranch,
        })
      )
    },
    [
      activeProjectCwd,
      activeWorktreePath,
      branchCwd,
      isBranchActionPending,
      isSelectingWorktreeBase,
      onComposerFocusRequest,
      onSetThreadBranch,
      queryClient,
      runBranchAction,
      setIsBranchMenuOpen,
      setOptimisticBranch,
    ]
  )
}

function useCreateBranchAction(
  input: UseBranchActionsInput & { runBranchAction: RunBranchAction }
) {
  const {
    activeWorktreePath,
    branchCwd,
    isBranchActionPending,
    setOptimisticBranch,
    setBranchQuery,
    setIsBranchMenuOpen,
    onSetThreadBranch,
    onComposerFocusRequest,
    runBranchAction,
  } = input
  return useCallback(
    (rawName: string) => {
      const name = rawName.trim()
      const api = readNativeApi()
      if (!api || !branchCwd || !name || isBranchActionPending) return
      setIsBranchMenuOpen(false)
      onComposerFocusRequest?.()
      runBranchAction(async () => {
        setOptimisticBranch(name)
        try {
          await api.git.createBranch({ cwd: branchCwd, branch: name })
          try {
            await api.git.checkout({ cwd: branchCwd, branch: name })
          } catch (error) {
            toastManager.add({
              type: 'error',
              title: 'Failed to checkout branch.',
              description: toBranchActionErrorMessage(error),
            })
            return
          }
        } catch (error) {
          toastManager.add({
            type: 'error',
            title: 'Failed to create branch.',
            description: toBranchActionErrorMessage(error),
          })
          return
        }
        setOptimisticBranch(name)
        onSetThreadBranch(name, activeWorktreePath)
        setBranchQuery('')
      })
    },
    [
      activeWorktreePath,
      branchCwd,
      isBranchActionPending,
      onComposerFocusRequest,
      onSetThreadBranch,
      runBranchAction,
      setBranchQuery,
      setIsBranchMenuOpen,
      setOptimisticBranch,
    ]
  )
}

export function useBranchActions(input: UseBranchActionsInput) {
  const { queryClient, startBranchActionTransition } = input
  const runBranchAction = useCallback<RunBranchAction>(
    action => {
      startBranchActionTransition(async () => {
        await action().catch(() => undefined)
        await invalidateGitQueries(queryClient).catch(() => undefined)
      })
    },
    [queryClient, startBranchActionTransition]
  )
  const selectBranch = useSelectBranchAction({ ...input, runBranchAction })
  const createBranch = useCreateBranchAction({ ...input, runBranchAction })
  return { selectBranch, createBranch }
}
