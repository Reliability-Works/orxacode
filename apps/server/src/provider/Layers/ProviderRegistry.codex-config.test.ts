import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, it, assert } from '@effect/vitest'
import { Effect, Layer } from 'effect'

import {
  checkCodexProviderStatus,
  hasCustomModelProvider,
  readCodexConfigModelProvider,
} from './CodexProvider'
import { ServerSettingsService } from '../../serverSettings'
import {
  failingSpawnerLayer,
  mockSpawnerLayer,
  withTempCodexHome,
} from './ProviderRegistry.test.helpers.ts'

const baseLayer = Layer.mergeAll(NodeServices.layer, ServerSettingsService.layerTest())
const provideCodexLayer = (layer: unknown) =>
  Effect.provide(Layer.mergeAll(baseLayer, layer as never))

describe('checkCodexProviderStatus with custom model providers', () => {
  it.effect('skips auth probe and returns ready when a custom model provider is configured', () =>
    Effect.gen(function* () {
      yield* withTempCodexHome(
        [
          'model_provider = "portkey"',
          '',
          '[model_providers.portkey]',
          'base_url = "https://api.portkey.ai/v1"',
          'env_key = "PORTKEY_API_KEY"',
        ].join('\n')
      )
      const status = yield* checkCodexProviderStatus()
      assert.strictEqual(status.status, 'ready')
      assert.strictEqual(status.auth.status, 'unknown')
      assert.strictEqual(
        status.message,
        'Using a custom Codex model provider; OpenAI login check skipped.'
      )
    }).pipe(
      provideCodexLayer(
        mockSpawnerLayer(args => {
          const joined = args.join(' ')
          if (joined === '--version') return { stdout: 'codex 1.0.0\n', stderr: '', code: 0 }
          throw new Error(`Auth probe should have been skipped but got args: ${joined}`)
        })
      )
    )
  )

  it.effect('still reports error when codex CLI is missing even with custom provider', () =>
    Effect.gen(function* () {
      yield* withTempCodexHome(
        [
          'model_provider = "portkey"',
          '',
          '[model_providers.portkey]',
          'base_url = "https://api.portkey.ai/v1"',
          'env_key = "PORTKEY_API_KEY"',
        ].join('\n')
      )
      const status = yield* checkCodexProviderStatus()
      assert.strictEqual(status.status, 'error')
      assert.strictEqual(status.installed, false)
    }).pipe(provideCodexLayer(failingSpawnerLayer('spawn codex ENOENT')))
  )

  it.effect('still runs auth probe when model_provider is openai', () =>
    Effect.gen(function* () {
      yield* withTempCodexHome('model_provider = "openai"\n')
      const status = yield* checkCodexProviderStatus()
      assert.strictEqual(status.status, 'error')
      assert.strictEqual(status.auth.status, 'unauthenticated')
    }).pipe(
      provideCodexLayer(
        mockSpawnerLayer(args => {
          const joined = args.join(' ')
          if (joined === '--version') return { stdout: 'codex 1.0.0\n', stderr: '', code: 0 }
          if (joined === 'login status') return { stdout: 'Not logged in\n', stderr: '', code: 1 }
          throw new Error(`Unexpected args: ${joined}`)
        })
      )
    )
  )
})

describe('readCodexConfigModelProvider', () => {
  it.effect('returns undefined when config file does not exist', () =>
    Effect.gen(function* () {
      yield* withTempCodexHome()
      assert.strictEqual(yield* readCodexConfigModelProvider(), undefined)
    }).pipe(Effect.provide(baseLayer))
  )

  it.effect('returns undefined when config has no model_provider key', () =>
    Effect.gen(function* () {
      yield* withTempCodexHome('model = "gpt-5-codex"\n')
      assert.strictEqual(yield* readCodexConfigModelProvider(), undefined)
    }).pipe(Effect.provide(baseLayer))
  )

  it.effect('returns the provider when model_provider is set at top level', () =>
    Effect.gen(function* () {
      yield* withTempCodexHome('model = "gpt-5-codex"\nmodel_provider = "portkey"\n')
      assert.strictEqual(yield* readCodexConfigModelProvider(), 'portkey')
    }).pipe(Effect.provide(baseLayer))
  )

  it.effect('returns openai when model_provider is openai', () =>
    Effect.gen(function* () {
      yield* withTempCodexHome('model_provider = "openai"\n')
      assert.strictEqual(yield* readCodexConfigModelProvider(), 'openai')
    }).pipe(Effect.provide(baseLayer))
  )

  it.effect('ignores model_provider inside section headers', () =>
    Effect.gen(function* () {
      yield* withTempCodexHome(
        [
          'model = "gpt-5-codex"',
          '',
          '[model_providers.portkey]',
          'base_url = "https://api.portkey.ai/v1"',
          'model_provider = "should-be-ignored"',
          '',
        ].join('\n')
      )
      assert.strictEqual(yield* readCodexConfigModelProvider(), undefined)
    }).pipe(Effect.provide(baseLayer))
  )

  it.effect('handles comments and whitespace', () =>
    Effect.gen(function* () {
      yield* withTempCodexHome(
        [
          '# This is a comment',
          '',
          '  model_provider = "azure"  ',
          '',
          '[profiles.deep-review]',
          'model = "gpt-5-pro"',
        ].join('\n')
      )
      assert.strictEqual(yield* readCodexConfigModelProvider(), 'azure')
    }).pipe(Effect.provide(baseLayer))
  )

  it.effect('handles single-quoted values in TOML', () =>
    Effect.gen(function* () {
      yield* withTempCodexHome("model_provider = 'mistral'\n")
      assert.strictEqual(yield* readCodexConfigModelProvider(), 'mistral')
    }).pipe(Effect.provide(baseLayer))
  )
})

describe('hasCustomModelProvider', () => {
  it.effect('returns false when no config file exists', () =>
    Effect.gen(function* () {
      yield* withTempCodexHome()
      assert.strictEqual(yield* hasCustomModelProvider, false)
    }).pipe(Effect.provide(baseLayer))
  )

  it.effect('returns false when model_provider is not set', () =>
    Effect.gen(function* () {
      yield* withTempCodexHome('model = "gpt-5-codex"\n')
      assert.strictEqual(yield* hasCustomModelProvider, false)
    }).pipe(Effect.provide(baseLayer))
  )

  it.effect('returns false when model_provider is openai', () =>
    Effect.gen(function* () {
      yield* withTempCodexHome('model_provider = "openai"\n')
      assert.strictEqual(yield* hasCustomModelProvider, false)
    }).pipe(Effect.provide(baseLayer))
  )

  it.effect('returns true when model_provider is portkey', () =>
    Effect.gen(function* () {
      yield* withTempCodexHome('model_provider = "portkey"\n')
      assert.strictEqual(yield* hasCustomModelProvider, true)
    }).pipe(Effect.provide(baseLayer))
  )

  it.effect('returns true when model_provider is azure', () =>
    Effect.gen(function* () {
      yield* withTempCodexHome('model_provider = "azure"\n')
      assert.strictEqual(yield* hasCustomModelProvider, true)
    }).pipe(Effect.provide(baseLayer))
  )

  it.effect('returns true when model_provider is ollama', () =>
    Effect.gen(function* () {
      yield* withTempCodexHome('model_provider = "ollama"\n')
      assert.strictEqual(yield* hasCustomModelProvider, true)
    }).pipe(Effect.provide(baseLayer))
  )

  it.effect('returns true when model_provider is a custom proxy', () =>
    Effect.gen(function* () {
      yield* withTempCodexHome('model_provider = "my-company-proxy"\n')
      assert.strictEqual(yield* hasCustomModelProvider, true)
    }).pipe(Effect.provide(baseLayer))
  )
})
