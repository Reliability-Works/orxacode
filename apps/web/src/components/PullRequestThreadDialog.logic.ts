import type { GitResolvePullRequestResult } from '@orxa-code/contracts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useDebouncedValue } from '@tanstack/react-pacer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { gitResolvePullRequestQueryOptions } from '~/lib/gitReactQuery'
import { parsePullRequestReference } from '~/pullRequestReference'

export type PreparePullRequestThreadMutation = {
  mutateAsync: (input: { reference: string; mode: 'local' | 'worktree' }) => Promise<{
    branch: string
    worktreePath: string | null
  }>
  error: unknown
  isPending: boolean
}

type PullRequestPreparedHandler = (input: {
  branch: string
  worktreePath: string | null
}) => Promise<void> | void

type OpenChangeHandler = (open: boolean) => void

interface PrepareThreadParams {
  cwd: string | null
  parsedReference: string | null
  resolvedPullRequest: GitResolvePullRequestResult['pullRequest'] | null
  preparePullRequestThreadMutation: PreparePullRequestThreadMutation
  onPrepared: PullRequestPreparedHandler
  onOpenChange: OpenChangeHandler
  setReferenceDirty: (dirty: boolean) => void
  setPreparingMode: (mode: 'local' | 'worktree' | null) => void
}

export function usePullRequestDialogState(initialReference: string | null, open: boolean) {
  const referenceInputRef = useRef<HTMLInputElement>(null)
  const [reference, setReference] = useState(initialReference ?? '')
  const [referenceDirty, setReferenceDirty] = useState(false)
  const [preparingMode, setPreparingMode] = useState<'local' | 'worktree' | null>(null)
  const [debouncedReference, referenceDebouncer] = useDebouncedValue(
    reference,
    { wait: 450 },
    debouncerState => ({ isPending: debouncerState.isPending })
  )

  useEffect(() => {
    if (!open) return
    setReference(initialReference ?? '')
    setReferenceDirty(false)
    setPreparingMode(null)
  }, [initialReference, open])

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      referenceInputRef.current?.focus()
      referenceInputRef.current?.select()
    })
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [open])

  return {
    referenceInputRef,
    reference,
    setReference,
    referenceDirty,
    setReferenceDirty,
    preparingMode,
    setPreparingMode,
    debouncedReference,
    referenceDebouncer,
  }
}

export function useResolvedPullRequestState({
  cwd,
  open,
  reference,
  debouncedReference,
  referenceDebouncer,
}: {
  cwd: string | null
  open: boolean
  reference: string
  debouncedReference: string
  referenceDebouncer: { state: { isPending: boolean } }
}) {
  const queryClient = useQueryClient()
  const parsedReference = parsePullRequestReference(reference)
  const parsedDebouncedReference = parsePullRequestReference(debouncedReference)
  const resolvePullRequestQuery = useQuery(
    gitResolvePullRequestQueryOptions({
      cwd,
      reference: open ? parsedDebouncedReference : null,
    })
  )
  const cachedPullRequest = useMemo(() => {
    if (!cwd || !parsedReference) {
      return null
    }
    const cached = queryClient.getQueryData<GitResolvePullRequestResult>([
      'git',
      'pull-request',
      cwd,
      parsedReference,
    ])
    return cached?.pullRequest ?? null
  }, [cwd, parsedReference, queryClient])

  const liveResolvedPullRequest =
    parsedReference !== null && parsedReference === parsedDebouncedReference
      ? (resolvePullRequestQuery.data?.pullRequest ?? null)
      : null
  const resolvedPullRequest = liveResolvedPullRequest ?? cachedPullRequest
  const isResolving =
    open &&
    parsedReference !== null &&
    resolvedPullRequest === null &&
    (referenceDebouncer.state.isPending ||
      parsedReference !== parsedDebouncedReference ||
      resolvePullRequestQuery.isPending ||
      resolvePullRequestQuery.isFetching)

  return {
    queryClient,
    parsedReference,
    resolvePullRequestQuery,
    resolvedPullRequest,
    isResolving,
  }
}

async function confirmPullRequestThreadPreparation({
  mode,
  cwd,
  parsedReference,
  resolvedPullRequest,
  preparePullRequestThreadMutation,
  onPrepared,
  onOpenChange,
  setReferenceDirty,
  setPreparingMode,
}: PrepareThreadParams & { mode: 'local' | 'worktree' }) {
  if (!parsedReference) {
    setReferenceDirty(true)
    return
  }
  if (!resolvedPullRequest || !cwd) {
    return
  }
  setPreparingMode(mode)
  try {
    const result = await preparePullRequestThreadMutation.mutateAsync({
      reference: parsedReference,
      mode,
    })
    await onPrepared({
      branch: result.branch,
      worktreePath: result.worktreePath,
    })
    onOpenChange(false)
  } finally {
    setPreparingMode(null)
  }
}

export function usePreparePullRequestThread({
  cwd,
  parsedReference,
  resolvedPullRequest,
  preparePullRequestThreadMutation,
  onPrepared,
  onOpenChange,
  setReferenceDirty,
  setPreparingMode,
}: PrepareThreadParams) {
  return useCallback(
    async (mode: 'local' | 'worktree') => {
      await confirmPullRequestThreadPreparation({
        mode,
        cwd,
        parsedReference,
        resolvedPullRequest,
        preparePullRequestThreadMutation,
        onPrepared,
        onOpenChange,
        setReferenceDirty,
        setPreparingMode,
      })
    },
    [
      cwd,
      onOpenChange,
      onPrepared,
      parsedReference,
      preparePullRequestThreadMutation,
      resolvedPullRequest,
      setPreparingMode,
      setReferenceDirty,
    ]
  )
}

export function resolvePullRequestDialogMessages({
  referenceDirty,
  reference,
  parsedReference,
  resolvedPullRequest,
  resolvePullRequestQuery,
  preparePullRequestThreadMutation,
}: {
  referenceDirty: boolean
  reference: string
  parsedReference: string | null
  resolvedPullRequest: GitResolvePullRequestResult['pullRequest'] | null
  resolvePullRequestQuery: { isError: boolean; error: unknown }
  preparePullRequestThreadMutation: Pick<PreparePullRequestThreadMutation, 'error'>
}) {
  const validationMessage = !referenceDirty
    ? null
    : reference.trim().length === 0
      ? 'Paste a GitHub pull request URL, `gh pr checkout 123`, or enter 123 / #123.'
      : parsedReference === null
        ? 'Use a GitHub pull request URL, `gh pr checkout 123`, 123, or #123.'
        : null
  const errorMessage =
    validationMessage ??
    (resolvedPullRequest === null && resolvePullRequestQuery.isError
      ? resolvePullRequestQuery.error instanceof Error
        ? resolvePullRequestQuery.error.message
        : 'Failed to resolve pull request.'
      : preparePullRequestThreadMutation.error instanceof Error
        ? preparePullRequestThreadMutation.error.message
        : preparePullRequestThreadMutation.error
          ? 'Failed to prepare pull request thread.'
          : null)
  return { errorMessage }
}
