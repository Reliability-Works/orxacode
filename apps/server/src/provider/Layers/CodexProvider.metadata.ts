import * as OS from 'node:os'
import { Effect, FileSystem, Option, Path, Result } from 'effect'
import type {
  ModelCapabilities,
  ServerProviderAuth,
  ServerProviderModel,
  ServerProviderState,
} from '@orxa-code/contracts'
import type { CodexAccountSnapshot } from '../codexAccount'
import { probeCodexAccount } from '../codexAppServer'
import { ServerSettingsService } from '../../serverSettings'
import { type CommandResult } from '../providerSnapshot'
import { parseProviderAuthStatusFromOutput } from './Provider.shared'

const OPENAI_AUTH_PROVIDERS = new Set(['openai'])
const CAPABILITIES_PROBE_TIMEOUT_MS = 8_000

const STANDARD_CODEX_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [
    { value: 'xhigh', label: 'Extra High' },
    { value: 'high', label: 'High', isDefault: true },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
  ],
  supportsFastMode: true,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
}

function makeStandardCodexModel(slug: string, name: string): ServerProviderModel {
  return {
    slug,
    name,
    isCustom: false,
    supportsReasoning: true,
    capabilities: STANDARD_CODEX_CAPABILITIES,
  }
}

export const BUILT_IN_CODEX_MODELS: ReadonlyArray<ServerProviderModel> = [
  makeStandardCodexModel('gpt-5.4', 'GPT-5.4'),
  makeStandardCodexModel('gpt-5.4-mini', 'GPT-5.4 Mini'),
  makeStandardCodexModel('gpt-5.3-codex', 'GPT-5.3 Codex'),
  makeStandardCodexModel('gpt-5.3-codex-spark', 'GPT-5.3 Codex Spark'),
  makeStandardCodexModel('gpt-5.2-codex', 'GPT-5.2 Codex'),
  makeStandardCodexModel('gpt-5.2', 'GPT-5.2'),
]

export function getCodexModelCapabilities(model: string | null | undefined): ModelCapabilities {
  const slug = model?.trim()
  return (
    BUILT_IN_CODEX_MODELS.find(candidate => candidate.slug === slug)?.capabilities ?? {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    }
  )
}

const CODEX_AUTH_PARSE_CONFIG = {
  unavailableCommandMessage:
    'Codex CLI authentication status command is unavailable in this Codex version.',
  notAuthenticatedMessage: 'Codex CLI is not authenticated. Run `codex login` and try again.',
  missingAuthMarkerMessage:
    'Could not verify Codex authentication status from JSON output (missing auth marker).',
  unverifiedAuthMessage: 'Could not verify Codex authentication status.',
  unverifiedAuthMessageWithDetail: (detail: string) =>
    `Could not verify Codex authentication status. ${detail}`,
  loginPromptPhrases: ['run `codex login`', 'run codex login'],
} as const

export function parseAuthStatusFromOutput(result: CommandResult): {
  readonly status: Exclude<ServerProviderState, 'disabled'>
  readonly auth: Pick<ServerProviderAuth, 'status'>
  readonly message?: string
} {
  return parseProviderAuthStatusFromOutput(result, CODEX_AUTH_PARSE_CONFIG)
}

export const readCodexConfigModelProvider = Effect.fn('readCodexConfigModelProvider')(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const settingsService = yield* ServerSettingsService
  const codexHome = yield* settingsService.getSettings.pipe(
    Effect.map(
      settings =>
        settings.providers.codex.homePath ||
        process.env.CODEX_HOME ||
        path.join(OS.homedir(), '.codex')
    )
  )
  const configPath = path.join(codexHome, 'config.toml')

  const content = yield* fileSystem
    .readFileString(configPath)
    .pipe(Effect.orElseSucceed(() => undefined))
  if (content === undefined) {
    return undefined
  }

  let inTopLevel = true
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (trimmed.startsWith('[')) {
      inTopLevel = false
      continue
    }
    if (!inTopLevel) continue

    const match = trimmed.match(/^model_provider\s*=\s*["']([^"']+)["']/)
    if (match) return match[1]
  }
  return undefined
})

export const hasCustomModelProvider = readCodexConfigModelProvider().pipe(
  Effect.map(provider => provider !== undefined && !OPENAI_AUTH_PROVIDERS.has(provider)),
  Effect.orElseSucceed(() => false)
)

export const probeCodexCapabilities = (input: {
  readonly binaryPath: string
  readonly homePath?: string
}) =>
  Effect.tryPromise(signal => probeCodexAccount({ ...input, signal })).pipe(
    Effect.timeoutOption(CAPABILITIES_PROBE_TIMEOUT_MS),
    Effect.result,
    Effect.map(result => {
      if (Result.isFailure(result)) return undefined
      return Option.isSome(result.success) ? result.success.value : undefined
    })
  )

export type { CodexAccountSnapshot }
