import type { Effect, FileSystem, Path } from 'effect'

import type { GitCommandError } from '@orxa-code/contracts'
import type { ExecuteGitResult, GitCoreShape } from '../Services/GitCore.ts'

export interface ExecuteGitOptions {
  stdin?: string | undefined
  timeoutMs?: number | undefined
  allowNonZeroExit?: boolean | undefined
  fallbackErrorMessage?: string | undefined
  maxOutputBytes?: number | undefined
  truncateOutputAtMaxBytes?: boolean | undefined
  progress?: import('../Services/GitCore.ts').ExecuteGitProgress | undefined
}

export type ExecuteGitFn = (
  operation: string,
  cwd: string,
  args: readonly string[],
  options?: ExecuteGitOptions
) => Effect.Effect<ExecuteGitResult, GitCommandError>

export type RunGitFn = (
  operation: string,
  cwd: string,
  args: readonly string[],
  allowNonZeroExit?: boolean
) => Effect.Effect<void, GitCommandError>

export type RunGitStdoutFn = (
  operation: string,
  cwd: string,
  args: readonly string[],
  allowNonZeroExit?: boolean
) => Effect.Effect<string, GitCommandError>

export type RunGitStdoutWithOptionsFn = (
  operation: string,
  cwd: string,
  args: readonly string[],
  options?: ExecuteGitOptions
) => Effect.Effect<string, GitCommandError>

export interface StatusUpstreamRefreshCacheKeyShape {
  cwd: string
  upstreamRef: string
  remoteName: string
  upstreamBranch: string
}

export interface GitCoreCommandDeps {
  readonly executeGit: ExecuteGitFn
  readonly runGit: RunGitFn
  readonly runGitStdout: RunGitStdoutFn
  readonly runGitStdoutWithOptions: RunGitStdoutWithOptionsFn
  readonly execute: GitCoreShape['execute']
  readonly fileSystem: FileSystem.FileSystem
  readonly path: Path.Path
  readonly worktreesDir: string
}

export interface GitCoreInternalDeps extends GitCoreCommandDeps {
  readonly branchExists: (cwd: string, branch: string) => Effect.Effect<boolean, GitCommandError>
  readonly resolveAvailableBranchName: (
    cwd: string,
    desiredBranch: string
  ) => Effect.Effect<string, GitCommandError>
  readonly resolveCurrentUpstream: (
    cwd: string
  ) => Effect.Effect<
    { upstreamRef: string; remoteName: string; upstreamBranch: string } | null,
    GitCommandError
  >
  readonly fetchUpstreamRef: (
    cwd: string,
    upstream: { upstreamRef: string; remoteName: string; upstreamBranch: string }
  ) => Effect.Effect<void, GitCommandError>
  readonly refreshStatusUpstreamIfStale: (cwd: string) => Effect.Effect<void, GitCommandError>
  readonly refreshCheckedOutBranchUpstream: (cwd: string) => Effect.Effect<void, GitCommandError>
  readonly resolveDefaultBranchName: (
    cwd: string,
    remoteName: string
  ) => Effect.Effect<string | null, GitCommandError>
  readonly remoteBranchExists: (
    cwd: string,
    remoteName: string,
    branch: string
  ) => Effect.Effect<boolean, GitCommandError>
  readonly originRemoteExists: (cwd: string) => Effect.Effect<boolean, GitCommandError>
  readonly listRemoteNames: (cwd: string) => Effect.Effect<ReadonlyArray<string>, GitCommandError>
  readonly resolvePrimaryRemoteName: (cwd: string) => Effect.Effect<string, GitCommandError>
  readonly resolvePushRemoteName: (
    cwd: string,
    branch: string
  ) => Effect.Effect<string | null, GitCommandError>
  readonly resolveBaseBranchForNoUpstream: (
    cwd: string,
    branch: string
  ) => Effect.Effect<string | null, GitCommandError>
  readonly computeAheadCountAgainstBase: (
    cwd: string,
    branch: string
  ) => Effect.Effect<number, GitCommandError>
  readonly readBranchRecency: (
    cwd: string
  ) => Effect.Effect<ReadonlyMap<string, number>, GitCommandError>
  readonly statusDetails: GitCoreShape['statusDetails']
}

export type GitCoreFullDeps = GitCoreInternalDeps
