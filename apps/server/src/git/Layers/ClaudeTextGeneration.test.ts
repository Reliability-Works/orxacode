import * as NodeServices from '@effect/platform-node/NodeServices'
import { it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Path } from 'effect'
import { expect } from 'vitest'

import { ServerConfig } from '../../config.ts'
import { TextGeneration } from '../Services/TextGeneration.ts'
import { sanitizeThreadTitle } from '../Utils.ts'
import { ClaudeTextGenerationLive } from './ClaudeTextGeneration.ts'
import { ServerSettingsService } from '../../serverSettings.ts'

const ClaudeTextGenerationTestLayer = ClaudeTextGenerationLive.pipe(
  Layer.provideMerge(ServerSettingsService.layerTest()),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), {
      prefix: 'orxa-claude-text-generation-test-',
    })
  ),
  Layer.provideMerge(NodeServices.layer)
)

type FakeClaudeEnvInput = {
  output: string
  exitCode?: number
  stderr?: string
  argsMustContain?: string
  argsMustNotContain?: string
  stdinMustContain?: string
}

type FakeClaudeEnvState = {
  previousPath: string | undefined
  previousOutput: string | undefined
  previousExitCode: string | undefined
  previousStderr: string | undefined
  previousArgsMustContain: string | undefined
  previousArgsMustNotContain: string | undefined
  previousStdinMustContain: string | undefined
}

function makeFakeClaudeBinary(dir: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const binDir = path.join(dir, 'bin')
    const claudePath = path.join(binDir, 'claude')
    yield* fs.makeDirectory(binDir, { recursive: true })

    yield* fs.writeFileString(
      claudePath,
      [
        '#!/bin/sh',
        'args="$*"',
        'stdin_content="$(cat)"',
        'if [ -n "$ORXA_FAKE_CLAUDE_ARGS_MUST_CONTAIN" ]; then',
        '  printf "%s" "$args" | grep -F -- "$ORXA_FAKE_CLAUDE_ARGS_MUST_CONTAIN" >/dev/null || {',
        '    printf "%s\\n" "args missing expected content" >&2',
        '    exit 2',
        '  }',
        'fi',
        'if [ -n "$ORXA_FAKE_CLAUDE_ARGS_MUST_NOT_CONTAIN" ]; then',
        '  if printf "%s" "$args" | grep -F -- "$ORXA_FAKE_CLAUDE_ARGS_MUST_NOT_CONTAIN" >/dev/null; then',
        '    printf "%s\\n" "args contained forbidden content" >&2',
        '    exit 3',
        '  fi',
        'fi',
        'if [ -n "$ORXA_FAKE_CLAUDE_STDIN_MUST_CONTAIN" ]; then',
        '  printf "%s" "$stdin_content" | grep -F -- "$ORXA_FAKE_CLAUDE_STDIN_MUST_CONTAIN" >/dev/null || {',
        '    printf "%s\\n" "stdin missing expected content" >&2',
        '    exit 4',
        '  }',
        'fi',
        'if [ -n "$ORXA_FAKE_CLAUDE_STDERR" ]; then',
        '  printf "%s\\n" "$ORXA_FAKE_CLAUDE_STDERR" >&2',
        'fi',
        'printf "%s" "$ORXA_FAKE_CLAUDE_OUTPUT"',
        'exit "${ORXA_FAKE_CLAUDE_EXIT_CODE:-0}"',
        '',
      ].join('\n')
    )
    yield* fs.chmod(claudePath, 0o755)
    return binDir
  })
}

function captureFakeClaudeEnvState(): FakeClaudeEnvState {
  return {
    previousPath: process.env.PATH,
    previousOutput: process.env.ORXA_FAKE_CLAUDE_OUTPUT,
    previousExitCode: process.env.ORXA_FAKE_CLAUDE_EXIT_CODE,
    previousStderr: process.env.ORXA_FAKE_CLAUDE_STDERR,
    previousArgsMustContain: process.env.ORXA_FAKE_CLAUDE_ARGS_MUST_CONTAIN,
    previousArgsMustNotContain: process.env.ORXA_FAKE_CLAUDE_ARGS_MUST_NOT_CONTAIN,
    previousStdinMustContain: process.env.ORXA_FAKE_CLAUDE_STDIN_MUST_CONTAIN,
  }
}

function assignOptionalEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

function applyFakeClaudeEnv(
  input: FakeClaudeEnvInput,
  binDir: string,
  previousPath: string | undefined
) {
  process.env.PATH = `${binDir}:${previousPath ?? ''}`
  process.env.ORXA_FAKE_CLAUDE_OUTPUT = input.output
  assignOptionalEnv(
    'ORXA_FAKE_CLAUDE_EXIT_CODE',
    input.exitCode !== undefined ? String(input.exitCode) : undefined
  )
  assignOptionalEnv('ORXA_FAKE_CLAUDE_STDERR', input.stderr)
  assignOptionalEnv('ORXA_FAKE_CLAUDE_ARGS_MUST_CONTAIN', input.argsMustContain)
  assignOptionalEnv('ORXA_FAKE_CLAUDE_ARGS_MUST_NOT_CONTAIN', input.argsMustNotContain)
  assignOptionalEnv('ORXA_FAKE_CLAUDE_STDIN_MUST_CONTAIN', input.stdinMustContain)
}

function restoreFakeClaudeEnv(previous: FakeClaudeEnvState) {
  process.env.PATH = previous.previousPath
  assignOptionalEnv('ORXA_FAKE_CLAUDE_OUTPUT', previous.previousOutput)
  assignOptionalEnv('ORXA_FAKE_CLAUDE_EXIT_CODE', previous.previousExitCode)
  assignOptionalEnv('ORXA_FAKE_CLAUDE_STDERR', previous.previousStderr)
  assignOptionalEnv('ORXA_FAKE_CLAUDE_ARGS_MUST_CONTAIN', previous.previousArgsMustContain)
  assignOptionalEnv('ORXA_FAKE_CLAUDE_ARGS_MUST_NOT_CONTAIN', previous.previousArgsMustNotContain)
  assignOptionalEnv('ORXA_FAKE_CLAUDE_STDIN_MUST_CONTAIN', previous.previousStdinMustContain)
}

function withFakeClaudeEnv<A, E, R>(input: FakeClaudeEnvInput, effect: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: 'orxa-claude-text-' })
      const binDir = yield* makeFakeClaudeBinary(tempDir)
      const previous = captureFakeClaudeEnvState()

      yield* Effect.sync(() => {
        applyFakeClaudeEnv(input, binDir, previous.previousPath)
      })

      return previous
    }),
    () => effect,
    previous => Effect.sync(() => restoreFakeClaudeEnv(previous))
  )
}

function makeClaudeThinkingModeEffect() {
  return withFakeClaudeEnv(
    {
      output: JSON.stringify({
        structured_output: {
          subject: 'Add important change',
          body: '',
        },
      }),
      argsMustContain: '--settings {"alwaysThinkingEnabled":false}',
      argsMustNotContain: '--effort',
    },
    Effect.gen(function* () {
      const textGeneration = yield* TextGeneration

      const generated = yield* textGeneration.generateCommitMessage({
        cwd: process.cwd(),
        branch: 'feature/claude-effect',
        stagedSummary: 'M README.md',
        stagedPatch: 'diff --git a/README.md b/README.md',
        modelSelection: {
          provider: 'claudeAgent',
          model: 'claude-haiku-4-5',
          options: {
            thinking: false,
            effort: 'high',
          },
        },
      })

      expect(generated.subject).toBe('Add important change')
    })
  )
}

function makeClaudeFastModeEffect() {
  return withFakeClaudeEnv(
    {
      output: JSON.stringify({
        structured_output: {
          title: 'Improve orchestration flow',
          body: 'Body',
        },
      }),
      argsMustContain: '--effort max --settings {"fastMode":true}',
    },
    Effect.gen(function* () {
      const textGeneration = yield* TextGeneration

      const generated = yield* textGeneration.generatePrContent({
        cwd: process.cwd(),
        baseBranch: 'main',
        headBranch: 'feature/claude-effect',
        commitSummary: 'Improve orchestration',
        diffSummary: '1 file changed',
        diffPatch: 'diff --git a/README.md b/README.md',
        modelSelection: {
          provider: 'claudeAgent',
          model: 'claude-opus-4-7',
          options: {
            effort: 'max',
            fastMode: true,
          },
        },
      })

      expect(generated.title).toBe('Improve orchestration flow')
    })
  )
}

function makeClaudeThreadTitleEffect() {
  return withFakeClaudeEnv(
    {
      output: JSON.stringify({
        structured_output: {
          title:
            '  "Reconnect failures after restart because the session state does not recover"  ',
        },
      }),
      stdinMustContain: 'You write concise thread titles for coding conversations.',
    },
    Effect.gen(function* () {
      const textGeneration = yield* TextGeneration

      const generated = yield* textGeneration.generateThreadTitle({
        cwd: process.cwd(),
        message: 'Please investigate reconnect failures after restarting the session.',
        modelSelection: {
          provider: 'claudeAgent',
          model: 'claude-sonnet-4-6',
        },
      })

      expect(generated.title).toBe(
        sanitizeThreadTitle(
          '"Reconnect failures after restart because the session state does not recover"'
        )
      )
    })
  )
}

function makeClaudeThreadTitleFallbackEffect() {
  return withFakeClaudeEnv(
    {
      output: JSON.stringify({
        structured_output: {
          title: '  """   """  ',
        },
      }),
    },
    Effect.gen(function* () {
      const textGeneration = yield* TextGeneration

      const generated = yield* textGeneration.generateThreadTitle({
        cwd: process.cwd(),
        message: 'Name this thread.',
        modelSelection: {
          provider: 'claudeAgent',
          model: 'claude-sonnet-4-6',
        },
      })

      expect(generated.title).toBe('New thread')
    })
  )
}

it.layer(ClaudeTextGenerationTestLayer)('ClaudeTextGenerationLive', itScope => {
  itScope.effect('forwards Claude thinking settings for Haiku without passing effort', () =>
    makeClaudeThinkingModeEffect()
  )
  itScope.effect('forwards Claude fast mode and supported effort', () => makeClaudeFastModeEffect())
  itScope.effect('generates thread titles through the Claude provider', () =>
    makeClaudeThreadTitleEffect()
  )
  itScope.effect('falls back when Claude thread title normalization becomes whitespace-only', () =>
    makeClaudeThreadTitleFallbackEffect()
  )
})
