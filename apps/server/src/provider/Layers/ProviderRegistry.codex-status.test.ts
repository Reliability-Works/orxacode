import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, it, assert } from '@effect/vitest'
import { Effect, FileSystem, Layer, Path } from 'effect'

import { checkCodexProviderStatus, parseAuthStatusFromOutput } from './CodexProvider'
import { ServerSettingsService } from '../../serverSettings'
import {
  codexReadySpawnerLayer,
  failingSpawnerLayer,
  mockSpawnerLayer,
  withTempCodexHome,
} from './ProviderRegistry.test.helpers.ts'

const baseLayer = Layer.mergeAll(NodeServices.layer, ServerSettingsService.layerTest())
const provideCodexLayer = (layer: unknown) =>
  Effect.provide(Layer.mergeAll(baseLayer, layer as never))

const codexBaseTest = Effect.gen(function* () {
  yield* withTempCodexHome()
  return yield* checkCodexProviderStatus()
})

describe('checkCodexProviderStatus ready states', () => {
  it.effect('returns ready when codex is installed and authenticated', () =>
    codexBaseTest.pipe(
      provideCodexLayer(codexReadySpawnerLayer()),
      Effect.tap(status =>
        Effect.sync(() => {
          assert.strictEqual(status.provider, 'codex')
          assert.strictEqual(status.status, 'ready')
          assert.strictEqual(status.installed, true)
          assert.strictEqual(status.auth.status, 'authenticated')
        })
      )
    )
  )

  it.effect('returns the codex plan type in auth and keeps spark for supported plans', () =>
    Effect.gen(function* () {
      yield* withTempCodexHome()
      const status = yield* checkCodexProviderStatus(() =>
        Effect.succeed({
          type: 'chatgpt' as const,
          planType: 'pro' as const,
          sparkEnabled: true,
        })
      )

      assert.strictEqual(status.provider, 'codex')
      assert.strictEqual(status.status, 'ready')
      assert.strictEqual(status.auth.status, 'authenticated')
      assert.strictEqual(status.auth.type, 'pro')
      assert.strictEqual(status.auth.label, 'ChatGPT Pro Subscription')
      assert.deepStrictEqual(
        status.models.some(model => model.slug === 'gpt-5.3-codex-spark'),
        true
      )
    }).pipe(provideCodexLayer(codexReadySpawnerLayer()))
  )
})

describe('checkCodexProviderStatus ChatGPT plan gating', () => {
  function expectSparkAvailability(planType: 'plus' | 'team', label: string) {
    return Effect.gen(function* () {
      yield* withTempCodexHome()
      const status = yield* checkCodexProviderStatus(() =>
        Effect.succeed({
          type: 'chatgpt' as const,
          planType,
          sparkEnabled: false,
        })
      )

      assert.strictEqual(status.auth.type, planType)
      assert.strictEqual(status.auth.label, label)
      assert.deepStrictEqual(
        status.models.some(model => model.slug === 'gpt-5.3-codex-spark'),
        false
      )
    }).pipe(provideCodexLayer(codexReadySpawnerLayer()))
  }

  it.effect('hides spark from codex models for unsupported chatgpt plans', () =>
    expectSparkAvailability('plus', 'ChatGPT Plus Subscription')
  )

  it.effect('hides spark from codex models for non-pro chatgpt subscriptions', () =>
    expectSparkAvailability('team', 'ChatGPT Team Subscription')
  )
})

describe('checkCodexProviderStatus failure states', () => {
  it.effect('returns an api key label for codex api key auth', () =>
    Effect.gen(function* () {
      yield* withTempCodexHome()
      const status = yield* checkCodexProviderStatus(() =>
        Effect.succeed({
          type: 'apiKey' as const,
          planType: null,
          sparkEnabled: false,
        })
      )

      assert.strictEqual(status.provider, 'codex')
      assert.strictEqual(status.auth.type, 'apiKey')
      assert.strictEqual(status.auth.label, 'OpenAI API Key')
    }).pipe(provideCodexLayer(codexReadySpawnerLayer()))
  )

  it.effect.skipIf(process.platform === 'win32')(
    'inherits PATH when launching the codex probe with a CODEX_HOME override',
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const binDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'orxa-test-codex-bin-' })
        const codexPath = path.join(binDir, 'codex')
        yield* fileSystem.writeFileString(
          codexPath,
          [
            '#!/bin/sh',
            'if [ "$1" = "--version" ]; then',
            '  echo "codex-cli 1.0.0"',
            '  exit 0',
            'fi',
            'if [ "$1" = "login" ] && [ "$2" = "status" ]; then',
            '  echo "Logged in using ChatGPT"',
            '  exit 0',
            'fi',
            'echo "unexpected args: $*" >&2',
            'exit 1',
            '',
          ].join('\n')
        )
        yield* fileSystem.chmod(codexPath, 0o755)
        const customCodexHome = yield* fileSystem.makeTempDirectoryScoped({
          prefix: 'orxa-test-codex-home-',
        })
        const previousPath = process.env.PATH
        process.env.PATH = binDir

        try {
          const serverSettingsLayer = ServerSettingsService.layerTest({
            providers: {
              codex: {
                homePath: customCodexHome,
              },
            },
          })
          const status = yield* checkCodexProviderStatus().pipe(Effect.provide(serverSettingsLayer))
          assert.strictEqual(status.status, 'ready')
        } finally {
          process.env.PATH = previousPath
        }
      }).pipe(Effect.provide(NodeServices.layer))
  )

  it.effect('returns unavailable when codex is missing', () =>
    codexBaseTest.pipe(
      provideCodexLayer(failingSpawnerLayer('spawn codex ENOENT')),
      Effect.tap(status =>
        Effect.sync(() => {
          assert.strictEqual(status.status, 'error')
          assert.strictEqual(status.installed, false)
          assert.strictEqual(status.message, 'Codex CLI (`codex`) is not installed or not on PATH.')
        })
      )
    )
  )
})

describe('checkCodexProviderStatus auth and version failures', () => {
  it.effect('returns unavailable when codex is below the minimum supported version', () =>
    codexBaseTest.pipe(
      provideCodexLayer(
        mockSpawnerLayer(args => {
          const joined = args.join(' ')
          if (joined === '--version') return { stdout: 'codex 0.36.0\n', stderr: '', code: 0 }
          throw new Error(`Unexpected args: ${joined}`)
        })
      ),
      Effect.tap(status =>
        Effect.sync(() => {
          assert.strictEqual(status.status, 'error')
          assert.strictEqual(status.installed, true)
          assert.strictEqual(
            status.message,
            'Codex CLI v0.36.0 is too old for Orxa Code. Upgrade to v0.37.0 or newer and restart Orxa Code.'
          )
        })
      )
    )
  )
})

describe('checkCodexProviderStatus login status failures', () => {
  it.effect('returns unauthenticated when auth probe reports login required', () =>
    Effect.gen(function* () {
      yield* withTempCodexHome()
      const status = yield* checkCodexProviderStatus()
      assert.strictEqual(status.auth.status, 'unauthenticated')
      assert.strictEqual(
        status.message,
        'Codex CLI is not authenticated. Run `codex login` and try again.'
      )
    }).pipe(
      provideCodexLayer(
        mockSpawnerLayer(args => {
          const joined = args.join(' ')
          if (joined === '--version') return { stdout: 'codex 1.0.0\n', stderr: '', code: 0 }
          if (joined === 'login status') {
            return { stdout: '', stderr: 'Not logged in. Run codex login.', code: 1 }
          }
          throw new Error(`Unexpected args: ${joined}`)
        })
      )
    )
  )

  it.effect("returns unauthenticated when login status output includes 'not logged in'", () =>
    codexBaseTest.pipe(
      provideCodexLayer(
        mockSpawnerLayer(args => {
          const joined = args.join(' ')
          if (joined === '--version') return { stdout: 'codex 1.0.0\n', stderr: '', code: 0 }
          if (joined === 'login status') return { stdout: 'Not logged in\n', stderr: '', code: 1 }
          throw new Error(`Unexpected args: ${joined}`)
        })
      ),
      Effect.tap(status =>
        Effect.sync(() => {
          assert.strictEqual(status.auth.status, 'unauthenticated')
        })
      )
    )
  )

  it.effect('returns warning when login status command is unsupported', () =>
    codexBaseTest.pipe(
      provideCodexLayer(
        mockSpawnerLayer(args => {
          const joined = args.join(' ')
          if (joined === '--version') return { stdout: 'codex 1.0.0\n', stderr: '', code: 0 }
          if (joined === 'login status') {
            return { stdout: '', stderr: "error: unknown command 'login'", code: 2 }
          }
          throw new Error(`Unexpected args: ${joined}`)
        })
      ),
      Effect.tap(status =>
        Effect.sync(() => {
          assert.strictEqual(status.status, 'warning')
          assert.strictEqual(status.auth.status, 'unknown')
          assert.strictEqual(
            status.message,
            'Codex CLI authentication status command is unavailable in this Codex version.'
          )
        })
      )
    )
  )
})

describe('parseAuthStatusFromOutput', () => {
  it('exit code 0 with no auth markers is ready', () => {
    const parsed = parseAuthStatusFromOutput({ stdout: 'OK\n', stderr: '', code: 0 })
    assert.strictEqual(parsed.status, 'ready')
    assert.strictEqual(parsed.auth.status, 'authenticated')
  })

  it('JSON with authenticated=false is unauthenticated', () => {
    const parsed = parseAuthStatusFromOutput({
      stdout: '[{"authenticated":false}]\n',
      stderr: '',
      code: 0,
    })
    assert.strictEqual(parsed.status, 'error')
    assert.strictEqual(parsed.auth.status, 'unauthenticated')
  })

  it('JSON without auth marker is warning', () => {
    const parsed = parseAuthStatusFromOutput({
      stdout: '[{"ok":true}]\n',
      stderr: '',
      code: 0,
    })
    assert.strictEqual(parsed.status, 'warning')
    assert.strictEqual(parsed.auth.status, 'unknown')
  })
})
