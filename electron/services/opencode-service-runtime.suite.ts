import { createServer } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import {
  buildManagedRuntimeConfigOverride,
  buildManagedServerEnv,
  compareOpencodeVersions,
  eventSessionIDFromOpencodeEvent,
  OpencodeService,
  pickLatestManagedOpencodeBinary,
  resolveManagedServerLaunchPort,
} from './opencode-service'
import { createSessionMessageBundle } from '../../src/test/session-message-bundle-factory'

vi.mock('electron', () => ({
  app: {
    getName: () => 'Orxa Code Test',
    getPath: () => '/tmp/orxa-opencode-service-test',
  },
}))

describe('OpencodeService abortSession', () => {
  it('aborts delegated child sessions before the parent session', async () => {
    const service = Object.create(OpencodeService.prototype) as {
      abortSession: (directory: string, sessionID: string) => Promise<boolean>
      ensureWorkspaceDirectory: (directory: string) => string
      loadMessages: (
        directory: string,
        sessionID: string
      ) => Promise<ReturnType<typeof createSessionMessageBundle>[]>
      client: (directory: string) => {
        session: { abort: (payload: { directory: string; sessionID: string }) => Promise<void> }
      }
    }

    const now = Date.now()
    const abortMock = vi.fn(async () => undefined)
    service.ensureWorkspaceDirectory = (directory: string) => directory
    service.client = () => ({ session: { abort: abortMock } })
    service.loadMessages = vi.fn(async (_directory: string, sessionID: string) => {
      if (sessionID === 'root-session') {
        return [
          createSessionMessageBundle({
            id: 'assistant-root',
            role: 'assistant',
            sessionID,
            createdAt: now,
            parts: [
              {
                id: 'subtask-root',
                type: 'subtask',
                sessionID: 'child-session',
                messageID: 'assistant-root',
                prompt: 'Inspect the booking stack.',
                description: 'Inspect booking stack',
                agent: 'explorer',
                model: { providerID: 'openai', modelID: 'gpt-5.4' },
              },
            ],
          }),
        ]
      }
      if (sessionID === 'child-session') {
        return [
          createSessionMessageBundle({
            id: 'assistant-child',
            role: 'assistant',
            sessionID,
            createdAt: now + 1,
            parts: [
              {
                id: 'subtask-child',
                type: 'subtask',
                sessionID: 'grandchild-session',
                messageID: 'assistant-child',
                prompt: 'Inspect the schema.',
                description: 'Inspect schema',
                agent: 'librarian',
                model: { providerID: 'openai', modelID: 'gpt-5.4' },
              },
            ],
          }),
        ]
      }
      return []
    })

    await service.abortSession('/repo', 'root-session')

    expect(
      abortMock.mock.calls.map((call: unknown[]) => {
        const payload = call.at(0) as { sessionID: string } | undefined
        return payload?.sessionID
      })
    ).toEqual(['grandchild-session', 'child-session', 'root-session'])
  })
})

describe('OpencodeService refreshProjectDelta', () => {
  it('fetches only dynamic workspace slices for high-frequency sync paths', async () => {
    const service = Object.create(OpencodeService.prototype) as {
      refreshProjectDelta: (directory: string) => Promise<{
        directory: string
        sessions: unknown[]
        sessionStatus: Record<string, unknown>
        permissions: unknown[]
        questions: unknown[]
        commands: unknown[]
        ptys: unknown[]
      }>
      ensureWorkspaceDirectory: (directory: string) => string
      unwrap: <T>(value: T) => Promise<T>
      client: (directory: string) => {
        session: {
          list: (payload: unknown) => Promise<unknown[]>
          status: (payload: unknown) => Promise<Record<string, unknown>>
        }
        permission: { list: (payload: unknown) => Promise<unknown[]> }
        question: { list: (payload: unknown) => Promise<unknown[]> }
        command: { list: (payload: unknown) => Promise<unknown[]> }
      }
      recordPerf: ReturnType<typeof vi.fn>
    }

    const listSessions = vi.fn(async () => [{ id: 'session-1' }])
    const listStatus = vi.fn(async () => ({ 'session-1': { type: 'busy' } }))
    const listPermissions = vi.fn(async () => [{ id: 'perm-1' }])
    const listQuestions = vi.fn(async () => [{ id: 'question-1' }])
    const listCommands = vi.fn(async () => [{ id: 'command-1' }])

    service.ensureWorkspaceDirectory = directory => directory
    service.unwrap = vi.fn(async value => value)
    service.client = () => ({
      session: {
        list: listSessions,
        status: listStatus,
      },
      permission: { list: listPermissions },
      question: { list: listQuestions },
      command: { list: listCommands },
    })
    service.recordPerf = vi.fn()

    const result = await service.refreshProjectDelta('/repo')

    expect(result).toEqual({
      directory: '/repo',
      sessions: [{ id: 'session-1' }],
      sessionStatus: { 'session-1': { type: 'busy' } },
      permissions: [{ id: 'perm-1' }],
      questions: [{ id: 'question-1' }],
      commands: [{ id: 'command-1' }],
      ptys: [],
    })
    expect(listSessions).toHaveBeenCalledTimes(1)
    expect(listStatus).toHaveBeenCalledTimes(1)
    expect(listPermissions).toHaveBeenCalledTimes(1)
    expect(listQuestions).toHaveBeenCalledTimes(1)
    expect(listCommands).toHaveBeenCalledTimes(1)
    expect(service.recordPerf).toHaveBeenCalledWith(
      'opencode.refresh_project_delta_ms',
      expect.any(Number),
      expect.objectContaining({ workspaceHash: '/repo' })
    )
  })
})

describe('OpencodeService replayProjectEvents', () => {
  it('returns buffered project events after the requested cursor', async () => {
    const service = Object.create(OpencodeService.prototype) as {
      replayProjectEvents: (
        directory: string,
        cursor?: number
      ) => Promise<{
        directory: string
        cursor: number
        events: Array<{ cursor: number; event: { type: string } }>
      }>
      ensureWorkspaceDirectory: (directory: string) => string
      projectEventCursorByDirectory: Map<string, number>
      projectEventReplayByDirectory: Map<string, Array<{ cursor: number; event: { type: string } }>>
      projectEventReplayHydratedDirectories: Set<string>
    }

    service.ensureWorkspaceDirectory = directory => directory
    service.projectEventCursorByDirectory = new Map([['/repo', 5]])
    service.projectEventReplayByDirectory = new Map([
      [
        '/repo',
        [
          { cursor: 3, event: { type: 'session.updated' } },
          { cursor: 4, event: { type: 'message.updated' } },
          { cursor: 5, event: { type: 'session.idle' } },
        ],
      ],
    ])
    service.projectEventReplayHydratedDirectories = new Set(['/repo'])

    const replay = await service.replayProjectEvents('/repo', 3)

    expect(replay).toEqual({
      directory: '/repo',
      cursor: 5,
      events: [
        { cursor: 4, event: { type: 'message.updated' } },
        { cursor: 5, event: { type: 'session.idle' } },
      ],
    })
  })

  it('fails when requested cursor is older than buffered range', async () => {
    const service = Object.create(OpencodeService.prototype) as {
      replayProjectEvents: (directory: string, cursor?: number) => Promise<unknown>
      ensureWorkspaceDirectory: (directory: string) => string
      projectEventCursorByDirectory: Map<string, number>
      projectEventReplayByDirectory: Map<string, Array<{ cursor: number; event: { type: string } }>>
      projectEventReplayHydratedDirectories: Set<string>
    }

    service.ensureWorkspaceDirectory = directory => directory
    service.projectEventCursorByDirectory = new Map([['/repo', 10]])
    service.projectEventReplayByDirectory = new Map([
      [
        '/repo',
        [
          { cursor: 8, event: { type: 'session.updated' } },
          { cursor: 9, event: { type: 'message.updated' } },
          { cursor: 10, event: { type: 'session.idle' } },
        ],
      ],
    ])
    service.projectEventReplayHydratedDirectories = new Set(['/repo'])

    await expect(service.replayProjectEvents('/repo', 7)).rejects.toThrow(
      'project-event-replay-cursor-expired'
    )
  })

  it('hydrates persisted replay state when in-memory replay ring is empty', async () => {
    const getBinding = vi.fn(() => ({
      provider: 'opencode',
      sessionKey: 'opencode::/repo::__project-stream-events__',
      status: 'running',
      resumeCursor: { directory: '/repo', cursor: 6 },
      runtimePayload: {
        cursor: 6,
        events: [
          { cursor: 5, event: { type: 'message.updated', properties: { sessionID: 'session-1' } } },
          { cursor: 6, event: { type: 'session.idle', properties: { sessionID: 'session-1' } } },
        ],
      },
      updatedAt: new Date().toISOString(),
    }))

    const service = Object.create(OpencodeService.prototype) as {
      replayProjectEvents: (
        directory: string,
        cursor?: number
      ) => Promise<{
        directory: string
        cursor: number
        events: Array<{ cursor: number; event: { type: string } }>
      }>
      ensureWorkspaceDirectory: (directory: string) => string
      projectEventCursorByDirectory: Map<string, number>
      projectEventReplayByDirectory: Map<string, Array<{ cursor: number; event: { type: string } }>>
      projectEventReplayHydratedDirectories: Set<string>
      providerSessionDirectory: { getBinding: ReturnType<typeof vi.fn> }
    }

    service.ensureWorkspaceDirectory = directory => directory
    service.projectEventCursorByDirectory = new Map()
    service.projectEventReplayByDirectory = new Map()
    service.projectEventReplayHydratedDirectories = new Set()
    service.providerSessionDirectory = { getBinding }

    const replay = await service.replayProjectEvents('/repo', 4)

    expect(getBinding).toHaveBeenCalledTimes(1)
    expect(replay).toEqual({
      directory: '/repo',
      cursor: 6,
      events: [
        { cursor: 5, event: { type: 'message.updated', properties: { sessionID: 'session-1' } } },
        { cursor: 6, event: { type: 'session.idle', properties: { sessionID: 'session-1' } } },
      ],
    })
  })
})

describe('OpencodeService runtime dependency detection', () => {
  it('marks opencode installed when shell fallback succeeds', async () => {
    const service = Object.create(OpencodeService.prototype) as {
      checkRuntimeDependencies: () => Promise<{
        dependencies: Array<{ key: 'opencode' | 'orxa'; installed: boolean }>
      }>
      canRunCommand: ReturnType<typeof vi.fn>
      commandPathCandidates: ReturnType<typeof vi.fn>
      canRunCommandViaLoginShell: ReturnType<typeof vi.fn>
    }

    service.canRunCommand = vi.fn(async () => false)
    service.commandPathCandidates = vi.fn(async () => [])
    service.canRunCommandViaLoginShell = vi.fn(async (command: string) => command === 'opencode')

    const report = await service.checkRuntimeDependencies()
    const opencode = report.dependencies.find(item => item.key === 'opencode')

    expect(opencode?.installed).toBe(true)
    expect(service.canRunCommandViaLoginShell).toHaveBeenCalledWith(
      'opencode',
      ['--version'],
      expect.any(String)
    )
  })

  it('marks opencode missing when direct and shell checks fail', async () => {
    const service = Object.create(OpencodeService.prototype) as {
      checkRuntimeDependencies: () => Promise<{
        dependencies: Array<{ key: 'opencode' | 'orxa'; installed: boolean }>
      }>
      canRunCommand: ReturnType<typeof vi.fn>
      commandPathCandidates: ReturnType<typeof vi.fn>
      canRunCommandViaLoginShell: ReturnType<typeof vi.fn>
    }

    service.canRunCommand = vi.fn(async () => false)
    service.commandPathCandidates = vi.fn(async () => [])
    service.canRunCommandViaLoginShell = vi.fn(async () => false)

    const report = await service.checkRuntimeDependencies()
    const opencode = report.dependencies.find(item => item.key === 'opencode')

    expect(opencode?.installed).toBe(false)
  })
})

describe('eventSessionIDFromOpencodeEvent', () => {
  it('extracts sessionID from stream event properties', () => {
    const sessionID = eventSessionIDFromOpencodeEvent({
      type: 'session.status',
      properties: {
        sessionID: 'session-123',
        status: { type: 'busy' },
      },
    } as unknown as Parameters<typeof eventSessionIDFromOpencodeEvent>[0])

    expect(sessionID).toBe('session-123')
  })

  it('returns undefined when stream event has no sessionID', () => {
    const sessionID = eventSessionIDFromOpencodeEvent({
      type: 'project.updated',
      properties: {
        directory: '/repo',
      },
    } as unknown as Parameters<typeof eventSessionIDFromOpencodeEvent>[0])

    expect(sessionID).toBeUndefined()
  })
})

it('selects the newest locally available OpenCode binary on macOS', async () => {
  const service = Object.create(OpencodeService.prototype) as {
    resolveBinary: (customPath?: string) => Promise<string>
    runCommandWithOutput: ReturnType<typeof vi.fn>
  }

  service.runCommandWithOutput = vi.fn(async (command: string) => {
    if (command === '/Applications/OpenCode.app/Contents/MacOS/opencode-cli') {
      return '1.2.27\n'
    }
    if (command === 'opencode') {
      return '1.2.26\n'
    }
    throw new Error(`Unexpected binary: ${command}`)
  })

  const result = await service.resolveBinary(undefined)

  if (process.platform === 'darwin') {
    expect(result).toBe('/Applications/OpenCode.app/Contents/MacOS/opencode-cli')
    expect(service.runCommandWithOutput).toHaveBeenCalledWith(
      '/Applications/OpenCode.app/Contents/MacOS/opencode-cli',
      ['--version'],
      expect.any(String)
    )
    expect(service.runCommandWithOutput).toHaveBeenCalledWith(
      'opencode',
      ['--version'],
      expect.any(String)
    )
  } else {
    expect(result).toBe('opencode')
  }
})

it('keeps the global opencode CLI when it matches or exceeds other local versions', async () => {
  const service = Object.create(OpencodeService.prototype) as {
    resolveBinary: (customPath?: string) => Promise<string>
    runCommandWithOutput: ReturnType<typeof vi.fn>
  }

  service.runCommandWithOutput = vi.fn(async (command: string) => {
    if (command === '/Applications/OpenCode.app/Contents/MacOS/opencode-cli') {
      return '1.2.27\n'
    }
    if (command === 'opencode') {
      return '1.2.27\n'
    }
    throw new Error(`Unexpected binary: ${command}`)
  })

  const result = await service.resolveBinary(undefined)

  expect(result).toBe('opencode')
})

it('starts the managed local runtime instead of attaching to an arbitrary existing server', async () => {
  const service = Object.create(OpencodeService.prototype) as {
    initializeFromStoredProfile: () => Promise<{ status: string }>
    profileStore: {
      list: () => Array<{
        id: string
        startCommand: boolean
        host: string
        port: number
        https: boolean
      }>
      activeProfileId: () => string | undefined
    }
    startLocal: ReturnType<typeof vi.fn>
    attach: ReturnType<typeof vi.fn>
    runtimeState: () => { status: string }
    setState: (next: unknown) => void
    managedProcess?: unknown
  }

  service.profileStore = {
    list: () => [
      { id: 'local-profile', startCommand: true, host: '127.0.0.1', port: 4096, https: false },
    ],
    activeProfileId: () => 'local-profile',
  }
  service.startLocal = vi.fn(async () => ({ status: 'connected' }))
  service.attach = vi.fn(async () => ({ status: 'connected' }))
  service.runtimeState = () => ({ status: 'connected' })
  service.setState = () => undefined

  const runtime = await service.initializeFromStoredProfile()

  expect(service.startLocal).toHaveBeenCalledWith('local-profile')
  expect(service.attach).not.toHaveBeenCalled()
  expect(runtime.status).toBe('connected')
})

it('falls back to an ephemeral port when the preferred managed runtime port is already occupied', async () => {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const occupiedPort = (server.address() as { port: number }).port

  try {
    await expect(resolveManagedServerLaunchPort('127.0.0.1', occupiedPort)).resolves.toBe(0)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()))
    })
  }
})

it('strips repo-local runtime and package-manager variables from the managed server environment', () => {
  const env = buildManagedServerEnv({
    PATH: '/usr/bin',
    HOME: '/Users/test',
    INIT_CWD: '/Volumes/ExtSSD/Repos/macapp/OpencodeOrxa',
    NODE_ENV: 'development',
    NODE_PATH: '/Users/callumspencer/Repos/macapp/orxacode/node_modules',
    OLDPWD: '/Users/callumspencer',
    OPENCODE_TEST_HOME: '/tmp/test-home',
    PNPM_SCRIPT_SRC_DIR: '/Volumes/ExtSSD/Repos/macapp/OpencodeOrxa',
    PWD: '/Users/callumspencer/Repos/macapp/orxacode',
    VITE_DEV_SERVER_URL: 'http://localhost:5173',
    npm_config_user_agent: 'pnpm/10.29.3',
    npm_package_name: 'opencode-orxa',
    npm_lifecycle_event: 'dev',
    pnpm_config_verify_deps_before_run: 'false',
  })

  expect(env.PATH).toBe('/usr/bin')
  expect(env.HOME).toBe('/Users/test')
  expect(env.INIT_CWD).toBeUndefined()
  expect(env.NODE_ENV).toBeUndefined()
  expect(env.NODE_PATH).toBeUndefined()
  expect(env.OLDPWD).toBeUndefined()
  expect(env.OPENCODE_TEST_HOME).toBeUndefined()
  expect(env.PNPM_SCRIPT_SRC_DIR).toBeUndefined()
  expect(env.PWD).toBeUndefined()
  expect(env.VITE_DEV_SERVER_URL).toBeUndefined()
  expect(env.npm_config_user_agent).toBeUndefined()
  expect(env.npm_package_name).toBeUndefined()
  expect(env.npm_lifecycle_event).toBeUndefined()
  expect(env.pnpm_config_verify_deps_before_run).toBeUndefined()
})

it('does not rely on OPENCODE_TEST_HOME for the managed runtime environment', () => {
  const service = Object.create(OpencodeService.prototype)
  const env = (
    service as unknown as {
      buildManagedRuntimeEnv: (baseEnv: NodeJS.ProcessEnv) => NodeJS.ProcessEnv
    }
  ).buildManagedRuntimeEnv({
    HOME: '/Users/test',
    OPENCODE_TEST_HOME: '/tmp/should-not-leak',
    XDG_DATA_HOME: '/tmp/managed/data',
  })

  expect(env.OPENCODE_TEST_HOME).toBeUndefined()
  expect(env.XDG_DATA_HOME).toBeUndefined()
  expect(env.OPENCODE_CONFIG_DIR).toBe('/Users/test/.config/opencode')
  expect(env.OPENCODE_CONFIG_CONTENT).toBe(JSON.stringify({ plugin: [] }))
})

it('uses a minimal managed runtime config override', () => {
  expect(buildManagedRuntimeConfigOverride()).toBe(JSON.stringify({ plugin: [] }))
})

it('compares OpenCode versions numerically', () => {
  expect(compareOpencodeVersions('1.2.27', '1.2.26')).toBe(1)
  expect(compareOpencodeVersions('1.2.26', '1.2.27')).toBe(-1)
  expect(compareOpencodeVersions('1.2.27', '1.2.27')).toBe(0)
  expect(compareOpencodeVersions('1.10.0', '1.2.99')).toBe(1)
})

it('selects the latest managed binary from pure launch inputs', () => {
  expect(
    pickLatestManagedOpencodeBinary({
      platform: 'darwin',
      candidates: [
        { path: 'opencode', version: '1.2.26' },
        { path: '/Applications/OpenCode.app/Contents/MacOS/opencode-cli', version: '1.2.27' },
      ],
    })
  ).toBe('/Applications/OpenCode.app/Contents/MacOS/opencode-cli')
  expect(
    pickLatestManagedOpencodeBinary({
      platform: 'darwin',
      candidates: [
        { path: 'opencode', version: '1.2.27' },
        { path: '/Applications/OpenCode.app/Contents/MacOS/opencode-cli', version: '1.2.27' },
      ],
    })
  ).toBe('opencode')
  expect(
    pickLatestManagedOpencodeBinary({
      platform: 'linux',
      candidates: [
        { path: 'opencode', version: '1.2.26' },
        { path: '/Applications/OpenCode.app/Contents/MacOS/opencode-cli', version: '1.2.27' },
      ],
    })
  ).toBe('opencode')
})

it("keeps using the launched managed server URL during attach instead of the profile's stale port", async () => {
  const setState = vi.fn()
  const startGlobalStream = vi.fn()
  const service = Object.create(OpencodeService.prototype) as {
    attach: (profileID: string) => Promise<{ status: string }>
    profileStore: {
      list: () => Array<{ id: string; host: string; port: number; https: boolean }>
      setActiveProfileId: (profileID: string) => void
    }
    basicAuthHeader: (profile: unknown) => Promise<string | undefined>
    setState: typeof setState
    client: () => { global: { health: () => Promise<{ data: unknown }> } }
    runtimeState: () => { status: string }
    startGlobalStream: typeof startGlobalStream
    managedProcess?: unknown
    managedBaseUrl?: string
    activeProfile?: { id: string; host: string; port: number; https: boolean }
    authHeader?: string
  }

  service.profileStore = {
    list: () => [{ id: 'local-profile', host: '127.0.0.1', port: 4096, https: false }],
    setActiveProfileId: () => undefined,
  }
  service.basicAuthHeader = async () => undefined
  service.setState = setState
  service.client = () => ({
    global: { health: async () => ({ data: { ok: true } }) },
  })
  service.runtimeState = () => ({ status: 'connected' })
  service.startGlobalStream = startGlobalStream
  service.managedProcess = { pid: 12345 }
  service.managedBaseUrl = 'http://127.0.0.1:55555'

  const result = await service.attach('local-profile')

  expect(setState).toHaveBeenCalledWith(
    expect.objectContaining({
      status: 'connecting',
      baseUrl: 'http://127.0.0.1:55555',
      managedServer: true,
    })
  )
  expect(setState).toHaveBeenLastCalledWith(
    expect.objectContaining({
      status: 'connected',
      baseUrl: 'http://127.0.0.1:55555',
      managedServer: true,
    })
  )
  expect(startGlobalStream).toHaveBeenCalled()
  expect(result.status).toBe('connected')
})
