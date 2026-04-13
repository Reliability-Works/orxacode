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
  type GitDiscoverReposInput,
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
  type GitRestoreAllUnstagedInput,
  type GitRestorePathInput,
  type GitRunStackedActionInput,
  type GitStageAllInput,
  type GitStagePathInput,
  type GitStatusInput,
  type GitUnstagePathInput,
  GitCommandError,
  GitGetIssuesResult,
  GitGetPullRequestsResult,
  GitHubCliError,
  WS_METHODS,
} from '@orxa-code/contracts'
import { Effect, Queue, Schema, Stream } from 'effect'
import * as fs from 'node:fs'
import * as path from 'node:path'

import type { GitCore } from './git/Services/GitCore'
import type { GitHubCli } from './git/Services/GitHubCli'
import type { GitManager } from './git/Services/GitManager'

export interface GitMethodDependencies {
  readonly git: typeof GitCore.Service
  readonly gitHubCli: typeof GitHubCli.Service
  readonly gitManager: typeof GitManager.Service
}

function buildGitIssuesMethod(gitHubCli: GitMethodDependencies['gitHubCli']) {
  return (input: GitGetIssuesInput) =>
    gitHubCli
      .execute({
        cwd: input.cwd,
        args: [
          'issue',
          'list',
          '--limit',
          String(input.limit ?? 20),
          '--json',
          'number,title,url,state,createdAt,updatedAt,author,labels',
        ],
      })
      .pipe(
        Effect.flatMap(result =>
          Effect.try({
            try: () =>
              Schema.decodeUnknownSync(GitGetIssuesResult)({
                entries: JSON.parse(result.stdout),
              }),
            catch: error =>
              new GitHubCliError({
                operation: 'execute',
                detail: error instanceof Error ? error.message : 'Failed to decode issue list.',
                cause: error,
              }),
          })
        )
      )
}

function buildGitPullRequestsMethod(gitHubCli: GitMethodDependencies['gitHubCli']) {
  return (input: GitGetPullRequestsInput) =>
    gitHubCli
      .execute({
        cwd: input.cwd,
        args: [
          'pr',
          'list',
          '--limit',
          String(input.limit ?? 20),
          '--json',
          'number,title,url,state,isDraft,updatedAt,headRefName,baseRefName,author',
        ],
      })
      .pipe(
        Effect.flatMap(result =>
          Effect.try({
            try: () =>
              Schema.decodeUnknownSync(GitGetPullRequestsResult)({
                entries: JSON.parse(result.stdout),
              }),
            catch: error =>
              new GitHubCliError({
                operation: 'execute',
                detail:
                  error instanceof Error ? error.message : 'Failed to decode pull request list.',
                cause: error,
              }),
          })
        )
      )
}

function discoverRepos(input: GitDiscoverReposInput) {
  return Effect.try({
    try: () => {
      const entries = fs.readdirSync(input.cwd, { withFileTypes: true })
      const repos: Array<{ path: string; name: string }> = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const childPath = path.join(input.cwd, entry.name)
        try {
          fs.statSync(path.join(childPath, '.git'))
          repos.push({ path: childPath, name: entry.name })
        } catch {
          // not a git repo, skip
        }
      }
      return { repos }
    },
    catch: error =>
      new GitCommandError({
        operation: 'discoverRepos',
        command: 'fs.readdirSync',
        cwd: input.cwd,
        detail: error instanceof Error ? error.message : 'Failed to scan directory for git repos',
      }),
  })
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
  [WS_METHODS.gitStageAll]: (input: GitStageAllInput) => git.stageAll(input),
  [WS_METHODS.gitRestoreAllUnstaged]: (input: GitRestoreAllUnstagedInput) =>
    git.restoreAllUnstaged(input),
  [WS_METHODS.gitStagePath]: (input: GitStagePathInput) => git.stagePath(input),
  [WS_METHODS.gitUnstagePath]: (input: GitUnstagePathInput) => git.unstagePath(input),
  [WS_METHODS.gitRestorePath]: (input: GitRestorePathInput) => git.restorePath(input),
  [WS_METHODS.gitGetIssues]: buildGitIssuesMethod(gitHubCli),
  [WS_METHODS.gitGetPullRequests]: buildGitPullRequestsMethod(gitHubCli),
  [WS_METHODS.gitDiscoverRepos]: (input: GitDiscoverReposInput) => discoverRepos(input),
})
