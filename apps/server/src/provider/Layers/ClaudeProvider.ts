import type {
  ClaudeSettings,
  ModelCapabilities,
  ServerProvider,
  ServerProviderModel,
  ServerProviderAuth,
  ServerProviderState,
} from '@orxa-code/contracts'
import { Cache, Duration, Effect, Equal, Layer, Option, Result, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'

import {
  DEFAULT_TIMEOUT_MS,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type CommandResult,
} from '../providerSnapshot'
import { makeManagedServerProvider } from '../makeManagedServerProvider'
import { ClaudeProvider } from '../Services/ClaudeProvider'
import { ServerSettingsService } from '../../serverSettings'
import { ServerSettingsError } from '@orxa-code/contracts'
import {
  adjustModelsForSubscription,
  claudeAuthMetadata,
  extractClaudeAuthMethodFromOutput,
  extractSubscriptionTypeFromOutput,
  probeClaudeCapabilities,
} from './ClaudeProvider.metadata'
import {
  buildAuthProbeFailureProvider,
  buildAuthProbeTimeoutProvider,
  buildDisabledProvider,
  buildProviderReadyProvider,
  buildVersionCommandFailureProvider,
  buildVersionProbeFailureProvider,
  buildVersionTimeoutProvider,
  parseProviderAuthStatusFromOutput,
  type ProviderStatusBuilder,
  type ProviderStatusContext,
} from './Provider.shared'

const PROVIDER = 'claudeAgent' as const

const CLAUDE_AUTH_PARSE_CONFIG = {
  unavailableCommandMessage:
    'Claude Agent authentication status command is unavailable in this version of Claude.',
  notAuthenticatedMessage: 'Claude is not authenticated. Run `claude auth login` and try again.',
  missingAuthMarkerMessage:
    'Could not verify Claude authentication status from JSON output (missing auth marker).',
  unverifiedAuthMessage: 'Could not verify Claude authentication status.',
  unverifiedAuthMessageWithDetail: (detail: string) =>
    `Could not verify Claude authentication status. ${detail}`,
  loginPromptPhrases: ['run `claude login`', 'run claude login'],
} as const

const CLAUDE_STATUS_BUILDER: ProviderStatusBuilder = {
  provider: PROVIDER,
  disabledMessage: 'Claude is disabled in Orxa Code settings.',
  missingBinaryMessage: 'Claude Agent CLI (`claude`) is not installed or not on PATH.',
  versionFailureMessagePrefix: 'Failed to execute Claude Agent CLI health check',
  versionTimeoutMessage:
    'Claude Agent CLI is installed but failed to run. Timed out while running command.',
  versionCommandFailureBaseMessage: 'Claude Agent CLI is installed but failed to run.',
  authProbeFailurePrefix: 'Could not verify Claude authentication status',
  authProbeFailureFallback: 'Could not verify Claude authentication status.',
  authProbeTimeoutMessage:
    'Could not verify Claude authentication status. Timed out while running command.',
}
const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High', isDefault: true },
        { value: 'max', label: 'Max' },
        { value: 'ultrathink', label: 'Ultrathink' },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      contextWindowOptions: [
        { value: '200k', label: '200k', isDefault: true },
        { value: '1m', label: '1M' },
      ],
      promptInjectedEffortLevels: ['ultrathink'],
    } satisfies ModelCapabilities,
  },
  {
    slug: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High', isDefault: true },
        { value: 'ultrathink', label: 'Ultrathink' },
      ],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      contextWindowOptions: [
        { value: '200k', label: '200k', isDefault: true },
        { value: '1m', label: '1M' },
      ],
      promptInjectedEffortLevels: ['ultrathink'],
    } satisfies ModelCapabilities,
  },
  {
    slug: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: true,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    } satisfies ModelCapabilities,
  },
]

export function getClaudeModelCapabilities(model: string | null | undefined): ModelCapabilities {
  const slug = model?.trim()
  return (
    BUILT_IN_MODELS.find(candidate => candidate.slug === slug)?.capabilities ?? {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    }
  )
}

export function parseClaudeAuthStatusFromOutput(result: CommandResult): {
  readonly status: Exclude<ServerProviderState, 'disabled'>
  readonly auth: Pick<ServerProviderAuth, 'status'>
  readonly message?: string
} {
  return parseProviderAuthStatusFromOutput(result, CLAUDE_AUTH_PARSE_CONFIG)
}

const runClaudeCommand = Effect.fn('runClaudeCommand')(function* (args: ReadonlyArray<string>) {
  const claudeSettings = yield* Effect.service(ServerSettingsService).pipe(
    Effect.flatMap(service => service.getSettings),
    Effect.map(settings => settings.providers.claudeAgent)
  )
  const command = ChildProcess.make(claudeSettings.binaryPath, [...args], {
    shell: process.platform === 'win32',
  })
  return yield* spawnAndCollect(claudeSettings.binaryPath, command)
})

type ClaudeProviderStatusContext = ProviderStatusContext

function buildClaudeReadyProvider(input: {
  authMethod: string | undefined
  context: ClaudeProviderStatusContext
  parsed: ReturnType<typeof parseClaudeAuthStatusFromOutput>
  parsedVersion: string | null
  resolvedModels: ReadonlyArray<ServerProviderModel>
  subscriptionType: string | undefined
}): ServerProvider {
  const authMetadata = claudeAuthMetadata({
    subscriptionType: input.subscriptionType,
    authMethod: input.authMethod,
  })
  return buildProviderReadyProvider(CLAUDE_STATUS_BUILDER, {
    context: input.context,
    parsed: input.parsed,
    parsedVersion: input.parsedVersion,
    resolvedModels: input.resolvedModels,
    ...(authMetadata ? { authExtras: authMetadata } : {}),
  })
}

type VersionProbeResult =
  | { readonly kind: 'provider'; readonly provider: ServerProvider }
  | { readonly kind: 'ok'; readonly parsedVersion: string | null }

const runClaudeVersionProbe = Effect.fn('runClaudeVersionProbe')(function* (
  context: ClaudeProviderStatusContext
): Effect.fn.Return<
  VersionProbeResult,
  ServerSettingsError,
  ChildProcessSpawner.ChildProcessSpawner | ServerSettingsService
> {
  const versionProbe = yield* runClaudeCommand(['--version']).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result
  )

  if (Result.isFailure(versionProbe)) {
    return {
      kind: 'provider',
      provider: buildVersionProbeFailureProvider(
        CLAUDE_STATUS_BUILDER,
        context,
        versionProbe.failure
      ),
    }
  }

  if (Option.isNone(versionProbe.success)) {
    return {
      kind: 'provider',
      provider: buildVersionTimeoutProvider(CLAUDE_STATUS_BUILDER, context),
    }
  }

  const version = versionProbe.success.value
  const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`)
  if (version.code !== 0) {
    return {
      kind: 'provider',
      provider: buildVersionCommandFailureProvider(
        CLAUDE_STATUS_BUILDER,
        context,
        parsedVersion,
        version
      ),
    }
  }

  return { kind: 'ok', parsedVersion }
})

type ClaudeCommandEffect = ReturnType<typeof runClaudeCommand>
type ClaudeCommandError =
  ClaudeCommandEffect extends Effect.Effect<unknown, infer E, unknown> ? E : never
type ClaudeAuthProbeResult = Result.Result<Option.Option<CommandResult>, ClaudeCommandError>

const resolveClaudeAuthSnapshot = Effect.fn('resolveClaudeAuthSnapshot')(function* (
  binaryPath: string,
  resolveSubscriptionType?: (binaryPath: string) => Effect.Effect<string | undefined>
): Effect.fn.Return<
  {
    readonly authProbe: ClaudeAuthProbeResult
    readonly subscriptionType: string | undefined
    readonly authMethod: string | undefined
  },
  ServerSettingsError,
  ChildProcessSpawner.ChildProcessSpawner | ServerSettingsService
> {
  const authProbe = yield* runClaudeCommand(['auth', 'status']).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result
  )

  let subscriptionType: string | undefined
  let authMethod: string | undefined

  if (Result.isSuccess(authProbe) && Option.isSome(authProbe.success)) {
    subscriptionType = extractSubscriptionTypeFromOutput(authProbe.success.value)
    authMethod = extractClaudeAuthMethodFromOutput(authProbe.success.value)
  }

  if (!subscriptionType && resolveSubscriptionType) {
    subscriptionType = yield* resolveSubscriptionType(binaryPath)
  }

  return { authProbe, subscriptionType, authMethod }
})

function resolveClaudeAuthProvider(input: {
  readonly authProbe: ClaudeAuthProbeResult
  readonly context: ClaudeProviderStatusContext
  readonly parsedVersion: string | null
  readonly resolvedModels: ReadonlyArray<ServerProviderModel>
  readonly authMethod: string | undefined
  readonly subscriptionType: string | undefined
}): ServerProvider {
  if (Result.isFailure(input.authProbe)) {
    return buildAuthProbeFailureProvider(CLAUDE_STATUS_BUILDER, {
      context: input.context,
      error: input.authProbe.failure,
      parsedVersion: input.parsedVersion,
      resolvedModels: input.resolvedModels,
    })
  }

  if (Option.isNone(input.authProbe.success)) {
    return buildAuthProbeTimeoutProvider(CLAUDE_STATUS_BUILDER, {
      context: input.context,
      parsedVersion: input.parsedVersion,
      resolvedModels: input.resolvedModels,
    })
  }

  const parsed = parseClaudeAuthStatusFromOutput(input.authProbe.success.value)
  return buildClaudeReadyProvider({
    authMethod: input.authMethod,
    context: input.context,
    parsed,
    parsedVersion: input.parsedVersion,
    resolvedModels: input.resolvedModels,
    subscriptionType: input.subscriptionType,
  })
}

export const checkClaudeProviderStatus = Effect.fn('checkClaudeProviderStatus')(function* (
  resolveSubscriptionType?: (binaryPath: string) => Effect.Effect<string | undefined>
): Effect.fn.Return<
  ServerProvider,
  ServerSettingsError,
  ChildProcessSpawner.ChildProcessSpawner | ServerSettingsService
> {
  const claudeSettings = yield* Effect.service(ServerSettingsService).pipe(
    Effect.flatMap(service => service.getSettings),
    Effect.map(settings => settings.providers.claudeAgent)
  )
  const context: ClaudeProviderStatusContext = {
    checkedAt: new Date().toISOString(),
    enabled: claudeSettings.enabled,
    models: providerModelsFromSettings(BUILT_IN_MODELS, PROVIDER, claudeSettings.customModels),
  }

  if (!claudeSettings.enabled) {
    return buildDisabledProvider(CLAUDE_STATUS_BUILDER, context)
  }

  const versionOutcome = yield* runClaudeVersionProbe(context)
  if (versionOutcome.kind === 'provider') {
    return versionOutcome.provider
  }
  const { parsedVersion } = versionOutcome

  // Determine subscription type from multiple sources (cheapest first):
  // 1. `claude auth status` JSON output (may or may not contain it)
  // 2. Cached SDK probe (spawns a Claude process on miss, reads
  //    `initializationResult()` for account metadata, then aborts
  //    immediately — no API tokens are consumed)
  const { authProbe, subscriptionType, authMethod } = yield* resolveClaudeAuthSnapshot(
    claudeSettings.binaryPath,
    resolveSubscriptionType
  )

  const resolvedModels = adjustModelsForSubscription(context.models, subscriptionType)

  return resolveClaudeAuthProvider({
    authProbe,
    context,
    parsedVersion,
    resolvedModels,
    authMethod,
    subscriptionType,
  })
})

export const ClaudeProviderLive = Layer.effect(
  ClaudeProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

    const subscriptionProbeCache = yield* Cache.make({
      capacity: 1,
      timeToLive: Duration.minutes(5),
      lookup: (binaryPath: string) =>
        probeClaudeCapabilities(binaryPath).pipe(Effect.map(r => r?.subscriptionType)),
    })

    const checkProvider = checkClaudeProviderStatus(binaryPath =>
      Cache.get(subscriptionProbeCache, binaryPath)
    ).pipe(
      Effect.provideService(ServerSettingsService, serverSettings),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
    )

    return yield* makeManagedServerProvider<ClaudeSettings>({
      getSettings: serverSettings.getSettings.pipe(
        Effect.map(settings => settings.providers.claudeAgent),
        Effect.orDie
      ),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map(settings => settings.providers.claudeAgent)
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      checkProvider,
    })
  })
)
