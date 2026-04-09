import { type GitActionProgressEvent, type GitStackedAction } from '@orxa-code/contracts'
import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query'
import { ensureNativeApi } from '../nativeApi'
import { getWsRpcClient } from '../wsRpcClient'

const GIT_PANEL_STALE_TIME_MS = 10_000
const GIT_PANEL_REFETCH_INTERVAL_MS = 30_000

export const gitPanelQueryKeys = {
  diff: (cwd: string | null) => ['git', 'panel', 'diff', cwd] as const,
  log: (cwd: string | null) => ['git', 'panel', 'log', cwd] as const,
  issues: (cwd: string | null) => ['git', 'panel', 'issues', cwd] as const,
  pullRequests: (cwd: string | null) => ['git', 'panel', 'pull-requests', cwd] as const,
}

export function gitPanelDiffQueryOptions(cwd: string | null) {
  return queryOptions({
    queryKey: gitPanelQueryKeys.diff(cwd),
    queryFn: () => {
      if (!cwd) throw new Error('cwd required')
      return getWsRpcClient().git.getDiff({ cwd })
    },
    enabled: cwd !== null,
    staleTime: GIT_PANEL_STALE_TIME_MS,
    refetchOnWindowFocus: 'always',
    refetchInterval: GIT_PANEL_REFETCH_INTERVAL_MS,
  })
}

export function gitPanelLogQueryOptions(cwd: string | null) {
  return queryOptions({
    queryKey: gitPanelQueryKeys.log(cwd),
    queryFn: () => {
      if (!cwd) throw new Error('cwd required')
      return getWsRpcClient().git.getLog({ cwd, limit: 50 })
    },
    enabled: cwd !== null,
    staleTime: GIT_PANEL_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchInterval: GIT_PANEL_REFETCH_INTERVAL_MS,
  })
}

export function gitPanelIssuesQueryOptions(cwd: string | null) {
  return queryOptions({
    queryKey: gitPanelQueryKeys.issues(cwd),
    queryFn: () => {
      if (!cwd) throw new Error('cwd required')
      return getWsRpcClient().git.getIssues({ cwd, limit: 20 })
    },
    enabled: cwd !== null,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}

export function gitPanelPullRequestsQueryOptions(cwd: string | null) {
  return queryOptions({
    queryKey: gitPanelQueryKeys.pullRequests(cwd),
    queryFn: () => {
      if (!cwd) throw new Error('cwd required')
      return getWsRpcClient().git.getPullRequests({ cwd, limit: 20 })
    },
    enabled: cwd !== null,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}

const GIT_STATUS_STALE_TIME_MS = 5_000
const GIT_STATUS_REFETCH_INTERVAL_MS = 15_000
const GIT_BRANCHES_STALE_TIME_MS = 15_000
const GIT_BRANCHES_REFETCH_INTERVAL_MS = 60_000

export const gitQueryKeys = {
  all: ['git'] as const,
  status: (cwd: string | null) => ['git', 'status', cwd] as const,
  branches: (cwd: string | null) => ['git', 'branches', cwd] as const,
}

export const gitMutationKeys = {
  init: (cwd: string | null) => ['git', 'mutation', 'init', cwd] as const,
  checkout: (cwd: string | null) => ['git', 'mutation', 'checkout', cwd] as const,
  runStackedAction: (cwd: string | null) => ['git', 'mutation', 'run-stacked-action', cwd] as const,
  pull: (cwd: string | null) => ['git', 'mutation', 'pull', cwd] as const,
  preparePullRequestThread: (cwd: string | null) =>
    ['git', 'mutation', 'prepare-pull-request-thread', cwd] as const,
}

export function invalidateGitQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: gitQueryKeys.all })
}

export function gitStatusQueryOptions(cwd: string | null) {
  return queryOptions({
    queryKey: gitQueryKeys.status(cwd),
    queryFn: async () => {
      const api = ensureNativeApi()
      if (!cwd) throw new Error('Git status is unavailable.')
      return api.git.status({ cwd })
    },
    enabled: cwd !== null,
    staleTime: GIT_STATUS_STALE_TIME_MS,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    refetchInterval: GIT_STATUS_REFETCH_INTERVAL_MS,
  })
}

export function gitBranchesQueryOptions(cwd: string | null) {
  return queryOptions({
    queryKey: gitQueryKeys.branches(cwd),
    queryFn: async () => {
      const api = ensureNativeApi()
      if (!cwd) throw new Error('Git branches are unavailable.')
      return api.git.listBranches({ cwd })
    },
    enabled: cwd !== null,
    staleTime: GIT_BRANCHES_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: GIT_BRANCHES_REFETCH_INTERVAL_MS,
  })
}

export function gitResolvePullRequestQueryOptions(input: {
  cwd: string | null
  reference: string | null
}) {
  return queryOptions({
    queryKey: ['git', 'pull-request', input.cwd, input.reference] as const,
    queryFn: async () => {
      const api = ensureNativeApi()
      if (!input.cwd || !input.reference) {
        throw new Error('Pull request lookup is unavailable.')
      }
      return api.git.resolvePullRequest({ cwd: input.cwd, reference: input.reference })
    },
    enabled: input.cwd !== null && input.reference !== null,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export function gitInitMutationOptions(input: { cwd: string | null; queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: gitMutationKeys.init(input.cwd),
    mutationFn: async () => {
      const api = ensureNativeApi()
      if (!input.cwd) throw new Error('Git init is unavailable.')
      return api.git.init({ cwd: input.cwd })
    },
    onSuccess: async () => {
      await invalidateGitQueries(input.queryClient)
    },
  })
}

export function gitCheckoutMutationOptions(input: {
  cwd: string | null
  queryClient: QueryClient
}) {
  return mutationOptions({
    mutationKey: gitMutationKeys.checkout(input.cwd),
    mutationFn: async (branch: string) => {
      const api = ensureNativeApi()
      if (!input.cwd) throw new Error('Git checkout is unavailable.')
      return api.git.checkout({ cwd: input.cwd, branch })
    },
    onSuccess: async () => {
      await invalidateGitQueries(input.queryClient)
    },
  })
}

export function gitRunStackedActionMutationOptions(input: {
  cwd: string | null
  queryClient: QueryClient
}) {
  return mutationOptions({
    mutationKey: gitMutationKeys.runStackedAction(input.cwd),
    mutationFn: async ({
      actionId,
      action,
      commitMessage,
      featureBranch,
      filePaths,
      onProgress,
    }: {
      actionId: string
      action: GitStackedAction
      commitMessage?: string
      featureBranch?: boolean
      filePaths?: string[]
      onProgress?: (event: GitActionProgressEvent) => void
    }) => {
      if (!input.cwd) throw new Error('Git action is unavailable.')
      return getWsRpcClient().git.runStackedAction(
        {
          actionId,
          cwd: input.cwd,
          action,
          ...(commitMessage ? { commitMessage } : {}),
          ...(featureBranch ? { featureBranch } : {}),
          ...(filePaths ? { filePaths } : {}),
        },
        ...(onProgress ? [{ onProgress }] : [])
      )
    },
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient)
    },
  })
}

export function gitPullMutationOptions(input: { cwd: string | null; queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: gitMutationKeys.pull(input.cwd),
    mutationFn: async () => {
      const api = ensureNativeApi()
      if (!input.cwd) throw new Error('Git pull is unavailable.')
      return api.git.pull({ cwd: input.cwd })
    },
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient)
    },
  })
}

export function gitCreateWorktreeMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async ({
      cwd,
      branch,
      newBranch,
      path,
    }: {
      cwd: string
      branch: string
      newBranch: string
      path?: string | null
    }) => {
      const api = ensureNativeApi()
      if (!cwd) throw new Error('Git worktree creation is unavailable.')
      return api.git.createWorktree({ cwd, branch, newBranch, path: path ?? null })
    },
    mutationKey: ['git', 'mutation', 'create-worktree'] as const,
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient)
    },
  })
}

export function gitRemoveWorktreeMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async ({ cwd, path, force }: { cwd: string; path: string; force?: boolean }) => {
      const api = ensureNativeApi()
      if (!cwd) throw new Error('Git worktree removal is unavailable.')
      return api.git.removeWorktree({ cwd, path, force })
    },
    mutationKey: ['git', 'mutation', 'remove-worktree'] as const,
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient)
    },
  })
}

export function gitPreparePullRequestThreadMutationOptions(input: {
  cwd: string | null
  queryClient: QueryClient
}) {
  return mutationOptions({
    mutationFn: async ({ reference, mode }: { reference: string; mode: 'local' | 'worktree' }) => {
      const api = ensureNativeApi()
      if (!input.cwd) throw new Error('Pull request thread preparation is unavailable.')
      return api.git.preparePullRequestThread({
        cwd: input.cwd,
        reference,
        mode,
      })
    },
    mutationKey: gitMutationKeys.preparePullRequestThread(input.cwd),
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient)
    },
  })
}
