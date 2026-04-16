import { Effect } from 'effect'

import type { GitPushWorktreeToParentResult } from '@orxa-code/contracts'

import type { GitCoreShape } from '../Services/GitCore.ts'

import type { GitCoreInternalDeps } from './GitCore.deps.ts'
import {
  RANGE_COMMIT_SUMMARY_MAX_OUTPUT_BYTES,
  RANGE_DIFF_PATCH_MAX_OUTPUT_BYTES,
  RANGE_DIFF_SUMMARY_MAX_OUTPUT_BYTES,
  createGitCommandError,
} from './GitCore.parsers.ts'

type PushCurrentBranchStatusDetails = {
  aheadCount: number
  behindCount: number
  hasUpstream: boolean
  upstreamRef: string | null
}

type SkippedUpToDatePushResult = {
  status: 'skipped_up_to_date'
  branch: string
  upstreamBranch?: string
}

function skippedUpToDatePushResult(
  branch: string,
  upstreamRef: string | null
): SkippedUpToDatePushResult {
  return {
    status: 'skipped_up_to_date',
    branch,
    ...(upstreamRef ? { upstreamBranch: upstreamRef } : {}),
  }
}

function buildResolveSkippedPushForNoLocalDelta(deps: GitCoreInternalDeps) {
  return Effect.fn('resolveSkippedPushForNoLocalDelta')(function* (
    cwd: string,
    branch: string,
    details: PushCurrentBranchStatusDetails
  ) {
    const hasNoLocalDelta = details.aheadCount === 0 && details.behindCount === 0
    if (!hasNoLocalDelta) {
      return null
    }
    if (details.hasUpstream) {
      return skippedUpToDatePushResult(branch, details.upstreamRef)
    }

    const comparableBaseBranch = yield* deps
      .resolveBaseBranchForNoUpstream(cwd, branch)
      .pipe(Effect.catch(() => Effect.succeed(null)))
    if (!comparableBaseBranch) {
      return null
    }

    const publishRemoteName = yield* deps
      .resolvePushRemoteName(cwd, branch)
      .pipe(Effect.catch(() => Effect.succeed(null)))
    if (!publishRemoteName) {
      return skippedUpToDatePushResult(branch, null)
    }

    const hasRemoteBranch = yield* deps
      .remoteBranchExists(cwd, publishRemoteName, branch)
      .pipe(Effect.catch(() => Effect.succeed(false)))
    return hasRemoteBranch ? skippedUpToDatePushResult(branch, null) : null
  })
}

function buildPushWithNoUpstream(deps: GitCoreInternalDeps) {
  return Effect.fn('pushWithNoUpstream')(function* (cwd: string, branch: string) {
    const publishRemoteName = yield* deps.resolvePushRemoteName(cwd, branch)
    if (!publishRemoteName) {
      return yield* createGitCommandError(
        'GitCore.pushCurrentBranch',
        cwd,
        ['push'],
        'Cannot push because no git remote is configured for this repository.'
      )
    }
    yield* deps.runGit('GitCore.pushCurrentBranch.pushWithUpstream', cwd, [
      'push',
      '-u',
      publishRemoteName,
      branch,
    ])
    return {
      status: 'pushed' as const,
      branch,
      upstreamBranch: `${publishRemoteName}/${branch}`,
      setUpstream: true,
    }
  })
}

function buildPushWithUpstream(deps: GitCoreInternalDeps) {
  return Effect.fn('pushWithUpstream')(function* (
    cwd: string,
    branch: string,
    details: PushCurrentBranchStatusDetails
  ) {
    const currentUpstream = yield* deps
      .resolveCurrentUpstream(cwd)
      .pipe(Effect.catch(() => Effect.succeed(null)))
    if (currentUpstream) {
      yield* deps.runGit('GitCore.pushCurrentBranch.pushUpstream', cwd, [
        'push',
        currentUpstream.remoteName,
        `HEAD:${currentUpstream.upstreamBranch}`,
      ])
      return {
        status: 'pushed' as const,
        branch,
        upstreamBranch: currentUpstream.upstreamRef,
        setUpstream: false,
      }
    }

    yield* deps.runGit('GitCore.pushCurrentBranch.push', cwd, ['push'])
    return {
      status: 'pushed' as const,
      branch,
      ...(details.upstreamRef ? { upstreamBranch: details.upstreamRef } : {}),
      setUpstream: false,
    }
  })
}

function buildPushCurrentBranch(deps: GitCoreInternalDeps): GitCoreShape['pushCurrentBranch'] {
  const resolveSkippedPushForNoLocalDelta = buildResolveSkippedPushForNoLocalDelta(deps)
  const pushWithNoUpstream = buildPushWithNoUpstream(deps)
  const pushWithUpstream = buildPushWithUpstream(deps)
  return Effect.fn('pushCurrentBranch')(function* (cwd, fallbackBranch) {
    const details = yield* deps.statusDetails(cwd)
    const branch = details.branch ?? fallbackBranch
    if (!branch) {
      return yield* createGitCommandError(
        'GitCore.pushCurrentBranch',
        cwd,
        ['push'],
        'Cannot push from detached HEAD.'
      )
    }

    const skippedResult = yield* resolveSkippedPushForNoLocalDelta(cwd, branch, details)
    if (skippedResult) {
      return skippedResult
    }

    if (!details.hasUpstream) {
      return yield* pushWithNoUpstream(cwd, branch)
    }

    return yield* pushWithUpstream(cwd, branch, details)
  })
}

function classifyPushFailure(stderr: string): GitPushWorktreeToParentResult {
  const lowered = stderr.toLowerCase()
  if (lowered.includes('non-fast-forward') || lowered.includes('(fetch first)')) {
    return { ok: false, reason: 'non_fast_forward', message: stderr }
  }
  if (
    lowered.includes('protected branch') ||
    lowered.includes('gh006') ||
    lowered.includes('gh013')
  ) {
    return { ok: false, reason: 'protected', message: stderr }
  }
  return { ok: false, reason: 'other', message: stderr }
}

function buildPushWorktreeToParent(
  deps: GitCoreInternalDeps
): GitCoreShape['pushWorktreeToParent'] {
  return Effect.fn('pushWorktreeToParent')(function* (input) {
    const remoteName = yield* deps.resolvePushRemoteName(input.cwd, input.sourceBranch)
    if (!remoteName) {
      return yield* createGitCommandError(
        'GitCore.pushWorktreeToParent',
        input.cwd,
        ['push'],
        'Cannot push because no git remote is configured for this repository.'
      )
    }

    yield* deps.runGit('GitCore.pushWorktreeToParent.fetchParent', input.cwd, [
      'fetch',
      '--quiet',
      '--no-tags',
      remoteName,
      input.parentBranch,
    ])

    const pushResult = yield* deps.executeGit(
      'GitCore.pushWorktreeToParent.push',
      input.cwd,
      ['push', remoteName, `${input.sourceBranch}:refs/heads/${input.parentBranch}`],
      { allowNonZeroExit: true, timeoutMs: 30_000 }
    )

    if (pushResult.code === 0) {
      return { ok: true } as const
    }
    const stderr = pushResult.stderr.trim() || pushResult.stdout.trim() || 'git push failed'
    return classifyPushFailure(stderr)
  })
}

function buildPullCurrentBranch(deps: GitCoreInternalDeps): GitCoreShape['pullCurrentBranch'] {
  return Effect.fn('pullCurrentBranch')(function* (cwd) {
    const details = yield* deps.statusDetails(cwd)
    const branch = details.branch
    if (!branch) {
      return yield* createGitCommandError(
        'GitCore.pullCurrentBranch',
        cwd,
        ['pull', '--ff-only'],
        'Cannot pull from detached HEAD.'
      )
    }
    if (!details.hasUpstream) {
      return yield* createGitCommandError(
        'GitCore.pullCurrentBranch',
        cwd,
        ['pull', '--ff-only'],
        'Current branch has no upstream configured. Push with upstream first.'
      )
    }
    const beforeSha = yield* deps
      .runGitStdout('GitCore.pullCurrentBranch.beforeSha', cwd, ['rev-parse', 'HEAD'], true)
      .pipe(Effect.map(stdout => stdout.trim()))
    yield* deps.executeGit('GitCore.pullCurrentBranch.pull', cwd, ['pull', '--ff-only'], {
      timeoutMs: 30_000,
      fallbackErrorMessage: 'git pull failed',
    })
    const afterSha = yield* deps
      .runGitStdout('GitCore.pullCurrentBranch.afterSha', cwd, ['rev-parse', 'HEAD'], true)
      .pipe(Effect.map(stdout => stdout.trim()))

    const refreshed = yield* deps.statusDetails(cwd)
    return {
      status: beforeSha.length > 0 && beforeSha === afterSha ? 'skipped_up_to_date' : 'pulled',
      branch,
      upstreamBranch: refreshed.upstreamRef,
    }
  })
}

function buildReadRangeContext(deps: GitCoreInternalDeps): GitCoreShape['readRangeContext'] {
  return Effect.fn('readRangeContext')(function* (cwd, baseBranch) {
    const range = `${baseBranch}..HEAD`
    const [commitSummary, diffSummary, diffPatch] = yield* Effect.all(
      [
        deps.runGitStdoutWithOptions(
          'GitCore.readRangeContext.log',
          cwd,
          ['log', '--oneline', range],
          {
            maxOutputBytes: RANGE_COMMIT_SUMMARY_MAX_OUTPUT_BYTES,
            truncateOutputAtMaxBytes: true,
          }
        ),
        deps.runGitStdoutWithOptions(
          'GitCore.readRangeContext.diffStat',
          cwd,
          ['diff', '--stat', range],
          {
            maxOutputBytes: RANGE_DIFF_SUMMARY_MAX_OUTPUT_BYTES,
            truncateOutputAtMaxBytes: true,
          }
        ),
        deps.runGitStdoutWithOptions(
          'GitCore.readRangeContext.diffPatch',
          cwd,
          ['diff', '--patch', '--minimal', range],
          {
            maxOutputBytes: RANGE_DIFF_PATCH_MAX_OUTPUT_BYTES,
            truncateOutputAtMaxBytes: true,
          }
        ),
      ],
      { concurrency: 'unbounded' }
    )

    return {
      commitSummary,
      diffSummary,
      diffPatch,
    }
  })
}

export function makePushMethods(deps: GitCoreInternalDeps): {
  pushCurrentBranch: GitCoreShape['pushCurrentBranch']
  pushWorktreeToParent: GitCoreShape['pushWorktreeToParent']
  pullCurrentBranch: GitCoreShape['pullCurrentBranch']
  readRangeContext: GitCoreShape['readRangeContext']
} {
  return {
    pushCurrentBranch: buildPushCurrentBranch(deps),
    pushWorktreeToParent: buildPushWorktreeToParent(deps),
    pullCurrentBranch: buildPullCurrentBranch(deps),
    readRangeContext: buildReadRangeContext(deps),
  }
}
