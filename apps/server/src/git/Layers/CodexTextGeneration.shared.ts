import { Effect, FileSystem, Stream } from 'effect'

import { TextGenerationError } from '@orxa-code/contracts'

import {
  readGenerationStreamAsString,
  type TextGenerationOperation,
} from './TextGeneration.shared.ts'

export type CodexOperation = TextGenerationOperation

export type MaterializedImageAttachments = {
  readonly imagePaths: ReadonlyArray<string>
}

export const readCodexStreamAsString = <E>(
  operation: CodexOperation,
  stream: Stream.Stream<Uint8Array, E>
): Effect.Effect<string, TextGenerationError> =>
  readGenerationStreamAsString('codex', operation, stream)

export const safeUnlink = (
  fileSystem: FileSystem.FileSystem,
  filePath: string
): Effect.Effect<void, never> => fileSystem.remove(filePath).pipe(Effect.catch(() => Effect.void))

export const createCodexCleanup = ({
  cleanupPaths,
  fileSystem,
  outputPath,
  schemaPath,
}: {
  cleanupPaths: ReadonlyArray<string>
  fileSystem: FileSystem.FileSystem
  outputPath: string
  schemaPath: string
}) =>
  Effect.all(
    [schemaPath, outputPath, ...cleanupPaths].map(filePath => safeUnlink(fileSystem, filePath)),
    {
      concurrency: 'unbounded',
    }
  ).pipe(Effect.asVoid)
