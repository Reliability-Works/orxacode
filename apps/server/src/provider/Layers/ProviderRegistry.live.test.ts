import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, it, assert } from '@effect/vitest'
import { Effect, Exit, Layer, Scope } from 'effect'
import type { ServerProvider } from '@orxa-code/contracts'

import { checkCodexProviderStatus } from './CodexProvider'
import { haveProvidersChanged, ProviderRegistryLive } from './ProviderRegistry'
import { ServerSettingsService } from '../../serverSettings'
import { ProviderRegistry } from '../Services/ProviderRegistry'
import {
  failingSpawnerLayer,
  makeMutableServerSettingsService,
  mockCommandSpawnerLayer,
  waitForProviderStatus,
} from './ProviderRegistry.test.helpers.ts'

function sampleProviders(): ReadonlyArray<ServerProvider> {
  return [
    {
      provider: 'codex',
      status: 'ready',
      enabled: true,
      installed: true,
      auth: { status: 'authenticated' },
      checkedAt: '2026-03-25T00:00:00.000Z',
      version: '1.0.0',
      models: [],
    },
    {
      provider: 'claudeAgent',
      status: 'warning',
      enabled: true,
      installed: true,
      auth: { status: 'unknown' },
      checkedAt: '2026-03-25T00:00:00.000Z',
      version: '1.0.0',
      models: [],
    },
  ] as const
}

describe('haveProvidersChanged', () => {
  it('treats equal provider snapshots as unchanged', () => {
    const providers = sampleProviders()
    assert.strictEqual(haveProvidersChanged(providers, [...providers]), false)
  })
})

describe('ProviderRegistryLive settings reactions', () => {
  it.effect('reruns codex health when codex provider settings change', () =>
    Effect.gen(function* () {
      const serverSettings = yield* makeMutableServerSettingsService()
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const providerRegistryLayer = ProviderRegistryLive.pipe(
        Layer.provideMerge(Layer.succeed(ServerSettingsService, serverSettings)),
        Layer.provideMerge(
          mockCommandSpawnerLayer((command, args) => {
            const joined = args.join(' ')
            if (joined === '--version') {
              if (command === 'codex') {
                return { stdout: 'codex 1.0.0\n', stderr: '', code: 0 }
              }
              return { stdout: '', stderr: 'spawn ENOENT', code: 1 }
            }
            if (joined === 'login status') {
              return { stdout: 'Logged in\n', stderr: '', code: 0 }
            }
            throw new Error(`Unexpected args: ${joined}`)
          })
        )
      )
      const runtimeServices = yield* Layer.build(
        Layer.mergeAll(Layer.succeed(ServerSettingsService, serverSettings), providerRegistryLayer)
      ).pipe(Scope.provide(scope))

      yield* Effect.gen(function* () {
        const registry = yield* ProviderRegistry

        const initial = yield* registry.getProviders
        assert.strictEqual(initial.find(status => status.provider === 'codex')?.status, 'ready')

        yield* serverSettings.updateSettings({
          providers: {
            codex: {
              binaryPath: '/custom/codex',
            },
          },
        })

        const updated = yield* waitForProviderStatus(registry.getProviders, 'codex', 'error')
        assert.strictEqual(updated.find(status => status.provider === 'codex')?.status, 'error')
      }).pipe(Effect.provide(runtimeServices))
    }).pipe(Effect.provide(NodeServices.layer))
  )
})

describe('checkCodexProviderStatus disabled provider handling', () => {
  it.effect('skips codex probes entirely when the provider is disabled', () =>
    Effect.gen(function* () {
      const serverSettingsLayer = ServerSettingsService.layerTest({
        providers: {
          codex: {
            enabled: false,
          },
        },
      })

      const status = yield* checkCodexProviderStatus().pipe(
        Effect.provide(
          Layer.mergeAll(serverSettingsLayer, failingSpawnerLayer('spawn codex ENOENT'))
        )
      )
      assert.strictEqual(status.provider, 'codex')
      assert.strictEqual(status.enabled, false)
      assert.strictEqual(status.status, 'disabled')
      assert.strictEqual(status.installed, false)
      assert.strictEqual(status.message, 'Codex is disabled in Orxa Code settings.')
    }).pipe(Effect.provide(NodeServices.layer))
  )
})
