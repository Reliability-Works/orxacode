/**
 * ClaudeTextGeneration – Text generation layer using the Claude CLI.
 *
 * Implements the same TextGenerationShape contract as CodexTextGeneration but
 * delegates to the `claude` CLI (`claude -p`) with structured JSON output
 * instead of the `codex exec` CLI.
 *
 * @module ClaudeTextGeneration
 */
import { Effect, Layer, Option, Schema, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'

import { ClaudeModelSelection, type ModelSelection } from '@orxa-code/contracts'
import { resolveApiModelId } from '@orxa-code/shared/model'
import { sanitizeBranchFragment } from '@orxa-code/shared/git'

import { TextGenerationError } from '@orxa-code/contracts'
import { type TextGenerationShape, TextGeneration } from '../Services/TextGeneration.ts'
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from '../Prompts.ts'
import {
  normalizeCliError,
  sanitizePrTitle,
  sanitizeThreadTitle,
  toJsonSchemaObject,
} from '../Utils.ts'
import { normalizeClaudeModelOptionsWithCapabilities } from '@orxa-code/shared/model'
import { ServerSettingsService } from '../../serverSettings.ts'
import { getClaudeModelCapabilities } from '../../provider/Layers/ClaudeProvider.ts'
import {
  finalizeGeneratedCommitMessage,
  readGenerationStreamAsString,
} from './TextGeneration.shared.ts'

const CLAUDE_TIMEOUT_MS = 180_000

/**
 * Schema for the wrapper JSON returned by `claude -p --output-format json`.
 * We only care about `structured_output`.
 */
const ClaudeOutputEnvelope = Schema.Struct({
  structured_output: Schema.Unknown,
})

type ClaudeOperation =
  | 'generateCommitMessage'
  | 'generatePrContent'
  | 'generateBranchName'
  | 'generateThreadTitle'

type ClaudeProcessHandle = ChildProcessSpawner.ChildProcessHandle

const readStreamAsString = <E>(
  operation: ClaudeOperation,
  stream: Stream.Stream<Uint8Array, E>
): Effect.Effect<string, TextGenerationError> =>
  readGenerationStreamAsString('claude', operation, stream)

const loadClaudeAgentSettings = (serverSettingsService: ServerSettingsService['Service']) =>
  Effect.map(serverSettingsService.getSettings, settings => settings.providers.claudeAgent).pipe(
    Effect.catch(() => Effect.undefined)
  )

const normalizeClaudeCliSettings = (modelSelection: ClaudeModelSelection) => {
  const normalizedOptions = normalizeClaudeModelOptionsWithCapabilities(
    getClaudeModelCapabilities(modelSelection.model),
    modelSelection.options
  )
  return {
    normalizedOptions,
    settings: {
      ...(typeof normalizedOptions?.thinking === 'boolean'
        ? { alwaysThinkingEnabled: normalizedOptions.thinking }
        : {}),
      ...(normalizedOptions?.fastMode ? { fastMode: true } : {}),
    },
  }
}

const makeClaudeCommand = <S extends Schema.Top>({
  claudeSettings,
  cwd,
  modelSelection,
  normalizedOptions,
  outputSchemaJson,
  prompt,
  settings,
}: {
  claudeSettings: { readonly binaryPath?: string | undefined } | undefined
  cwd: string
  modelSelection: ClaudeModelSelection
  normalizedOptions: ReturnType<typeof normalizeClaudeModelOptionsWithCapabilities>
  outputSchemaJson: S
  prompt: string
  settings: Record<string, boolean>
}) =>
  ChildProcess.make(
    claudeSettings?.binaryPath || 'claude',
    [
      '-p',
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(toJsonSchemaObject(outputSchemaJson)),
      '--model',
      resolveApiModelId(modelSelection),
      ...(normalizedOptions?.effort ? ['--effort', normalizedOptions.effort] : []),
      ...(Object.keys(settings).length > 0 ? ['--settings', JSON.stringify(settings)] : []),
      '--dangerously-skip-permissions',
    ],
    {
      cwd,
      shell: process.platform === 'win32',
      stdin: {
        stream: Stream.encodeText(Stream.make(prompt)),
      },
    }
  )

const spawnClaudeCommand = ({
  command,
  commandSpawner,
  operation,
}: {
  command: ReturnType<typeof ChildProcess.make>
  commandSpawner: ChildProcessSpawner.ChildProcessSpawner['Service']
  operation: ClaudeOperation
}) =>
  commandSpawner
    .spawn(command)
    .pipe(
      Effect.mapError(cause =>
        normalizeCliError('claude', operation, cause, 'Failed to spawn Claude CLI process')
      )
    )

const collectClaudeCommandOutput = ({
  child,
  operation,
}: {
  child: ClaudeProcessHandle
  operation: ClaudeOperation
}) =>
  Effect.all(
    [
      readStreamAsString(operation, child.stdout),
      readStreamAsString(operation, child.stderr),
      child.exitCode.pipe(
        Effect.mapError(cause =>
          normalizeCliError('claude', operation, cause, 'Failed to read Claude CLI exit code')
        )
      ),
    ],
    { concurrency: 'unbounded' }
  )

const validateClaudeExitCode = ({
  exitCode,
  operation,
  stderr,
  stdout,
}: {
  exitCode: number
  operation: ClaudeOperation
  stderr: string
  stdout: string
}) => {
  if (exitCode === 0) {
    return Effect.succeed(stdout)
  }

  const stderrDetail = stderr.trim()
  const stdoutDetail = stdout.trim()
  const detail = stderrDetail.length > 0 ? stderrDetail : stdoutDetail
  return Effect.fail(
    new TextGenerationError({
      operation,
      detail:
        detail.length > 0
          ? `Claude CLI command failed: ${detail}`
          : `Claude CLI command failed with code ${exitCode}.`,
    })
  )
}

const executeClaudeCommand = ({
  command,
  commandSpawner,
  operation,
}: {
  command: ReturnType<typeof ChildProcess.make>
  commandSpawner: ChildProcessSpawner.ChildProcessSpawner['Service']
  operation: ClaudeOperation
}) =>
  Effect.gen(function* () {
    const child = yield* spawnClaudeCommand({ command, commandSpawner, operation })
    const [stdout, stderr, exitCode] = yield* collectClaudeCommandOutput({ child, operation })
    return yield* validateClaudeExitCode({ exitCode, operation, stderr, stdout })
  }).pipe(Effect.scoped)

const decodeClaudeEnvelope = (operation: ClaudeOperation, rawStdout: string) =>
  Schema.decodeEffect(Schema.fromJsonString(ClaudeOutputEnvelope))(rawStdout).pipe(
    Effect.catchTag('SchemaError', cause =>
      Effect.fail(
        new TextGenerationError({
          operation,
          detail: 'Claude CLI returned unexpected output format.',
          cause,
        })
      )
    )
  )

const decodeClaudeStructuredOutput = <S extends Schema.Top>({
  envelope,
  operation,
  outputSchemaJson,
}: {
  envelope: typeof ClaudeOutputEnvelope.Type
  operation: ClaudeOperation
  outputSchemaJson: S
}) =>
  Schema.decodeEffect(outputSchemaJson)(envelope.structured_output).pipe(
    Effect.catchTag('SchemaError', cause =>
      Effect.fail(
        new TextGenerationError({
          operation,
          detail: 'Claude returned invalid structured output.',
          cause,
        })
      )
    )
  )

const requireClaudeModelSelection = (
  operation: ClaudeOperation,
  modelSelection: ModelSelection
): Effect.Effect<ClaudeModelSelection, TextGenerationError> =>
  modelSelection.provider === 'claudeAgent'
    ? Effect.succeed(modelSelection)
    : Effect.fail(new TextGenerationError({ operation, detail: 'Invalid model selection.' }))

const makeRunClaudeJson = ({
  commandSpawner,
  serverSettingsService,
}: {
  commandSpawner: ChildProcessSpawner.ChildProcessSpawner['Service']
  serverSettingsService: ServerSettingsService['Service']
}) =>
  Effect.fn('runClaudeJson')(function* <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchemaJson,
    modelSelection,
  }: {
    operation: ClaudeOperation
    cwd: string
    prompt: string
    outputSchemaJson: S
    modelSelection: ClaudeModelSelection
  }): Effect.fn.Return<S['Type'], TextGenerationError, S['DecodingServices']> {
    const claudeSettings = yield* loadClaudeAgentSettings(serverSettingsService)
    const { normalizedOptions, settings } = normalizeClaudeCliSettings(modelSelection)
    const command = makeClaudeCommand({
      claudeSettings,
      cwd,
      modelSelection,
      normalizedOptions,
      outputSchemaJson,
      prompt,
      settings,
    })

    const rawStdout = yield* executeClaudeCommand({
      command,
      commandSpawner,
      operation,
    }).pipe(
      Effect.timeoutOption(CLAUDE_TIMEOUT_MS),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new TextGenerationError({ operation, detail: 'Claude CLI request timed out.' })
            ),
          onSome: value => Effect.succeed(value),
        })
      )
    )

    const envelope = yield* decodeClaudeEnvelope(operation, rawStdout)
    return yield* decodeClaudeStructuredOutput({
      envelope,
      operation,
      outputSchemaJson,
    })
  })

const makeGenerateCommitMessage = (
  runClaudeJson: ReturnType<typeof makeRunClaudeJson>
): TextGenerationShape['generateCommitMessage'] =>
  Effect.fn('ClaudeTextGeneration.generateCommitMessage')(function* (input) {
    const modelSelection = yield* requireClaudeModelSelection(
      'generateCommitMessage',
      input.modelSelection
    )
    const { prompt, outputSchema } = buildCommitMessagePrompt({
      branch: input.branch,
      stagedSummary: input.stagedSummary,
      stagedPatch: input.stagedPatch,
      includeBranch: input.includeBranch === true,
    })
    const generated = yield* runClaudeJson({
      operation: 'generateCommitMessage',
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection,
    })

    return finalizeGeneratedCommitMessage(generated)
  })

const makeGeneratePrContent = (
  runClaudeJson: ReturnType<typeof makeRunClaudeJson>
): TextGenerationShape['generatePrContent'] =>
  Effect.fn('ClaudeTextGeneration.generatePrContent')(function* (input) {
    const modelSelection = yield* requireClaudeModelSelection(
      'generatePrContent',
      input.modelSelection
    )
    const { prompt, outputSchema } = buildPrContentPrompt({
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      commitSummary: input.commitSummary,
      diffSummary: input.diffSummary,
      diffPatch: input.diffPatch,
    })
    const generated = yield* runClaudeJson({
      operation: 'generatePrContent',
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection,
    })

    return {
      title: sanitizePrTitle(generated.title),
      body: generated.body.trim(),
    }
  })

const makeGenerateBranchName = (
  runClaudeJson: ReturnType<typeof makeRunClaudeJson>
): TextGenerationShape['generateBranchName'] =>
  Effect.fn('ClaudeTextGeneration.generateBranchName')(function* (input) {
    const modelSelection = yield* requireClaudeModelSelection(
      'generateBranchName',
      input.modelSelection
    )
    const { prompt, outputSchema } = buildBranchNamePrompt({
      message: input.message,
      attachments: input.attachments,
    })
    const generated = yield* runClaudeJson({
      operation: 'generateBranchName',
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection,
    })

    return {
      branch: sanitizeBranchFragment(generated.branch),
    }
  })

const makeGenerateThreadTitle = (
  runClaudeJson: ReturnType<typeof makeRunClaudeJson>
): TextGenerationShape['generateThreadTitle'] =>
  Effect.fn('ClaudeTextGeneration.generateThreadTitle')(function* (input) {
    const modelSelection = yield* requireClaudeModelSelection(
      'generateThreadTitle',
      input.modelSelection
    )
    const { prompt, outputSchema } = buildThreadTitlePrompt({
      message: input.message,
      attachments: input.attachments,
    })
    const generated = yield* runClaudeJson({
      operation: 'generateThreadTitle',
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection,
    })

    return {
      title: sanitizeThreadTitle(generated.title),
    }
  })

const makeClaudeTextGeneration = Effect.gen(function* () {
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const serverSettingsService = yield* Effect.service(ServerSettingsService)
  const runClaudeJson = makeRunClaudeJson({ commandSpawner, serverSettingsService })

  return {
    generateCommitMessage: makeGenerateCommitMessage(runClaudeJson),
    generatePrContent: makeGeneratePrContent(runClaudeJson),
    generateBranchName: makeGenerateBranchName(runClaudeJson),
    generateThreadTitle: makeGenerateThreadTitle(runClaudeJson),
  } satisfies TextGenerationShape
})

export const ClaudeTextGenerationLive = Layer.effect(TextGeneration, makeClaudeTextGeneration)
