import type { CodexSettings, ServerProvider, ServerProviderModel } from '@orxa-code/contracts'
import { Effect, FileSystem, Option, Path, Result } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'

import {
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
} from '../providerSnapshot'
import {
  buildAuthProbeFailureProvider,
  buildAuthProbeTimeoutProvider,
  buildDisabledProvider,
  buildProviderReadyProvider,
  buildVersionCommandFailureProvider,
  buildVersionProbeFailureProvider,
  buildVersionTimeoutProvider,
  type ProviderStatusBuilder,
  type ProviderStatusContext,
} from './Provider.shared'
import {
  formatCodexCliUpgradeMessage,
  isCodexCliVersionSupported,
  parseCodexCliVersion,
} from '../codexCliVersion'
import { adjustCodexModelsForAccount, codexAuthSubLabel, codexAuthSubType } from '../codexAccount'
import { ServerSettingsService } from '../../serverSettings'
import { ServerSettingsError } from '@orxa-code/contracts'
import {
  BUILT_IN_CODEX_MODELS,
  hasCustomModelProvider,
  parseAuthStatusFromOutput,
  type CodexAccountSnapshot,
} from './CodexProvider.metadata'

export {
  getCodexModelCapabilities,
  hasCustomModelProvider,
  parseAuthStatusFromOutput,
  readCodexConfigModelProvider,
} from './CodexProvider.metadata'
export { CodexProviderLive } from './CodexProvider.live'

const PROVIDER = 'codex' as const

const CODEX_STATUS_BUILDER: ProviderStatusBuilder = {
  provider: PROVIDER,
  disabledMessage: 'Codex is disabled in Orxa Code settings.',
  missingBinaryMessage: 'Codex CLI (`codex`) is not installed or not on PATH.',
  versionFailureMessagePrefix: 'Failed to execute Codex CLI health check',
  versionTimeoutMessage:
    'Codex CLI is installed but failed to run. Timed out while running command.',
  versionCommandFailureBaseMessage: 'Codex CLI is installed but failed to run.',
  authProbeFailurePrefix: 'Could not verify Codex authentication status',
  authProbeFailureFallback: 'Could not verify Codex authentication status.',
  authProbeTimeoutMessage:
    'Could not verify Codex authentication status. Timed out while running command.',
}

const runCodexCommand = Effect.fn('runCodexCommand')(function* (args: ReadonlyArray<string>) {
  const settingsService = yield* ServerSettingsService
  const codexSettings = yield* settingsService.getSettings.pipe(
    Effect.map(settings => settings.providers.codex)
  )
  const command = ChildProcess.make(codexSettings.binaryPath, [...args], {
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      ...(codexSettings.homePath ? { CODEX_HOME: codexSettings.homePath } : {}),
    },
  })
  return yield* spawnAndCollect(codexSettings.binaryPath, command)
})

type CodexProviderStatusContext = ProviderStatusContext

function loadCodexProviderStatusContext(codexSettings: CodexSettings): CodexProviderStatusContext {
  return {
    checkedAt: new Date().toISOString(),
    enabled: codexSettings.enabled,
    models: providerModelsFromSettings(
      BUILT_IN_CODEX_MODELS,
      PROVIDER,
      codexSettings.customModels,
      {
        supportsReasoning: true,
      }
    ),
  }
}

function resolveCodexAccountState(input: {
  codexSettings: CodexSettings
  context: CodexProviderStatusContext
  resolveAccount?: (input: {
    readonly binaryPath: string
    readonly homePath?: string
  }) => Effect.Effect<CodexAccountSnapshot | undefined>
}) {
  return Effect.gen(function* () {
    const account = input.resolveAccount
      ? yield* input.resolveAccount({
          binaryPath: input.codexSettings.binaryPath,
          homePath: input.codexSettings.homePath,
        })
      : undefined
    return {
      account,
      resolvedModels: adjustCodexModelsForAccount(input.context.models, account),
    }
  })
}

function buildCodexInstalledStatusProvider(input: {
  context: CodexProviderStatusContext
  parsedVersion: string | null
  status: 'error' | 'ready'
  message: string
}): ServerProvider {
  return buildServerProvider({
    provider: PROVIDER,
    enabled: input.context.enabled,
    checkedAt: input.context.checkedAt,
    models: input.context.models,
    probe: {
      installed: true,
      version: input.parsedVersion,
      status: input.status,
      auth: { status: 'unknown' },
      message: input.message,
    },
  })
}

function buildCodexUnsupportedVersionProvider(input: {
  context: CodexProviderStatusContext
  parsedVersion: string
}): ServerProvider {
  return buildCodexInstalledStatusProvider({
    context: input.context,
    parsedVersion: input.parsedVersion,
    status: 'error',
    message: formatCodexCliUpgradeMessage(input.parsedVersion),
  })
}

function buildCodexCustomProviderStatus(input: {
  context: CodexProviderStatusContext
  parsedVersion: string | null
}): ServerProvider {
  return buildCodexInstalledStatusProvider({
    context: input.context,
    parsedVersion: input.parsedVersion,
    status: 'ready',
    message: 'Using a custom Codex model provider; OpenAI login check skipped.',
  })
}

function buildCodexReadyProvider(input: {
  account: CodexAccountSnapshot | undefined
  context: CodexProviderStatusContext
  parsed: ReturnType<typeof parseAuthStatusFromOutput>
  parsedVersion: string | null
  resolvedModels: ReadonlyArray<ServerProviderModel>
}): ServerProvider {
  const authType = codexAuthSubType(input.account)
  const authLabel = codexAuthSubLabel(input.account)
  const authExtras: Record<string, string> = {
    ...(authType ? { type: authType } : {}),
    ...(authLabel ? { label: authLabel } : {}),
  }
  return buildProviderReadyProvider(CODEX_STATUS_BUILDER, {
    context: input.context,
    parsed: input.parsed,
    parsedVersion: input.parsedVersion,
    resolvedModels: input.resolvedModels,
    authExtras,
  })
}

export const checkCodexProviderStatus = Effect.fn('checkCodexProviderStatus')(function* (
  resolveAccount?: (input: {
    readonly binaryPath: string
    readonly homePath?: string
  }) => Effect.Effect<CodexAccountSnapshot | undefined>
): Effect.fn.Return<
  ServerProvider,
  ServerSettingsError,
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | ServerSettingsService
> {
  const codexSettings = yield* Effect.service(ServerSettingsService).pipe(
    Effect.flatMap(service => service.getSettings),
    Effect.map(settings => settings.providers.codex)
  )
  const context = loadCodexProviderStatusContext(codexSettings)

  if (!codexSettings.enabled) {
    return buildDisabledProvider(CODEX_STATUS_BUILDER, context)
  }

  const versionProbe = yield* runCodexCommand(['--version']).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result
  )

  if (Result.isFailure(versionProbe)) {
    return buildVersionProbeFailureProvider(CODEX_STATUS_BUILDER, context, versionProbe.failure)
  }

  if (Option.isNone(versionProbe.success)) {
    return buildVersionTimeoutProvider(CODEX_STATUS_BUILDER, context)
  }

  const version = versionProbe.success.value
  const parsedVersion =
    parseCodexCliVersion(`${version.stdout}\n${version.stderr}`) ??
    parseGenericCliVersion(`${version.stdout}\n${version.stderr}`)
  if (version.code !== 0) {
    return buildVersionCommandFailureProvider(CODEX_STATUS_BUILDER, context, parsedVersion, version)
  }

  if (parsedVersion && !isCodexCliVersionSupported(parsedVersion)) {
    return buildCodexUnsupportedVersionProvider({ context, parsedVersion })
  }

  if (yield* hasCustomModelProvider) {
    return buildCodexCustomProviderStatus({ context, parsedVersion })
  }

  const authProbe = yield* runCodexCommand(['login', 'status']).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result
  )
  const { account, resolvedModels } = yield* resolveCodexAccountState({
    codexSettings,
    context,
    ...(resolveAccount ? { resolveAccount } : {}),
  })

  if (Result.isFailure(authProbe)) {
    return buildAuthProbeFailureProvider(CODEX_STATUS_BUILDER, {
      context,
      error: authProbe.failure,
      parsedVersion,
      resolvedModels,
    })
  }

  if (Option.isNone(authProbe.success)) {
    return buildAuthProbeTimeoutProvider(CODEX_STATUS_BUILDER, {
      context,
      parsedVersion,
      resolvedModels,
    })
  }

  const parsed = parseAuthStatusFromOutput(authProbe.success.value)
  return buildCodexReadyProvider({ account, context, parsed, parsedVersion, resolvedModels })
})
