import { Effect, FileSystem, Layer, Path } from 'effect'

import {
  WorkspaceFileSystem,
  WorkspaceFileSystemError,
  type WorkspaceFileSystemShape,
} from '../Services/WorkspaceFileSystem.ts'
import { WorkspaceEntries } from '../Services/WorkspaceEntries.ts'
import type { WorkspaceEntriesShape } from '../Services/WorkspaceEntries.ts'
import { WorkspacePaths } from '../Services/WorkspacePaths.ts'
import type { WorkspacePathsShape } from '../Services/WorkspacePaths.ts'

const WORKSPACE_EDITOR_MAX_BYTES = 1024 * 1024

function toWorkspaceFileSystemError(input: {
  cwd: string
  relativePath: string
  operation: string
  detail: string
  cause?: unknown
}) {
  return new WorkspaceFileSystemError({
    cwd: input.cwd,
    relativePath: input.relativePath,
    operation: input.operation,
    detail: input.detail,
    ...(input.cause ? { cause: input.cause } : {}),
  })
}

function makeReadFile(deps: {
  fileSystem: FileSystem.FileSystem
  workspacePaths: WorkspacePathsShape
}): WorkspaceFileSystemShape['readFile'] {
  return Effect.fn('WorkspaceFileSystem.readFile')(function* (input) {
    const target = yield* deps.workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    })

    const stat = yield* deps.fileSystem.stat(target.absolutePath).pipe(
      Effect.mapError(cause =>
        toWorkspaceFileSystemError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: 'workspaceFileSystem.stat',
          detail: cause.message,
          cause,
        })
      )
    )

    if (stat.type !== 'File') {
      return yield* toWorkspaceFileSystemError({
        cwd: input.cwd,
        relativePath: input.relativePath,
        operation: 'workspaceFileSystem.readFile',
        detail: 'Only files can be opened in the editor.',
      })
    }

    if (stat.size > WORKSPACE_EDITOR_MAX_BYTES) {
      return yield* toWorkspaceFileSystemError({
        cwd: input.cwd,
        relativePath: input.relativePath,
        operation: 'workspaceFileSystem.readFile',
        detail: 'File is too large to open in the sidebar editor.',
      })
    }

    const contents = yield* deps.fileSystem.readFileString(target.absolutePath).pipe(
      Effect.mapError(cause =>
        toWorkspaceFileSystemError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: 'workspaceFileSystem.readFile',
          detail: cause.message,
          cause,
        })
      )
    )

    return {
      relativePath: target.relativePath,
      contents,
    }
  })
}

function makeWriteFile(deps: {
  fileSystem: FileSystem.FileSystem
  path: Path.Path
  workspacePaths: WorkspacePathsShape
  workspaceEntries: WorkspaceEntriesShape
}): WorkspaceFileSystemShape['writeFile'] {
  return Effect.fn('WorkspaceFileSystem.writeFile')(function* (input) {
    const target = yield* deps.workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    })

    yield* deps.fileSystem
      .makeDirectory(deps.path.dirname(target.absolutePath), { recursive: true })
      .pipe(
        Effect.mapError(cause =>
          toWorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: 'workspaceFileSystem.makeDirectory',
            detail: cause.message,
            cause,
          })
        )
      )
    yield* deps.fileSystem.writeFileString(target.absolutePath, input.contents).pipe(
      Effect.mapError(cause =>
        toWorkspaceFileSystemError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: 'workspaceFileSystem.writeFile',
          detail: cause.message,
          cause,
        })
      )
    )
    yield* deps.workspaceEntries.invalidate(input.cwd)
    return { relativePath: target.relativePath }
  })
}

export const makeWorkspaceFileSystem = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const workspacePaths = yield* WorkspacePaths
  const workspaceEntries = yield* WorkspaceEntries

  const readFile = makeReadFile({ fileSystem, workspacePaths })
  const writeFile = makeWriteFile({ fileSystem, path, workspacePaths, workspaceEntries })
  return { readFile, writeFile } satisfies WorkspaceFileSystemShape
})

export const WorkspaceFileSystemLive = Layer.effect(WorkspaceFileSystem, makeWorkspaceFileSystem)
