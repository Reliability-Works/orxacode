/**
 * GitCore - Effect service contract for low-level Git operations.
 *
 * Wraps core repository primitives used by higher-level orchestration
 * services and WebSocket routes.
 *
 * @module GitCore
 */
import { ServiceMap } from 'effect'
import type { Effect, Scope } from 'effect'
import type {
  GitCheckoutInput,
  GitCreateBranchInput,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitGetDiffInput,
  GitGetDiffResult,
  GitGetLogInput,
  GitGetLogResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitPullResult,
  GitPushWorktreeToParentInput,
  GitPushWorktreeToParentResult,
  GitRemoveWorktreeInput,
  GitRestoreAllUnstagedInput,
  GitRestorePathInput,
  GitStageAllInput,
  GitStagePathInput,
  GitStatusInput,
  GitStatusResult,
  GitUnstagePathInput,
} from '@orxa-code/contracts'

import type { GitCommandError } from '@orxa-code/contracts'

export interface ExecuteGitInput {
  readonly operation: string
  readonly cwd: string
  readonly args: ReadonlyArray<string>
  readonly stdin?: string
  readonly env?: NodeJS.ProcessEnv
  readonly allowNonZeroExit?: boolean
  readonly timeoutMs?: number
  readonly maxOutputBytes?: number
  readonly truncateOutputAtMaxBytes?: boolean
  readonly progress?: ExecuteGitProgress
}

export interface ExecuteGitResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
  readonly stdoutTruncated: boolean
  readonly stderrTruncated: boolean
}

export interface GitStatusDetails extends Omit<GitStatusResult, 'pr'> {
  upstreamRef: string | null
}

export interface GitPreparedCommitContext {
  stagedSummary: string
  stagedPatch: string
}

export interface GitHookProgress {
  readonly onHookStarted?: (hookName: string) => Effect.Effect<void, never>
  readonly onHookFinished?: (input: {
    hookName: string
    exitCode: number | null
    durationMs: number | null
  }) => Effect.Effect<void, never>
}

export interface ExecuteGitProgress extends GitHookProgress {
  readonly onStdoutLine?: (line: string) => Effect.Effect<void, never>
  readonly onStderrLine?: (line: string) => Effect.Effect<void, never>
}

export interface GitCommitProgress extends GitHookProgress {
  readonly onOutputLine?: (input: {
    stream: 'stdout' | 'stderr'
    text: string
  }) => Effect.Effect<void, never>
}

export interface GitCommitOptions {
  readonly timeoutMs?: number
  readonly progress?: GitCommitProgress
}

export interface GitPushResult {
  status: 'pushed' | 'skipped_up_to_date'
  branch: string
  upstreamBranch?: string | undefined
  setUpstream?: boolean | undefined
}

export interface GitRangeContext {
  commitSummary: string
  diffSummary: string
  diffPatch: string
}

export interface GitListWorkspaceFilesResult {
  readonly paths: ReadonlyArray<string>
  readonly truncated: boolean
}

export interface GitRenameBranchInput {
  cwd: string
  oldBranch: string
  newBranch: string
}

export interface GitRenameBranchResult {
  branch: string
}

export interface GitFetchPullRequestBranchInput {
  cwd: string
  prNumber: number
  branch: string
}

export interface GitEnsureRemoteInput {
  cwd: string
  preferredName: string
  url: string
}

export interface GitFetchRemoteBranchInput {
  cwd: string
  remoteName: string
  remoteBranch: string
  localBranch: string
}

export interface GitSetBranchUpstreamInput {
  cwd: string
  branch: string
  remoteName: string
  remoteBranch: string
}

/**
 * GitCoreShape - Service API for low-level Git repository interactions.
 */
export interface GitCoreShape {
  /**
   * Execute a raw Git command.
   */
  readonly execute: (input: ExecuteGitInput) => Effect.Effect<ExecuteGitResult, GitCommandError>

  /**
   * Read Git status for a repository.
   */
  readonly status: (input: GitStatusInput) => Effect.Effect<GitStatusResult, GitCommandError>

  /**
   * Read detailed working tree / branch status for a repository.
   */
  readonly statusDetails: (cwd: string) => Effect.Effect<GitStatusDetails, GitCommandError>

  /**
   * Build staged change context for commit generation.
   */
  readonly prepareCommitContext: (
    cwd: string,
    filePaths?: readonly string[]
  ) => Effect.Effect<GitPreparedCommitContext | null, GitCommandError>

  /**
   * Create a commit with provided subject/body.
   */
  readonly commit: (
    cwd: string,
    subject: string,
    body: string,
    options?: GitCommitOptions
  ) => Effect.Effect<{ commitSha: string }, GitCommandError>

  /**
   * Push current branch, setting upstream if needed.
   */
  readonly pushCurrentBranch: (
    cwd: string,
    fallbackBranch: string | null
  ) => Effect.Effect<GitPushResult, GitCommandError>

  /**
   * Fast-forward push a worktree branch into its parent branch on origin.
   * Returns a discriminated-union result classifying non-fast-forward and
   * protected-branch failures so the UI can suggest opening a PR instead.
   */
  readonly pushWorktreeToParent: (
    input: GitPushWorktreeToParentInput
  ) => Effect.Effect<GitPushWorktreeToParentResult, GitCommandError>

  /**
   * Collect commit/diff context between base branch and current HEAD.
   */
  readonly readRangeContext: (
    cwd: string,
    baseBranch: string
  ) => Effect.Effect<GitRangeContext, GitCommandError>

  /**
   * Read a Git config value from the local repository.
   */
  readonly readConfigValue: (
    cwd: string,
    key: string
  ) => Effect.Effect<string | null, GitCommandError>

  /**
   * Determine whether the provided cwd is inside a git work tree.
   */
  readonly isInsideWorkTree: (cwd: string) => Effect.Effect<boolean, GitCommandError>

  /**
   * List tracked and untracked workspace file paths relative to cwd.
   */
  readonly listWorkspaceFiles: (
    cwd: string
  ) => Effect.Effect<GitListWorkspaceFilesResult, GitCommandError>

  /**
   * Remove gitignored paths from a relative path list.
   */
  readonly filterIgnoredPaths: (
    cwd: string,
    relativePaths: ReadonlyArray<string>
  ) => Effect.Effect<ReadonlyArray<string>, GitCommandError>

  /**
   * List local + remote branches and branch metadata.
   */
  readonly listBranches: (
    input: GitListBranchesInput
  ) => Effect.Effect<GitListBranchesResult, GitCommandError>

  /**
   * Pull current branch from upstream using fast-forward only.
   */
  readonly pullCurrentBranch: (cwd: string) => Effect.Effect<GitPullResult, GitCommandError>

  /**
   * Create a worktree and branch from a base branch.
   */
  readonly createWorktree: (
    input: GitCreateWorktreeInput
  ) => Effect.Effect<GitCreateWorktreeResult, GitCommandError>

  /**
   * Materialize a GitHub pull request head as a local branch without switching checkout.
   */
  readonly fetchPullRequestBranch: (
    input: GitFetchPullRequestBranchInput
  ) => Effect.Effect<void, GitCommandError>

  /**
   * Ensure a named remote exists for the provided URL, returning the reused or created remote name.
   */
  readonly ensureRemote: (input: GitEnsureRemoteInput) => Effect.Effect<string, GitCommandError>

  /**
   * Fetch a remote branch into a local branch without checkout.
   */
  readonly fetchRemoteBranch: (
    input: GitFetchRemoteBranchInput
  ) => Effect.Effect<void, GitCommandError>

  /**
   * Set the upstream tracking branch for a local branch.
   */
  readonly setBranchUpstream: (
    input: GitSetBranchUpstreamInput
  ) => Effect.Effect<void, GitCommandError>

  /**
   * Remove an existing worktree.
   */
  readonly removeWorktree: (input: GitRemoveWorktreeInput) => Effect.Effect<void, GitCommandError>

  /**
   * Rename an existing local branch.
   */
  readonly renameBranch: (
    input: GitRenameBranchInput
  ) => Effect.Effect<GitRenameBranchResult, GitCommandError>

  /**
   * Create a local branch.
   */
  readonly createBranch: (input: GitCreateBranchInput) => Effect.Effect<void, GitCommandError>

  /**
   * Checkout an existing branch and refresh its upstream metadata in background.
   */
  readonly checkoutBranch: (
    input: GitCheckoutInput
  ) => Effect.Effect<void, GitCommandError, Scope.Scope>

  /**
   * Initialize a repository in the provided directory.
   */
  readonly initRepo: (input: GitInitInput) => Effect.Effect<void, GitCommandError>

  /**
   * List local branch names (short format).
   */
  readonly listLocalBranchNames: (cwd: string) => Effect.Effect<string[], GitCommandError>

  // ── Git sidebar panel methods ───────────────────────────────────────

  /**
   * Get staged/unstaged/untracked diff for the sidebar diff view.
   */
  readonly getDiff: (input: GitGetDiffInput) => Effect.Effect<GitGetDiffResult, GitCommandError>

  /**
   * Get recent commit log entries.
   */
  readonly getLog: (input: GitGetLogInput) => Effect.Effect<GitGetLogResult, GitCommandError>

  /**
   * Stage all working tree changes.
   */
  readonly stageAll: (input: GitStageAllInput) => Effect.Effect<void, GitCommandError>

  /**
   * Restore all unstaged working tree changes.
   */
  readonly restoreAllUnstaged: (
    input: GitRestoreAllUnstagedInput
  ) => Effect.Effect<void, GitCommandError>

  /**
   * Stage a single path.
   */
  readonly stagePath: (input: GitStagePathInput) => Effect.Effect<void, GitCommandError>

  /**
   * Unstage a single path.
   */
  readonly unstagePath: (input: GitUnstagePathInput) => Effect.Effect<void, GitCommandError>

  /**
   * Restore (discard changes to) a path.
   */
  readonly restorePath: (input: GitRestorePathInput) => Effect.Effect<void, GitCommandError>
}

/**
 * GitCore - Service tag for low-level Git repository operations.
 */
export class GitCore extends ServiceMap.Service<GitCore, GitCoreShape>()(
  'orxacode/git/Services/GitCore'
) {}
