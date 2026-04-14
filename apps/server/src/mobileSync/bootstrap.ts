import type {
  OrchestrationReadModel,
  ServerConfig as ContractServerConfig,
} from '@orxa-code/contracts'
import { Effect } from 'effect'

import { ServerConfig } from '../config'
import { Keybindings } from '../keybindings'
import { resolveAvailableEditors } from '../open'
import { OrchestrationEngineService } from '../orchestration/Services/OrchestrationEngine'
import { ProviderRegistry } from '../provider/Services/ProviderRegistry'
import { ServerSettingsService } from '../serverSettings'

export type MobileSyncBootstrapResult = {
  readonly config: ContractServerConfig
  readonly readModel: OrchestrationReadModel
}

export function loadServerConfigSnapshot() {
  return Effect.gen(function* () {
    const config = yield* ServerConfig
    const keybindings = yield* Keybindings
    const providerRegistry = yield* ProviderRegistry
    const serverSettings = yield* ServerSettingsService

    const [keybindingsConfig, providers, settings] = yield* Effect.all([
      keybindings.loadConfigState,
      providerRegistry.getProviders,
      serverSettings.getSettings,
    ])

    return {
      cwd: config.cwd,
      keybindingsConfigPath: config.keybindingsConfigPath,
      keybindings: keybindingsConfig.keybindings,
      issues: keybindingsConfig.issues,
      providers,
      availableEditors: resolveAvailableEditors(),
      settings,
    } satisfies ContractServerConfig
  })
}

export function loadMobileSyncBootstrap() {
  return Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngineService
    const [config, readModel] = yield* Effect.all([
      loadServerConfigSnapshot(),
      orchestrationEngine.getReadModel(),
    ])

    return {
      config,
      readModel,
    } satisfies MobileSyncBootstrapResult
  })
}
