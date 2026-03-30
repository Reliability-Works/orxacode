import { describe, expect, it, vi } from 'vitest'
import { hasRecentMatchingUserPrompt } from './prompt-dedupe'
import { OpencodeService } from './opencode-service'
import {
  createSessionMessageBundle,
  createTextPart,
} from '../../src/test/session-message-bundle-factory'

vi.mock('electron', () => ({
  app: {
    getName: () => 'Orxa Code Test',
    getPath: () => '/tmp/orxa-opencode-service-test',
  },
}))

function createSendPromptHarness() {
  const service = Object.create(OpencodeService.prototype) as unknown as {
    sendPrompt: (input: {
      directory: string
      sessionID: string
      text: string
    }) => Promise<boolean>
    promptFence: Map<string, number>
    client: () => { session: { promptAsync: (payload: unknown) => Promise<void> } }
    ensureWorkspaceDirectory: (directory: string) => string
  }
  service.promptFence = new Map<string, number>()
  service.ensureWorkspaceDirectory = directory => directory
  return service
}

describe('hasRecentMatchingUserPrompt', () => {
  it('detects a matching recent user prompt', () => {
    const now = Date.now()
    const messages = [
      createSessionMessageBundle({
        id: 'assistant-1',
        role: 'assistant',
        sessionID: 's-1',
        createdAt: now - 1_000,
        parts: [],
      }),
      createSessionMessageBundle({
        id: 'user-1',
        role: 'user',
        sessionID: 's-1',
        createdAt: now + 400,
        parts: [
          createTextPart({
            id: 'part-user-1',
            sessionID: 's-1',
            messageID: 'user-1',
            text: 'build me a website',
          }),
        ],
      }),
    ]

    expect(hasRecentMatchingUserPrompt(messages, 'build me a website', now)).toBe(true)
  })

  it('ignores stale or non-matching user prompts', () => {
    const now = Date.now()
    const messages = [
      createSessionMessageBundle({
        id: 'user-stale',
        role: 'user',
        sessionID: 's-1',
        createdAt: now - 15_000,
        parts: [
          createTextPart({
            id: 'part-user-stale',
            sessionID: 's-1',
            messageID: 'user-stale',
            text: 'build me a website',
          }),
        ],
      }),
      createSessionMessageBundle({
        id: 'user-new',
        role: 'user',
        sessionID: 's-1',
        createdAt: now + 500,
        parts: [
          createTextPart({
            id: 'part-user-new',
            sessionID: 's-1',
            messageID: 'user-new',
            text: 'different message',
          }),
        ],
      }),
    ]

    expect(hasRecentMatchingUserPrompt(messages, 'build me a website', now)).toBe(false)
  })
})

it('keeps the prompt system field explicit-only', async () => {
  const service = createSendPromptHarness()
  const promptMock = vi.fn(async (payload: unknown) => {
    void payload
    return undefined
  })
  service.client = () => ({ session: { promptAsync: promptMock } })

  await service.sendPrompt({
    directory: '/repo-memory',
    sessionID: 'session-1',
    text: 'Run tests',
  })

  const payload = promptMock.mock.calls[0]?.[0] as { system?: string } | undefined
  expect(payload?.system).toBeUndefined()
})

it('omits system field when no explicit system prompt exists', async () => {
  const service = createSendPromptHarness() as unknown as {
    sendPrompt: (input: {
      directory: string
      sessionID: string
      text: string
    }) => Promise<boolean>
    client: () => { session: { promptAsync: (payload: unknown) => Promise<void> } }
  }
  const promptMock = vi.fn(async (payload: unknown) => {
    void payload
    return undefined
  })
  service.client = () => ({ session: { promptAsync: promptMock } })

  await service.sendPrompt({
    directory: '/repo-standard',
    sessionID: 'session-2',
    text: 'No memory',
  })

  const payload = promptMock.mock.calls[0]?.[0] as { system?: string } | undefined
  expect(payload?.system).toBeUndefined()
})

it('forwards explicit tool policy overrides in prompt payload', async () => {
  const service = createSendPromptHarness() as unknown as {
    sendPrompt: (input: {
      directory: string
      sessionID: string
      text: string
      tools?: Record<string, boolean>
    }) => Promise<boolean>
    client: () => { session: { promptAsync: (payload: unknown) => Promise<void> } }
  }
  const promptMock = vi.fn(async (payload: unknown) => {
    void payload
    return undefined
  })
  service.client = () => ({ session: { promptAsync: promptMock } })

  await service.sendPrompt({
    directory: '/repo-standard',
    sessionID: 'session-3',
    text: 'Use ORXA browser actions only',
    tools: { '*': false, web_search: false },
  })

  const payload = promptMock.mock.calls[0]?.[0] as { tools?: Record<string, boolean> } | undefined
  expect(payload?.tools).toEqual({ '*': false, web_search: false })
})

it('still omits system field for machine-origin prompts', async () => {
  const service = createSendPromptHarness() as unknown as {
    sendPrompt: (input: {
      directory: string
      sessionID: string
      text: string
      promptSource?: 'machine' | 'user'
    }) => Promise<boolean>
    client: () => { session: { promptAsync: (payload: unknown) => Promise<void> } }
  }
  const promptMock = vi.fn(async (payload: unknown) => {
    void payload
    return undefined
  })
  service.client = () => ({ session: { promptAsync: promptMock } })

  await service.sendPrompt({
    directory: '/repo-standard',
    sessionID: 'session-4',
    text: '[ORXA_BROWSER_RESULT]{}',
    promptSource: 'machine',
  })

  const payload = promptMock.mock.calls[0]?.[0] as { system?: string } | undefined
  expect(payload?.system).toBeUndefined()
})

describe('OpencodeService provider filtering', () => {
  it('keeps credential-backed and env-backed providers while excluding unauthenticated catalog entries', async () => {
    const service = Object.create(OpencodeService.prototype) as {
      listProviders: (
        directory?: string
      ) => Promise<{
        all: Array<{ id: string }>
        connected: string[]
        default: Record<string, string>
      }>
      client: () => { provider: { list: () => Promise<{ data: unknown }> } }
      listAuthenticatedProviderIDs: () => Promise<Set<string>>
      providerHasSatisfiedEnv: (provider: unknown) => boolean
    }

    service.client = () => ({
      provider: {
        list: async () => ({
          data: {
            all: [
              {
                id: 'google',
                name: 'Google',
                env: ['GEMINI_API_KEY'],
                models: { gemini: { id: 'gemini' } },
              },
              {
                id: 'zai-coding-plan',
                name: 'Z.AI Coding Plan',
                env: ['ZHIPU_API_KEY'],
                models: { glm: { id: 'glm' } },
              },
              {
                id: 'anthropic',
                name: 'Anthropic',
                env: ['ANTHROPIC_API_KEY'],
                models: { sonnet: { id: 'sonnet' } },
              },
            ],
            connected: ['google'],
            default: {
              google: 'gemini',
              'zai-coding-plan': 'glm',
              anthropic: 'sonnet',
            },
          },
        }),
      },
    })
    service.listAuthenticatedProviderIDs = async () => new Set(['zai-coding-plan'])
    service.providerHasSatisfiedEnv = provider => {
      const id = (provider as { id?: string }).id
      return id === 'google'
    }

    const providers = await service.listProviders()

    expect(providers.all.map(provider => provider.id)).toEqual(['google', 'zai-coding-plan'])
    expect(providers.connected).toEqual(['google', 'zai-coding-plan'])
    expect(providers.default).toEqual({
      google: 'gemini',
      'zai-coding-plan': 'glm',
    })
  })

  it('treats a provider as env-authenticated when any supported env key is present', async () => {
    const service = Object.create(OpencodeService.prototype) as {
      providerHasSatisfiedEnv: (provider: unknown) => boolean
    }

    const previousApiToken = process.env.CLOUDFLARE_API_TOKEN
    const previousAccountId = process.env.CLOUDFLARE_ACCOUNT_ID
    const previousGatewayId = process.env.CLOUDFLARE_GATEWAY_ID
    process.env.CLOUDFLARE_API_TOKEN = 'configured'
    delete process.env.CLOUDFLARE_ACCOUNT_ID
    delete process.env.CLOUDFLARE_GATEWAY_ID

    try {
      expect(
        service.providerHasSatisfiedEnv({
          id: 'cloudflare-ai-gateway',
          env: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_GATEWAY_ID'],
        })
      ).toBe(true)
    } finally {
      if (previousApiToken === undefined) {
        delete process.env.CLOUDFLARE_API_TOKEN
      } else {
        process.env.CLOUDFLARE_API_TOKEN = previousApiToken
      }
      if (previousAccountId === undefined) {
        delete process.env.CLOUDFLARE_ACCOUNT_ID
      } else {
        process.env.CLOUDFLARE_ACCOUNT_ID = previousAccountId
      }
      if (previousGatewayId === undefined) {
        delete process.env.CLOUDFLARE_GATEWAY_ID
      } else {
        process.env.CLOUDFLARE_GATEWAY_ID = previousGatewayId
      }
    }
  })
})
