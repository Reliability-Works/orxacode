import type {
  ServerProvider,
  ServerProviderAuth,
  ServerProviderModel,
  ServerProviderState,
} from '@orxa-code/contracts'
import { Effect, Option, Result } from 'effect'

import {
  DEFAULT_TIMEOUT_MS,
  buildServerProvider,
  detailFromResult,
  extractAuthBoolean,
  isCommandMissingCause,
  parseGenericCliVersion,
  type CommandResult,
} from '../providerSnapshot'

export type ProviderStatusContext = {
  checkedAt: string
  enabled: boolean
  models: ReadonlyArray<ServerProviderModel>
}

export type ProviderAuthParseResult = {
  readonly status: Exclude<ServerProviderState, 'disabled'>
  readonly auth: Pick<ServerProviderAuth, 'status'>
  readonly message?: string
}

export type ProviderAuthParseConfig = {
  readonly unavailableCommandMessage: string
  readonly notAuthenticatedMessage: string
  readonly missingAuthMarkerMessage: string
  readonly unverifiedAuthMessage: string
  readonly unverifiedAuthMessageWithDetail: (detail: string) => string
  readonly loginPromptPhrases: ReadonlyArray<string>
}

function tryParseAuthJson(stdout: string): {
  attemptedJsonParse: boolean
  auth: boolean | undefined
} {
  const trimmed = stdout.trim()
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return { attemptedJsonParse: false, auth: undefined }
  }
  try {
    return { attemptedJsonParse: true, auth: extractAuthBoolean(JSON.parse(trimmed)) }
  } catch {
    return { attemptedJsonParse: false, auth: undefined }
  }
}

export function parseProviderAuthStatusFromOutput(
  result: CommandResult,
  config: ProviderAuthParseConfig
): ProviderAuthParseResult {
  const lowerOutput = `${result.stdout}\n${result.stderr}`.toLowerCase()

  if (
    lowerOutput.includes('unknown command') ||
    lowerOutput.includes('unrecognized command') ||
    lowerOutput.includes('unexpected argument')
  ) {
    return {
      status: 'warning',
      auth: { status: 'unknown' },
      message: config.unavailableCommandMessage,
    }
  }

  if (
    lowerOutput.includes('not logged in') ||
    lowerOutput.includes('login required') ||
    lowerOutput.includes('authentication required') ||
    config.loginPromptPhrases.some(phrase => lowerOutput.includes(phrase))
  ) {
    return {
      status: 'error',
      auth: { status: 'unauthenticated' },
      message: config.notAuthenticatedMessage,
    }
  }

  const parsedAuth = tryParseAuthJson(result.stdout)

  if (parsedAuth.auth === true) {
    return { status: 'ready', auth: { status: 'authenticated' } }
  }
  if (parsedAuth.auth === false) {
    return {
      status: 'error',
      auth: { status: 'unauthenticated' },
      message: config.notAuthenticatedMessage,
    }
  }
  if (parsedAuth.attemptedJsonParse) {
    return {
      status: 'warning',
      auth: { status: 'unknown' },
      message: config.missingAuthMarkerMessage,
    }
  }
  if (result.code === 0) {
    return { status: 'ready', auth: { status: 'authenticated' } }
  }

  const detail = detailFromResult(result)
  return {
    status: 'warning',
    auth: { status: 'unknown' },
    message: detail ? config.unverifiedAuthMessageWithDetail(detail) : config.unverifiedAuthMessage,
  }
}

export type ProviderStatusBuilder = {
  readonly provider: ServerProvider['provider']
  readonly disabledMessage: string
  readonly missingBinaryMessage: string
  readonly versionFailureMessagePrefix: string
  readonly versionTimeoutMessage: string
  readonly versionCommandFailureBaseMessage: string
  readonly authProbeFailurePrefix: string
  readonly authProbeFailureFallback: string
  readonly authProbeTimeoutMessage: string
}

export function buildDisabledProvider(
  builder: ProviderStatusBuilder,
  context: ProviderStatusContext
): ServerProvider {
  return buildServerProvider({
    provider: builder.provider,
    enabled: false,
    checkedAt: context.checkedAt,
    models: context.models,
    probe: {
      installed: false,
      version: null,
      status: 'warning',
      auth: { status: 'unknown' },
      message: builder.disabledMessage,
    },
  })
}

export function buildVersionProbeFailureProvider(
  builder: ProviderStatusBuilder,
  context: ProviderStatusContext,
  error: unknown
): ServerProvider {
  return buildServerProvider({
    provider: builder.provider,
    enabled: context.enabled,
    checkedAt: context.checkedAt,
    models: context.models,
    probe: {
      installed: !isCommandMissingCause(error),
      version: null,
      status: 'error',
      auth: { status: 'unknown' },
      message: isCommandMissingCause(error)
        ? builder.missingBinaryMessage
        : `${builder.versionFailureMessagePrefix}: ${error instanceof Error ? error.message : String(error)}.`,
    },
  })
}

function buildInstalledFailureProvider(
  builder: ProviderStatusBuilder,
  context: ProviderStatusContext,
  options: {
    version: string | null
    status: 'error' | 'warning'
    message: string
    models?: ReadonlyArray<ServerProviderModel>
  }
): ServerProvider {
  return buildServerProvider({
    provider: builder.provider,
    enabled: context.enabled,
    checkedAt: context.checkedAt,
    models: options.models ?? context.models,
    probe: {
      installed: true,
      version: options.version,
      status: options.status,
      auth: { status: 'unknown' },
      message: options.message,
    },
  })
}

export function buildVersionTimeoutProvider(
  builder: ProviderStatusBuilder,
  context: ProviderStatusContext
): ServerProvider {
  return buildInstalledFailureProvider(builder, context, {
    version: null,
    status: 'error',
    message: builder.versionTimeoutMessage,
  })
}

export function buildVersionCommandFailureProvider(
  builder: ProviderStatusBuilder,
  context: ProviderStatusContext,
  parsedVersion: string | null,
  version: CommandResult
): ServerProvider {
  const detail = detailFromResult(version)
  return buildInstalledFailureProvider(builder, context, {
    version: parsedVersion,
    status: 'error',
    message: detail
      ? `${builder.versionCommandFailureBaseMessage} ${detail}`
      : builder.versionCommandFailureBaseMessage,
  })
}

export function buildAuthProbeFailureProvider(
  builder: ProviderStatusBuilder,
  input: {
    context: ProviderStatusContext
    error: unknown
    parsedVersion: string | null
    resolvedModels: ReadonlyArray<ServerProviderModel>
  }
): ServerProvider {
  return buildInstalledFailureProvider(builder, input.context, {
    version: input.parsedVersion,
    status: 'warning',
    models: input.resolvedModels,
    message:
      input.error instanceof Error
        ? `${builder.authProbeFailurePrefix}: ${input.error.message}.`
        : builder.authProbeFailureFallback,
  })
}

export function buildProviderReadyProvider(
  builder: ProviderStatusBuilder,
  input: {
    context: ProviderStatusContext
    parsed: ProviderAuthParseResult
    parsedVersion: string | null
    resolvedModels: ReadonlyArray<ServerProviderModel>
    authExtras?: Record<string, string>
  }
): ServerProvider {
  return buildServerProvider({
    provider: builder.provider,
    enabled: input.context.enabled,
    checkedAt: input.context.checkedAt,
    models: input.resolvedModels,
    probe: {
      installed: true,
      version: input.parsedVersion,
      status: input.parsed.status,
      auth: {
        ...input.parsed.auth,
        ...(input.authExtras ?? {}),
      },
      ...(input.parsed.message ? { message: input.parsed.message } : {}),
    },
  })
}

export type VersionProbeOutcome =
  | { readonly kind: 'provider'; readonly provider: ServerProvider }
  | { readonly kind: 'ok'; readonly parsedVersion: string | null }

/**
 * Run a provider's `--version` health-check command and translate the result
 * (failure / timeout / non-zero exit / success) into a `VersionProbeOutcome`.
 * Both Claude and Opencode use this so the version-probe ladder lives in one
 * place and jscpd does not flag the duplication.
 */
export const runProviderVersionProbe = <CommandError, CommandRequirements>(input: {
  readonly builder: ProviderStatusBuilder
  readonly context: ProviderStatusContext
  readonly runVersionCommand: Effect.Effect<CommandResult, CommandError, CommandRequirements>
  readonly timeoutMs?: number
}): Effect.Effect<VersionProbeOutcome, never, CommandRequirements> =>
  Effect.gen(function* () {
    const versionProbe = yield* input.runVersionCommand.pipe(
      Effect.timeoutOption(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      Effect.result
    )
    if (Result.isFailure(versionProbe)) {
      return {
        kind: 'provider',
        provider: buildVersionProbeFailureProvider(
          input.builder,
          input.context,
          versionProbe.failure
        ),
      } satisfies VersionProbeOutcome
    }
    if (Option.isNone(versionProbe.success)) {
      return {
        kind: 'provider',
        provider: buildVersionTimeoutProvider(input.builder, input.context),
      } satisfies VersionProbeOutcome
    }
    const version = versionProbe.success.value
    const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`)
    if (version.code !== 0) {
      return {
        kind: 'provider',
        provider: buildVersionCommandFailureProvider(
          input.builder,
          input.context,
          parsedVersion,
          version
        ),
      } satisfies VersionProbeOutcome
    }
    return { kind: 'ok', parsedVersion } satisfies VersionProbeOutcome
  })

export function buildAuthProbeTimeoutProvider(
  builder: ProviderStatusBuilder,
  input: {
    context: ProviderStatusContext
    parsedVersion: string | null
    resolvedModels: ReadonlyArray<ServerProviderModel>
  }
): ServerProvider {
  return buildInstalledFailureProvider(builder, input.context, {
    version: input.parsedVersion,
    status: 'warning',
    models: input.resolvedModels,
    message: builder.authProbeTimeoutMessage,
  })
}
