import type {
  OpencodeSettings,
  ServerProvider,
  ServerProviderAuth,
  ServerProviderModel,
} from '@orxa-code/contracts'
import { ServerSettingsError } from '@orxa-code/contracts'
import { Cache, Cause, Duration, Effect, Equal, Layer, Option, Result, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'
import { normalizeModelSlug } from '@orxa-code/shared/model'

import { makeManagedServerProvider } from '../makeManagedServerProvider'
import { DEFAULT_TIMEOUT_MS, buildServerProvider, spawnAndCollect } from '../providerSnapshot'
import {
  discoverOpencodeProviders,
  type DiscoverOpencodeProvidersResult,
} from '../opencodeDiscovery'
import { ServerSettingsService } from '../../serverSettings'
import { OpencodeProvider } from '../Services/OpencodeProvider'
import {
  buildAuthProbeFailureProvider,
  buildAuthProbeTimeoutProvider,
  buildDisabledProvider,
  buildProviderReadyProvider,
  runProviderVersionProbe,
  type ProviderStatusBuilder,
  type ProviderStatusContext,
  type VersionProbeOutcome,
} from './Provider.shared'

const PROVIDER = 'opencode' as const

const OPENCODE_AUTH_PROBE_CACHE_TTL = Duration.minutes(5)
const OPENCODE_AUTH_PROBE_TIMEOUT_MS = 20_000

const OPENCODE_UNAUTHENTICATED_MESSAGE =
  'Opencode has no LLM providers configured. Run `opencode auth login` to add one.'

const OPENCODE_STATUS_BUILDER: ProviderStatusBuilder = {
  provider: PROVIDER,
  disabledMessage: 'Opencode is disabled in Orxa Code settings.',
  missingBinaryMessage: 'Opencode CLI (`opencode`) is not installed or not on PATH.',
  versionFailureMessagePrefix: 'Failed to execute Opencode CLI health check',
  versionTimeoutMessage:
    'Opencode CLI is installed but failed to run. Timed out while running command.',
  versionCommandFailureBaseMessage: 'Opencode CLI is installed but failed to run.',
  authProbeFailurePrefix: 'Could not verify Opencode provider configuration',
  authProbeFailureFallback: 'Could not verify Opencode provider configuration.',
  authProbeTimeoutMessage:
    'Could not verify Opencode provider configuration. Timed out while probing `opencode serve`.',
}

const runOpencodeCommand = Effect.fn('runOpencodeCommand')(function* (args: ReadonlyArray<string>) {
  const settingsService = yield* ServerSettingsService
  const opencodeSettings = yield* settingsService.getSettings.pipe(
    Effect.map(settings => settings.providers.opencode)
  )
  const command = ChildProcess.make(opencodeSettings.binaryPath, [...args], {
    shell: process.platform === 'win32',
  })
  return yield* spawnAndCollect(opencodeSettings.binaryPath, command)
})

type OpencodeProviderStatusContext = ProviderStatusContext

function loadOpencodeProviderStatusContext(
  opencodeSettings: OpencodeSettings
): OpencodeProviderStatusContext {
  return {
    checkedAt: new Date().toISOString(),
    enabled: opencodeSettings.enabled,
    // Models are resolved dynamically from the auth-probe discovery result;
    // settings.customModels are merged in once we know which discovered slugs
    // exist (see `mergeDiscoveredAndCustomModels`).
    models: [],
  }
}

function withConfiguredProviders(
  provider: ServerProvider,
  configuredProviders: ReadonlyArray<string>
): ServerProvider {
  const auth: ServerProviderAuth = {
    ...provider.auth,
    configuredProviders,
  }
  return { ...provider, auth }
}

function discoveredModelsToServerModels(
  discovery: DiscoverOpencodeProvidersResult
): ReadonlyArray<ServerProviderModel> {
  return discovery.models.map(model => ({
    slug: model.id,
    name: model.displayName,
    isCustom: false,
    capabilities: null,
    supportsReasoning: model.supportsReasoning,
    ...(model.variants.length > 0 ? { variants: model.variants } : {}),
  }))
}

function mergeDiscoveredAndCustomModels(input: {
  readonly discovered: ReadonlyArray<ServerProviderModel>
  readonly customModels: ReadonlyArray<string>
}): ReadonlyArray<ServerProviderModel> {
  const seen = new Set(input.discovered.map(model => model.slug))
  const customEntries: Array<ServerProviderModel> = []
  for (const candidate of input.customModels) {
    const normalized = normalizeModelSlug(candidate, PROVIDER)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    customEntries.push({
      slug: normalized,
      name: normalized,
      isCustom: true,
      capabilities: null,
    })
  }
  return [...input.discovered, ...customEntries]
}

function buildOpencodeUnauthenticatedProvider(input: {
  readonly context: OpencodeProviderStatusContext
  readonly parsedVersion: string | null
  readonly resolvedModels: ReadonlyArray<ServerProviderModel>
  readonly configuredProviders: ReadonlyArray<string>
}): ServerProvider {
  const base = buildServerProvider({
    provider: PROVIDER,
    enabled: input.context.enabled,
    checkedAt: input.context.checkedAt,
    models: input.resolvedModels,
    probe: {
      installed: true,
      version: input.parsedVersion,
      status: 'error',
      auth: { status: 'unauthenticated' },
      message: OPENCODE_UNAUTHENTICATED_MESSAGE,
    },
  })
  return withConfiguredProviders(base, input.configuredProviders)
}

/**
 * Resolve opencode's runtime discovery surface — the cross-verified set of
 * configured nested LLM providers AND the models each one currently exposes.
 * Boots a short-lived `opencode serve` subprocess and calls
 * `client.config.providers()`, then intersects against `auth.json`. The
 * `Live` layer wraps it in a 5-minute `Cache.make` keyed by binaryPath.
 */
export type ResolveOpencodeDiscovery = (input: {
  readonly binaryPath: string
}) => Effect.Effect<DiscoverOpencodeProvidersResult, Cause.UnknownError>

function defaultResolveOpencodeDiscovery(input: {
  readonly binaryPath: string
}): Effect.Effect<DiscoverOpencodeProvidersResult, Cause.UnknownError> {
  return Effect.tryPromise(signal =>
    discoverOpencodeProviders({ binaryPath: input.binaryPath, signal })
  )
}

const runOpencodeVersionProbe = (
  context: OpencodeProviderStatusContext
): Effect.Effect<
  VersionProbeOutcome,
  never,
  ChildProcessSpawner.ChildProcessSpawner | ServerSettingsService
> =>
  runProviderVersionProbe({
    builder: OPENCODE_STATUS_BUILDER,
    context,
    runVersionCommand: runOpencodeCommand(['--version']),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  })

interface ResolveOpencodeAuthInput {
  readonly authProbe: Result.Result<
    Option.Option<DiscoverOpencodeProvidersResult>,
    Cause.UnknownError
  >
  readonly context: OpencodeProviderStatusContext
  readonly parsedVersion: string | null
  readonly customModels: ReadonlyArray<string>
}

function resolveOpencodeAuthProvider(input: ResolveOpencodeAuthInput): ServerProvider {
  if (Result.isFailure(input.authProbe)) {
    return buildAuthProbeFailureProvider(OPENCODE_STATUS_BUILDER, {
      context: input.context,
      error: input.authProbe.failure,
      parsedVersion: input.parsedVersion,
      resolvedModels: input.context.models,
    })
  }
  if (Option.isNone(input.authProbe.success)) {
    return buildAuthProbeTimeoutProvider(OPENCODE_STATUS_BUILDER, {
      context: input.context,
      parsedVersion: input.parsedVersion,
      resolvedModels: input.context.models,
    })
  }
  const discovery = input.authProbe.success.value
  const discoveredModels = discoveredModelsToServerModels(discovery)
  const resolvedModels = mergeDiscoveredAndCustomModels({
    discovered: discoveredModels,
    customModels: input.customModels,
  })
  if (discovery.configuredProviderIds.length === 0) {
    return buildOpencodeUnauthenticatedProvider({
      context: input.context,
      parsedVersion: input.parsedVersion,
      resolvedModels,
      configuredProviders: discovery.configuredProviderIds,
    })
  }
  const ready = buildProviderReadyProvider(OPENCODE_STATUS_BUILDER, {
    context: input.context,
    parsed: { status: 'ready', auth: { status: 'authenticated' } },
    parsedVersion: input.parsedVersion,
    resolvedModels,
  })
  return withConfiguredProviders(ready, discovery.configuredProviderIds)
}

export interface CheckOpencodeProviderStatusOptions {
  readonly resolveDiscovery?: ResolveOpencodeDiscovery | undefined
  readonly authProbeTimeoutMs?: number | undefined
}

export const checkOpencodeProviderStatus = Effect.fn('checkOpencodeProviderStatus')(function* (
  options?: CheckOpencodeProviderStatusOptions
): Effect.fn.Return<
  ServerProvider,
  ServerSettingsError,
  ChildProcessSpawner.ChildProcessSpawner | ServerSettingsService
> {
  const opencodeSettings = yield* Effect.service(ServerSettingsService).pipe(
    Effect.flatMap(service => service.getSettings),
    Effect.map(settings => settings.providers.opencode)
  )
  const context = loadOpencodeProviderStatusContext(opencodeSettings)

  if (!opencodeSettings.enabled) {
    return buildDisabledProvider(OPENCODE_STATUS_BUILDER, context)
  }

  const versionOutcome = yield* runOpencodeVersionProbe(context)
  if (versionOutcome.kind === 'provider') {
    return versionOutcome.provider
  }
  const { parsedVersion } = versionOutcome

  const resolve = options?.resolveDiscovery ?? defaultResolveOpencodeDiscovery
  const authProbeTimeoutMs = options?.authProbeTimeoutMs ?? OPENCODE_AUTH_PROBE_TIMEOUT_MS
  const authProbe = yield* resolve({ binaryPath: opencodeSettings.binaryPath }).pipe(
    Effect.timeoutOption(authProbeTimeoutMs),
    Effect.result
  )

  return resolveOpencodeAuthProvider({
    authProbe,
    context,
    parsedVersion,
    customModels: opencodeSettings.customModels,
  })
})

export const OpencodeProviderLive = Layer.effect(
  OpencodeProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

    const discoveryCache = yield* Cache.make({
      capacity: 4,
      timeToLive: OPENCODE_AUTH_PROBE_CACHE_TTL,
      lookup: (binaryPath: string) => defaultResolveOpencodeDiscovery({ binaryPath }),
    })

    const checkProvider = checkOpencodeProviderStatus({
      resolveDiscovery: input => Cache.get(discoveryCache, input.binaryPath),
    }).pipe(
      Effect.provideService(ServerSettingsService, serverSettings),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
    )

    return yield* makeManagedServerProvider<OpencodeSettings>({
      getSettings: serverSettings.getSettings.pipe(
        Effect.map(settings => settings.providers.opencode),
        Effect.orDie
      ),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map(settings => settings.providers.opencode)
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      checkProvider,
    })
  })
)
