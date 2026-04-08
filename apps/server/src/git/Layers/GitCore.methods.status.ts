import { Effect } from 'effect'

import type { GitCoreShape, GitCommitOptions } from '../Services/GitCore.ts'

import type { GitCoreInternalDeps } from './GitCore.deps.ts'
import { PREPARED_COMMIT_PATCH_MAX_OUTPUT_BYTES } from './GitCore.parsers.ts'

function buildStatus(deps: GitCoreInternalDeps): GitCoreShape['status'] {
  return input =>
    deps.statusDetails(input.cwd).pipe(
      Effect.map(details => ({
        branch: details.branch,
        hasWorkingTreeChanges: details.hasWorkingTreeChanges,
        workingTree: details.workingTree,
        hasUpstream: details.hasUpstream,
        aheadCount: details.aheadCount,
        behindCount: details.behindCount,
        pr: null,
      }))
    )
}

function buildPrepareCommitContext(
  deps: GitCoreInternalDeps
): GitCoreShape['prepareCommitContext'] {
  return Effect.fn('prepareCommitContext')(function* (cwd, filePaths) {
    if (filePaths && filePaths.length > 0) {
      yield* deps
        .runGit('GitCore.prepareCommitContext.reset', cwd, ['reset'])
        .pipe(Effect.catch(() => Effect.void))
      yield* deps.runGit('GitCore.prepareCommitContext.addSelected', cwd, [
        'add',
        '-A',
        '--',
        ...filePaths,
      ])
    } else {
      yield* deps.runGit('GitCore.prepareCommitContext.addAll', cwd, ['add', '-A'])
    }

    const stagedSummary = yield* deps
      .runGitStdout('GitCore.prepareCommitContext.stagedSummary', cwd, [
        'diff',
        '--cached',
        '--name-status',
      ])
      .pipe(Effect.map(stdout => stdout.trim()))
    if (stagedSummary.length === 0) {
      return null
    }

    const stagedPatch = yield* deps.runGitStdoutWithOptions(
      'GitCore.prepareCommitContext.stagedPatch',
      cwd,
      ['diff', '--cached', '--patch', '--minimal'],
      {
        maxOutputBytes: PREPARED_COMMIT_PATCH_MAX_OUTPUT_BYTES,
        truncateOutputAtMaxBytes: true,
      }
    )

    return {
      stagedSummary,
      stagedPatch,
    }
  })
}

function buildCommitProgress(options?: GitCommitOptions) {
  if (options?.progress?.onOutputLine === undefined) {
    return options?.progress
  }
  const source = options.progress
  return {
    ...source,
    onStdoutLine: (line: string) =>
      source.onOutputLine?.({ stream: 'stdout', text: line }) ?? Effect.void,
    onStderrLine: (line: string) =>
      source.onOutputLine?.({ stream: 'stderr', text: line }) ?? Effect.void,
  }
}

function buildCommit(deps: GitCoreInternalDeps): GitCoreShape['commit'] {
  return Effect.fn('commit')(function* (cwd, subject, body, options?: GitCommitOptions) {
    const args = ['commit', '-m', subject]
    const trimmedBody = body.trim()
    if (trimmedBody.length > 0) {
      args.push('-m', trimmedBody)
    }
    const progress = buildCommitProgress(options)
    yield* deps
      .executeGit('GitCore.commit.commit', cwd, args, {
        ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(progress ? { progress } : {}),
      })
      .pipe(Effect.asVoid)
    const commitSha = yield* deps
      .runGitStdout('GitCore.commit.revParseHead', cwd, ['rev-parse', 'HEAD'])
      .pipe(Effect.map(stdout => stdout.trim()))

    return { commitSha }
  })
}

export function makeStatusMethods(deps: GitCoreInternalDeps): {
  status: GitCoreShape['status']
  statusDetails: GitCoreShape['statusDetails']
  prepareCommitContext: GitCoreShape['prepareCommitContext']
  commit: GitCoreShape['commit']
} {
  return {
    status: buildStatus(deps),
    statusDetails: deps.statusDetails,
    prepareCommitContext: buildPrepareCommitContext(deps),
    commit: buildCommit(deps),
  }
}
