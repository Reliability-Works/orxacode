import * as NodeServices from '@effect/platform-node/NodeServices'
import { DEFAULT_SERVER_SETTINGS, ServerSettingsPatch } from '@orxa-code/contracts'
import { assert, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Schema } from 'effect'
import { ServerConfig } from './config'
import { ServerSettingsLive, ServerSettingsService } from './serverSettings'

const makeServerSettingsLayer = () =>
  ServerSettingsLive.pipe(
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix: 'orxa-server-settings-test-',
        })
      )
    )
  )

it.layer(NodeServices.layer)('server settings schema', it => {
  it.effect('decodes nested settings patches', () =>
    Effect.sync(() => {
      const decodePatch = Schema.decodeUnknownSync(ServerSettingsPatch)

      assert.deepEqual(decodePatch({ providers: { codex: { binaryPath: '/tmp/codex' } } }), {
        providers: { codex: { binaryPath: '/tmp/codex' } },
      })

      assert.deepEqual(
        decodePatch({ providers: { opencode: { hiddenModelSlugs: ['openai/gpt-5'] } } }),
        {
          providers: { opencode: { hiddenModelSlugs: ['openai/gpt-5'] } },
        }
      )

      assert.deepEqual(
        decodePatch({
          textGenerationModelSelection: {
            options: {
              fastMode: false,
            },
          },
        }),
        {
          textGenerationModelSelection: {
            options: {
              fastMode: false,
            },
          },
        }
      )
    })
  )
})

it.layer(NodeServices.layer)('server settings deep merge behavior', it => {
  it.effect('deep merges nested settings updates without dropping siblings', () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService

      yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: '/usr/local/bin/codex',
            homePath: '/Users/julius/.codex',
          },
          claudeAgent: {
            binaryPath: '/usr/local/bin/claude',
            customModels: ['claude-custom'],
          },
        },
        textGenerationModelSelection: {
          provider: 'codex',
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
          options: {
            reasoningEffort: 'high',
            fastMode: true,
          },
        },
      })

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: '/opt/homebrew/bin/codex',
          },
        },
        textGenerationModelSelection: {
          options: {
            fastMode: false,
          },
        },
      })

      assert.deepEqual(next.providers.codex, {
        enabled: true,
        binaryPath: '/opt/homebrew/bin/codex',
        homePath: '/Users/julius/.codex',
        customModels: [],
      })
      assert.deepEqual(next.providers.claudeAgent, {
        enabled: true,
        binaryPath: '/usr/local/bin/claude',
        customModels: ['claude-custom'],
      })
      assert.deepEqual(next.providers.opencode, {
        enabled: true,
        binaryPath: 'opencode',
        customModels: [],
        hiddenModelSlugs: [],
      })
      assert.deepEqual(next.textGenerationModelSelection, {
        provider: 'codex',
        model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
        options: {
          reasoningEffort: 'high',
          fastMode: false,
        },
      })
    }).pipe(Effect.provide(makeServerSettingsLayer()))
  )
})

it.layer(NodeServices.layer)('server settings provider switching', it => {
  it.effect('preserves model when switching providers via textGenerationModelSelection', () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService

      // Start with Claude text generation selection
      yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          provider: 'claudeAgent',
          model: 'claude-sonnet-4-6',
          options: {
            effort: 'high',
          },
        },
      })

      // Switch to Codex — the stale Claude "effort" in options must not
      // cause the update to lose the selected model.
      const next = yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          provider: 'codex',
          model: 'gpt-5.4',
          options: {
            reasoningEffort: 'high',
          },
        },
      })

      assert.deepEqual(next.textGenerationModelSelection, {
        provider: 'codex',
        model: 'gpt-5.4',
        options: {
          reasoningEffort: 'high',
        },
      })
    }).pipe(Effect.provide(makeServerSettingsLayer()))
  )
})

it.layer(NodeServices.layer)('server settings path normalization', it => {
  it.effect('trims provider path settings when updates are applied', () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: '  /opt/homebrew/bin/codex  ',
            homePath: '   ',
          },
          claudeAgent: {
            binaryPath: '  /opt/homebrew/bin/claude  ',
          },
        },
      })

      assert.deepEqual(next.providers.codex, {
        enabled: true,
        binaryPath: '/opt/homebrew/bin/codex',
        homePath: '',
        customModels: [],
      })
      assert.deepEqual(next.providers.claudeAgent, {
        enabled: true,
        binaryPath: '/opt/homebrew/bin/claude',
        customModels: [],
      })
      assert.deepEqual(next.providers.opencode, {
        enabled: true,
        binaryPath: 'opencode',
        customModels: [],
        hiddenModelSlugs: [],
      })
    }).pipe(Effect.provide(makeServerSettingsLayer()))
  )

  it.effect('defaults blank binary paths to provider executables', () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: '   ',
          },
          claudeAgent: {
            binaryPath: '',
          },
        },
      })

      assert.equal(next.providers.codex.binaryPath, 'codex')
      assert.equal(next.providers.claudeAgent.binaryPath, 'claude')
      assert.deepEqual(next.providers.opencode.hiddenModelSlugs, [])
    }).pipe(Effect.provide(makeServerSettingsLayer()))
  )
})

it.layer(NodeServices.layer)('server settings opencode model visibility', it => {
  it.effect('persists hidden Opencode model slugs alongside other provider settings', () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService

      const next = yield* serverSettings.updateSettings({
        providers: {
          opencode: {
            hiddenModelSlugs: ['openai/gpt-5', 'anthropic/claude-sonnet-4-5'],
          },
        },
      })

      assert.deepEqual(next.providers.opencode.hiddenModelSlugs, [
        'openai/gpt-5',
        'anthropic/claude-sonnet-4-5',
      ])
    }).pipe(Effect.provide(makeServerSettingsLayer()))
  )
})

it.layer(NodeServices.layer)('server settings persistence', it => {
  it.effect('writes only non-default server settings to disk', () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService
      const serverConfig = yield* ServerConfig
      const fileSystem = yield* FileSystem.FileSystem
      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: '/opt/homebrew/bin/codex',
          },
        },
      })

      assert.equal(next.providers.codex.binaryPath, '/opt/homebrew/bin/codex')

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath)
      assert.deepEqual(JSON.parse(raw), {
        providers: {
          codex: {
            binaryPath: '/opt/homebrew/bin/codex',
          },
        },
      })
    }).pipe(Effect.provide(makeServerSettingsLayer()))
  )
})
