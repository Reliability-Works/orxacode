import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ThreadId,
  type ServerConfig,
  type ServerConfigStreamEvent,
  type ServerLifecycleStreamEvent,
  type ServerProvider,
} from '@orxa-code/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getServerConfig,
  onProvidersUpdated,
  onServerConfigUpdated,
  onWelcome,
  resetServerStateForTests,
  startServerStateSync,
} from './serverState'

function registerListener<T>(listeners: Set<(event: T) => void>, listener: (event: T) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const lifecycleListeners = new Set<(event: ServerLifecycleStreamEvent) => void>()
const configListeners = new Set<(event: ServerConfigStreamEvent) => void>()

const defaultProviders: ReadonlyArray<ServerProvider> = [
  {
    provider: 'codex',
    enabled: true,
    installed: true,
    version: '0.116.0',
    status: 'ready',
    auth: { status: 'authenticated' },
    checkedAt: '2026-01-01T00:00:00.000Z',
    models: [],
  },
]

const baseServerConfig: ServerConfig = {
  cwd: '/tmp/workspace',
  keybindingsConfigPath: '/tmp/workspace/.config/keybindings.json',
  keybindings: [],
  issues: [],
  providers: defaultProviders,
  availableEditors: ['cursor'],
  settings: DEFAULT_SERVER_SETTINGS,
}

const serverApi = {
  subscribeConfig: vi.fn((listener: (event: ServerConfigStreamEvent) => void) =>
    registerListener(configListeners, listener)
  ),
  subscribeLifecycle: vi.fn((listener: (event: ServerLifecycleStreamEvent) => void) =>
    registerListener(lifecycleListeners, listener)
  ),
}

function buildExpectedServerConfigSummary(overrides?: {
  issues?: ServerConfig['issues']
  providers?: ServerConfig['providers']
  settings?: ServerConfig['settings']
}) {
  return {
    issues: overrides?.issues ?? [],
    providers: overrides?.providers ?? defaultProviders,
    settings: overrides?.settings ?? DEFAULT_SERVER_SETTINGS,
  }
}

function expectConfigListenerCall(
  listener: ReturnType<typeof vi.fn>,
  callIndex: number,
  summary: ReturnType<typeof buildExpectedServerConfigSummary>,
  source: string
) {
  expect(listener).toHaveBeenNthCalledWith(callIndex, summary, source)
}

function createWarningProviders(): ReadonlyArray<ServerProvider> {
  return [
    {
      ...defaultProviders[0]!,
      status: 'warning',
      checkedAt: '2026-01-02T00:00:00.000Z',
      message: 'rate limited',
    },
  ]
}

function emitLifecycleEvent(event: ServerLifecycleStreamEvent) {
  for (const listener of lifecycleListeners) {
    listener(event)
  }
}

function emitServerConfigEvent(event: ServerConfigStreamEvent) {
  for (const listener of configListeners) {
    listener(event)
  }
}

function emitServerConfigSnapshot(config: ServerConfig) {
  emitServerConfigEvent({
    version: 1,
    type: 'snapshot',
    config,
  })
}

function emitServerConfigUpdates(input: {
  readonly issues: ServerConfig['issues']
  readonly providers: ServerConfig['providers']
  readonly settings: ServerConfig['settings']
}) {
  emitServerConfigEvent({
    version: 1,
    type: 'keybindingsUpdated',
    payload: { issues: input.issues },
  })
  emitServerConfigEvent({
    version: 1,
    type: 'providerStatuses',
    payload: { providers: input.providers },
  })
  emitServerConfigEvent({
    version: 1,
    type: 'settingsUpdated',
    payload: { settings: input.settings },
  })
}

async function waitFor(assertion: () => void, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now()
  for (;;) {
    try {
      assertion()
      return
    } catch (error) {
      if (Date.now() - startedAt >= timeoutMs) {
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  lifecycleListeners.clear()
  configListeners.clear()
  resetServerStateForTests()
})

afterEach(() => {
  resetServerStateForTests()
})

describe('serverState bootstrap', () => {
  it('replays the streamed server config snapshot to late subscribers', async () => {
    const configListener = vi.fn()
    const stop = startServerStateSync(serverApi)
    const unsubscribe = onServerConfigUpdated(configListener)

    emitServerConfigSnapshot(baseServerConfig)

    await waitFor(() => {
      expect(getServerConfig()).toEqual(baseServerConfig)
    })

    expect(serverApi.subscribeConfig).toHaveBeenCalledOnce()
    expect(serverApi.subscribeLifecycle).toHaveBeenCalledOnce()
    expect(configListener).toHaveBeenCalledWith(buildExpectedServerConfigSummary(), 'snapshot')

    const lateListener = vi.fn()
    const unsubscribeLate = onServerConfigUpdated(lateListener)
    expect(lateListener).toHaveBeenCalledWith(buildExpectedServerConfigSummary(), 'snapshot')

    unsubscribeLate()
    unsubscribe()
    stop()
  })

  it('keeps the latest streamed snapshot when later snapshots arrive', async () => {
    const stop = startServerStateSync(serverApi)

    const streamedConfig: ServerConfig = {
      ...baseServerConfig,
      cwd: '/tmp/from-stream',
    }

    emitServerConfigSnapshot(streamedConfig)

    await waitFor(() => {
      expect(getServerConfig()).toEqual(streamedConfig)
    })

    emitServerConfigSnapshot(baseServerConfig)

    await waitFor(() => {
      expect(getServerConfig()).toEqual(baseServerConfig)
    })
    stop()
  })
})

describe('serverState lifecycle replay', () => {
  it('replays welcome events to late subscribers', async () => {
    const stop = startServerStateSync(serverApi)

    const listener = vi.fn()
    const unsubscribe = onWelcome(listener)

    emitLifecycleEvent({
      version: 1,
      sequence: 1,
      type: 'welcome',
      payload: {
        cwd: '/tmp/workspace',
        projectName: 'orxa-code',
        bootstrapProjectId: ProjectId.makeUnsafe('project-1'),
        bootstrapThreadId: ThreadId.makeUnsafe('thread-1'),
      },
    })

    expect(listener).toHaveBeenCalledWith({
      cwd: '/tmp/workspace',
      projectName: 'orxa-code',
      bootstrapProjectId: ProjectId.makeUnsafe('project-1'),
      bootstrapThreadId: ThreadId.makeUnsafe('thread-1'),
    })

    const lateListener = vi.fn()
    const unsubscribeLate = onWelcome(lateListener)
    expect(lateListener).toHaveBeenCalledWith({
      cwd: '/tmp/workspace',
      projectName: 'orxa-code',
      bootstrapProjectId: ProjectId.makeUnsafe('project-1'),
      bootstrapThreadId: ThreadId.makeUnsafe('thread-1'),
    })

    unsubscribeLate()
    unsubscribe()
    stop()
  })
})

describe('serverState config updates', () => {
  it('merges provider, settings, and keybinding updates into the cached config', async () => {
    const configListener = vi.fn()
    const providersListener = vi.fn()
    const stop = startServerStateSync(serverApi)
    const unsubscribeConfig = onServerConfigUpdated(configListener)
    const unsubscribeProviders = onProvidersUpdated(providersListener)

    emitServerConfigSnapshot(baseServerConfig)

    await waitFor(() => {
      expect(getServerConfig()).toEqual(baseServerConfig)
    })

    const keybindingIssues = [
      { kind: 'keybindings.malformed-config', message: 'bad json' },
    ] as const
    const updatedSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      enableAssistantStreaming: true,
    }
    const nextProviders = createWarningProviders()

    emitServerConfigUpdates({
      issues: keybindingIssues,
      providers: nextProviders,
      settings: updatedSettings,
    })

    await waitFor(() => {
      expect(getServerConfig()).toEqual({
        ...baseServerConfig,
        issues: keybindingIssues,
        providers: nextProviders,
        settings: updatedSettings,
      })
    })

    expect(providersListener).toHaveBeenLastCalledWith({ providers: nextProviders })
    expectConfigListenerCall(
      configListener,
      2,
      buildExpectedServerConfigSummary({ issues: keybindingIssues }),
      'keybindingsUpdated'
    )
    expectConfigListenerCall(
      configListener,
      3,
      buildExpectedServerConfigSummary({ issues: keybindingIssues, providers: nextProviders }),
      'providerStatuses'
    )
    expect(configListener).toHaveBeenLastCalledWith(
      buildExpectedServerConfigSummary({
        issues: keybindingIssues,
        providers: nextProviders,
        settings: updatedSettings,
      }),
      'settingsUpdated'
    )

    unsubscribeProviders()
    unsubscribeConfig()
    stop()
  })
})
