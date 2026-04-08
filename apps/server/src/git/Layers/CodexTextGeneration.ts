import { randomUUID } from 'node:crypto'

import { Effect, FileSystem, Layer, Option, Path, Schema, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'

import { CodexModelSelection } from '@orxa-code/contracts'
import { sanitizeBranchFragment } from '@orxa-code/shared/git'

import { resolveAttachmentPath } from '../../attachmentStore.ts'
import { ServerConfig } from '../../config.ts'
import { TextGenerationError } from '@orxa-code/contracts'
import {
  type BranchNameGenerationInput,
  type ThreadTitleGenerationResult,
  type TextGenerationShape,
  TextGeneration,
} from '../Services/TextGeneration.ts'
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
import { finalizeGeneratedCommitMessage } from './TextGeneration.shared.ts'
import { getCodexModelCapabilities } from '../../provider/Layers/CodexProvider.ts'
import { ServerSettingsService } from '../../serverSettings.ts'
import { normalizeCodexModelOptionsWithCapabilities } from '@orxa-code/shared/model'
import {
  type CodexOperation,
  createCodexCleanup,
  type MaterializedImageAttachments,
  readCodexStreamAsString,
} from './CodexTextGeneration.shared.ts'

const CODEX_GIT_TEXT_GENERATION_REASONING_EFFORT = 'low'
const CODEX_TIMEOUT_MS = 180_000

const writeCodexTempFile = ({
  content,
  fileSystem,
  operation,
  prefix,
}: {
  content: string
  fileSystem: FileSystem.FileSystem
  operation: CodexOperation
  prefix: string
}) =>
  fileSystem
    .makeTempFileScoped({
      prefix: `orxa-${prefix}-${process.pid}-${randomUUID()}.tmp`,
    })
    .pipe(
      Effect.tap(filePath => fileSystem.writeFileString(filePath, content)),
      Effect.mapError(
        cause =>
          new TextGenerationError({
            operation,
            detail: 'Failed to write temp file',
            cause,
          })
      )
    )

const materializeCodexImageAttachments = ({
  attachments,
  attachmentsDir,
  fileSystem,
  pathService,
}: {
  attachments: BranchNameGenerationInput['attachments']
  attachmentsDir: string
  fileSystem: FileSystem.FileSystem
  pathService: Path.Path
}): Effect.Effect<MaterializedImageAttachments> =>
  Effect.gen(function* () {
    if (!attachments || attachments.length === 0) {
      return { imagePaths: [] }
    }

    const imagePaths: string[] = []
    for (const attachment of attachments) {
      if (attachment.type !== 'image') {
        continue
      }

      const resolvedPath = resolveAttachmentPath({
        attachmentsDir,
        attachment,
      })
      if (!resolvedPath || !pathService.isAbsolute(resolvedPath)) {
        continue
      }
      const fileInfo = yield* fileSystem
        .stat(resolvedPath)
        .pipe(Effect.catch(() => Effect.succeed(null)))
      if (!fileInfo || fileInfo.type !== 'File') {
        continue
      }
      imagePaths.push(resolvedPath)
    }

    return { imagePaths }
  })

const loadCodexSettings = (serverSettingsService: ServerSettingsService['Service']) =>
  Effect.map(serverSettingsService.getSettings, settings => settings.providers.codex).pipe(
    Effect.catch(() => Effect.undefined)
  )

const buildCodexCommand = ({
  codexSettings,
  cwd,
  imagePaths,
  modelSelection,
  outputPath,
  prompt,
  schemaPath,
}: {
  codexSettings:
    | { readonly binaryPath?: string | undefined; readonly homePath?: string | undefined }
    | undefined
  cwd: string
  imagePaths: ReadonlyArray<string>
  modelSelection: CodexModelSelection
  outputPath: string
  prompt: string
  schemaPath: string
}) => {
  const normalizedOptions = normalizeCodexModelOptionsWithCapabilities(
    getCodexModelCapabilities(modelSelection.model),
    modelSelection.options
  )
  const reasoningEffort =
    modelSelection.options?.reasoningEffort ?? CODEX_GIT_TEXT_GENERATION_REASONING_EFFORT

  return ChildProcess.make(
    codexSettings?.binaryPath || 'codex',
    [
      'exec',
      '--ephemeral',
      '-s',
      'read-only',
      '--model',
      modelSelection.model,
      '--config',
      `model_reasoning_effort="${reasoningEffort}"`,
      ...(normalizedOptions?.fastMode ? ['--config', `service_tier="fast"`] : []),
      '--output-schema',
      schemaPath,
      '--output-last-message',
      outputPath,
      ...imagePaths.flatMap(imagePath => ['--image', imagePath]),
      '-',
    ],
    {
      env: {
        ...process.env,
        ...(codexSettings?.homePath ? { CODEX_HOME: codexSettings.homePath } : {}),
      },
      cwd,
      shell: process.platform === 'win32',
      stdin: {
        stream: Stream.encodeText(Stream.make(prompt)),
      },
    }
  )
}

const runCodexCommandWithTimeout = ({
  command,
  commandSpawner,
  operation,
}: {
  command: ReturnType<typeof ChildProcess.make>
  commandSpawner: ChildProcessSpawner.ChildProcessSpawner['Service']
  operation: CodexOperation
}) =>
  runCodexCommand({
    command,
    commandSpawner,
    operation,
  }).pipe(
    Effect.timeoutOption(CODEX_TIMEOUT_MS),
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(
            new TextGenerationError({ operation, detail: 'Codex CLI request timed out.' })
          ),
        onSome: () => Effect.void,
      })
    )
  )

const runCodexCommand = ({
  command,
  commandSpawner,
  operation,
}: {
  command: ReturnType<typeof ChildProcess.make>
  commandSpawner: ChildProcessSpawner.ChildProcessSpawner['Service']
  operation: CodexOperation
}) =>
  Effect.gen(function* () {
    const child = yield* commandSpawner
      .spawn(command)
      .pipe(
        Effect.mapError(cause =>
          normalizeCliError('codex', operation, cause, 'Failed to spawn Codex CLI process')
        )
      )

    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        readCodexStreamAsString(operation, child.stdout),
        readCodexStreamAsString(operation, child.stderr),
        child.exitCode.pipe(
          Effect.mapError(cause =>
            normalizeCliError('codex', operation, cause, 'Failed to read Codex CLI exit code')
          )
        ),
      ],
      { concurrency: 'unbounded' }
    )

    if (exitCode !== 0) {
      const stderrDetail = stderr.trim()
      const stdoutDetail = stdout.trim()
      const detail = stderrDetail.length > 0 ? stderrDetail : stdoutDetail
      return yield* new TextGenerationError({
        operation,
        detail:
          detail.length > 0
            ? `Codex CLI command failed: ${detail}`
            : `Codex CLI command failed with code ${exitCode}.`,
      })
    }
  }).pipe(Effect.scoped)

const readCodexStructuredOutput = <S extends Schema.Top>({
  fileSystem,
  operation,
  outputPath,
  outputSchemaJson,
}: {
  fileSystem: FileSystem.FileSystem
  operation: CodexOperation
  outputPath: string
  outputSchemaJson: S
}) =>
  fileSystem.readFileString(outputPath).pipe(
    Effect.mapError(
      cause =>
        new TextGenerationError({
          operation,
          detail: 'Failed to read Codex output file.',
          cause,
        })
    ),
    Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(outputSchemaJson))),
    Effect.catchTag('SchemaError', cause =>
      Effect.fail(
        new TextGenerationError({
          operation,
          detail: 'Codex returned invalid structured output.',
          cause,
        })
      )
    )
  )

const createRunCodexJson = ({
  commandSpawner,
  fileSystem,
  serverSettingsService,
}: {
  commandSpawner: ChildProcessSpawner.ChildProcessSpawner['Service']
  fileSystem: FileSystem.FileSystem
  serverSettingsService: ServerSettingsService['Service']
}) =>
  Effect.fn('runCodexJson')(function* <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchemaJson,
    imagePaths = [],
    cleanupPaths = [],
    modelSelection,
  }: {
    operation: CodexOperation
    cwd: string
    prompt: string
    outputSchemaJson: S
    imagePaths?: ReadonlyArray<string>
    cleanupPaths?: ReadonlyArray<string>
    modelSelection: CodexModelSelection
  }): Effect.fn.Return<S['Type'], TextGenerationError, S['DecodingServices']> {
    const schemaPath = yield* writeCodexTempFile({
      content: JSON.stringify(toJsonSchemaObject(outputSchemaJson)),
      fileSystem,
      operation,
      prefix: 'codex-schema',
    })
    const outputPath = yield* writeCodexTempFile({
      content: '',
      fileSystem,
      operation,
      prefix: 'codex-output',
    })
    const codexSettings = yield* loadCodexSettings(serverSettingsService)
    const cleanup = createCodexCleanup({
      cleanupPaths,
      fileSystem,
      outputPath,
      schemaPath,
    })
    const command = buildCodexCommand({
      codexSettings,
      cwd,
      imagePaths,
      modelSelection,
      outputPath,
      prompt,
      schemaPath,
    })

    yield* runCodexCommandWithTimeout({
      command,
      commandSpawner,
      operation,
    })

    return yield* readCodexStructuredOutput({
      fileSystem,
      operation,
      outputPath,
      outputSchemaJson,
    }).pipe(Effect.ensuring(cleanup))
  })

const makeGenerateCommitMessage = (
  runCodexJson: ReturnType<typeof createRunCodexJson>
): TextGenerationShape['generateCommitMessage'] =>
  Effect.fn('CodexTextGeneration.generateCommitMessage')(function* (input) {
    const { prompt, outputSchema } = buildCommitMessagePrompt({
      branch: input.branch,
      stagedSummary: input.stagedSummary,
      stagedPatch: input.stagedPatch,
      includeBranch: input.includeBranch === true,
    })

    if (input.modelSelection.provider !== 'codex') {
      return yield* new TextGenerationError({
        operation: 'generateCommitMessage',
        detail: 'Invalid model selection.',
      })
    }

    const generated = yield* runCodexJson({
      operation: 'generateCommitMessage',
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    })

    return finalizeGeneratedCommitMessage(generated)
  })

const makeGeneratePrContent = (
  runCodexJson: ReturnType<typeof createRunCodexJson>
): TextGenerationShape['generatePrContent'] =>
  Effect.fn('CodexTextGeneration.generatePrContent')(function* (input) {
    const { prompt, outputSchema } = buildPrContentPrompt({
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      commitSummary: input.commitSummary,
      diffSummary: input.diffSummary,
      diffPatch: input.diffPatch,
    })

    if (input.modelSelection.provider !== 'codex') {
      return yield* new TextGenerationError({
        operation: 'generatePrContent',
        detail: 'Invalid model selection.',
      })
    }

    const generated = yield* runCodexJson({
      operation: 'generatePrContent',
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    })

    return {
      title: sanitizePrTitle(generated.title),
      body: generated.body.trim(),
    }
  })

const makeGenerateBranchName = ({
  attachmentsDir,
  fileSystem,
  pathService,
  runCodexJson,
}: {
  attachmentsDir: string
  fileSystem: FileSystem.FileSystem
  pathService: Path.Path
  runCodexJson: ReturnType<typeof createRunCodexJson>
}): TextGenerationShape['generateBranchName'] =>
  Effect.fn('CodexTextGeneration.generateBranchName')(function* (input) {
    const { imagePaths } = yield* materializeCodexImageAttachments({
      attachments: input.attachments,
      attachmentsDir,
      fileSystem,
      pathService,
    })
    const { prompt, outputSchema } = buildBranchNamePrompt({
      message: input.message,
      attachments: input.attachments,
    })

    if (input.modelSelection.provider !== 'codex') {
      return yield* new TextGenerationError({
        operation: 'generateBranchName',
        detail: 'Invalid model selection.',
      })
    }

    const generated = yield* runCodexJson({
      operation: 'generateBranchName',
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      imagePaths,
      modelSelection: input.modelSelection,
    })

    return {
      branch: sanitizeBranchFragment(generated.branch),
    }
  })

const makeGenerateThreadTitle = ({
  attachmentsDir,
  fileSystem,
  pathService,
  runCodexJson,
}: {
  attachmentsDir: string
  fileSystem: FileSystem.FileSystem
  pathService: Path.Path
  runCodexJson: ReturnType<typeof createRunCodexJson>
}): TextGenerationShape['generateThreadTitle'] =>
  Effect.fn('CodexTextGeneration.generateThreadTitle')(function* (input) {
    const { imagePaths } = yield* materializeCodexImageAttachments({
      attachments: input.attachments,
      attachmentsDir,
      fileSystem,
      pathService,
    })
    const { prompt, outputSchema } = buildThreadTitlePrompt({
      message: input.message,
      attachments: input.attachments,
    })

    if (input.modelSelection.provider !== 'codex') {
      return yield* new TextGenerationError({
        operation: 'generateThreadTitle',
        detail: 'Invalid model selection.',
      })
    }

    const generated = yield* runCodexJson({
      operation: 'generateThreadTitle',
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      imagePaths,
      modelSelection: input.modelSelection,
    })

    return {
      title: sanitizeThreadTitle(generated.title),
    } satisfies ThreadTitleGenerationResult
  })

const makeCodexTextGeneration = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const serverConfig = yield* Effect.service(ServerConfig)
  const serverSettingsService = yield* Effect.service(ServerSettingsService)
  const runCodexJson = createRunCodexJson({
    commandSpawner,
    fileSystem,
    serverSettingsService,
  })

  return {
    generateCommitMessage: makeGenerateCommitMessage(runCodexJson),
    generatePrContent: makeGeneratePrContent(runCodexJson),
    generateBranchName: makeGenerateBranchName({
      attachmentsDir: serverConfig.attachmentsDir,
      fileSystem,
      pathService,
      runCodexJson,
    }),
    generateThreadTitle: makeGenerateThreadTitle({
      attachmentsDir: serverConfig.attachmentsDir,
      fileSystem,
      pathService,
      runCodexJson,
    }),
  } satisfies TextGenerationShape
})

export const CodexTextGenerationLive = Layer.effect(TextGeneration, makeCodexTextGeneration)
