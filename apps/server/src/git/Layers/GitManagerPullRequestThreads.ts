import { Effect } from 'effect'

import type { GitManagerShape } from '../Services/GitManager.ts'
import type { GitHubPullRequestSummary } from '../Services/GitHubCli.ts'
import {
  canonicalizeExistingPath,
  gitManagerError,
  normalizePullRequestReference,
  resolvePullRequestWorktreeLocalBranchName,
  toPullRequestHeadRemoteInfo,
  toResolvedPullRequest,
  type PullRequestHeadRemoteInfo,
  type ResolvedPullRequest,
} from './GitManagerShared.ts'
import {
  configurePullRequestHeadUpstream,
  materializePullRequestHeadBranch,
  type GitManagerPullRequestRuntimeDependencies,
} from './GitManagerPullRequestRuntime.ts'

interface PreparePullRequestThreadContext {
  normalizedReference: string
  rootWorktreePath: string
  pullRequest: ResolvedPullRequest
  pullRequestWithRemoteInfo: ResolvedPullRequest & PullRequestHeadRemoteInfo
  localPullRequestBranch: string
}

function buildPullRequestThreadContext(input: {
  cwd: string
  reference: string
  pullRequestSummary: GitHubPullRequestSummary
}): PreparePullRequestThreadContext {
  const normalizedReference = normalizePullRequestReference(input.reference)
  const rootWorktreePath = canonicalizeExistingPath(input.cwd)
  const pullRequest = toResolvedPullRequest(input.pullRequestSummary)
  const pullRequestWithRemoteInfo = {
    ...pullRequest,
    ...toPullRequestHeadRemoteInfo(input.pullRequestSummary),
  }

  return {
    normalizedReference,
    rootWorktreePath,
    pullRequest,
    pullRequestWithRemoteInfo,
    localPullRequestBranch: resolvePullRequestWorktreeLocalBranchName(pullRequestWithRemoteInfo),
  }
}

function pullRequestBranchAlreadyCheckedOutError() {
  return gitManagerError(
    'preparePullRequestThread',
    'This PR branch is already checked out in the main repo. Use Local, or switch the main repo off that branch before creating a worktree thread.'
  )
}

type ResolvePullRequest = (
  deps: GitManagerPullRequestRuntimeDependencies,
  input: Parameters<GitManagerShape['resolvePullRequest']>[0]
) => ReturnType<GitManagerShape['resolvePullRequest']>

export const resolvePullRequest: ResolvePullRequest = (deps, input) =>
  deps.gitHubCli
    .getPullRequest({
      cwd: input.cwd,
      reference: normalizePullRequestReference(input.reference),
    })
    .pipe(Effect.map(resolved => ({ pullRequest: toResolvedPullRequest(resolved) })))

const prepareLocalPullRequestThread = Effect.fn('prepareLocalPullRequestThread')(function* (
  deps: GitManagerPullRequestRuntimeDependencies,
  cwd: string,
  context: PreparePullRequestThreadContext
) {
  yield* deps.gitHubCli.checkoutPullRequest({
    cwd,
    reference: context.normalizedReference,
    force: true,
  })
  const details = yield* deps.gitCore.statusDetails(cwd)
  yield* configurePullRequestHeadUpstream(
    deps,
    cwd,
    context.pullRequestWithRemoteInfo,
    details.branch ?? context.pullRequest.headBranch
  )
  return {
    pullRequest: context.pullRequest,
    branch: details.branch ?? context.pullRequest.headBranch,
    worktreePath: null,
  }
})

const findLocalPullRequestBranch = Effect.fn('findLocalPullRequestBranch')(function* (
  deps: GitManagerPullRequestRuntimeDependencies,
  cwd: string,
  context: PreparePullRequestThreadContext
) {
  const result = yield* deps.gitCore.listBranches({ cwd })
  const directBranch = result.branches.find(
    branch => !branch.isRemote && branch.name === context.localPullRequestBranch
  )
  if (directBranch) {
    return directBranch
  }
  if (context.localPullRequestBranch === context.pullRequest.headBranch) {
    return null
  }

  return (
    result.branches.find(
      branch =>
        !branch.isRemote &&
        branch.name === context.pullRequest.headBranch &&
        branch.worktreePath !== null &&
        canonicalizeExistingPath(branch.worktreePath) !== context.rootWorktreePath
    ) ?? null
  )
})

const ensureExistingWorktreeUpstream = Effect.fn('ensureExistingWorktreeUpstream')(function* (
  deps: GitManagerPullRequestRuntimeDependencies,
  worktreePath: string,
  context: PreparePullRequestThreadContext
) {
  const details = yield* deps.gitCore.statusDetails(worktreePath)
  yield* configurePullRequestHeadUpstream(
    deps,
    worktreePath,
    context.pullRequestWithRemoteInfo,
    details.branch ?? context.pullRequest.headBranch
  )
})

const resolveExistingWorktree = Effect.fn('resolveExistingWorktree')(function* (
  deps: GitManagerPullRequestRuntimeDependencies,
  cwd: string,
  context: PreparePullRequestThreadContext
) {
  const existingBranch = yield* findLocalPullRequestBranch(deps, cwd, context)
  const existingPath = existingBranch?.worktreePath
    ? canonicalizeExistingPath(existingBranch.worktreePath)
    : null

  if (existingBranch?.worktreePath && existingPath !== context.rootWorktreePath) {
    yield* ensureExistingWorktreeUpstream(deps, existingBranch.worktreePath, context)
    return {
      pullRequest: context.pullRequest,
      branch: context.localPullRequestBranch,
      worktreePath: existingBranch.worktreePath,
    }
  }

  if (existingPath === context.rootWorktreePath) {
    return yield* pullRequestBranchAlreadyCheckedOutError()
  }

  return null
})

const prepareWorktreePullRequestThread = Effect.fn('prepareWorktreePullRequestThread')(function* (
  deps: GitManagerPullRequestRuntimeDependencies,
  cwd: string,
  context: PreparePullRequestThreadContext
) {
  const existingBeforeFetch = yield* resolveExistingWorktree(deps, cwd, context)
  if (existingBeforeFetch) {
    return existingBeforeFetch
  }

  yield* materializePullRequestHeadBranch(
    deps,
    cwd,
    context.pullRequestWithRemoteInfo,
    context.localPullRequestBranch
  )

  const existingAfterFetch = yield* resolveExistingWorktree(deps, cwd, context)
  if (existingAfterFetch) {
    return existingAfterFetch
  }

  const worktree = yield* deps.gitCore.createWorktree({
    cwd,
    branch: context.localPullRequestBranch,
    path: null,
  })
  yield* ensureExistingWorktreeUpstream(deps, worktree.worktree.path, context)

  return {
    pullRequest: context.pullRequest,
    branch: worktree.worktree.branch,
    worktreePath: worktree.worktree.path,
  }
})

type PreparePullRequestThread = (
  deps: GitManagerPullRequestRuntimeDependencies,
  input: Parameters<GitManagerShape['preparePullRequestThread']>[0]
) => ReturnType<GitManagerShape['preparePullRequestThread']>

export const preparePullRequestThread: PreparePullRequestThread = (deps, input) =>
  Effect.gen(function* () {
    const pullRequestSummary = yield* deps.gitHubCli.getPullRequest({
      cwd: input.cwd,
      reference: normalizePullRequestReference(input.reference),
    })
    const context = buildPullRequestThreadContext({
      cwd: input.cwd,
      reference: input.reference,
      pullRequestSummary,
    })

    if (input.mode === 'local') {
      return yield* prepareLocalPullRequestThread(deps, input.cwd, context)
    }

    return yield* prepareWorktreePullRequestThread(deps, input.cwd, context)
  })
