import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

import {
  buildSanitizedOpencodeEnv,
  probeOpencodeAuth,
  startOpencodeServer,
  type OpencodeClientFactory,
  type OpencodeSpawner,
  type SpawnedOpencodeProcess,
} from './opencodeAppServer.ts'

interface FakeChildOptions {
  readonly emitErrorOnSpawn?: Error
  readonly autoExit?: boolean
}

class FakeChild extends EventEmitter implements SpawnedOpencodeProcess {
  public pid: number | undefined = 4242
  public killed = false
  public readonly stdout: SpawnedOpencodeProcess['stdout'] = null
  public readonly stderr: SpawnedOpencodeProcess['stderr'] =
    new EventEmitter() as unknown as SpawnedOpencodeProcess['stderr']
  public killSignals: Array<NodeJS.Signals | number | undefined> = []

  constructor(private readonly options: FakeChildOptions = {}) {
    super()
    if (options.emitErrorOnSpawn) {
      queueMicrotask(() => this.emit('error', options.emitErrorOnSpawn))
    }
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killSignals.push(signal)
    this.killed = true
    queueMicrotask(() => this.emit('exit', null, 'SIGTERM'))
    return true
  }

  emitStderr(text: string): void {
    ;(this.stderr as unknown as EventEmitter).emit('data', Buffer.from(text, 'utf8'))
  }
}

interface MakeFakeSpawnerResult {
  readonly spawner: OpencodeSpawner
  readonly children: Array<FakeChild>
  readonly spawnEnvs: Array<NodeJS.ProcessEnv | undefined>
}

function makeFakeSpawner(factory: () => FakeChild): MakeFakeSpawnerResult {
  const children: Array<FakeChild> = []
  const spawnEnvs: Array<NodeJS.ProcessEnv | undefined> = []
  const spawner: OpencodeSpawner = (_binaryPath, _args, options) => {
    const child = factory()
    children.push(child)
    spawnEnvs.push(options.env)
    return child
  }
  return { spawner, children, spawnEnvs }
}

interface FakeProviderListResult {
  readonly data?: { readonly connected?: ReadonlyArray<string> }
  readonly error?: unknown
}

function makeFakeClientFactory(
  result: FakeProviderListResult | (() => Promise<FakeProviderListResult>)
): { factory: OpencodeClientFactory; calls: Array<string> } {
  const calls: Array<string> = []
  const factory: OpencodeClientFactory = config => {
    calls.push(config.baseUrl)
    return {
      provider: {
        list: async () => (typeof result === 'function' ? await result() : result),
      },
    } as unknown as ReturnType<OpencodeClientFactory>
  }
  return { factory, calls }
}

describe('startOpencodeServer happy paths', () => {
  it('returns a client and shutdown when readiness probe succeeds', async () => {
    const { spawner, children } = makeFakeSpawner(() => new FakeChild())
    const { factory, calls } = makeFakeClientFactory({ data: { connected: [] } })

    const probe = vi.fn().mockResolvedValue(true)

    const started = await startOpencodeServer({
      binaryPath: 'opencode',
      spawner,
      clientFactory: factory,
      readinessProbe: probe,
      readinessTimeoutMs: 1_000,
      readinessPollIntervalMs: 5,
    })

    expect(started.client).toBeDefined()
    expect(started.port).toBeGreaterThan(0)
    expect(calls).toEqual([`http://127.0.0.1:${started.port}`])
    expect(probe).toHaveBeenCalled()
    expect(children).toHaveLength(1)
    expect(children[0]?.killed).toBe(false)

    await started.shutdown()
    expect(children[0]?.killed).toBe(true)
  })

  it('shutdown is idempotent and safe to call twice', async () => {
    const { spawner, children } = makeFakeSpawner(() => new FakeChild())
    const { factory } = makeFakeClientFactory({ data: { connected: [] } })

    const started = await startOpencodeServer({
      binaryPath: 'opencode',
      spawner,
      clientFactory: factory,
      readinessProbe: () => Promise.resolve(true),
      readinessTimeoutMs: 1_000,
      readinessPollIntervalMs: 5,
    })

    const first = started.shutdown()
    const second = started.shutdown()
    expect(second).toBe(first)
    await Promise.all([first, second])

    const child = children[0]
    expect(child).toBeDefined()
    expect(child?.killSignals.length ?? 0).toBeLessThanOrEqual(1)
  })
})

describe('startOpencodeServer failures', () => {
  it('rejects with descriptive error when readiness probe times out and kills child', async () => {
    const child = new FakeChild()
    const { spawner, children } = makeFakeSpawner(() => child)
    const { factory } = makeFakeClientFactory({ data: { connected: [] } })

    const probe = vi.fn().mockResolvedValue(false)

    await expect(
      startOpencodeServer({
        binaryPath: 'opencode',
        spawner,
        clientFactory: factory,
        readinessProbe: probe,
        readinessTimeoutMs: 30,
        readinessPollIntervalMs: 5,
      })
    ).rejects.toThrow(/did not become ready/)

    expect(children[0]?.killed).toBe(true)
  })

  it('rejects when the child emits a spawn error and cleans up', async () => {
    const enoent = Object.assign(new Error('spawn opencode ENOENT'), { code: 'ENOENT' })
    const { spawner, children } = makeFakeSpawner(() => new FakeChild({ emitErrorOnSpawn: enoent }))
    const { factory } = makeFakeClientFactory({ data: { connected: [] } })

    const probe = vi.fn().mockResolvedValue(false)

    await expect(
      startOpencodeServer({
        binaryPath: 'opencode',
        spawner,
        clientFactory: factory,
        readinessProbe: probe,
        readinessTimeoutMs: 1_000,
        readinessPollIntervalMs: 5,
      })
    ).rejects.toThrow(/failed to spawn|ENOENT/)

    expect(children[0]?.killed).toBe(true)
  })

  it('appends recent stderr to error message when readiness fails', async () => {
    const { spawner, children } = makeFakeSpawner(() => new FakeChild())
    const { factory } = makeFakeClientFactory({ data: { connected: [] } })

    const probe = vi.fn().mockImplementation(async () => {
      children[0]?.emitStderr('boom: port already in use')
      return false
    })

    await expect(
      startOpencodeServer({
        binaryPath: 'opencode',
        spawner,
        clientFactory: factory,
        readinessProbe: probe,
        readinessTimeoutMs: 30,
        readinessPollIntervalMs: 5,
      })
    ).rejects.toThrow(/Last stderr: boom: port already in use/)
  })
})

describe('buildSanitizedOpencodeEnv', () => {
  it('drops provider API keys from the parent process.env', () => {
    const source: NodeJS.ProcessEnv = {
      PATH: '/usr/bin:/bin',
      HOME: '/Users/test',
      CLOUDFLARE_API_TOKEN: 'fake-cf-token',
      ANTHROPIC_API_KEY: 'fake-anthropic-key',
      OPENAI_API_KEY: 'fake-openai-key',
    }
    const env = buildSanitizedOpencodeEnv(undefined, source)
    expect(env.CLOUDFLARE_API_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.PATH).toBe('/usr/bin:/bin')
    expect(env.HOME).toBe('/Users/test')
  })

  it('passes through core allow-listed keys when present', () => {
    const source: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      HOME: '/Users/test',
      USER: 'test',
      LOGNAME: 'test',
      XDG_CONFIG_HOME: '/Users/test/.config',
      XDG_DATA_HOME: '/Users/test/.local/share',
      XDG_CACHE_HOME: '/Users/test/.cache',
      XDG_STATE_HOME: '/Users/test/.local/state',
      TMPDIR: '/tmp',
      LANG: 'en_US.UTF-8',
      TERM: 'xterm-256color',
      SHELL: '/bin/zsh',
    }
    const env = buildSanitizedOpencodeEnv(undefined, source)
    expect(env.PATH).toBe('/usr/bin')
    expect(env.HOME).toBe('/Users/test')
    expect(env.XDG_CONFIG_HOME).toBe('/Users/test/.config')
    expect(env.XDG_DATA_HOME).toBe('/Users/test/.local/share')
    expect(env.XDG_CACHE_HOME).toBe('/Users/test/.cache')
    expect(env.XDG_STATE_HOME).toBe('/Users/test/.local/state')
    expect(env.TMPDIR).toBe('/tmp')
    expect(env.LANG).toBe('en_US.UTF-8')
    expect(env.TERM).toBe('xterm-256color')
    expect(env.SHELL).toBe('/bin/zsh')
  })

  it('omits missing keys instead of injecting empty strings', () => {
    const source: NodeJS.ProcessEnv = { PATH: '/usr/bin', HOME: '/Users/test' }
    const env = buildSanitizedOpencodeEnv(undefined, source)
    expect('TMPDIR' in env).toBe(false)
    expect('XDG_CONFIG_HOME' in env).toBe(false)
    expect('LC_ALL' in env).toBe(false)
  })

  it('allows overrides to add keys outside the allow-list for scoped use', () => {
    const source: NodeJS.ProcessEnv = { PATH: '/usr/bin' }
    const env = buildSanitizedOpencodeEnv({ OPENCODE_CONFIG: '/tmp/opencode.json' }, source)
    expect(env.PATH).toBe('/usr/bin')
    expect(env.OPENCODE_CONFIG).toBe('/tmp/opencode.json')
  })
})

describe('opencode subprocess env sanitization', () => {
  it('startOpencodeServer spawns the child with only the allow-listed env', async () => {
    const originalCloudflare = process.env.CLOUDFLARE_API_TOKEN
    const originalAnthropic = process.env.ANTHROPIC_API_KEY
    process.env.CLOUDFLARE_API_TOKEN = 'fake-cf-token'
    process.env.ANTHROPIC_API_KEY = 'fake-anthropic-key'
    try {
      const { spawner, spawnEnvs } = makeFakeSpawner(() => new FakeChild())
      const { factory } = makeFakeClientFactory({ data: { connected: [] } })

      const started = await startOpencodeServer({
        binaryPath: 'opencode',
        spawner,
        clientFactory: factory,
        readinessProbe: () => Promise.resolve(true),
        readinessTimeoutMs: 1_000,
        readinessPollIntervalMs: 5,
      })
      try {
        expect(spawnEnvs).toHaveLength(1)
        const spawnEnv = spawnEnvs[0]
        expect(spawnEnv).toBeDefined()
        expect(spawnEnv?.CLOUDFLARE_API_TOKEN).toBeUndefined()
        expect(spawnEnv?.ANTHROPIC_API_KEY).toBeUndefined()
      } finally {
        await started.shutdown()
      }
    } finally {
      if (originalCloudflare === undefined) delete process.env.CLOUDFLARE_API_TOKEN
      else process.env.CLOUDFLARE_API_TOKEN = originalCloudflare
      if (originalAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = originalAnthropic
    }
  })

  it('probeOpencodeAuth spawns the child with only the allow-listed env', async () => {
    const originalCloudflare = process.env.CLOUDFLARE_API_TOKEN
    process.env.CLOUDFLARE_API_TOKEN = 'fake-cf-token'
    try {
      const { spawner, spawnEnvs } = makeFakeSpawner(() => new FakeChild())
      const { factory } = makeFakeClientFactory({ data: { connected: [] } })

      await probeOpencodeAuth({
        binaryPath: 'opencode',
        spawner,
        clientFactory: factory,
        readinessProbe: () => Promise.resolve(true),
        readinessTimeoutMs: 1_000,
      })

      expect(spawnEnvs).toHaveLength(1)
      const spawnEnv = spawnEnvs[0]
      expect(spawnEnv?.CLOUDFLARE_API_TOKEN).toBeUndefined()
    } finally {
      if (originalCloudflare === undefined) delete process.env.CLOUDFLARE_API_TOKEN
      else process.env.CLOUDFLARE_API_TOKEN = originalCloudflare
    }
  })
})

describe('probeOpencodeAuth', () => {
  it('returns the configured providers from provider.list and shuts down', async () => {
    const { spawner, children } = makeFakeSpawner(() => new FakeChild())
    const { factory } = makeFakeClientFactory({
      data: { connected: ['anthropic', 'openai'] },
    })

    const result = await probeOpencodeAuth({
      binaryPath: 'opencode',
      spawner,
      clientFactory: factory,
      readinessProbe: () => Promise.resolve(true),
      readinessTimeoutMs: 1_000,
    })

    expect(result.configuredProviders).toEqual(['anthropic', 'openai'])
    expect(children[0]?.killed).toBe(true)
  })

  it('returns an empty list when the SDK omits connected providers', async () => {
    const { spawner } = makeFakeSpawner(() => new FakeChild())
    const { factory } = makeFakeClientFactory({ data: {} })

    const result = await probeOpencodeAuth({
      binaryPath: 'opencode',
      spawner,
      clientFactory: factory,
      readinessProbe: () => Promise.resolve(true),
      readinessTimeoutMs: 1_000,
    })

    expect(result.configuredProviders).toEqual([])
  })

  it('rejects with the SDK error message and still shuts the server down', async () => {
    const { spawner, children } = makeFakeSpawner(() => new FakeChild())
    const { factory } = makeFakeClientFactory({
      error: { message: 'auth backend offline' },
    })

    await expect(
      probeOpencodeAuth({
        binaryPath: 'opencode',
        spawner,
        clientFactory: factory,
        readinessProbe: () => Promise.resolve(true),
        readinessTimeoutMs: 1_000,
      })
    ).rejects.toThrow(/auth backend offline/)

    expect(children[0]?.killed).toBe(true)
  })
})
