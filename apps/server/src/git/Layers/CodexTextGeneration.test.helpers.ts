import * as NodeServices from '@effect/platform-node/NodeServices'
import { Effect, FileSystem, Layer, Path } from 'effect'

import { ServerConfig } from '../../config.ts'
import { CodexTextGenerationLive } from './CodexTextGeneration.ts'
import { ServerSettingsService } from '../../serverSettings.ts'

export const DEFAULT_TEST_MODEL_SELECTION = {
  provider: 'codex' as const,
  model: 'gpt-5.4-mini',
}

export const CodexTextGenerationTestLayer = CodexTextGenerationLive.pipe(
  Layer.provideMerge(ServerSettingsService.layerTest()),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), {
      prefix: 'orxa-codex-text-generation-test-',
    })
  ),
  Layer.provideMerge(NodeServices.layer)
)

export type FakeCodexEnvInput = {
  output: string
  exitCode?: number
  stderr?: string
  requireImage?: boolean
  requireFastServiceTier?: boolean
  requireReasoningEffort?: string
  forbidReasoningEffort?: boolean
  stdinMustContain?: string
  stdinMustNotContain?: string
}

const buildImageRequirementLines = (input: FakeCodexEnvInput) =>
  input.requireImage
    ? [
        'if [ "$seen_image" != "1" ]; then',
        '  printf "%s\\n" "missing --image input" >&2',
        '  exit 2',
        'fi',
      ]
    : []

const buildServiceTierRequirementLines = (input: FakeCodexEnvInput) =>
  input.requireFastServiceTier
    ? [
        'if [ "$seen_fast_service_tier" != "1" ]; then',
        '  printf "%s\\n" "missing fast service tier config" >&2',
        '  exit 5',
        'fi',
      ]
    : []

const buildReasoningEffortLines = (input: FakeCodexEnvInput) =>
  input.requireReasoningEffort !== undefined
    ? [
        `if [ "$seen_reasoning_effort" != "model_reasoning_effort=\\"${input.requireReasoningEffort}\\"" ]; then`,
        '  printf "%s\\n" "unexpected reasoning effort config: $seen_reasoning_effort" >&2',
        '  exit 6',
        'fi',
      ]
    : input.forbidReasoningEffort
      ? [
          'if [ -n "$seen_reasoning_effort" ]; then',
          '  printf "%s\\n" "reasoning effort config should be omitted: $seen_reasoning_effort" >&2',
          '  exit 7',
          'fi',
        ]
      : []

const buildStdinExpectationLines = (input: FakeCodexEnvInput) => [
  ...(input.stdinMustContain !== undefined
    ? [
        `if ! printf "%s" "$stdin_content" | grep -F -- ${JSON.stringify(input.stdinMustContain)} >/dev/null; then`,
        '  printf "%s\\n" "stdin missing expected content" >&2',
        '  exit 3',
        'fi',
      ]
    : []),
  ...(input.stdinMustNotContain !== undefined
    ? [
        `if printf "%s" "$stdin_content" | grep -F -- ${JSON.stringify(input.stdinMustNotContain)} >/dev/null; then`,
        '  printf "%s\\n" "stdin contained forbidden content" >&2',
        '  exit 4',
        'fi',
      ]
    : []),
]

const buildStderrLines = (input: FakeCodexEnvInput) =>
  input.stderr !== undefined ? [`printf "%s\\n" ${JSON.stringify(input.stderr)} >&2`] : []

const buildFakeCodexScript = (input: FakeCodexEnvInput) =>
  [
    '#!/bin/sh',
    'output_path=""',
    'seen_image="0"',
    'seen_fast_service_tier="0"',
    'seen_reasoning_effort=""',
    'while [ $# -gt 0 ]; do',
    '  if [ "$1" = "--image" ]; then',
    '    shift',
    '    if [ -n "$1" ]; then',
    '      seen_image="1"',
    '    fi',
    '    shift',
    '    continue',
    '  fi',
    '  if [ "$1" = "--config" ]; then',
    '    shift',
    '    if [ "$1" = "service_tier=\\"fast\\"" ]; then',
    '      seen_fast_service_tier="1"',
    '    fi',
    '    case "$1" in',
    '      model_reasoning_effort=*)',
    '        seen_reasoning_effort="$1"',
    '        ;;',
    '    esac',
    '    shift',
    '    continue',
    '  fi',
    '  if [ "$1" = "--output-last-message" ]; then',
    '    shift',
    '    output_path="$1"',
    '    shift',
    '    continue',
    '  fi',
    '  shift',
    'done',
    'stdin_content="$(cat)"',
    ...buildImageRequirementLines(input),
    ...buildServiceTierRequirementLines(input),
    ...buildReasoningEffortLines(input),
    ...buildStdinExpectationLines(input),
    ...buildStderrLines(input),
    'if [ -n "$output_path" ]; then',
    '  cat > "$output_path" <<\'__ORXA_FAKE_CODEX_OUTPUT__\'',
    input.output,
    '__ORXA_FAKE_CODEX_OUTPUT__',
    'fi',
    `exit ${input.exitCode ?? 0}`,
    '',
  ].join('\n')

function makeFakeCodexBinary(dir: string, input: FakeCodexEnvInput) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const binDir = path.join(dir, 'bin')
    const codexPath = path.join(binDir, 'codex')
    yield* fs.makeDirectory(binDir, { recursive: true })
    yield* fs.writeFileString(codexPath, buildFakeCodexScript(input))
    yield* fs.chmod(codexPath, 0o755)
    return codexPath
  })
}

export function withFakeCodexEnv<A, E, R>(
  input: FakeCodexEnvInput,
  effect: Effect.Effect<A, E, R>
) {
  return Effect.acquireUseRelease(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: 'orxa-codex-text-' })
      const codexPath = yield* makeFakeCodexBinary(tempDir, input)
      const serverSettings = yield* ServerSettingsService
      const previousSettings = yield* serverSettings.getSettings
      yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: codexPath,
          },
        },
      })
      return { serverSettings, previousBinaryPath: previousSettings.providers.codex.binaryPath }
    }),
    () => effect,
    ({ serverSettings, previousBinaryPath }) =>
      serverSettings
        .updateSettings({
          providers: {
            codex: {
              binaryPath: previousBinaryPath,
            },
          },
        })
        .pipe(Effect.asVoid)
  )
}
