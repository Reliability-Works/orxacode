import { Effect } from 'effect'

import type { GitCoreShape } from '../Services/GitCore.ts'
import type { GitHubCliShape } from '../Services/GitHubCli.ts'
import {
  appendUnique,
  extractBranchFromRef,
  gitManagerError,
  parseGitHubRepositoryNameWithOwnerFromRemoteUrl,
  parsePullRequestList,
  parseRepositoryOwnerLogin,
  resolveHeadRepositoryNameWithOwner,
  shouldPreferSshRemote,
  type BranchHeadContext,
  type PullRequestHeadRemoteInfo,
  type PullRequestInfo,
  type ResolvedPullRequest,
} from './GitManagerShared.ts'

export interface GitManagerPullRequestRuntimeDependencies {
  readonly gitCore: GitCoreShape
  readonly gitHubCli: GitHubCliShape
}

interface RemoteRepositoryContext {
  repositoryNameWithOwner: string | null
  ownerLogin: string | null
}

function collectHeadSelectors(input: {
  details: { branch: string; upstreamRef: string | null }
  headBranch: string
  remoteName: string | null
  remoteRepository: RemoteRepositoryContext
  isCrossRepository: boolean
}): ReadonlyArray<string> {
  const { details, headBranch, remoteName, remoteRepository, isCrossRepository } = input
  const ownerHeadSelector =
    remoteRepository.ownerLogin && headBranch.length > 0
      ? `${remoteRepository.ownerLogin}:${headBranch}`
      : null
  const remoteAliasHeadSelector =
    remoteName && headBranch.length > 0 ? `${remoteName}:${headBranch}` : null
  const shouldProbeRemoteOwnedSelectors =
    isCrossRepository || (remoteName !== null && remoteName !== 'origin')

  const headSelectors: string[] = []
  if (isCrossRepository && shouldProbeRemoteOwnedSelectors) {
    appendUnique(headSelectors, ownerHeadSelector)
    appendUnique(
      headSelectors,
      remoteAliasHeadSelector !== ownerHeadSelector ? remoteAliasHeadSelector : null
    )
  }
  appendUnique(headSelectors, details.branch)
  appendUnique(headSelectors, headBranch !== details.branch ? headBranch : null)
  if (!isCrossRepository && shouldProbeRemoteOwnedSelectors) {
    appendUnique(headSelectors, ownerHeadSelector)
    appendUnique(
      headSelectors,
      remoteAliasHeadSelector !== ownerHeadSelector ? remoteAliasHeadSelector : null
    )
  }

  return headSelectors
}

function selectLatestPullRequest(
  parsedByNumber: Map<number, PullRequestInfo>
): PullRequestInfo | null {
  const parsed = Array.from(parsedByNumber.values()).toSorted((a, b) => {
    const left = a.updatedAt ? Date.parse(a.updatedAt) : 0
    const right = b.updatedAt ? Date.parse(b.updatedAt) : 0
    return right - left
  })
  return parsed.find(pr => pr.state === 'open') ?? parsed[0] ?? null
}

export const readConfigValueNullable = (
  deps: GitManagerPullRequestRuntimeDependencies,
  cwd: string,
  key: string
) => deps.gitCore.readConfigValue(cwd, key).pipe(Effect.catch(() => Effect.succeed(null)))

export const resolveRemoteRepositoryContext = Effect.fn('resolveRemoteRepositoryContext')(
  function* (
    deps: GitManagerPullRequestRuntimeDependencies,
    cwd: string,
    remoteName: string | null
  ) {
    if (!remoteName) {
      return {
        repositoryNameWithOwner: null,
        ownerLogin: null,
      } satisfies RemoteRepositoryContext
    }

    const remoteUrl = yield* readConfigValueNullable(deps, cwd, `remote.${remoteName}.url`)
    const repositoryNameWithOwner = parseGitHubRepositoryNameWithOwnerFromRemoteUrl(remoteUrl)
    return {
      repositoryNameWithOwner,
      ownerLogin: parseRepositoryOwnerLogin(repositoryNameWithOwner),
    } satisfies RemoteRepositoryContext
  }
)

export const ensurePullRequestRemote = Effect.fn('ensurePullRequestRemote')(function* (
  deps: GitManagerPullRequestRuntimeDependencies,
  cwd: string,
  pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo
) {
  const repositoryNameWithOwner = resolveHeadRepositoryNameWithOwner(pullRequest) ?? ''
  if (repositoryNameWithOwner.length === 0) {
    return null
  }

  const cloneUrls = yield* deps.gitHubCli.getRepositoryCloneUrls({
    cwd,
    repository: repositoryNameWithOwner,
  })
  const originRemoteUrl = yield* deps.gitCore.readConfigValue(cwd, 'remote.origin.url')
  const remoteUrl = shouldPreferSshRemote(originRemoteUrl) ? cloneUrls.sshUrl : cloneUrls.url
  const preferredRemoteName =
    pullRequest.headRepositoryOwnerLogin?.trim() ||
    repositoryNameWithOwner.split('/')[0]?.trim() ||
    'fork'

  const remoteName = yield* deps.gitCore.ensureRemote({
    cwd,
    preferredName: preferredRemoteName,
    url: remoteUrl,
  })

  return { remoteName }
})

export const configurePullRequestHeadUpstreamBase = Effect.fn('configurePullRequestHeadUpstream')(
  function* (
    deps: GitManagerPullRequestRuntimeDependencies,
    cwd: string,
    pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
    localBranch = pullRequest.headBranch
  ) {
    const remote = yield* ensurePullRequestRemote(deps, cwd, pullRequest)
    if (!remote) {
      return
    }

    yield* deps.gitCore.setBranchUpstream({
      cwd,
      branch: localBranch,
      remoteName: remote.remoteName,
      remoteBranch: pullRequest.headBranch,
    })
  }
)

export const configurePullRequestHeadUpstream = (
  deps: GitManagerPullRequestRuntimeDependencies,
  cwd: string,
  pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
  localBranch = pullRequest.headBranch
) =>
  configurePullRequestHeadUpstreamBase(deps, cwd, pullRequest, localBranch).pipe(
    Effect.catch(error =>
      Effect.logWarning(
        `GitManager.configurePullRequestHeadUpstream: failed to configure upstream for ${localBranch} -> ${pullRequest.headBranch} in ${cwd}: ${error.message}`
      ).pipe(Effect.asVoid)
    )
  )

export const materializePullRequestHeadBranchBase = Effect.fn('materializePullRequestHeadBranch')(
  function* (
    deps: GitManagerPullRequestRuntimeDependencies,
    cwd: string,
    pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
    localBranch = pullRequest.headBranch
  ) {
    const remote = yield* ensurePullRequestRemote(deps, cwd, pullRequest)
    if (!remote) {
      yield* deps.gitCore.fetchPullRequestBranch({
        cwd,
        prNumber: pullRequest.number,
        branch: localBranch,
      })
      return
    }

    yield* deps.gitCore.fetchRemoteBranch({
      cwd,
      remoteName: remote.remoteName,
      remoteBranch: pullRequest.headBranch,
      localBranch,
    })
    yield* deps.gitCore.setBranchUpstream({
      cwd,
      branch: localBranch,
      remoteName: remote.remoteName,
      remoteBranch: pullRequest.headBranch,
    })
  }
)

export const materializePullRequestHeadBranch = (
  deps: GitManagerPullRequestRuntimeDependencies,
  cwd: string,
  pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
  localBranch = pullRequest.headBranch
) =>
  materializePullRequestHeadBranchBase(deps, cwd, pullRequest, localBranch).pipe(
    Effect.catch(() =>
      deps.gitCore.fetchPullRequestBranch({
        cwd,
        prNumber: pullRequest.number,
        branch: localBranch,
      })
    )
  )

export const resolveBranchHeadContext = Effect.fn('resolveBranchHeadContext')(function* (
  deps: GitManagerPullRequestRuntimeDependencies,
  cwd: string,
  details: { branch: string; upstreamRef: string | null }
) {
  const remoteName = yield* readConfigValueNullable(deps, cwd, `branch.${details.branch}.remote`)
  const headBranchFromUpstream = details.upstreamRef
    ? extractBranchFromRef(details.upstreamRef)
    : ''
  const headBranch = headBranchFromUpstream.length > 0 ? headBranchFromUpstream : details.branch

  const [remoteRepository, originRepository] = yield* Effect.all(
    [
      resolveRemoteRepositoryContext(deps, cwd, remoteName),
      resolveRemoteRepositoryContext(deps, cwd, 'origin'),
    ],
    {
      concurrency: 'unbounded',
    }
  )

  const isCrossRepository =
    remoteRepository.repositoryNameWithOwner !== null &&
    originRepository.repositoryNameWithOwner !== null
      ? remoteRepository.repositoryNameWithOwner.toLowerCase() !==
        originRepository.repositoryNameWithOwner.toLowerCase()
      : remoteName !== null &&
        remoteName !== 'origin' &&
        remoteRepository.repositoryNameWithOwner !== null

  const headSelectors = collectHeadSelectors({
    details,
    headBranch,
    remoteName,
    remoteRepository,
    isCrossRepository,
  })

  return {
    localBranch: details.branch,
    headBranch,
    headSelectors,
    preferredHeadSelector:
      remoteRepository.ownerLogin && isCrossRepository
        ? `${remoteRepository.ownerLogin}:${headBranch}`
        : headBranch,
    remoteName,
    headRepositoryNameWithOwner: remoteRepository.repositoryNameWithOwner,
    headRepositoryOwnerLogin: remoteRepository.ownerLogin,
    isCrossRepository,
  } satisfies BranchHeadContext
})

export const findOpenPr = Effect.fn('findOpenPr')(function* (
  deps: GitManagerPullRequestRuntimeDependencies,
  cwd: string,
  headSelectors: ReadonlyArray<string>
) {
  for (const headSelector of headSelectors) {
    const pullRequests = yield* deps.gitHubCli.listOpenPullRequests({
      cwd,
      headSelector,
      limit: 1,
    })
    const [firstPullRequest] = pullRequests
    if (firstPullRequest) {
      return {
        number: firstPullRequest.number,
        title: firstPullRequest.title,
        url: firstPullRequest.url,
        baseRefName: firstPullRequest.baseRefName,
        headRefName: firstPullRequest.headRefName,
        state: 'open',
        updatedAt: null,
      } satisfies PullRequestInfo
    }
  }

  return null
})

export const findLatestPr = Effect.fn('findLatestPr')(function* (
  deps: GitManagerPullRequestRuntimeDependencies,
  cwd: string,
  details: { branch: string; upstreamRef: string | null }
) {
  const headContext = yield* resolveBranchHeadContext(deps, cwd, details)
  const parsedByNumber = new Map<number, PullRequestInfo>()

  for (const headSelector of headContext.headSelectors) {
    const stdout = yield* deps.gitHubCli
      .execute({
        cwd,
        args: [
          'pr',
          'list',
          '--head',
          headSelector,
          '--state',
          'all',
          '--limit',
          '20',
          '--json',
          'number,title,url,baseRefName,headRefName,state,mergedAt,updatedAt',
        ],
      })
      .pipe(Effect.map(result => result.stdout))

    const raw = stdout.trim()
    if (raw.length === 0) {
      continue
    }

    const parsedJson = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: cause =>
        gitManagerError('findLatestPr', 'GitHub CLI returned invalid PR list JSON.', cause),
    })
    for (const pr of parsePullRequestList(parsedJson)) {
      parsedByNumber.set(pr.number, pr)
    }
  }

  return selectLatestPullRequest(parsedByNumber)
})

export const resolveBaseBranch = Effect.fn('resolveBaseBranch')(function* (
  deps: GitManagerPullRequestRuntimeDependencies,
  cwd: string,
  branch: string,
  upstreamRef: string | null,
  headContext: Pick<BranchHeadContext, 'isCrossRepository'>
) {
  const configured = yield* deps.gitCore.readConfigValue(cwd, `branch.${branch}.gh-merge-base`)
  if (configured) {
    return configured
  }

  if (upstreamRef && !headContext.isCrossRepository) {
    const upstreamBranch = extractBranchFromRef(upstreamRef)
    if (upstreamBranch.length > 0 && upstreamBranch !== branch) {
      return upstreamBranch
    }
  }

  const defaultFromGh = yield* deps.gitHubCli
    .getDefaultBranch({ cwd })
    .pipe(Effect.catch(() => Effect.succeed(null)))
  return defaultFromGh ?? 'main'
})
