/**
 * WS handlers for `git.*` RPCs.
 *
 * Extracted from `ws.ts` to keep the aggregator file under the 500-line lint
 * cap. Covers all git operations: branch management, worktrees, working-tree
 * diff/log, per-path stage/unstage/restore, and GitHub CLI issues/PRs.
 *
 * @module ws.git
 */
import {
  type GitActionProgressEvent,
  type GitCheckoutInput,
  type GitCreateBranchInput,
  type GitCreateWorktreeInput,
  type GitGetDiffInput,
  type GitGetIssuesInput,
  type GitGetLogInput,
  type GitGetPullRequestsInput,
  type GitInitInput,
  type GitListBranchesInput,
  type GitManagerServiceError,
  type GitPreparePullRequestThreadInput,
  type GitPullInput,
  type GitPullRequestRefInput,
  type GitRemoveWorktreeInput,
  type GitRestorePathInput,
  type GitRunStackedActionInput,
  type GitStagePathInput,
  type GitStatusInput,
  type GitUnstagePathInput,
  WS_METHODS,
} from '@orxa-code/contracts'
import { Effect, Queue, Stream } from 'effect'

import type { GitCore } from './git/Services/GitCore'
import type { GitHubCli } from './git/Services/GitHubCli'
import type { GitManager } from './git/Services/GitManager'

export interface GitMethodDependencies {
  readonly git: typeof GitCore.Service
  readonly gitHubCli: typeof GitHubCli.Service
  readonly gitManager: typeof GitManager.Service
}

export const createGitMethods = ({ git, gitHubCli, gitManager }: GitMethodDependencies) => ({
  [WS_METHODS.gitStatus]: (input: GitStatusInput) => gitManager.status(input),
  [WS_METHODS.gitPull]: (input: GitPullInput) => git.pullCurrentBranch(input.cwd),
  [WS_METHODS.gitRunStackedAction]: (input: GitRunStackedActionInput) =>
    Stream.callback<GitActionProgressEvent, GitManagerServiceError>(queue =>
      gitManager
        .runStackedAction(input, {
          actionId: input.actionId,
          progressReporter: {
            publish: event => Queue.offer(queue, event).pipe(Effect.asVoid),
          },
        })
        .pipe(
          Effect.matchCauseEffect({
            onFailure: cause => Queue.failCause(queue, cause),
            onSuccess: () => Queue.end(queue).pipe(Effect.asVoid),
          })
        )
    ),
  [WS_METHODS.gitResolvePullRequest]: (input: GitPullRequestRefInput) =>
    gitManager.resolvePullRequest(input),
  [WS_METHODS.gitPreparePullRequestThread]: (input: GitPreparePullRequestThreadInput) =>
    gitManager.preparePullRequestThread(input),
  [WS_METHODS.gitListBranches]: (input: GitListBranchesInput) => git.listBranches(input),
  [WS_METHODS.gitCreateWorktree]: (input: GitCreateWorktreeInput) => git.createWorktree(input),
  [WS_METHODS.gitRemoveWorktree]: (input: GitRemoveWorktreeInput) => git.removeWorktree(input),
  [WS_METHODS.gitCreateBranch]: (input: GitCreateBranchInput) => git.createBranch(input),
  [WS_METHODS.gitCheckout]: (input: GitCheckoutInput) => Effect.scoped(git.checkoutBranch(input)),
  [WS_METHODS.gitInit]: (input: GitInitInput) => git.initRepo(input),
  [WS_METHODS.gitGetDiff]: (input: GitGetDiffInput) => git.getDiff(input),
  [WS_METHODS.gitGetLog]: (input: GitGetLogInput) => git.getLog(input),
  [WS_METHODS.gitStagePath]: (input: GitStagePathInput) => git.stagePath(input),
  [WS_METHODS.gitUnstagePath]: (input: GitUnstagePathInput) => git.unstagePath(input),
  [WS_METHODS.gitRestorePath]: (input: GitRestorePathInput) => git.restorePath(input),
  [WS_METHODS.gitGetIssues]: (input: GitGetIssuesInput) =>
    gitHubCli
      .execute({ cwd: input.cwd, args: ['issue', 'list', '--limit', String(input.limit ?? 20)] })
      .pipe(Effect.map(result => ({ text: result.stdout }))),
  [WS_METHODS.gitGetPullRequests]: (input: GitGetPullRequestsInput) =>
    gitHubCli
      .execute({ cwd: input.cwd, args: ['pr', 'list', '--limit', String(input.limit ?? 20)] })
      .pipe(Effect.map(result => ({ text: result.stdout }))),
})
