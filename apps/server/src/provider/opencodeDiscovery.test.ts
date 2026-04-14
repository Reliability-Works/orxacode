/**
 * Unit tests for `discoverOpencodeProviders` covering the cross-verification
 * with `auth.json`, the missing/malformed-auth tolerance, and the model
 * normalization (display name fallback + `supportsReasoning` extraction).
 *
 * Uses the `startServer` + `readAuthJson` test seams so it never spawns a
 * real opencode subprocess.
 *
 * @module opencodeDiscovery.test
 */
import { describe, expect, it } from 'vitest'

import {
  discoverOpencodeProviders,
  extractModelVariants,
  type StartOpencodeServerFn,
} from './opencodeDiscovery'
import type { StartedOpencodeServer } from './opencodeAppServer'

interface FakeServerInput {
  readonly providers: ReadonlyArray<unknown>
}

function makeFakeStartServer(input: FakeServerInput): {
  readonly start: StartOpencodeServerFn
  readonly shutdownCalls: { value: number }
} {
  const shutdownCalls = { value: 0 }
  const start: StartOpencodeServerFn = async () => {
    const fakeStarted: StartedOpencodeServer = {
      port: 4242,
      pid: undefined,
      shutdown: async () => {
        shutdownCalls.value += 1
      },
      // Cast through unknown so the test fake doesn't need to satisfy the
      // entire OpencodeClient surface — only `client.config.providers()`.
      client: {
        config: {
          providers: async () => ({ data: { providers: input.providers } }),
        },
      } as unknown as StartedOpencodeServer['client'],
    }
    return fakeStarted
  }
  return { start, shutdownCalls }
}

const sampleProviders = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: {
      'claude-sonnet-4-5': {
        id: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        capabilities: { reasoning: true },
      },
      'claude-haiku-4-5': {
        id: 'claude-haiku-4-5',
        name: 'Claude Haiku 4.5',
        capabilities: { reasoning: false },
      },
    },
  },
  {
    id: 'openai',
    name: 'OpenAI',
    models: {
      'gpt-5': {
        id: 'gpt-5',
        name: 'GPT-5',
        capabilities: { reasoning: false },
      },
    },
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare (env-leaked)',
    models: {
      'workers-ai': { id: 'workers-ai', name: 'Workers AI', capabilities: { reasoning: false } },
    },
  },
]

describe('discoverOpencodeProviders', () => {
  it('returns providers cross-verified against auth.json with reasoning + display names', async () => {
    const { start, shutdownCalls } = makeFakeStartServer({ providers: sampleProviders })
    const result = await discoverOpencodeProviders({
      binaryPath: '/fake/opencode',
      authJsonPath: '/fake/auth.json',
      readAuthJson: async () =>
        JSON.stringify({
          anthropic: { type: 'api', key: 'redacted' },
          openai: { type: 'api', key: 'redacted' },
        }),
      startServer: start,
    })

    expect(result.configuredProviderIds).toEqual(['anthropic', 'openai'])
    expect(result.models.map(model => model.id)).toEqual([
      'anthropic/claude-haiku-4-5',
      'anthropic/claude-sonnet-4-5',
      'openai/gpt-5',
    ])
    const sonnet = result.models.find(model => model.id === 'anthropic/claude-sonnet-4-5')
    expect(sonnet?.supportsReasoning).toBe(true)
    expect(sonnet?.displayName).toBe('Claude Sonnet 4.5')
    expect(result.models.find(model => model.providerId === 'cloudflare')).toBeUndefined()
    expect(shutdownCalls.value).toBe(1)
  })

  it('returns empty result without booting the server when auth.json is missing', async () => {
    let started = 0
    const start: StartOpencodeServerFn = async () => {
      started += 1
      throw new Error('should not start')
    }
    const result = await discoverOpencodeProviders({
      binaryPath: '/fake/opencode',
      authJsonPath: '/fake/missing-auth.json',
      readAuthJson: async () => {
        const error = new Error('not found') as Error & { code?: string }
        error.code = 'ENOENT'
        throw error
      },
      startServer: start,
    })
    expect(result.configuredProviderIds).toEqual([])
    expect(result.models).toEqual([])
    expect(started).toBe(0)
  })

  it('warns and returns empty result when auth.json is malformed', async () => {
    const warnings: Array<string> = []
    let started = 0
    const start: StartOpencodeServerFn = async () => {
      started += 1
      throw new Error('should not start')
    }
    const result = await discoverOpencodeProviders({
      binaryPath: '/fake/opencode',
      authJsonPath: '/fake/bad-auth.json',
      readAuthJson: async () => '{not json',
      startServer: start,
      logWarning: message => warnings.push(message),
    })
    expect(result.configuredProviderIds).toEqual([])
    expect(result.models).toEqual([])
    expect(started).toBe(0)
    expect(warnings.some(warning => warning.includes('malformed'))).toBe(true)
  })
})

const cloudflareOnlyProviders = [
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    models: {
      'workers-ai': {
        id: 'workers-ai',
        name: 'Workers AI',
        capabilities: { reasoning: false },
      },
    },
  },
]

const anthropicWithVariantsProviders = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: {
      'claude-sonnet-4-5': {
        id: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        capabilities: { reasoning: true },
        variants: { reasoning: {}, turbo: {} },
      },
      'claude-haiku-4-5': {
        id: 'claude-haiku-4-5',
        name: 'Claude Haiku 4.5',
        capabilities: { reasoning: false },
      },
    },
  },
]

describe('discoverOpencodeProviders edge cases', () => {
  it('drops providers reported by SDK that are not present in auth.json', async () => {
    const { start } = makeFakeStartServer({ providers: cloudflareOnlyProviders })
    const result = await discoverOpencodeProviders({
      binaryPath: '/fake/opencode',
      authJsonPath: '/fake/auth.json',
      readAuthJson: async () => JSON.stringify({ openai: { type: 'api', key: 'k' } }),
      startServer: start,
    })
    expect(result.configuredProviderIds).toEqual([])
    expect(result.models).toEqual([])
  })

  it('threads variant keys from the SDK model payload', async () => {
    const { start } = makeFakeStartServer({ providers: anthropicWithVariantsProviders })
    const result = await discoverOpencodeProviders({
      binaryPath: '/fake/opencode',
      authJsonPath: '/fake/auth.json',
      readAuthJson: async () => JSON.stringify({ anthropic: { type: 'api', key: 'k' } }),
      startServer: start,
    })
    const sonnet = result.models.find(model => model.id === 'anthropic/claude-sonnet-4-5')
    const haiku = result.models.find(model => model.id === 'anthropic/claude-haiku-4-5')
    expect(sonnet?.variants).toEqual(['reasoning', 'turbo'])
    expect(haiku?.variants).toEqual([])
  })

  it('falls back to the model id when display name is missing', async () => {
    const { start } = makeFakeStartServer({
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'mystery-model': {
              id: 'mystery-model',
              capabilities: { reasoning: false },
            },
          },
        },
      ],
    })
    const result = await discoverOpencodeProviders({
      binaryPath: '/fake/opencode',
      authJsonPath: '/fake/auth.json',
      readAuthJson: async () => JSON.stringify({ openai: { type: 'api', key: 'k' } }),
      startServer: start,
    })
    expect(result.models).toHaveLength(1)
    expect(result.models[0]?.displayName).toBe('mystery-model')
    expect(result.models[0]?.supportsReasoning).toBe(false)
    expect(result.models[0]?.variants).toEqual([])
  })
})

describe('extractModelVariants', () => {
  it('returns empty when variants field is missing', () => {
    expect(extractModelVariants({ id: 'm', name: 'M' })).toEqual([])
  })

  it('returns keys when variants is a record', () => {
    expect(extractModelVariants({ variants: { reasoning: {}, turbo: {} } })).toEqual([
      'reasoning',
      'turbo',
    ])
  })

  it('returns empty when variants is a string', () => {
    expect(extractModelVariants({ variants: 'nope' })).toEqual([])
  })

  it('returns empty when variants is an array', () => {
    expect(extractModelVariants({ variants: [] })).toEqual([])
  })

  it('returns empty when the model itself is not an object', () => {
    expect(extractModelVariants(null)).toEqual([])
    expect(extractModelVariants('model-id')).toEqual([])
  })
})
