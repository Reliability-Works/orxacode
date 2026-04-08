import { Effect, FileSystem, Layer, Path } from 'effect'

import { GitCore, type GitCoreShape } from '../Services/GitCore.ts'
import { ServerConfig } from '../../config.ts'

import { createExecuteGit } from './GitCore.exec.ts'
import type { GitCoreCommandDeps } from './GitCore.deps.ts'
import { makeGitCoreInternals } from './GitCore.internals.ts'
import { makeBranchMethods } from './GitCore.methods.branches.ts'
import { makePushMethods } from './GitCore.methods.push.ts'
import { makeShellMethods } from './GitCore.methods.shell.ts'
import { makeStatusMethods } from './GitCore.methods.status.ts'
import { makeWorktreeMethods } from './GitCore.methods.worktree.ts'
import { buildGitCommandHelpers } from './GitCore.wiring.ts'

export const makeGitCore = Effect.fn('makeGitCore')(function* (options?: {
  executeOverride?: GitCoreShape['execute']
}) {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const { worktreesDir } = yield* ServerConfig

  const execute: GitCoreShape['execute'] = options?.executeOverride ?? (yield* createExecuteGit())

  const { executeGit, runGit, runGitStdout, runGitStdoutWithOptions } =
    buildGitCommandHelpers(execute)

  const commandDeps: GitCoreCommandDeps = {
    execute,
    executeGit,
    runGit,
    runGitStdout,
    runGitStdoutWithOptions,
    fileSystem,
    path,
    worktreesDir,
  }

  const internals = yield* makeGitCoreInternals(commandDeps)

  const shell = makeShellMethods(internals)
  const statusGroup = makeStatusMethods(internals)
  const pushGroup = makePushMethods(internals)
  const branchGroup = makeBranchMethods(internals)
  const worktreeGroup = makeWorktreeMethods(internals)

  return {
    execute,
    status: statusGroup.status,
    statusDetails: statusGroup.statusDetails,
    prepareCommitContext: statusGroup.prepareCommitContext,
    commit: statusGroup.commit,
    pushCurrentBranch: pushGroup.pushCurrentBranch,
    pullCurrentBranch: pushGroup.pullCurrentBranch,
    readRangeContext: pushGroup.readRangeContext,
    readConfigValue: shell.readConfigValue,
    isInsideWorkTree: shell.isInsideWorkTree,
    listWorkspaceFiles: shell.listWorkspaceFiles,
    filterIgnoredPaths: shell.filterIgnoredPaths,
    listBranches: branchGroup.listBranches,
    createWorktree: worktreeGroup.createWorktree,
    fetchPullRequestBranch: worktreeGroup.fetchPullRequestBranch,
    ensureRemote: worktreeGroup.ensureRemote,
    fetchRemoteBranch: worktreeGroup.fetchRemoteBranch,
    setBranchUpstream: worktreeGroup.setBranchUpstream,
    removeWorktree: worktreeGroup.removeWorktree,
    renameBranch: branchGroup.renameBranch,
    createBranch: branchGroup.createBranch,
    checkoutBranch: branchGroup.checkoutBranch,
    initRepo: shell.initRepo,
    listLocalBranchNames: shell.listLocalBranchNames,
  } satisfies GitCoreShape
})

export const GitCoreLive = Layer.effect(GitCore, makeGitCore())
