import { Effect } from 'effect'

import type { GitCommandError } from '@orxa-code/contracts'
import type { GitCoreShape, ExecuteGitResult } from '../Services/GitCore.ts'

import type { GitCoreInternalDeps } from './GitCore.deps.ts'
import {
  buildLocalBranchEntries,
  buildRemoteBranchEntries,
  createGitCommandError,
  deriveLocalBranchNameFromRemoteRef,
  listBranchLookupFailureEffect,
  logListBranchLookupWarnings,
  parseRemoteNames,
  parseTrackingBranchByUpstreamRef,
  readWorktreeMap,
} from './GitCore.parsers.ts'

type GitLookupResult = Pick<ExecuteGitResult, 'code' | 'stdout' | 'stderr'>

function readListBranchesLocalResult(
  deps: GitCoreInternalDeps,
  cwd: string
): Effect.Effect<GitLookupResult, GitCommandError> {
  return deps.executeGit(
    'GitCore.listBranches.branchNoColor',
    cwd,
    ['branch', '--no-color', '--no-column'],
    {
      timeoutMs: 10_000,
      allowNonZeroExit: true,
    }
  )
}

function readListBranchesRemoteBranchResult(
  deps: GitCoreInternalDeps,
  cwd: string
): Effect.Effect<GitLookupResult, never> {
  return deps
    .executeGit(
      'GitCore.listBranches.remoteBranches',
      cwd,
      ['branch', '--no-color', '--no-column', '--remotes'],
      {
        timeoutMs: 10_000,
        allowNonZeroExit: true,
      }
    )
    .pipe(
      Effect.catch(error =>
        listBranchLookupFailureEffect({
          cwd,
          lookup: 'remote branch',
          errorMessage: error.message,
        })
      )
    )
}

function readListBranchesRemoteNamesResult(
  deps: GitCoreInternalDeps,
  cwd: string
): Effect.Effect<GitLookupResult, never> {
  return deps
    .executeGit('GitCore.listBranches.remoteNames', cwd, ['remote'], {
      timeoutMs: 5_000,
      allowNonZeroExit: true,
    })
    .pipe(
      Effect.catch(error =>
        listBranchLookupFailureEffect({
          cwd,
          lookup: 'remote name',
          errorMessage: error.message,
        })
      )
    )
}

const readListBranchesSupportingData = Effect.fn('readListBranchesSupportingData')(function* (
  deps: GitCoreInternalDeps,
  cwd: string,
  branchRecencyPromise: Effect.Effect<ReadonlyMap<string, number>, never>
) {
  const [defaultRef, worktreeList, remoteBranchResult, remoteNamesResult, branchLastCommit] =
    yield* Effect.all(
      [
        deps.executeGit(
          'GitCore.listBranches.defaultRef',
          cwd,
          ['symbolic-ref', 'refs/remotes/origin/HEAD'],
          { timeoutMs: 5_000, allowNonZeroExit: true }
        ),
        deps.executeGit(
          'GitCore.listBranches.worktreeList',
          cwd,
          ['worktree', 'list', '--porcelain'],
          { timeoutMs: 5_000, allowNonZeroExit: true }
        ),
        readListBranchesRemoteBranchResult(deps, cwd),
        readListBranchesRemoteNamesResult(deps, cwd),
        branchRecencyPromise,
      ],
      { concurrency: 'unbounded' }
    )
  return { defaultRef, worktreeList, remoteBranchResult, remoteNamesResult, branchLastCommit }
})

function buildListBranches(deps: GitCoreInternalDeps): GitCoreShape['listBranches'] {
  return Effect.fn('listBranches')(function* (input) {
    const branchRecencyPromise = deps
      .readBranchRecency(input.cwd)
      .pipe(
        Effect.catch(() => Effect.succeed(new Map<string, number>() as ReadonlyMap<string, number>))
      )
    const localBranchResult = yield* readListBranchesLocalResult(deps, input.cwd)
    if (localBranchResult.code !== 0) {
      const stderr = localBranchResult.stderr.trim()
      if (stderr.toLowerCase().includes('not a git repository')) {
        return { branches: [], isRepo: false, hasOriginRemote: false }
      }
      return yield* createGitCommandError(
        'GitCore.listBranches',
        input.cwd,
        ['branch', '--no-color', '--no-column'],
        stderr || 'git branch failed'
      )
    }

    const { defaultRef, worktreeList, remoteBranchResult, remoteNamesResult, branchLastCommit } =
      yield* readListBranchesSupportingData(deps, input.cwd, branchRecencyPromise)
    const remoteNames =
      remoteNamesResult.code === 0 ? parseRemoteNames(remoteNamesResult.stdout) : []
    yield* logListBranchLookupWarnings({
      cwd: input.cwd,
      remoteBranchResult,
      remoteNamesResult,
    })

    const defaultBranch =
      defaultRef.code === 0
        ? defaultRef.stdout.trim().replace(/^refs\/remotes\/origin\//, '')
        : null
    const worktreeMap =
      worktreeList.code === 0
        ? yield* readWorktreeMap(deps.fileSystem, worktreeList.stdout)
        : new Map<string, string>()
    const localBranches = buildLocalBranchEntries({
      stdout: localBranchResult.stdout,
      defaultBranch,
      worktreeMap,
      branchLastCommit,
    })
    const remoteBranches =
      remoteBranchResult.code === 0
        ? buildRemoteBranchEntries({
            stdout: remoteBranchResult.stdout,
            remoteNames,
            branchLastCommit,
          })
        : []

    return {
      branches: [...localBranches, ...remoteBranches],
      isRepo: true,
      hasOriginRemote: remoteNames.includes('origin'),
    }
  })
}

function buildCreateBranch(deps: GitCoreInternalDeps): GitCoreShape['createBranch'] {
  return input =>
    deps
      .executeGit('GitCore.createBranch', input.cwd, ['branch', input.branch], {
        timeoutMs: 10_000,
        fallbackErrorMessage: 'git branch create failed',
      })
      .pipe(Effect.asVoid)
}

function buildRenameBranch(deps: GitCoreInternalDeps): GitCoreShape['renameBranch'] {
  return Effect.fn('renameBranch')(function* (input) {
    if (input.oldBranch === input.newBranch) {
      return { branch: input.newBranch }
    }
    const targetBranch = yield* deps.resolveAvailableBranchName(input.cwd, input.newBranch)

    yield* deps.executeGit(
      'GitCore.renameBranch',
      input.cwd,
      ['branch', '-m', '--', input.oldBranch, targetBranch],
      {
        timeoutMs: 10_000,
        fallbackErrorMessage: 'git branch rename failed',
      }
    )

    return { branch: targetBranch }
  })
}

const resolveCheckoutArgs = Effect.fn('resolveCheckoutArgs')(function* (
  deps: GitCoreInternalDeps,
  cwd: string,
  branch: string
) {
  const [localInputExists, remoteExists] = yield* Effect.all(
    [
      deps
        .executeGit(
          'GitCore.checkoutBranch.localInputExists',
          cwd,
          ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
          { timeoutMs: 5_000, allowNonZeroExit: true }
        )
        .pipe(Effect.map(result => result.code === 0)),
      deps
        .executeGit(
          'GitCore.checkoutBranch.remoteExists',
          cwd,
          ['show-ref', '--verify', '--quiet', `refs/remotes/${branch}`],
          { timeoutMs: 5_000, allowNonZeroExit: true }
        )
        .pipe(Effect.map(result => result.code === 0)),
    ],
    { concurrency: 'unbounded' }
  )

  const localTrackingBranch = remoteExists
    ? yield* deps
        .executeGit(
          'GitCore.checkoutBranch.localTrackingBranch',
          cwd,
          ['for-each-ref', '--format=%(refname:short)\t%(upstream:short)', 'refs/heads'],
          { timeoutMs: 5_000, allowNonZeroExit: true }
        )
        .pipe(
          Effect.map(result =>
            result.code === 0 ? parseTrackingBranchByUpstreamRef(result.stdout, branch) : null
          )
        )
    : null

  const localTrackedBranchCandidate = deriveLocalBranchNameFromRemoteRef(branch)
  const localTrackedBranchTargetExists =
    remoteExists && localTrackedBranchCandidate
      ? yield* deps
          .executeGit(
            'GitCore.checkoutBranch.localTrackedBranchTargetExists',
            cwd,
            ['show-ref', '--verify', '--quiet', `refs/heads/${localTrackedBranchCandidate}`],
            {
              timeoutMs: 5_000,
              allowNonZeroExit: true,
            }
          )
          .pipe(Effect.map(result => result.code === 0))
      : false

  return localInputExists
    ? ['checkout', branch]
    : remoteExists && !localTrackingBranch && localTrackedBranchTargetExists
      ? ['checkout', branch]
      : remoteExists && !localTrackingBranch
        ? ['checkout', '--track', branch]
        : remoteExists && localTrackingBranch
          ? ['checkout', localTrackingBranch]
          : ['checkout', branch]
})

function buildCheckoutBranch(deps: GitCoreInternalDeps): GitCoreShape['checkoutBranch'] {
  return Effect.fn('checkoutBranch')(function* (input) {
    const checkoutArgs = yield* resolveCheckoutArgs(deps, input.cwd, input.branch)

    yield* deps.executeGit('GitCore.checkoutBranch.checkout', input.cwd, checkoutArgs, {
      timeoutMs: 10_000,
      fallbackErrorMessage: 'git checkout failed',
    })

    yield* deps
      .refreshCheckedOutBranchUpstream(input.cwd)
      .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach({ startImmediately: true }))
  })
}

export function makeBranchMethods(deps: GitCoreInternalDeps): {
  listBranches: GitCoreShape['listBranches']
  createBranch: GitCoreShape['createBranch']
  renameBranch: GitCoreShape['renameBranch']
  checkoutBranch: GitCoreShape['checkoutBranch']
} {
  return {
    listBranches: buildListBranches(deps),
    createBranch: buildCreateBranch(deps),
    renameBranch: buildRenameBranch(deps),
    checkoutBranch: buildCheckoutBranch(deps),
  }
}
