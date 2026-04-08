import { Effect, Layer } from 'effect'
import { it, assert } from '@effect/vitest'
import * as NodeServices from '@effect/platform-node/NodeServices'

import { ProviderValidationError, ProviderUnsupportedError } from '../Errors.ts'
import { ProviderAdapterRegistry } from '../Services/ProviderAdapterRegistry.ts'
import { ProviderService } from '../Services/ProviderService.ts'
import { makeProviderServiceLive } from './ProviderService.ts'
import { AnalyticsService } from '../../telemetry/Services/AnalyticsService.ts'
import { ServerSettingsService } from '../../serverSettings.ts'
import {
  asThreadId,
  makeFakeCodexAdapter,
  makeTempPersistenceHarness,
} from './ProviderService.test.helpers.ts'

it.effect('ProviderServiceLive rejects new sessions for disabled providers', () =>
  Effect.gen(function* () {
    const codex = makeFakeCodexAdapter()
    const claude = makeFakeCodexAdapter('claudeAgent')
    const registry: typeof ProviderAdapterRegistry.Service = {
      getByProvider: provider =>
        provider === 'codex'
          ? Effect.succeed(codex.adapter)
          : provider === 'claudeAgent'
            ? Effect.succeed(claude.adapter)
            : Effect.fail(new ProviderUnsupportedError({ provider })),
      listProviders: () => Effect.succeed(['codex', 'claudeAgent']),
    }
    const harness = makeTempPersistenceHarness('orxa-provider-service-disabled-')
    const serverSettingsLayer = ServerSettingsService.layerTest({
      providers: {
        claudeAgent: {
          enabled: false,
        },
      },
    })
    const providerLayer = makeProviderServiceLive().pipe(
      Layer.provide(Layer.succeed(ProviderAdapterRegistry, registry)),
      Layer.provide(harness.directoryLayer),
      Layer.provide(serverSettingsLayer),
      Layer.provide(AnalyticsService.layerTest)
    )

    const failure = yield* Effect.flip(
      Effect.gen(function* () {
        const provider = yield* ProviderService
        return yield* provider.startSession(asThreadId('thread-disabled'), {
          provider: 'claudeAgent',
          threadId: asThreadId('thread-disabled'),
          runtimeMode: 'full-access',
        })
      }).pipe(Effect.provide(providerLayer))
    )

    assert.instanceOf(failure, ProviderValidationError)
    assert.include(failure.issue, "Provider 'claudeAgent' is disabled in Orxa Code settings.")
    assert.equal(claude.startSession.mock.calls.length, 0)
    harness.cleanup()
  }).pipe(Effect.provide(NodeServices.layer))
)
