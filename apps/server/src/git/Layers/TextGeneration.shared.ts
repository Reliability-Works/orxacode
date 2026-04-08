import { Effect, Stream } from 'effect'

import { TextGenerationError } from '@orxa-code/contracts'
import { sanitizeFeatureBranchName } from '@orxa-code/shared/git'

import { normalizeCliError, sanitizeCommitSubject } from '../Utils.ts'

export type TextGenerationOperation =
  | 'generateCommitMessage'
  | 'generatePrContent'
  | 'generateBranchName'
  | 'generateThreadTitle'

export type GeneratedCommitMessage = {
  readonly subject: string
  readonly body: string
  readonly branch?: string
}

export const finalizeGeneratedCommitMessage = (generated: {
  subject: string
  body: string
  branch?: unknown
}): GeneratedCommitMessage => ({
  subject: sanitizeCommitSubject(generated.subject),
  body: generated.body.trim(),
  ...('branch' in generated && typeof generated.branch === 'string'
    ? { branch: sanitizeFeatureBranchName(generated.branch) }
    : {}),
})

export const readGenerationStreamAsString = <E>(
  cli: 'claude' | 'codex',
  operation: TextGenerationOperation,
  stream: Stream.Stream<Uint8Array, E>
): Effect.Effect<string, TextGenerationError> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => '',
      (acc, chunk) => acc + chunk
    ),
    Effect.mapError(cause =>
      normalizeCliError(cli, operation, cause, 'Failed to collect process output')
    )
  )
