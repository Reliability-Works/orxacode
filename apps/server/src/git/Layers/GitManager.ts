import { Effect, FileSystem, Layer, Path } from 'effect'

import { GitManager, type GitManagerShape } from '../Services/GitManager.ts'
import { GitCore } from '../Services/GitCore.ts'
import { GitHubCli } from '../Services/GitHubCli.ts'
import { TextGeneration } from '../Services/TextGeneration.ts'
import { ServerSettingsService } from '../../serverSettings.ts'
import { preparePullRequestThread, resolvePullRequest } from './GitManagerPullRequestThreads.ts'
import { findLatestPr } from './GitManagerPullRequestRuntime.ts'
import { runStackedAction } from './GitManagerStackedActions.ts'
import { toStatusPr } from './GitManagerShared.ts'

export const makeGitManager = Effect.fn('makeGitManager')(function* () {
  const gitCore = yield* GitCore
  const gitHubCli = yield* GitHubCli
  const textGeneration = yield* TextGeneration
  const serverSettingsService = yield* ServerSettingsService
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const tempDir = process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? '/tmp'

  const pullRequestRuntime = { gitCore, gitHubCli } as const

  const status: GitManagerShape['status'] = Effect.fn('status')(function* (input) {
    const details = yield* gitCore.statusDetails(input.cwd)
    const pr =
      details.branch !== null
        ? yield* findLatestPr(pullRequestRuntime, input.cwd, {
            branch: details.branch,
            upstreamRef: details.upstreamRef,
          }).pipe(
            Effect.map(latest => (latest ? toStatusPr(latest) : null)),
            Effect.catch(() => Effect.succeed(null))
          )
        : null

    return {
      branch: details.branch,
      hasWorkingTreeChanges: details.hasWorkingTreeChanges,
      workingTree: details.workingTree,
      hasUpstream: details.hasUpstream,
      aheadCount: details.aheadCount,
      behindCount: details.behindCount,
      pr,
    }
  })

  return {
    status,
    resolvePullRequest: input => resolvePullRequest(pullRequestRuntime, input),
    preparePullRequestThread: input => preparePullRequestThread(pullRequestRuntime, input),
    runStackedAction: (input, options) =>
      runStackedAction(
        {
          gitCore,
          gitHubCli,
          textGeneration,
          serverSettingsService,
          pullRequestRuntime,
          fileSystem,
          path,
          tempDir,
        },
        input,
        options
      ),
  } satisfies GitManagerShape
})

export const GitManagerLive = Layer.effect(GitManager, makeGitManager())
