import { it } from '@effect/vitest'
import { Effect, FileSystem, Path, Result } from 'effect'
import { expect } from 'vitest'

import { ServerConfig } from '../../config.ts'
import { TextGenerationError } from '@orxa-code/contracts'
import { TextGeneration } from '../Services/TextGeneration.ts'
import {
  CodexTextGenerationTestLayer,
  DEFAULT_TEST_MODEL_SELECTION,
  withFakeCodexEnv,
} from './CodexTextGeneration.test.helpers.ts'

function makeSanitizedCommitMessageEffect() {
  return withFakeCodexEnv(
    {
      output: JSON.stringify({
        subject:
          '  Add important change to the system with too much detail and a trailing period.\nsecondary line',
        body: '\n- added migration\n- updated tests\n',
      }),
      stdinMustNotContain: 'branch must be a short semantic git branch fragment',
    },
    Effect.gen(function* () {
      const textGeneration = yield* TextGeneration

      const generated = yield* textGeneration.generateCommitMessage({
        cwd: process.cwd(),
        branch: 'feature/codex-effect',
        stagedSummary: 'M README.md',
        stagedPatch: 'diff --git a/README.md b/README.md',
        modelSelection: DEFAULT_TEST_MODEL_SELECTION,
      })

      expect(generated.subject.length).toBeLessThanOrEqual(72)
      expect(generated.subject.endsWith('.')).toBe(false)
      expect(generated.body).toBe('- added migration\n- updated tests')
      expect(generated.branch).toBeUndefined()
    })
  )
}

function makeFastModeCommitMessageEffect() {
  return withFakeCodexEnv(
    {
      output: JSON.stringify({
        subject: 'Add important change',
        body: '',
      }),
      requireFastServiceTier: true,
      requireReasoningEffort: 'xhigh',
      stdinMustNotContain: 'branch must be a short semantic git branch fragment',
    },
    Effect.gen(function* () {
      const textGeneration = yield* TextGeneration

      yield* textGeneration.generateCommitMessage({
        cwd: process.cwd(),
        branch: 'feature/codex-effect',
        stagedSummary: 'M README.md',
        stagedPatch: 'diff --git a/README.md b/README.md',
        modelSelection: {
          provider: 'codex',
          model: 'gpt-5.4',
          options: {
            reasoningEffort: 'xhigh',
            fastMode: true,
          },
        },
      })
    })
  )
}

function makeDefaultEffortCommitMessageEffect() {
  return withFakeCodexEnv(
    {
      output: JSON.stringify({
        subject: 'Add important change',
        body: '',
      }),
      requireReasoningEffort: 'low',
    },
    Effect.gen(function* () {
      const textGeneration = yield* TextGeneration

      yield* textGeneration.generateCommitMessage({
        cwd: process.cwd(),
        branch: 'feature/codex-effect',
        stagedSummary: 'M README.md',
        stagedPatch: 'diff --git a/README.md b/README.md',
        modelSelection: DEFAULT_TEST_MODEL_SELECTION,
      })
    })
  )
}

function makeCommitMessageWithBranchEffect() {
  return withFakeCodexEnv(
    {
      output: JSON.stringify({
        subject: 'Add important change',
        body: '',
        branch: 'fix/important-system-change',
      }),
      stdinMustContain: 'branch must be a short semantic git branch fragment',
    },
    Effect.gen(function* () {
      const textGeneration = yield* TextGeneration

      const generated = yield* textGeneration.generateCommitMessage({
        cwd: process.cwd(),
        branch: 'feature/codex-effect',
        stagedSummary: 'M README.md',
        stagedPatch: 'diff --git a/README.md b/README.md',
        includeBranch: true,
        modelSelection: DEFAULT_TEST_MODEL_SELECTION,
      })

      expect(generated.subject).toBe('Add important change')
      expect(generated.branch).toBe('feature/fix/important-system-change')
    })
  )
}

function makePrContentEffect() {
  return withFakeCodexEnv(
    {
      output: JSON.stringify({
        title: '  Improve orchestration flow\nwith ignored suffix',
        body: '\n## Summary\n- improve flow\n\n## Testing\n- bun test\n\n',
      }),
    },
    Effect.gen(function* () {
      const textGeneration = yield* TextGeneration

      const generated = yield* textGeneration.generatePrContent({
        cwd: process.cwd(),
        baseBranch: 'main',
        headBranch: 'feature/codex-effect',
        commitSummary: 'feat: improve orchestration flow',
        diffSummary: '2 files changed',
        diffPatch: 'diff --git a/a.ts b/a.ts',
        modelSelection: DEFAULT_TEST_MODEL_SELECTION,
      })

      expect(generated.title).toBe('Improve orchestration flow')
      expect(generated.body.startsWith('## Summary')).toBe(true)
      expect(generated.body.endsWith('\n\n')).toBe(false)
    })
  )
}

function makeNormalizedBranchNameEffect() {
  return withFakeCodexEnv(
    {
      output: JSON.stringify({
        branch: '  Feat/Session  ',
      }),
      stdinMustNotContain: 'Image attachments supplied to the model',
    },
    Effect.gen(function* () {
      const textGeneration = yield* TextGeneration

      const generated = yield* textGeneration.generateBranchName({
        cwd: process.cwd(),
        message: 'Please update session handling.',
        modelSelection: DEFAULT_TEST_MODEL_SELECTION,
      })

      expect(generated.branch).toBe('feat/session')
    })
  )
}

function makeTrimmedThreadTitleEffect() {
  return withFakeCodexEnv(
    {
      output: JSON.stringify({
        title:
          '  "Investigate websocket reconnect regressions after worktree restore"  \nignored line',
      }),
    },
    Effect.gen(function* () {
      const textGeneration = yield* TextGeneration

      const generated = yield* textGeneration.generateThreadTitle({
        cwd: process.cwd(),
        message: 'Please investigate websocket reconnect regressions after a worktree restore.',
        modelSelection: DEFAULT_TEST_MODEL_SELECTION,
      })

      expect(generated.title).toBe('Investigate websocket reconnect regressions aft...')
    })
  )
}

function makeWhitespaceThreadTitleFallbackEffect() {
  return withFakeCodexEnv(
    {
      output: JSON.stringify({
        title: '  """   """  ',
      }),
    },
    Effect.gen(function* () {
      const textGeneration = yield* TextGeneration

      const generated = yield* textGeneration.generateThreadTitle({
        cwd: process.cwd(),
        message: 'Name this thread.',
        modelSelection: DEFAULT_TEST_MODEL_SELECTION,
      })

      expect(generated.title).toBe('New thread')
    })
  )
}

function makeTrimmedQuoteThreadTitleEffect() {
  return withFakeCodexEnv(
    {
      output: JSON.stringify({
        title: `  "' hello world '"  `,
      }),
    },
    Effect.gen(function* () {
      const textGeneration = yield* TextGeneration

      const generated = yield* textGeneration.generateThreadTitle({
        cwd: process.cwd(),
        message: 'Name this thread.',
        modelSelection: DEFAULT_TEST_MODEL_SELECTION,
      })

      expect(generated.title).toBe('hello world')
    })
  )
}

function makeNoAttachmentMetadataEffect() {
  return withFakeCodexEnv(
    {
      output: JSON.stringify({
        branch: 'fix/session-timeout',
      }),
      stdinMustNotContain: 'Attachment metadata:',
    },
    Effect.gen(function* () {
      const textGeneration = yield* TextGeneration

      const generated = yield* textGeneration.generateBranchName({
        cwd: process.cwd(),
        message: 'Fix timeout behavior.',
        modelSelection: DEFAULT_TEST_MODEL_SELECTION,
      })

      expect(generated.branch).toBe('fix/session-timeout')
    })
  )
}

function makeBranchNameWithImageAttachmentEffect() {
  return withFakeCodexEnv(
    {
      output: JSON.stringify({
        branch: 'fix/ui-regression',
      }),
      requireImage: true,
      stdinMustContain: 'Attachment metadata:',
    },
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const { attachmentsDir } = yield* ServerConfig
      const attachmentId = `thread-branch-image-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const attachmentPath = path.join(attachmentsDir, `${attachmentId}.png`)
      yield* fs.makeDirectory(attachmentsDir, { recursive: true })
      yield* fs.writeFile(attachmentPath, Buffer.from('hello'))

      const textGeneration = yield* TextGeneration
      const generated = yield* textGeneration.generateBranchName({
        modelSelection: DEFAULT_TEST_MODEL_SELECTION,
        cwd: process.cwd(),
        message: 'Fix layout bug from screenshot.',
        attachments: [
          {
            type: 'image',
            id: attachmentId,
            name: 'bug.png',
            mimeType: 'image/png',
            sizeBytes: 5,
          },
        ],
      })

      expect(generated.branch).toBe('fix/ui-regression')
    })
  )
}

function makePersistedAttachmentResolutionEffect() {
  return withFakeCodexEnv(
    {
      output: JSON.stringify({
        branch: 'fix/ui-regression',
      }),
      requireImage: true,
    },
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const { attachmentsDir } = yield* ServerConfig
      const attachmentId = `thread-1-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const imagePath = path.join(attachmentsDir, `${attachmentId}.png`)
      yield* fs.makeDirectory(attachmentsDir, { recursive: true })
      yield* fs.writeFile(imagePath, Buffer.from('hello'))

      const textGeneration = yield* TextGeneration
      const generated = yield* textGeneration
        .generateBranchName({
          modelSelection: DEFAULT_TEST_MODEL_SELECTION,
          cwd: process.cwd(),
          message: 'Fix layout bug from screenshot.',
          attachments: [
            {
              type: 'image',
              id: attachmentId,
              name: 'bug.png',
              mimeType: 'image/png',
              sizeBytes: 5,
            },
          ],
        })
        .pipe(
          Effect.tap(() =>
            fs.stat(imagePath).pipe(
              Effect.map(fileInfo => {
                expect(fileInfo.type).toBe('File')
              })
            )
          ),
          Effect.ensuring(fs.remove(imagePath).pipe(Effect.catch(() => Effect.void)))
        )

      expect(generated.branch).toBe('fix/ui-regression')
    })
  )
}

function makeMissingAttachmentFailureEffect() {
  return withFakeCodexEnv(
    {
      output: JSON.stringify({
        branch: 'fix/ui-regression',
      }),
      requireImage: true,
    },
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const { attachmentsDir } = yield* ServerConfig
      const missingAttachmentId = `thread-missing-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const missingPath = path.join(attachmentsDir, `${missingAttachmentId}.png`)
      yield* fs.remove(missingPath).pipe(Effect.catch(() => Effect.void))

      const textGeneration = yield* TextGeneration
      const result = yield* textGeneration
        .generateBranchName({
          modelSelection: DEFAULT_TEST_MODEL_SELECTION,
          cwd: process.cwd(),
          message: 'Fix layout bug from screenshot.',
          attachments: [
            {
              type: 'image',
              id: missingAttachmentId,
              name: 'outside.png',
              mimeType: 'image/png',
              sizeBytes: 5,
            },
          ],
        })
        .pipe(Effect.result)

      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(TextGenerationError)
        expect(result.failure.message).toContain('missing --image input')
      }
    })
  )
}

function makeWrongBranchPayloadFailureEffect() {
  return withFakeCodexEnv(
    {
      output: JSON.stringify({
        title: 'This is not a branch payload',
      }),
    },
    Effect.gen(function* () {
      const textGeneration = yield* TextGeneration

      const result = yield* textGeneration
        .generateBranchName({
          cwd: process.cwd(),
          message: 'Fix websocket reconnect flake',
          modelSelection: DEFAULT_TEST_MODEL_SELECTION,
        })
        .pipe(Effect.result)

      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(TextGenerationError)
        expect(result.failure.message).toContain('Codex returned invalid structured output')
      }
    })
  )
}

function makeCodexNonZeroExitFailureEffect() {
  return withFakeCodexEnv(
    {
      output: JSON.stringify({ subject: 'ignored', body: '' }),
      exitCode: 1,
      stderr: 'codex execution failed',
    },
    Effect.gen(function* () {
      const textGeneration = yield* TextGeneration

      const result = yield* textGeneration
        .generateCommitMessage({
          cwd: process.cwd(),
          branch: 'feature/codex-error',
          stagedSummary: 'M README.md',
          stagedPatch: 'diff --git a/README.md b/README.md',
          modelSelection: DEFAULT_TEST_MODEL_SELECTION,
        })
        .pipe(Effect.result)

      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(TextGenerationError)
        expect(result.failure.message).toContain('Codex CLI command failed: codex execution failed')
      }
    })
  )
}

it.layer(CodexTextGenerationTestLayer)('CodexTextGenerationLive', it => {
  it.effect('generates and sanitizes commit messages without branch by default', () =>
    makeSanitizedCommitMessageEffect()
  )
  it.effect(
    'forwards codex fast mode and non-default reasoning effort into codex exec config',
    () => makeFastModeCommitMessageEffect()
  )
  it.effect('defaults git text generation codex effort to low', () =>
    makeDefaultEffortCommitMessageEffect()
  )
  it.effect('generates commit message with branch when includeBranch is true', () =>
    makeCommitMessageWithBranchEffect()
  )
  it.effect('generates PR content and trims markdown body', () => makePrContentEffect())
  it.effect('generates branch names and normalizes branch fragments', () =>
    makeNormalizedBranchNameEffect()
  )
  it.effect('generates thread titles and trims them for sidebar use', () =>
    makeTrimmedThreadTitleEffect()
  )
  it.effect('falls back when thread title normalization becomes whitespace-only', () =>
    makeWhitespaceThreadTitleFallbackEffect()
  )
  it.effect('trims whitespace exposed after quote removal in thread titles', () =>
    makeTrimmedQuoteThreadTitleEffect()
  )
  it.effect('omits attachment metadata section when no attachments are provided', () =>
    makeNoAttachmentMetadataEffect()
  )
  it.effect('passes image attachments through as codex image inputs', () =>
    makeBranchNameWithImageAttachmentEffect()
  )
  it.effect('resolves persisted attachment ids to files for codex image inputs', () =>
    makePersistedAttachmentResolutionEffect()
  )
  it.effect('ignores missing attachment ids for codex image inputs', () =>
    makeMissingAttachmentFailureEffect()
  )
  it.effect(
    'fails with typed TextGenerationError when codex returns wrong branch payload shape',
    () => makeWrongBranchPayloadFailureEffect()
  )
  it.effect('returns typed TextGenerationError when codex exits non-zero', () =>
    makeCodexNonZeroExitFailureEffect()
  )
})
