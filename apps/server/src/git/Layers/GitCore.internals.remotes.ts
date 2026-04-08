import { Effect } from 'effect'

import type { GitCommandError } from '@orxa-code/contracts'

import type { GitCoreCommandDeps } from './GitCore.deps.ts'
import {
  DEFAULT_BASE_BRANCH_CANDIDATES,
  createGitCommandError,
  parseDefaultBranchFromRemoteHeadRef,
  parseRemoteNames,
} from './GitCore.parsers.ts'

export function makeResolveDefaultBranchName(deps: GitCoreCommandDeps) {
  return (cwd: string, remoteName: string): Effect.Effect<string | null, GitCommandError> =>
    deps
      .executeGit(
        'GitCore.resolveDefaultBranchName',
        cwd,
        ['symbolic-ref', `refs/remotes/${remoteName}/HEAD`],
        { allowNonZeroExit: true }
      )
      .pipe(
        Effect.map(result => {
          if (result.code !== 0) {
            return null
          }
          return parseDefaultBranchFromRemoteHeadRef(result.stdout, remoteName)
        })
      )
}

export function makeRemoteBranchExists(deps: GitCoreCommandDeps) {
  return (
    cwd: string,
    remoteName: string,
    branch: string
  ): Effect.Effect<boolean, GitCommandError> =>
    deps
      .executeGit(
        'GitCore.remoteBranchExists',
        cwd,
        ['show-ref', '--verify', '--quiet', `refs/remotes/${remoteName}/${branch}`],
        { allowNonZeroExit: true }
      )
      .pipe(Effect.map(result => result.code === 0))
}

export function makeOriginRemoteExists(deps: GitCoreCommandDeps) {
  return (cwd: string): Effect.Effect<boolean, GitCommandError> =>
    deps
      .executeGit('GitCore.originRemoteExists', cwd, ['remote', 'get-url', 'origin'], {
        allowNonZeroExit: true,
      })
      .pipe(Effect.map(result => result.code === 0))
}

export function makeListRemoteNames(deps: GitCoreCommandDeps) {
  return (cwd: string): Effect.Effect<ReadonlyArray<string>, GitCommandError> =>
    deps
      .runGitStdout('GitCore.listRemoteNames', cwd, ['remote'])
      .pipe(Effect.map(stdout => parseRemoteNames(stdout).toReversed()))
}

export function makeResolvePrimaryRemoteName(
  originRemoteExists: (cwd: string) => Effect.Effect<boolean, GitCommandError>,
  listRemoteNames: (cwd: string) => Effect.Effect<ReadonlyArray<string>, GitCommandError>
) {
  return Effect.fn('resolvePrimaryRemoteName')(function* (cwd: string) {
    if (yield* originRemoteExists(cwd)) {
      return 'origin'
    }
    const remotes = yield* listRemoteNames(cwd)
    const [firstRemote] = remotes
    if (firstRemote) {
      return firstRemote
    }
    return yield* createGitCommandError(
      'GitCore.resolvePrimaryRemoteName',
      cwd,
      ['remote'],
      'No git remote is configured for this repository.'
    )
  })
}

export function makeResolvePushRemoteName(
  deps: GitCoreCommandDeps,
  resolvePrimaryRemoteName: (cwd: string) => Effect.Effect<string, GitCommandError>
) {
  return Effect.fn('resolvePushRemoteName')(function* (cwd: string, branch: string) {
    const branchPushRemote = yield* deps
      .runGitStdout(
        'GitCore.resolvePushRemoteName.branchPushRemote',
        cwd,
        ['config', '--get', `branch.${branch}.pushRemote`],
        true
      )
      .pipe(Effect.map(stdout => stdout.trim()))
    if (branchPushRemote.length > 0) {
      return branchPushRemote
    }

    const pushDefaultRemote = yield* deps
      .runGitStdout(
        'GitCore.resolvePushRemoteName.remotePushDefault',
        cwd,
        ['config', '--get', 'remote.pushDefault'],
        true
      )
      .pipe(Effect.map(stdout => stdout.trim()))
    if (pushDefaultRemote.length > 0) {
      return pushDefaultRemote
    }

    return yield* resolvePrimaryRemoteName(cwd).pipe(Effect.catch(() => Effect.succeed(null)))
  })
}

export function makeResolveBaseBranchForNoUpstream(
  resolvePrimaryRemoteName: (cwd: string) => Effect.Effect<string, GitCommandError>,
  resolveDefaultBranchName: (
    cwd: string,
    remoteName: string
  ) => Effect.Effect<string | null, GitCommandError>,
  branchExists: (cwd: string, branch: string) => Effect.Effect<boolean, GitCommandError>,
  remoteBranchExists: (
    cwd: string,
    remoteName: string,
    branch: string
  ) => Effect.Effect<boolean, GitCommandError>,
  deps: GitCoreCommandDeps
) {
  return Effect.fn('resolveBaseBranchForNoUpstream')(function* (cwd: string, branch: string) {
    const configuredBaseBranch = yield* deps
      .runGitStdout(
        'GitCore.resolveBaseBranchForNoUpstream.config',
        cwd,
        ['config', '--get', `branch.${branch}.gh-merge-base`],
        true
      )
      .pipe(Effect.map(stdout => stdout.trim()))

    const primaryRemoteName = yield* resolvePrimaryRemoteName(cwd).pipe(
      Effect.catch(() => Effect.succeed(null))
    )
    const defaultBranch =
      primaryRemoteName === null ? null : yield* resolveDefaultBranchName(cwd, primaryRemoteName)
    const candidates = [
      configuredBaseBranch.length > 0 ? configuredBaseBranch : null,
      defaultBranch,
      ...DEFAULT_BASE_BRANCH_CANDIDATES,
    ]

    for (const candidate of candidates) {
      if (!candidate) {
        continue
      }

      const remotePrefix =
        primaryRemoteName && primaryRemoteName !== 'origin' ? `${primaryRemoteName}/` : null
      const normalizedCandidate = candidate.startsWith('origin/')
        ? candidate.slice('origin/'.length)
        : remotePrefix && candidate.startsWith(remotePrefix)
          ? candidate.slice(remotePrefix.length)
          : candidate
      if (normalizedCandidate.length === 0 || normalizedCandidate === branch) {
        continue
      }

      if (yield* branchExists(cwd, normalizedCandidate)) {
        return normalizedCandidate
      }

      if (
        primaryRemoteName &&
        (yield* remoteBranchExists(cwd, primaryRemoteName, normalizedCandidate))
      ) {
        return `${primaryRemoteName}/${normalizedCandidate}`
      }
    }

    return null
  })
}
