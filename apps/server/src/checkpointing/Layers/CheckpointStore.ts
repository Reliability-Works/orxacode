/**
 * CheckpointStoreLive - Filesystem checkpoint store adapter layer.
 *
 * Implements hidden Git-ref checkpoint capture/restore directly with
 * Effect-native child process execution (`effect/unstable/process`).
 *
 * This layer owns filesystem/Git interactions only; it does not persist
 * checkpoint metadata and does not coordinate provider rollback semantics.
 *
 * @module CheckpointStoreLive
 */
import { randomUUID } from 'node:crypto'

import { Effect, Layer, FileSystem, Path } from 'effect'

import { CheckpointInvariantError } from '../Errors.ts'
import { GitCommandError } from '@orxa-code/contracts'
import { GitCore } from '../../git/Services/GitCore.ts'
import type { GitCoreShape } from '../../git/Services/GitCore.ts'
import { CheckpointStore, type CheckpointStoreShape } from '../Services/CheckpointStore.ts'
import { CheckpointRef } from '@orxa-code/contracts'

interface CheckpointStoreDeps {
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
  readonly git: GitCoreShape
}

function resolveCommitOid(
  git: GitCoreShape,
  operation: string,
  cwd: string,
  revision: string
): Effect.Effect<string | null, GitCommandError> {
  return git
    .execute({
      operation,
      cwd,
      args: ['rev-parse', '--verify', '--quiet', revision],
      allowNonZeroExit: true,
    })
    .pipe(
      Effect.map(result => {
        if (result.code !== 0) {
          return null
        }
        const commit = result.stdout.trim()
        return commit.length > 0 ? commit : null
      })
    )
}

function resolveHeadCommit(
  git: GitCoreShape,
  cwd: string
): Effect.Effect<string | null, GitCommandError> {
  return resolveCommitOid(git, 'CheckpointStore.resolveHeadCommit', cwd, 'HEAD^{commit}')
}

function hasHeadCommit(git: GitCoreShape, cwd: string): Effect.Effect<boolean, GitCommandError> {
  return git
    .execute({
      operation: 'CheckpointStore.hasHeadCommit',
      cwd,
      args: ['rev-parse', '--verify', 'HEAD'],
      allowNonZeroExit: true,
    })
    .pipe(Effect.map(result => result.code === 0))
}

function resolveCheckpointCommit(
  git: GitCoreShape,
  cwd: string,
  checkpointRef: CheckpointRef
): Effect.Effect<string | null, GitCommandError> {
  return resolveCommitOid(
    git,
    'CheckpointStore.resolveCheckpointCommit',
    cwd,
    `${checkpointRef}^{commit}`
  )
}

function makeCheckpointCommitEnv(tempIndexPath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_INDEX_FILE: tempIndexPath,
    GIT_AUTHOR_NAME: 'Orxa Code',
    GIT_AUTHOR_EMAIL: 'orxacode@users.noreply.github.com',
    GIT_COMMITTER_NAME: 'Orxa Code',
    GIT_COMMITTER_EMAIL: 'orxacode@users.noreply.github.com',
  }
}

function requireGitOid(
  operation: string,
  command: string,
  cwd: string,
  oid: string,
  detail: string
): Effect.Effect<string, GitCommandError> {
  if (oid.length === 0) {
    return Effect.fail(
      new GitCommandError({
        operation,
        command,
        cwd,
        detail,
      })
    )
  }
  return Effect.succeed(oid)
}

function captureCheckpointInTempDirectory(
  deps: Pick<CheckpointStoreDeps, 'path' | 'git'>,
  input: Parameters<CheckpointStoreShape['captureCheckpoint']>[0],
  tempDir: string
): Effect.Effect<void, GitCommandError> {
  return Effect.gen(function* () {
    const operation = 'CheckpointStore.captureCheckpoint'
    const tempIndexPath = deps.path.join(tempDir, `index-${randomUUID()}`)
    const commitEnv = makeCheckpointCommitEnv(tempIndexPath)

    const headExists = yield* hasHeadCommit(deps.git, input.cwd)
    if (headExists) {
      yield* deps.git.execute({
        operation,
        cwd: input.cwd,
        args: ['read-tree', 'HEAD'],
        env: commitEnv,
      })
    }

    yield* deps.git.execute({
      operation,
      cwd: input.cwd,
      args: ['add', '-A', '--', '.'],
      env: commitEnv,
    })

    const writeTreeResult = yield* deps.git.execute({
      operation,
      cwd: input.cwd,
      args: ['write-tree'],
      env: commitEnv,
    })
    const treeOid = yield* requireGitOid(
      operation,
      'git write-tree',
      input.cwd,
      writeTreeResult.stdout.trim(),
      'git write-tree returned an empty tree oid.'
    )

    const message = `orxacode checkpoint ref=${input.checkpointRef}`
    const commitTreeResult = yield* deps.git.execute({
      operation,
      cwd: input.cwd,
      args: ['commit-tree', treeOid, '-m', message],
      env: commitEnv,
    })
    const commitOid = yield* requireGitOid(
      operation,
      'git commit-tree',
      input.cwd,
      commitTreeResult.stdout.trim(),
      'git commit-tree returned an empty commit oid.'
    )

    yield* deps.git.execute({
      operation,
      cwd: input.cwd,
      args: ['update-ref', input.checkpointRef, commitOid],
    })
  })
}

function restoreCheckpointCommitOid(
  git: GitCoreShape,
  input: Parameters<CheckpointStoreShape['restoreCheckpoint']>[0]
): Effect.Effect<string | null, GitCommandError> {
  return Effect.gen(function* () {
    let commitOid = yield* resolveCheckpointCommit(git, input.cwd, input.checkpointRef)
    if (!commitOid && input.fallbackToHead === true) {
      commitOid = yield* resolveHeadCommit(git, input.cwd)
    }
    return commitOid
  })
}

function maybeResetAfterRestore(
  git: GitCoreShape,
  cwd: string,
  operation: string
): Effect.Effect<void, GitCommandError> {
  return Effect.gen(function* () {
    const headExists = yield* hasHeadCommit(git, cwd)
    if (!headExists) {
      return
    }
    yield* git.execute({
      operation,
      cwd,
      args: ['reset', '--quiet', '--', '.'],
    })
  })
}

function resolveDiffCommitOids(
  git: GitCoreShape,
  input: Parameters<CheckpointStoreShape['diffCheckpoints']>[0]
): Effect.Effect<{ fromCommitOid: string; toCommitOid: string }, GitCommandError> {
  return Effect.gen(function* () {
    let fromCommitOid = yield* resolveCheckpointCommit(git, input.cwd, input.fromCheckpointRef)
    const toCommitOid = yield* resolveCheckpointCommit(git, input.cwd, input.toCheckpointRef)

    if (!fromCommitOid && input.fallbackFromToHead === true) {
      const headCommit = yield* resolveHeadCommit(git, input.cwd)
      if (headCommit) {
        fromCommitOid = headCommit
      }
    }

    if (!fromCommitOid || !toCommitOid) {
      return yield* new GitCommandError({
        operation: 'CheckpointStore.diffCheckpoints',
        command: 'git diff',
        cwd: input.cwd,
        detail: 'Checkpoint ref is unavailable for diff operation.',
      })
    }

    return { fromCommitOid, toCommitOid }
  })
}

function makeIsGitRepository(git: GitCoreShape): CheckpointStoreShape['isGitRepository'] {
  return cwd =>
    git
      .execute({
        operation: 'CheckpointStore.isGitRepository',
        cwd,
        args: ['rev-parse', '--is-inside-work-tree'],
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map(result => result.code === 0 && result.stdout.trim() === 'true'),
        Effect.catch(() => Effect.succeed(false))
      )
}

function makeCaptureCheckpoint(
  deps: CheckpointStoreDeps
): CheckpointStoreShape['captureCheckpoint'] {
  return Effect.fn('captureCheckpoint')(function* (input) {
    yield* Effect.acquireUseRelease(
      deps.fs.makeTempDirectory({ prefix: 'orxa-fs-checkpoint-' }),
      tempDir => captureCheckpointInTempDirectory(deps, input, tempDir),
      tempDir => deps.fs.remove(tempDir, { recursive: true })
    ).pipe(
      Effect.catchTags({
        PlatformError: error =>
          Effect.fail(
            new CheckpointInvariantError({
              operation: 'CheckpointStore.captureCheckpoint',
              detail: 'Failed to capture checkpoint.',
              cause: error,
            })
          ),
      })
    )
  })
}

function makeHasCheckpointRef(git: GitCoreShape): CheckpointStoreShape['hasCheckpointRef'] {
  return input =>
    resolveCheckpointCommit(git, input.cwd, input.checkpointRef).pipe(
      Effect.map(commit => commit !== null)
    )
}

function makeRestoreCheckpoint(git: GitCoreShape): CheckpointStoreShape['restoreCheckpoint'] {
  return Effect.fn('restoreCheckpoint')(function* (input) {
    const operation = 'CheckpointStore.restoreCheckpoint'
    const commitOid = yield* restoreCheckpointCommitOid(git, input)
    if (!commitOid) {
      return false
    }

    yield* git.execute({
      operation,
      cwd: input.cwd,
      args: ['restore', '--source', commitOid, '--worktree', '--staged', '--', '.'],
    })
    yield* git.execute({
      operation,
      cwd: input.cwd,
      args: ['clean', '-fd', '--', '.'],
    })
    yield* maybeResetAfterRestore(git, input.cwd, operation)

    return true
  })
}

function makeDiffCheckpoints(git: GitCoreShape): CheckpointStoreShape['diffCheckpoints'] {
  return Effect.fn('diffCheckpoints')(function* (input) {
    const { fromCommitOid, toCommitOid } = yield* resolveDiffCommitOids(git, input)
    const result = yield* git.execute({
      operation: 'CheckpointStore.diffCheckpoints',
      cwd: input.cwd,
      args: ['diff', '--patch', '--minimal', '--no-color', fromCommitOid, toCommitOid],
    })

    return result.stdout
  })
}

function makeDeleteCheckpointRefs(git: GitCoreShape): CheckpointStoreShape['deleteCheckpointRefs'] {
  return Effect.fn('deleteCheckpointRefs')(function* (input) {
    const operation = 'CheckpointStore.deleteCheckpointRefs'

    yield* Effect.forEach(
      input.checkpointRefs,
      checkpointRef =>
        git.execute({
          operation,
          cwd: input.cwd,
          args: ['update-ref', '-d', checkpointRef],
          allowNonZeroExit: true,
        }),
      { discard: true }
    )
  })
}

function makeCheckpointStoreShape(deps: CheckpointStoreDeps): CheckpointStoreShape {
  return {
    isGitRepository: makeIsGitRepository(deps.git),
    captureCheckpoint: makeCaptureCheckpoint(deps),
    hasCheckpointRef: makeHasCheckpointRef(deps.git),
    restoreCheckpoint: makeRestoreCheckpoint(deps.git),
    diffCheckpoints: makeDiffCheckpoints(deps.git),
    deleteCheckpointRefs: makeDeleteCheckpointRefs(deps.git),
  } satisfies CheckpointStoreShape
}

const makeCheckpointStore = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const git = yield* GitCore
  const deps = { fs, path, git } satisfies CheckpointStoreDeps

  return makeCheckpointStoreShape(deps)
})

export const CheckpointStoreLive = Layer.effect(CheckpointStore, makeCheckpointStore)
