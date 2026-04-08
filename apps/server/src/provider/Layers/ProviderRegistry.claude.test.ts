import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, it, assert } from '@effect/vitest'
import { Effect, Layer } from 'effect'

import { checkClaudeProviderStatus, parseClaudeAuthStatusFromOutput } from './ClaudeProvider'
import { ServerSettingsService } from '../../serverSettings'
import {
  claudeReadySpawnerLayer,
  failingSpawnerLayer,
  mockSpawnerLayer,
} from './ProviderRegistry.test.helpers.ts'

const baseLayer = Layer.mergeAll(NodeServices.layer, ServerSettingsService.layerTest())
const provideClaudeLayer = (layer: unknown) =>
  Effect.provide(Layer.mergeAll(baseLayer, layer as never))

describe('checkClaudeProviderStatus ready states', () => {
  it.effect('returns ready when claude is installed and authenticated', () =>
    checkClaudeProviderStatus().pipe(
      provideClaudeLayer(claudeReadySpawnerLayer('{"loggedIn":true,"authMethod":"claude.ai"}\n')),
      Effect.tap(status =>
        Effect.sync(() => {
          assert.strictEqual(status.provider, 'claudeAgent')
          assert.strictEqual(status.status, 'ready')
          assert.strictEqual(status.installed, true)
          assert.strictEqual(status.auth.status, 'authenticated')
        })
      )
    )
  )

  it.effect('returns a display label for claude subscription types', () =>
    checkClaudeProviderStatus(() => Effect.succeed('maxplan')).pipe(
      provideClaudeLayer(claudeReadySpawnerLayer('{"loggedIn":true,"authMethod":"claude.ai"}\n')),
      Effect.tap(status =>
        Effect.sync(() => {
          assert.strictEqual(status.provider, 'claudeAgent')
          assert.strictEqual(status.status, 'ready')
          assert.strictEqual(status.auth.status, 'authenticated')
          assert.strictEqual(status.auth.type, 'maxplan')
          assert.strictEqual(status.auth.label, 'Claude Max Subscription')
        })
      )
    )
  )

  it.effect('returns an api key label for claude api key auth', () =>
    checkClaudeProviderStatus().pipe(
      provideClaudeLayer(claudeReadySpawnerLayer('{"loggedIn":true,"authMethod":"api-key"}\n')),
      Effect.tap(status =>
        Effect.sync(() => {
          assert.strictEqual(status.provider, 'claudeAgent')
          assert.strictEqual(status.status, 'ready')
          assert.strictEqual(status.auth.type, 'apiKey')
          assert.strictEqual(status.auth.label, 'Claude API Key')
        })
      )
    )
  )
})

describe('checkClaudeProviderStatus failure states', () => {
  it.effect('returns unavailable when claude is missing', () =>
    checkClaudeProviderStatus().pipe(
      provideClaudeLayer(failingSpawnerLayer('spawn claude ENOENT')),
      Effect.tap(status =>
        Effect.sync(() => {
          assert.strictEqual(status.provider, 'claudeAgent')
          assert.strictEqual(status.status, 'error')
          assert.strictEqual(status.installed, false)
          assert.strictEqual(
            status.message,
            'Claude Agent CLI (`claude`) is not installed or not on PATH.'
          )
        })
      )
    )
  )

  it.effect('returns error when version check fails with non-zero exit code', () =>
    checkClaudeProviderStatus().pipe(
      provideClaudeLayer(
        mockSpawnerLayer(args => {
          const joined = args.join(' ')
          if (joined === '--version') {
            return { stdout: '', stderr: 'Something went wrong', code: 1 }
          }
          throw new Error(`Unexpected args: ${joined}`)
        })
      ),
      Effect.tap(status =>
        Effect.sync(() => {
          assert.strictEqual(status.provider, 'claudeAgent')
          assert.strictEqual(status.status, 'error')
          assert.strictEqual(status.installed, true)
        })
      )
    )
  )
})

describe('checkClaudeProviderStatus auth failures', () => {
  it.effect('returns unauthenticated when auth status reports not logged in', () =>
    checkClaudeProviderStatus().pipe(
      provideClaudeLayer(claudeReadySpawnerLayer('{"loggedIn":false}\n', 1)),
      Effect.tap(status =>
        Effect.sync(() => {
          assert.strictEqual(status.status, 'error')
          assert.strictEqual(status.auth.status, 'unauthenticated')
          assert.strictEqual(
            status.message,
            'Claude is not authenticated. Run `claude auth login` and try again.'
          )
        })
      )
    )
  )

  it.effect("returns unauthenticated when output includes 'not logged in'", () =>
    checkClaudeProviderStatus().pipe(
      provideClaudeLayer(claudeReadySpawnerLayer('Not logged in\n', 1)),
      Effect.tap(status =>
        Effect.sync(() => {
          assert.strictEqual(status.status, 'error')
          assert.strictEqual(status.auth.status, 'unauthenticated')
        })
      )
    )
  )

  it.effect('returns warning when auth status command is unsupported', () =>
    checkClaudeProviderStatus().pipe(
      provideClaudeLayer(
        mockSpawnerLayer(args => {
          const joined = args.join(' ')
          if (joined === '--version') return { stdout: '1.0.0\n', stderr: '', code: 0 }
          if (joined === 'auth status') {
            return { stdout: '', stderr: "error: unknown command 'auth'", code: 2 }
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
            'Claude Agent authentication status command is unavailable in this version of Claude.'
          )
        })
      )
    )
  )
})

describe('parseClaudeAuthStatusFromOutput', () => {
  it('exit code 0 with no auth markers is ready', () => {
    const parsed = parseClaudeAuthStatusFromOutput({ stdout: 'OK\n', stderr: '', code: 0 })
    assert.strictEqual(parsed.status, 'ready')
    assert.strictEqual(parsed.auth.status, 'authenticated')
  })

  it('JSON with loggedIn=true is authenticated', () => {
    const parsed = parseClaudeAuthStatusFromOutput({
      stdout: '{"loggedIn":true,"authMethod":"claude.ai"}\n',
      stderr: '',
      code: 0,
    })
    assert.strictEqual(parsed.status, 'ready')
    assert.strictEqual(parsed.auth.status, 'authenticated')
  })

  it('JSON with loggedIn=false is unauthenticated', () => {
    const parsed = parseClaudeAuthStatusFromOutput({
      stdout: '{"loggedIn":false}\n',
      stderr: '',
      code: 0,
    })
    assert.strictEqual(parsed.status, 'error')
    assert.strictEqual(parsed.auth.status, 'unauthenticated')
  })

  it('JSON without auth marker is warning', () => {
    const parsed = parseClaudeAuthStatusFromOutput({
      stdout: '{"ok":true}\n',
      stderr: '',
      code: 0,
    })
    assert.strictEqual(parsed.status, 'warning')
    assert.strictEqual(parsed.auth.status, 'unknown')
  })
})
