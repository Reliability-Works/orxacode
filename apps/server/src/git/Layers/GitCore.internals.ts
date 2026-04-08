import { Cache, Data, Duration, Effect, Exit } from 'effect'

import type { GitCommandError } from '@orxa-code/contracts'

import type { GitCoreCommandDeps, GitCoreInternalDeps } from './GitCore.deps.ts'
import {
  commandLabel,
  createGitCommandError,
  parseRemoteFetchUrls,
  parseStatusPorcelain,
  sanitizeRemoteName,
  normalizeRemoteUrl,
  toWorkingTreeStats,
} from './GitCore.parsers.ts'
import {
  makeListRemoteNames,
  makeOriginRemoteExists,
  makeRemoteBranchExists,
  makeResolveBaseBranchForNoUpstream,
  makeResolveDefaultBranchName,
  makeResolvePrimaryRemoteName,
  makeResolvePushRemoteName,
} from './GitCore.internals.remotes.ts'

const STATUS_UPSTREAM_REFRESH_INTERVAL = Duration.seconds(15)
const STATUS_UPSTREAM_REFRESH_TIMEOUT = Duration.seconds(5)
const STATUS_UPSTREAM_REFRESH_CACHE_CAPACITY = 2_048

class StatusUpstreamRefreshCacheKey extends Data.Class<{
  cwd: string
  upstreamRef: string
  remoteName: string
  upstreamBranch: string
}> {}

function makeBranchExists(deps: GitCoreCommandDeps) {
  return (cwd: string, branch: string): Effect.Effect<boolean, GitCommandError> =>
    deps
      .executeGit(
        'GitCore.branchExists',
        cwd,
        ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
        {
          allowNonZeroExit: true,
          timeoutMs: 5_000,
        }
      )
      .pipe(Effect.map(result => result.code === 0))
}

function makeResolveAvailableBranchName(
  deps: GitCoreCommandDeps,
  branchExists: (cwd: string, branch: string) => Effect.Effect<boolean, GitCommandError>
) {
  return Effect.fn('resolveAvailableBranchName')(function* (cwd: string, desiredBranch: string) {
    const isDesiredTaken = yield* branchExists(cwd, desiredBranch)
    if (!isDesiredTaken) {
      return desiredBranch
    }

    for (let suffix = 1; suffix <= 100; suffix += 1) {
      const candidate = `${desiredBranch}-${suffix}`
      const isCandidateTaken = yield* branchExists(cwd, candidate)
      if (!isCandidateTaken) {
        return candidate
      }
    }

    return yield* createGitCommandError(
      'GitCore.renameBranch',
      cwd,
      ['branch', '-m', '--', desiredBranch],
      `Could not find an available branch name for '${desiredBranch}'.`
    )
  })
}

function makeResolveCurrentUpstream(deps: GitCoreCommandDeps) {
  return Effect.fn('resolveCurrentUpstream')(function* (cwd: string) {
    const upstreamRef = yield* deps
      .runGitStdout(
        'GitCore.resolveCurrentUpstream',
        cwd,
        ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
        true
      )
      .pipe(Effect.map(stdout => stdout.trim()))

    if (upstreamRef.length === 0 || upstreamRef === '@{upstream}') {
      return null
    }

    const separatorIndex = upstreamRef.indexOf('/')
    if (separatorIndex <= 0) {
      return null
    }
    const remoteName = upstreamRef.slice(0, separatorIndex)
    const upstreamBranch = upstreamRef.slice(separatorIndex + 1)
    if (remoteName.length === 0 || upstreamBranch.length === 0) {
      return null
    }

    return {
      upstreamRef,
      remoteName,
      upstreamBranch,
    }
  })
}

type UpstreamFetchTarget = {
  upstreamRef: string
  remoteName: string
  upstreamBranch: string
}

function buildFetchUpstreamArgs(upstream: UpstreamFetchTarget): string[] {
  const refspec = `+refs/heads/${upstream.upstreamBranch}:refs/remotes/${upstream.upstreamRef}`
  return ['fetch', '--quiet', '--no-tags', upstream.remoteName, refspec]
}

function makeFetchUpstreamRef(deps: GitCoreCommandDeps) {
  return (cwd: string, upstream: UpstreamFetchTarget): Effect.Effect<void, GitCommandError> =>
    deps.runGit('GitCore.fetchUpstreamRef', cwd, buildFetchUpstreamArgs(upstream), true)
}

function makeFetchUpstreamRefForStatus(deps: GitCoreCommandDeps) {
  return (cwd: string, upstream: UpstreamFetchTarget): Effect.Effect<void, GitCommandError> =>
    deps
      .executeGit('GitCore.fetchUpstreamRefForStatus', cwd, buildFetchUpstreamArgs(upstream), {
        allowNonZeroExit: true,
        timeoutMs: Duration.toMillis(STATUS_UPSTREAM_REFRESH_TIMEOUT),
      })
      .pipe(Effect.asVoid)
}

function makeComputeAheadCountAgainstBase(
  deps: GitCoreCommandDeps,
  resolveBaseBranchForNoUpstream: (
    cwd: string,
    branch: string
  ) => Effect.Effect<string | null, GitCommandError>
) {
  return Effect.fn('computeAheadCountAgainstBase')(function* (cwd: string, branch: string) {
    const baseBranch = yield* resolveBaseBranchForNoUpstream(cwd, branch)
    if (!baseBranch) {
      return 0
    }

    const result = yield* deps.executeGit(
      'GitCore.computeAheadCountAgainstBase',
      cwd,
      ['rev-list', '--count', `${baseBranch}..HEAD`],
      { allowNonZeroExit: true }
    )
    if (result.code !== 0) {
      return 0
    }

    const parsed = Number.parseInt(result.stdout.trim(), 10)
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
  })
}

function makeReadBranchRecency(deps: GitCoreCommandDeps) {
  return Effect.fn('readBranchRecency')(function* (cwd: string) {
    const branchRecency = yield* deps.executeGit(
      'GitCore.readBranchRecency',
      cwd,
      [
        'for-each-ref',
        '--format=%(refname:short)%09%(committerdate:unix)',
        'refs/heads',
        'refs/remotes',
      ],
      {
        timeoutMs: 15_000,
        allowNonZeroExit: true,
      }
    )

    const branchLastCommit = new Map<string, number>()
    if (branchRecency.code !== 0) {
      return branchLastCommit as ReadonlyMap<string, number>
    }

    for (const line of branchRecency.stdout.split('\n')) {
      if (line.length === 0) {
        continue
      }
      const [name, lastCommitRaw] = line.split('\t')
      if (!name) {
        continue
      }
      const lastCommit = Number.parseInt(lastCommitRaw ?? '0', 10)
      branchLastCommit.set(name, Number.isFinite(lastCommit) ? lastCommit : 0)
    }

    return branchLastCommit as ReadonlyMap<string, number>
  })
}

type BaseInternalHelpers = {
  branchExists: ReturnType<typeof makeBranchExists>
  resolveAvailableBranchName: ReturnType<typeof makeResolveAvailableBranchName>
  resolveCurrentUpstream: ReturnType<typeof makeResolveCurrentUpstream>
  fetchUpstreamRef: ReturnType<typeof makeFetchUpstreamRef>
  fetchUpstreamRefForStatus: ReturnType<typeof makeFetchUpstreamRefForStatus>
  resolveDefaultBranchName: ReturnType<typeof makeResolveDefaultBranchName>
  remoteBranchExists: ReturnType<typeof makeRemoteBranchExists>
  originRemoteExists: ReturnType<typeof makeOriginRemoteExists>
  listRemoteNames: ReturnType<typeof makeListRemoteNames>
  resolvePrimaryRemoteName: ReturnType<typeof makeResolvePrimaryRemoteName>
  resolvePushRemoteName: ReturnType<typeof makeResolvePushRemoteName>
  resolveBaseBranchForNoUpstream: ReturnType<typeof makeResolveBaseBranchForNoUpstream>
  computeAheadCountAgainstBase: ReturnType<typeof makeComputeAheadCountAgainstBase>
  readBranchRecency: ReturnType<typeof makeReadBranchRecency>
}

function buildBaseInternalHelpers(deps: GitCoreCommandDeps): BaseInternalHelpers {
  const branchExists = makeBranchExists(deps)
  const resolveAvailableBranchName = makeResolveAvailableBranchName(deps, branchExists)
  const resolveCurrentUpstream = makeResolveCurrentUpstream(deps)
  const fetchUpstreamRef = makeFetchUpstreamRef(deps)
  const fetchUpstreamRefForStatus = makeFetchUpstreamRefForStatus(deps)
  const resolveDefaultBranchName = makeResolveDefaultBranchName(deps)
  const remoteBranchExists = makeRemoteBranchExists(deps)
  const originRemoteExists = makeOriginRemoteExists(deps)
  const listRemoteNames = makeListRemoteNames(deps)
  const resolvePrimaryRemoteName = makeResolvePrimaryRemoteName(originRemoteExists, listRemoteNames)
  const resolvePushRemoteName = makeResolvePushRemoteName(deps, resolvePrimaryRemoteName)
  const resolveBaseBranchForNoUpstream = makeResolveBaseBranchForNoUpstream(
    resolvePrimaryRemoteName,
    resolveDefaultBranchName,
    branchExists,
    remoteBranchExists,
    deps
  )
  const computeAheadCountAgainstBase = makeComputeAheadCountAgainstBase(
    deps,
    resolveBaseBranchForNoUpstream
  )
  const readBranchRecency = makeReadBranchRecency(deps)
  return {
    branchExists,
    resolveAvailableBranchName,
    resolveCurrentUpstream,
    fetchUpstreamRef,
    fetchUpstreamRefForStatus,
    resolveDefaultBranchName,
    remoteBranchExists,
    originRemoteExists,
    listRemoteNames,
    resolvePrimaryRemoteName,
    resolvePushRemoteName,
    resolveBaseBranchForNoUpstream,
    computeAheadCountAgainstBase,
    readBranchRecency,
  }
}

const buildStatusUpstreamRefreshCache = Effect.fn('buildStatusUpstreamRefreshCache')(function* (
  fetchUpstreamRefForStatus: BaseInternalHelpers['fetchUpstreamRefForStatus']
) {
  const refreshStatusUpstreamCacheEntry = Effect.fn('refreshStatusUpstreamCacheEntry')(function* (
    cacheKey: StatusUpstreamRefreshCacheKey
  ) {
    yield* fetchUpstreamRefForStatus(cacheKey.cwd, {
      upstreamRef: cacheKey.upstreamRef,
      remoteName: cacheKey.remoteName,
      upstreamBranch: cacheKey.upstreamBranch,
    })
    return true as const
  })

  return yield* Cache.makeWith({
    capacity: STATUS_UPSTREAM_REFRESH_CACHE_CAPACITY,
    lookup: refreshStatusUpstreamCacheEntry,
    timeToLive: exit => (Exit.isSuccess(exit) ? STATUS_UPSTREAM_REFRESH_INTERVAL : Duration.zero),
  })
})

type StatusUpstreamRefreshCache = Cache.Cache<StatusUpstreamRefreshCacheKey, true, GitCommandError>

function buildRefreshStatusUpstreamIfStale(
  resolveCurrentUpstream: BaseInternalHelpers['resolveCurrentUpstream'],
  statusUpstreamRefreshCache: StatusUpstreamRefreshCache
) {
  return Effect.fn('refreshStatusUpstreamIfStale')(function* (cwd: string) {
    const upstream = yield* resolveCurrentUpstream(cwd)
    if (!upstream) return
    yield* Cache.get(
      statusUpstreamRefreshCache,
      new StatusUpstreamRefreshCacheKey({
        cwd,
        upstreamRef: upstream.upstreamRef,
        remoteName: upstream.remoteName,
        upstreamBranch: upstream.upstreamBranch,
      })
    )
  })
}

function buildRefreshCheckedOutBranchUpstream(
  resolveCurrentUpstream: BaseInternalHelpers['resolveCurrentUpstream'],
  fetchUpstreamRef: BaseInternalHelpers['fetchUpstreamRef']
) {
  return Effect.fn('refreshCheckedOutBranchUpstream')(function* (cwd: string) {
    const upstream = yield* resolveCurrentUpstream(cwd)
    if (!upstream) return
    yield* fetchUpstreamRef(cwd, upstream)
  })
}

function buildStatusDetails(
  deps: GitCoreCommandDeps,
  base: Pick<BaseInternalHelpers, 'computeAheadCountAgainstBase'>,
  refreshStatusUpstreamIfStale: ReturnType<typeof buildRefreshStatusUpstreamIfStale>
) {
  return Effect.fn('statusDetails')(function* (cwd: string) {
    yield* refreshStatusUpstreamIfStale(cwd).pipe(Effect.ignoreCause({ log: true }))

    const [statusStdout, unstagedNumstatStdout, stagedNumstatStdout] = yield* Effect.all(
      [
        deps.runGitStdout('GitCore.statusDetails.status', cwd, [
          'status',
          '--porcelain=2',
          '--branch',
        ]),
        deps.runGitStdout('GitCore.statusDetails.unstagedNumstat', cwd, ['diff', '--numstat']),
        deps.runGitStdout('GitCore.statusDetails.stagedNumstat', cwd, [
          'diff',
          '--cached',
          '--numstat',
        ]),
      ],
      {
        concurrency: 'unbounded',
      }
    )

    const parsedStatus = parseStatusPorcelain(statusStdout)
    const { branch, upstreamRef, hasWorkingTreeChanges, changedFilesWithoutNumstat } = parsedStatus
    let { aheadCount, behindCount } = parsedStatus

    if (!upstreamRef && branch) {
      aheadCount = yield* base
        .computeAheadCountAgainstBase(cwd, branch)
        .pipe(Effect.catch(() => Effect.succeed(0)))
      behindCount = 0
    }
    const { files, insertions, deletions } = toWorkingTreeStats(
      stagedNumstatStdout,
      unstagedNumstatStdout,
      changedFilesWithoutNumstat
    )

    return {
      branch,
      upstreamRef,
      hasWorkingTreeChanges,
      workingTree: {
        files,
        insertions,
        deletions,
      },
      hasUpstream: upstreamRef !== null,
      aheadCount,
      behindCount,
    }
  })
}

export const makeGitCoreInternals = Effect.fn('makeGitCoreInternals')(function* (
  deps: GitCoreCommandDeps
) {
  const base = buildBaseInternalHelpers(deps)
  const statusUpstreamRefreshCache = yield* buildStatusUpstreamRefreshCache(
    base.fetchUpstreamRefForStatus
  )
  const refreshStatusUpstreamIfStale = buildRefreshStatusUpstreamIfStale(
    base.resolveCurrentUpstream,
    statusUpstreamRefreshCache
  )
  const refreshCheckedOutBranchUpstream = buildRefreshCheckedOutBranchUpstream(
    base.resolveCurrentUpstream,
    base.fetchUpstreamRef
  )
  const statusDetails = buildStatusDetails(deps, base, refreshStatusUpstreamIfStale)

  const internals: GitCoreInternalDeps = {
    ...deps,
    branchExists: base.branchExists,
    resolveAvailableBranchName: base.resolveAvailableBranchName,
    resolveCurrentUpstream: base.resolveCurrentUpstream,
    fetchUpstreamRef: base.fetchUpstreamRef,
    refreshStatusUpstreamIfStale,
    refreshCheckedOutBranchUpstream,
    resolveDefaultBranchName: base.resolveDefaultBranchName,
    remoteBranchExists: base.remoteBranchExists,
    originRemoteExists: base.originRemoteExists,
    listRemoteNames: base.listRemoteNames,
    resolvePrimaryRemoteName: base.resolvePrimaryRemoteName,
    resolvePushRemoteName: base.resolvePushRemoteName,
    resolveBaseBranchForNoUpstream: base.resolveBaseBranchForNoUpstream,
    computeAheadCountAgainstBase: base.computeAheadCountAgainstBase,
    readBranchRecency: base.readBranchRecency,
    statusDetails,
  }
  return internals
})

export { sanitizeRemoteName, normalizeRemoteUrl, parseRemoteFetchUrls, commandLabel }
