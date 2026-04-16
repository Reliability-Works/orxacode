import { Effect } from 'effect'

import type { GitCoreShape } from '../Services/GitCore.ts'

import type { GitCoreInternalDeps } from './GitCore.deps.ts'
import {
  commandLabel,
  createGitCommandError,
  normalizeRemoteUrl,
  parseRemoteFetchUrls,
  sanitizeRemoteName,
} from './GitCore.parsers.ts'

function buildCreateWorktree(deps: GitCoreInternalDeps): GitCoreShape['createWorktree'] {
  return Effect.fn('createWorktree')(function* (input) {
    const targetBranch = input.newBranch ?? input.branch
    const sanitizedBranch = targetBranch.replace(/\//g, '-')
    const repoName = deps.path.basename(input.cwd)
    const worktreePath = input.path ?? deps.path.join(deps.worktreesDir, repoName, sanitizedBranch)
    const args = input.newBranch
      ? ['worktree', 'add', '-b', input.newBranch, worktreePath, input.branch]
      : ['worktree', 'add', worktreePath, input.branch]

    yield* deps.executeGit('GitCore.createWorktree', input.cwd, args, {
      fallbackErrorMessage: 'git worktree add failed',
    })

    if (input.newBranch) {
      yield* deps
        .executeGit(
          'GitCore.createWorktree.setMergeBase',
          worktreePath,
          ['config', `branch.${input.newBranch}.gh-merge-base`, input.branch],
          { allowNonZeroExit: true }
        )
        .pipe(Effect.ignore)
    }

    return {
      worktree: {
        path: worktreePath,
        branch: targetBranch,
      },
    }
  })
}

function buildRemoveWorktree(deps: GitCoreInternalDeps): GitCoreShape['removeWorktree'] {
  return Effect.fn('removeWorktree')(function* (input) {
    const args = ['worktree', 'remove']
    if (input.force) {
      args.push('--force')
    }
    args.push(input.path)
    yield* deps
      .executeGit('GitCore.removeWorktree', input.cwd, args, {
        timeoutMs: 15_000,
        fallbackErrorMessage: 'git worktree remove failed',
      })
      .pipe(
        Effect.mapError(error =>
          createGitCommandError(
            'GitCore.removeWorktree',
            input.cwd,
            args,
            `${commandLabel(args)} failed (cwd: ${input.cwd}): ${error instanceof Error ? error.message : String(error)}`,
            error
          )
        )
      )
  })
}

function buildFetchPullRequestBranch(
  deps: GitCoreInternalDeps
): GitCoreShape['fetchPullRequestBranch'] {
  return Effect.fn('fetchPullRequestBranch')(function* (input) {
    const remoteName = yield* deps.resolvePrimaryRemoteName(input.cwd)
    yield* deps.executeGit(
      'GitCore.fetchPullRequestBranch',
      input.cwd,
      [
        'fetch',
        '--quiet',
        '--no-tags',
        remoteName,
        `+refs/pull/${input.prNumber}/head:refs/heads/${input.branch}`,
      ],
      {
        fallbackErrorMessage: 'git fetch pull request branch failed',
      }
    )
  })
}

function buildFetchRemoteBranch(deps: GitCoreInternalDeps): GitCoreShape['fetchRemoteBranch'] {
  return Effect.fn('fetchRemoteBranch')(function* (input) {
    yield* deps.runGit('GitCore.fetchRemoteBranch.fetch', input.cwd, [
      'fetch',
      '--quiet',
      '--no-tags',
      input.remoteName,
      `+refs/heads/${input.remoteBranch}:refs/remotes/${input.remoteName}/${input.remoteBranch}`,
    ])

    const localBranchAlreadyExists = yield* deps.branchExists(input.cwd, input.localBranch)
    const targetRef = `${input.remoteName}/${input.remoteBranch}`
    yield* deps.runGit(
      'GitCore.fetchRemoteBranch.materialize',
      input.cwd,
      localBranchAlreadyExists
        ? ['branch', '--force', input.localBranch, targetRef]
        : ['branch', input.localBranch, targetRef]
    )
  })
}

function buildSetBranchUpstream(deps: GitCoreInternalDeps): GitCoreShape['setBranchUpstream'] {
  return input =>
    deps.runGit('GitCore.setBranchUpstream', input.cwd, [
      'branch',
      '--set-upstream-to',
      `${input.remoteName}/${input.remoteBranch}`,
      input.branch,
    ])
}

function buildEnsureRemote(deps: GitCoreInternalDeps): GitCoreShape['ensureRemote'] {
  return Effect.fn('ensureRemote')(function* (input) {
    const preferredName = sanitizeRemoteName(input.preferredName)
    const normalizedTargetUrl = normalizeRemoteUrl(input.url)
    const remoteFetchUrls = yield* deps
      .runGitStdout('GitCore.ensureRemote.listRemoteUrls', input.cwd, ['remote', '-v'])
      .pipe(Effect.map(stdout => parseRemoteFetchUrls(stdout)))

    for (const [remoteName, remoteUrl] of remoteFetchUrls.entries()) {
      if (normalizeRemoteUrl(remoteUrl) === normalizedTargetUrl) {
        return remoteName
      }
    }

    let remoteName = preferredName
    let suffix = 1
    while (remoteFetchUrls.has(remoteName)) {
      remoteName = `${preferredName}-${suffix}`
      suffix += 1
    }

    yield* deps.runGit('GitCore.ensureRemote.add', input.cwd, [
      'remote',
      'add',
      remoteName,
      input.url,
    ])
    return remoteName
  })
}

export function makeWorktreeMethods(deps: GitCoreInternalDeps): {
  createWorktree: GitCoreShape['createWorktree']
  removeWorktree: GitCoreShape['removeWorktree']
  fetchPullRequestBranch: GitCoreShape['fetchPullRequestBranch']
  fetchRemoteBranch: GitCoreShape['fetchRemoteBranch']
  setBranchUpstream: GitCoreShape['setBranchUpstream']
  ensureRemote: GitCoreShape['ensureRemote']
} {
  return {
    createWorktree: buildCreateWorktree(deps),
    removeWorktree: buildRemoveWorktree(deps),
    fetchPullRequestBranch: buildFetchPullRequestBranch(deps),
    fetchRemoteBranch: buildFetchRemoteBranch(deps),
    setBranchUpstream: buildSetBranchUpstream(deps),
    ensureRemote: buildEnsureRemote(deps),
  }
}
