import type { GitBranch } from '@orxa-code/contracts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from 'react'

import { gitBranchesQueryOptions, gitQueryKeys, gitStatusQueryOptions } from '../lib/gitReactQuery'
import { parsePullRequestReference } from '../pullRequestReference'
import {
  dedupeRemoteBranchesWithLocalMatches,
  EnvMode,
  resolveBranchToolbarValue,
  shouldIncludeBranchPickerItem,
} from './BranchToolbar.logic'
import { useBranchActions } from './BranchToolbarBranchSelector.actions'

type QueryClient = ReturnType<typeof useQueryClient>

export interface BranchToolbarBranchSelectorProps {
  activeProjectCwd: string
  activeThreadBranch: string | null
  activeWorktreePath: string | null
  branchCwd: string | null
  effectiveEnvMode: EnvMode
  envLocked: boolean
  onSetThreadBranch: (branch: string | null, worktreePath: string | null) => void
  onCheckoutPullRequestRequest?: (reference: string) => void
  onComposerFocusRequest?: () => void
}

interface BranchPickerItemsInput {
  branches: readonly GitBranch[]
  trimmedBranchQuery: string
  normalizedDeferredBranchQuery: string
  isSelectingWorktreeBase: boolean
  prReference: string | null
  onCheckoutPullRequestRequest?: (reference: string) => void
}

function useBranchPickerItems(input: BranchPickerItemsInput) {
  const {
    branches,
    trimmedBranchQuery,
    normalizedDeferredBranchQuery,
    isSelectingWorktreeBase,
    prReference,
    onCheckoutPullRequestRequest,
  } = input
  const branchNames = useMemo(() => branches.map(b => b.name), [branches])
  const branchByName = useMemo(() => new Map(branches.map(b => [b.name, b] as const)), [branches])
  const checkoutPullRequestItemValue =
    prReference && onCheckoutPullRequestRequest ? `__checkout_pull_request__:${prReference}` : null
  const createBranchItemValue =
    !isSelectingWorktreeBase && trimmedBranchQuery.length > 0
      ? `__create_new_branch__:${trimmedBranchQuery}`
      : null
  const hasExactBranchMatch = branchByName.has(trimmedBranchQuery)
  const branchPickerItems = useMemo(() => {
    const items = [...branchNames]
    if (createBranchItemValue && !hasExactBranchMatch) items.push(createBranchItemValue)
    if (checkoutPullRequestItemValue) items.unshift(checkoutPullRequestItemValue)
    return items
  }, [branchNames, checkoutPullRequestItemValue, createBranchItemValue, hasExactBranchMatch])
  const filteredBranchPickerItems = useMemo(
    () =>
      normalizedDeferredBranchQuery.length === 0
        ? branchPickerItems
        : branchPickerItems.filter(itemValue =>
            shouldIncludeBranchPickerItem({
              itemValue,
              normalizedQuery: normalizedDeferredBranchQuery,
              createBranchItemValue,
              checkoutPullRequestItemValue,
            })
          ),
    [
      branchPickerItems,
      checkoutPullRequestItemValue,
      createBranchItemValue,
      normalizedDeferredBranchQuery,
    ]
  )
  return {
    branchByName,
    checkoutPullRequestItemValue,
    createBranchItemValue,
    branchPickerItems,
    filteredBranchPickerItems,
  }
}

function useBranchSelectorMenuHandlers(input: {
  branchCwd: string | null
  queryClient: QueryClient
  setIsBranchMenuOpen: (open: boolean) => void
  setBranchQuery: (query: string) => void
  onCheckoutPullRequestRequest?: (reference: string) => void
  onComposerFocusRequest?: () => void
}) {
  const {
    branchCwd,
    queryClient,
    setIsBranchMenuOpen,
    setBranchQuery,
    onCheckoutPullRequestRequest,
    onComposerFocusRequest,
  } = input
  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsBranchMenuOpen(open)
      if (!open) {
        setBranchQuery('')
        return
      }
      void queryClient.invalidateQueries({ queryKey: gitQueryKeys.branches(branchCwd) })
    },
    [branchCwd, queryClient, setBranchQuery, setIsBranchMenuOpen]
  )
  const scrollToIndexRef = useRef<((index: number, opts: { align: string }) => void) | null>(null)
  const handleScrollToIndex = useCallback(
    (fn: (index: number, opts: { align: string }) => void) => {
      scrollToIndexRef.current = fn
    },
    []
  )
  const onCheckoutPr = useCallback(
    (reference: string) => {
      if (!onCheckoutPullRequestRequest) return
      setIsBranchMenuOpen(false)
      setBranchQuery('')
      onComposerFocusRequest?.()
      onCheckoutPullRequestRequest(reference)
    },
    [onCheckoutPullRequestRequest, onComposerFocusRequest, setBranchQuery, setIsBranchMenuOpen]
  )
  return { handleOpenChange, scrollToIndexRef, handleScrollToIndex, onCheckoutPr }
}

function useBranchSelectorCore(props: BranchToolbarBranchSelectorProps) {
  const { activeThreadBranch, activeWorktreePath, branchCwd, effectiveEnvMode, envLocked } = props
  const queryClient = useQueryClient()
  const [isBranchMenuOpen, setIsBranchMenuOpen] = useState(false)
  const [branchQuery, setBranchQuery] = useState('')
  const deferredBranchQuery = useDeferredValue(branchQuery)
  const branchesQuery = useQuery(gitBranchesQueryOptions(branchCwd))
  const branchStatusQuery = useQuery(gitStatusQueryOptions(branchCwd))
  const branches = useMemo(
    () => dedupeRemoteBranchesWithLocalMatches(branchesQuery.data?.branches ?? []),
    [branchesQuery.data?.branches]
  )
  const currentGitBranch =
    branchStatusQuery.data?.branch ?? branches.find(b => b.current)?.name ?? null
  const canonicalActiveBranch = resolveBranchToolbarValue({
    envMode: effectiveEnvMode,
    activeWorktreePath,
    activeThreadBranch,
    currentGitBranch,
  })
  const trimmedBranchQuery = branchQuery.trim()
  const normalizedDeferredBranchQuery = deferredBranchQuery.trim().toLowerCase()
  const prReference = parsePullRequestReference(trimmedBranchQuery)
  const isSelectingWorktreeBase =
    effectiveEnvMode === 'worktree' && !envLocked && !activeWorktreePath
  const [resolvedActiveBranch, setOptimisticBranch] = useOptimistic(
    canonicalActiveBranch,
    (_: string | null, v: string | null) => v
  )
  const [isBranchActionPending, startTransitionRaw] = useTransition()
  const startBranchActionTransition = useCallback(
    (fn: () => Promise<void>) => {
      startTransitionRaw(() => {
        void fn()
      })
    },
    [startTransitionRaw]
  )
  return {
    queryClient,
    isBranchMenuOpen,
    setIsBranchMenuOpen,
    branchQuery,
    setBranchQuery,
    branchesQuery,
    branches,
    currentGitBranch,
    trimmedBranchQuery,
    normalizedDeferredBranchQuery,
    prReference,
    isSelectingWorktreeBase,
    resolvedActiveBranch,
    setOptimisticBranch,
    isBranchActionPending,
    startBranchActionTransition,
  }
}

function useAutoSelectWorktreeBaseBranch(input: {
  effectiveEnvMode: EnvMode
  activeWorktreePath: string | null
  activeThreadBranch: string | null
  currentGitBranch: string | null
  onSetThreadBranch: (branch: string | null, worktreePath: string | null) => void
}) {
  const {
    effectiveEnvMode,
    activeWorktreePath,
    activeThreadBranch,
    currentGitBranch,
    onSetThreadBranch,
  } = input
  useEffect(() => {
    if (
      effectiveEnvMode !== 'worktree' ||
      activeWorktreePath ||
      activeThreadBranch ||
      !currentGitBranch
    )
      return
    onSetThreadBranch(currentGitBranch, null)
  }, [
    activeThreadBranch,
    activeWorktreePath,
    currentGitBranch,
    effectiveEnvMode,
    onSetThreadBranch,
  ])
}

export function useBranchSelectorState(props: BranchToolbarBranchSelectorProps) {
  const {
    activeProjectCwd,
    activeThreadBranch,
    activeWorktreePath,
    branchCwd,
    effectiveEnvMode,
    onSetThreadBranch,
    onCheckoutPullRequestRequest,
    onComposerFocusRequest,
  } = props
  const core = useBranchSelectorCore(props)
  const pickerItems = useBranchPickerItems({
    branches: core.branches,
    trimmedBranchQuery: core.trimmedBranchQuery,
    normalizedDeferredBranchQuery: core.normalizedDeferredBranchQuery,
    isSelectingWorktreeBase: core.isSelectingWorktreeBase,
    prReference: core.prReference,
    ...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {}),
  })
  const shouldVirtualizeBranchList = pickerItems.filteredBranchPickerItems.length > 40
  const { selectBranch, createBranch } = useBranchActions({
    activeProjectCwd,
    activeWorktreePath,
    branchCwd,
    isSelectingWorktreeBase: core.isSelectingWorktreeBase,
    isBranchActionPending: core.isBranchActionPending,
    queryClient: core.queryClient,
    setOptimisticBranch: core.setOptimisticBranch,
    setBranchQuery: core.setBranchQuery,
    setIsBranchMenuOpen: core.setIsBranchMenuOpen,
    onSetThreadBranch,
    startBranchActionTransition: core.startBranchActionTransition,
    ...(onComposerFocusRequest ? { onComposerFocusRequest } : {}),
  })
  useAutoSelectWorktreeBaseBranch({
    effectiveEnvMode,
    activeWorktreePath,
    activeThreadBranch,
    currentGitBranch: core.currentGitBranch,
    onSetThreadBranch,
  })
  const menuHandlers = useBranchSelectorMenuHandlers({
    branchCwd,
    queryClient: core.queryClient,
    setIsBranchMenuOpen: core.setIsBranchMenuOpen,
    setBranchQuery: core.setBranchQuery,
    ...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {}),
    ...(onComposerFocusRequest ? { onComposerFocusRequest } : {}),
  })
  return {
    queryClient: core.queryClient,
    branchesQuery: core.branchesQuery,
    branches: core.branches,
    isBranchMenuOpen: core.isBranchMenuOpen,
    branchQuery: core.branchQuery,
    setBranchQuery: core.setBranchQuery,
    resolvedActiveBranch: core.resolvedActiveBranch,
    isBranchActionPending: core.isBranchActionPending,
    shouldVirtualizeBranchList,
    branchPickerItems: pickerItems.branchPickerItems,
    filteredBranchPickerItems: pickerItems.filteredBranchPickerItems,
    handleOpenChange: menuHandlers.handleOpenChange,
    scrollToIndexRef: menuHandlers.scrollToIndexRef,
    handleScrollToIndex: menuHandlers.handleScrollToIndex,
    onCheckoutPr: menuHandlers.onCheckoutPr,
    selectBranch,
    createBranch,
    checkoutPullRequestItemValue: pickerItems.checkoutPullRequestItemValue,
    createBranchItemValue: pickerItems.createBranchItemValue,
    prReference: core.prReference,
    trimmedBranchQuery: core.trimmedBranchQuery,
    branchByName: pickerItems.branchByName,
  }
}
