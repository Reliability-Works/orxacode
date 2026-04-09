import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, it, assert } from '@effect/vitest'
import { Cache, Cause, Duration, Effect, Fiber, Layer, Ref } from 'effect'
import { TestClock } from 'effect/testing'

import { checkOpencodeProviderStatus } from './OpencodeProvider'
import type { DiscoverOpencodeProvidersResult } from '../opencodeDiscovery'
import { ServerSettingsService } from '../../serverSettings'
import { failingSpawnerLayer, mockSpawnerLayer } from './ProviderRegistry.test.helpers.ts'

const VERSION_OK = { stdout: 'opencode 1.0.0\n', stderr: '', code: 0 }

const baseLayer = Layer.mergeAll(NodeServices.layer, ServerSettingsService.layerTest())
const provideOpencodeLayer = (layer: unknown) =>
  Effect.provide(Layer.mergeAll(baseLayer, layer as never))

const versionOkSpawnerLayer = () =>
  mockSpawnerLayer(args => {
    const joined = args.join(' ')
    if (joined === '--version') return VERSION_OK
    throw new Error(`Unexpected args: ${joined}`)
  })

const emptyDiscovery: DiscoverOpencodeProvidersResult = {
  configuredProviderIds: [],
  models: [],
}

const resolveDiscoverySuccess = (discovery: DiscoverOpencodeProvidersResult) => () =>
  Effect.succeed(discovery)

const resolveDiscoveryFail = (message: string) => () =>
  Effect.fail(new Cause.UnknownError(new Error(message), `opencode discovery failed: ${message}`))

const resolveDiscoveryNeverSettles = (): Effect.Effect<
  DiscoverOpencodeProvidersResult,
  Cause.UnknownError
> =>
  Effect.sleep(Duration.hours(1)).pipe(Effect.map(() => emptyDiscovery)) as Effect.Effect<
    DiscoverOpencodeProvidersResult,
    Cause.UnknownError
  >

describe('checkOpencodeProviderStatus disabled and missing-binary paths', () => {
  it.effect('returns disabled when opencode is disabled in settings', () =>
    Effect.gen(function* () {
      const status = yield* checkOpencodeProviderStatus()
      assert.strictEqual(status.provider, 'opencode')
      assert.strictEqual(status.status, 'disabled')
      assert.strictEqual(status.installed, false)
      assert.strictEqual(status.message, 'Opencode is disabled in Orxa Code settings.')
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          ServerSettingsService.layerTest({
            providers: { opencode: { enabled: false } },
          }),
          versionOkSpawnerLayer()
        )
      )
    )
  )

  it.effect('returns missing-binary error when opencode is not installed', () =>
    checkOpencodeProviderStatus().pipe(
      provideOpencodeLayer(failingSpawnerLayer('spawn opencode ENOENT')),
      Effect.tap(status =>
        Effect.sync(() => {
          assert.strictEqual(status.status, 'error')
          assert.strictEqual(status.installed, false)
          assert.strictEqual(
            status.message,
            'Opencode CLI (`opencode`) is not installed or not on PATH.'
          )
        })
      )
    )
  )
})

describe('checkOpencodeProviderStatus version probe failures', () => {
  it.effect('returns error when the opencode version command exits non-zero', () =>
    checkOpencodeProviderStatus().pipe(
      provideOpencodeLayer(
        mockSpawnerLayer(args => {
          if (args.join(' ') === '--version') {
            return { stdout: '', stderr: 'boom', code: 2 }
          }
          throw new Error(`Unexpected args: ${args.join(' ')}`)
        })
      ),
      Effect.tap(status =>
        Effect.sync(() => {
          assert.strictEqual(status.status, 'error')
          assert.strictEqual(status.installed, true)
          assert.ok(status.message?.includes('Opencode CLI is installed but failed to run'))
        })
      )
    )
  )
})

describe('checkOpencodeProviderStatus auth probe outcomes', () => {
  it.effect('returns ready with discovered providers + models when discovery succeeds', () =>
    Effect.gen(function* () {
      const discovery: DiscoverOpencodeProvidersResult = {
        configuredProviderIds: ['anthropic', 'openai'],
        models: [
          {
            id: 'anthropic/claude-sonnet-4-5',
            providerId: 'anthropic',
            displayName: 'Claude Sonnet 4.5',
            supportsReasoning: true,
            variants: ['reasoning', 'turbo'],
          },
          {
            id: 'openai/gpt-5',
            providerId: 'openai',
            displayName: 'GPT-5',
            supportsReasoning: false,
            variants: [],
          },
        ],
      }
      const status = yield* checkOpencodeProviderStatus({
        resolveDiscovery: resolveDiscoverySuccess(discovery),
      })
      assert.strictEqual(status.provider, 'opencode')
      assert.strictEqual(status.status, 'ready')
      assert.strictEqual(status.installed, true)
      assert.strictEqual(status.auth.status, 'authenticated')
      assert.deepStrictEqual(status.auth.configuredProviders, ['anthropic', 'openai'])
      const slugs = status.models.map(model => model.slug)
      assert.deepStrictEqual(slugs, ['anthropic/claude-sonnet-4-5', 'openai/gpt-5'])
      const reasoningFlags = status.models.map(model => model.supportsReasoning)
      assert.deepStrictEqual(reasoningFlags, [true, false])
      const sonnet = status.models.find(model => model.slug === 'anthropic/claude-sonnet-4-5')
      const gpt5 = status.models.find(model => model.slug === 'openai/gpt-5')
      assert.deepStrictEqual(sonnet?.variants, ['reasoning', 'turbo'])
      assert.strictEqual(gpt5?.variants, undefined)
    }).pipe(provideOpencodeLayer(versionOkSpawnerLayer()))
  )

  it.effect('returns unauthenticated when discovery returns zero providers', () =>
    Effect.gen(function* () {
      const status = yield* checkOpencodeProviderStatus({
        resolveDiscovery: resolveDiscoverySuccess(emptyDiscovery),
      })
      assert.strictEqual(status.status, 'error')
      assert.strictEqual(status.auth.status, 'unauthenticated')
      assert.deepStrictEqual(status.auth.configuredProviders, [])
      assert.deepStrictEqual(status.models, [])
      assert.strictEqual(
        status.message,
        'Opencode has no LLM providers configured. Run `opencode auth login` to add one.'
      )
    }).pipe(provideOpencodeLayer(versionOkSpawnerLayer()))
  )
})

describe('checkOpencodeProviderStatus auth probe warnings', () => {
  it.effect('returns warning when discovery fails', () =>
    Effect.gen(function* () {
      const status = yield* checkOpencodeProviderStatus({
        resolveDiscovery: resolveDiscoveryFail('serve crashed'),
      })
      assert.strictEqual(status.status, 'warning')
      assert.strictEqual(status.auth.status, 'unknown')
      assert.ok(status.message?.includes('Could not verify Opencode provider configuration'))
    }).pipe(provideOpencodeLayer(versionOkSpawnerLayer()))
  )

  it.effect('returns warning when discovery times out', () =>
    Effect.gen(function* () {
      const fiber = yield* checkOpencodeProviderStatus({
        resolveDiscovery: resolveDiscoveryNeverSettles,
        authProbeTimeoutMs: 20,
      }).pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      yield* TestClock.adjust(Duration.millis(100))
      const status = yield* Fiber.join(fiber)
      assert.strictEqual(status.status, 'warning')
      assert.strictEqual(status.auth.status, 'unknown')
      assert.ok(status.message?.includes('Could not verify Opencode provider configuration'))
    }).pipe(provideOpencodeLayer(versionOkSpawnerLayer()), Effect.provide(TestClock.layer()))
  )

  it.effect('surfaces a model with capabilities.reasoning = true via supportsReasoning', () =>
    Effect.gen(function* () {
      const discovery: DiscoverOpencodeProvidersResult = {
        configuredProviderIds: ['openai'],
        models: [
          {
            id: 'openai/o4-reasoner',
            providerId: 'openai',
            displayName: 'OpenAI Reasoner',
            supportsReasoning: true,
            variants: [],
          },
        ],
      }
      const status = yield* checkOpencodeProviderStatus({
        resolveDiscovery: resolveDiscoverySuccess(discovery),
      })
      assert.strictEqual(status.models.length, 1)
      assert.strictEqual(status.models[0]?.supportsReasoning, true)
    }).pipe(provideOpencodeLayer(versionOkSpawnerLayer()))
  )
})

describe('checkOpencodeProviderStatus caching', () => {
  it.effect('caches the discovery probe across consecutive snapshots within the TTL', () =>
    Effect.gen(function* () {
      const callCount = yield* Ref.make(0)
      const lookup = (binaryPath: string) =>
        Ref.update(callCount, n => n + 1).pipe(
          Effect.as<DiscoverOpencodeProvidersResult>({
            configuredProviderIds: [`called-for-${binaryPath}`],
            models: [],
          })
        )
      const cache = yield* Cache.make({
        capacity: 4,
        timeToLive: Duration.minutes(5),
        lookup,
      })
      const resolve = (input: { readonly binaryPath: string }) =>
        Cache.get(cache, input.binaryPath) as Effect.Effect<
          DiscoverOpencodeProvidersResult,
          Cause.UnknownError
        >

      const first = yield* checkOpencodeProviderStatus({
        resolveDiscovery: resolve,
      })
      const second = yield* checkOpencodeProviderStatus({
        resolveDiscovery: resolve,
      })

      assert.strictEqual(first.status, 'ready')
      assert.strictEqual(second.status, 'ready')
      assert.deepStrictEqual(first.auth.configuredProviders, second.auth.configuredProviders)

      const calls = yield* Ref.get(callCount)
      assert.strictEqual(calls, 1)
    }).pipe(provideOpencodeLayer(versionOkSpawnerLayer()))
  )
})
