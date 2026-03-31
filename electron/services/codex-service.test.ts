/** @vitest-environment node */

import { describe, expect, it, vi } from 'vitest'

const { createInterfaceMock, spawnMock } = vi.hoisted(() => ({
  createInterfaceMock: vi.fn(),
  spawnMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

vi.mock('node:readline', () => ({
  createInterface: createInterfaceMock,
}))

import { buildRunMetadataPrompt, CodexService, parseRunMetadataValue } from './codex-service'
import {
  ProviderSessionDirectory,
  makeProviderRuntimeSessionKey,
} from './provider-session-directory'

function createMockCodexProcess() {
  const lineListeners: Array<(line: string) => void> = []
  const errorListeners: Array<(error: Error) => void> = []
  const exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = []
  const stderrListeners: Array<(chunk: Buffer) => void> = []

  const child = {
    stdin: {
      writable: true,
      write: vi.fn((chunk: string) => {
        const message = JSON.parse(chunk.trim()) as { id?: number; method?: string }
        if (typeof message.id !== 'number' || typeof message.method !== 'string') {
          return true
        }

        const result =
          message.method === 'initialize'
            ? { serverInfo: { name: 'codex', version: '1.0.0' } }
            : message.method === 'model/list'
              ? { data: [] }
              : message.method === 'collaborationMode/list'
                ? { data: [] }
                : {}

        queueMicrotask(() => {
          const line = JSON.stringify({ id: message.id, result })
          lineListeners.forEach(listener => listener(line))
        })
        return true
      }),
    },
    stdout: {},
    stderr: {
      on: vi.fn((event: string, listener: (chunk: Buffer) => void) => {
        if (event === 'data') {
          stderrListeners.push(listener)
        }
      }),
    },
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      if (event === 'error') {
        errorListeners.push(listener as (error: Error) => void)
      }
      if (event === 'exit') {
        exitListeners.push(
          listener as (code: number | null, signal: NodeJS.Signals | null) => void
        )
      }
    }),
    kill: vi.fn(),
    emitError: (error: Error) => errorListeners.forEach(listener => listener(error)),
    emitExit: (code: number | null, signal: NodeJS.Signals | null = null) =>
      exitListeners.forEach(listener => listener(code, signal)),
    emitStderr: (chunk: string) =>
      stderrListeners.forEach(listener => listener(Buffer.from(chunk))),
  }

  createInterfaceMock.mockReturnValue({
    on: vi.fn((event: string, listener: (line: string) => void) => {
      if (event === 'line') {
        lineListeners.push(listener)
      }
    }),
    close: vi.fn(),
  })

  return child
}

describe('CodexService metadata helpers', () => {
  it('builds the metadata prompt with the task text', () => {
    const prompt = buildRunMetadataPrompt('Fix the workspace sidebar race')

    expect(prompt).toContain('Return ONLY a JSON object')
    expect(prompt).toContain('Fix the workspace sidebar race')
  })

  it('parses JSON metadata responses', () => {
    expect(
      parseRunMetadataValue(
        '{"title":"Fix Workspace Session Naming","worktreeName":"fix/workspace-session-naming"}'
      )
    ).toEqual({
      title: 'Fix Workspace Session Naming',
      worktreeName: 'fix/workspace-session-naming',
    })
  })

  it('parses metadata wrapped in surrounding text', () => {
    expect(
      parseRunMetadataValue(
        'Result:\n{"title":"Add Codex Thread Rename","worktreeName":"feat/codex-thread-rename"}\nDone.'
      )
    ).toEqual({
      title: 'Add Codex Thread Rename',
      worktreeName: 'feat/codex-thread-rename',
    })
  })

  it('throws when metadata is missing required fields', () => {
    expect(() => parseRunMetadataValue('{"title":""}')).toThrow(/missing title|missing worktree/i)
  })
})

describe('CodexService archive semantics', () => {
  it('treats a missing rollout during archive as already archived', async () => {
    const service = new CodexService()
    const request = vi.fn(async (method: string) => {
      if (method === 'thread/archive') {
        throw new Error('no rollout found for thread id 019d0aab-c237-7783-8e5f-bf32a98f72e1')
      }
      return {}
    })
    const ensureConnected = vi.fn(async () => undefined)
    const cleanupThreadMappings = vi.fn()

    Object.assign(service as unknown as Record<string, unknown>, {
      request,
      ensureConnected,
      cleanupThreadMappings,
    })

    await expect(
      service.archiveThread('019d0aab-c237-7783-8e5f-bf32a98f72e1')
    ).resolves.toBeUndefined()
    expect(ensureConnected).toHaveBeenCalled()
    expect(request).toHaveBeenCalledWith('thread/archive', {
      threadId: '019d0aab-c237-7783-8e5f-bf32a98f72e1',
    })
    expect(cleanupThreadMappings).toHaveBeenCalledWith('019d0aab-c237-7783-8e5f-bf32a98f72e1')
  })

  it('still throws archive errors that are not missing-rollout cases', async () => {
    const service = new CodexService()
    const request = vi.fn(async (method: string) => {
      if (method === 'thread/archive') {
        throw new Error('permission denied')
      }
      return {}
    })

    Object.assign(service as unknown as Record<string, unknown>, {
      request,
      ensureConnected: vi.fn(async () => undefined),
      cleanupThreadMappings: vi.fn(),
    })

    await expect(service.archiveThread('thr-1')).rejects.toThrow('permission denied')
  })
})

describe('CodexService startup', () => {
  it('waits for an in-flight startup instead of returning a transient connecting state', async () => {
    spawnMock.mockReset()
    createInterfaceMock.mockReset()
    spawnMock.mockReturnValue(createMockCodexProcess())

    const service = new CodexService()

    const firstStart = service.start('/workspace/project')
    const secondStart = service.start('/workspace/project')
    const [firstState, secondState] = await Promise.all([firstStart, secondStart])

    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(firstState).toMatchObject({
      status: 'connected',
      serverInfo: { name: 'codex', version: '1.0.0' },
    })
    expect(secondState).toEqual(firstState)
  })
})

function registerTurnModeParsingTests() {
  it('parses collaboration modes when app-server omits ids', async () => {
    const service = new CodexService()
    const request = vi.fn(async () => ({
      data: [
        { name: 'Plan', mode: 'plan', model: null, reasoning_effort: 'medium' },
        { name: 'Default', mode: 'default', model: null, reasoning_effort: null },
      ],
    }))

    Object.assign(service as unknown as Record<string, unknown>, {
      process: {} as object,
      ensureConnected: vi.fn(async () => undefined),
      request,
    })

    await expect(service.listCollaborationModes()).resolves.toEqual([
      {
        id: 'plan',
        label: 'Plan',
        mode: 'plan',
        model: '',
        reasoningEffort: 'medium',
        developerInstructions: '',
      },
      {
        id: 'default',
        label: 'Default',
        mode: 'default',
        model: '',
        reasoningEffort: '',
        developerInstructions: '',
      },
    ])
  })
}

function registerTurnModeStartTests() {
  it('includes required collaboration mode settings when starting a turn', async () => {
    const service = new CodexService()
    const request = vi.fn(async () => ({}))

    Object.assign(service as unknown as Record<string, unknown>, {
      request,
      _collaborationModes: [
        {
          id: 'default',
          label: 'Default',
          mode: 'default',
          model: 'gpt-5.4',
          reasoningEffort: 'high',
          developerInstructions: '',
        },
      ],
    })

    await service.startTurn({
      threadId: 'thread-1',
      prompt: 'Implement the plan.',
      collaborationMode: 'default',
    })

    expect(request).toHaveBeenCalledWith('turn/start', {
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'Implement the plan.', text_elements: [] }],
      collaborationMode: {
        mode: 'default',
        settings: {
          model: 'gpt-5.4',
          reasoning_effort: 'high',
          developer_instructions: null,
        },
      },
    })
  })
}

function registerTurnResumeTests() {
  it('includes image attachments in turn/start input items', async () => {
    const service = new CodexService()
    const request = vi.fn(async () => ({}))

    Object.assign(service as unknown as Record<string, unknown>, {
      request,
    })

    await service.startTurn({
      threadId: 'thread-1',
      prompt: 'Inspect this image',
      attachments: [{ type: 'image', url: 'data:image/png;base64,AAAA' }],
    })

    expect(request).toHaveBeenCalledWith('turn/start', {
      threadId: 'thread-1',
      input: [
        { type: 'text', text: 'Inspect this image', text_elements: [] },
        { type: 'image', url: 'data:image/png;base64,AAAA' },
      ],
    })
  })

  it('resumes a persisted thread before the first turn after process restart', async () => {
    const directory = new ProviderSessionDirectory()
    directory.upsert({
      provider: 'codex',
      sessionKey: makeProviderRuntimeSessionKey('codex', '/workspace', 'thread-restore'),
      status: 'running',
      resumeCursor: { threadId: 'thread-restore' },
      runtimePayload: { directory: '/workspace' },
    })
    const service = new CodexService(directory)
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'thread/resume') {
        return { thread: { id: params.threadId } }
      }
      return {}
    })
    vi.spyOn(
      service as unknown as { ensureConnected: (cwd?: string) => Promise<void> },
      'ensureConnected'
    ).mockResolvedValue(undefined)

    Object.assign(service as unknown as Record<string, unknown>, {
      process: {} as object,
      request,
    })

    await service.startTurn({
      threadId: 'thread-restore',
      prompt: 'Continue the existing thread',
    })

    expect(request).toHaveBeenNthCalledWith(1, 'thread/resume', { threadId: 'thread-restore' })
    expect(request).toHaveBeenNthCalledWith(2, 'turn/start', {
      threadId: 'thread-restore',
      input: [{ type: 'text', text: 'Continue the existing thread', text_elements: [] }],
    })
  })
}

function registerLegacyResumeTests() {
  it('falls back to stored thread settings when plan acceptance omits model and effort', async () => {
    const service = new CodexService()
    const request = vi.fn(async () => ({}))

    Object.assign(service as unknown as Record<string, unknown>, {
      request,
      _collaborationModes: [
        {
          id: 'default',
          label: 'Default',
          mode: 'default',
          model: '',
          reasoningEffort: '',
          developerInstructions: '',
        },
      ],
      threadSettings: new Map([['thread-1', { model: 'gpt-5.4', reasoningEffort: 'medium' }]]),
    })

    await service.startTurn({
      threadId: 'thread-1',
      prompt: 'Implement the plan.',
      collaborationMode: 'default',
    })

    expect(request).toHaveBeenCalledWith('turn/start', {
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'Implement the plan.', text_elements: [] }],
      collaborationMode: {
        mode: 'default',
        settings: {
          model: 'gpt-5.4',
          reasoning_effort: 'medium',
          developer_instructions: null,
        },
      },
    })
  })

  it('seeds the provider directory from legacy persisted Codex thread state', async () => {
    const directory = new ProviderSessionDirectory()
    vi.spyOn(directory, 'getLegacyRendererValue').mockReturnValue(
      JSON.stringify({
        thread: { id: 'thread-legacy' },
        messages: [],
        isStreaming: false,
        messageIdCounter: 0,
      })
    )
    const service = new CodexService(directory)
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'thread/resume') {
        return { thread: { id: params.threadId } }
      }
      return {}
    })
    vi.spyOn(
      service as unknown as { ensureConnected: (cwd?: string) => Promise<void> },
      'ensureConnected'
    ).mockResolvedValue(undefined)

    Object.assign(service as unknown as Record<string, unknown>, {
      process: {} as object,
      request,
    })

    await service.startTurn({
      threadId: 'thread-legacy',
      prompt: 'Continue the migrated thread',
      cwd: '/workspace',
    })

    expect(
      directory.getBinding(
        makeProviderRuntimeSessionKey('codex', '/workspace', 'thread-legacy'),
        'codex'
      )
    ).toEqual(
      expect.objectContaining({
        resumeCursor: { threadId: 'thread-legacy' },
      })
    )
    expect(request).toHaveBeenCalledWith('thread/resume', { threadId: 'thread-legacy' })
  })
}

function registerImageAndSteerTests() {
  it('supports image-only Codex turns', async () => {
    const service = new CodexService()
    const request = vi.fn(async () => ({}))

    Object.assign(service as unknown as Record<string, unknown>, {
      request,
    })

    await service.startTurn({
      threadId: 'thread-1',
      prompt: '',
      attachments: [{ type: 'image', url: 'data:image/png;base64,BBBB' }],
    })

    expect(request).toHaveBeenCalledWith('turn/start', {
      threadId: 'thread-1',
      input: [{ type: 'image', url: 'data:image/png;base64,BBBB' }],
    })
  })

  it('sends turn/steer with expectedTurnId and text input', async () => {
    const service = new CodexService()
    const request = vi.fn(async () => ({}))

    Object.assign(service as unknown as Record<string, unknown>, {
      request,
    })

    await service.steerTurn('thread-1', 'turn-1', 'continue with this')

    expect(request).toHaveBeenCalledWith('turn/steer', {
      threadId: 'thread-1',
      expectedTurnId: 'turn-1',
      input: [{ type: 'text', text: 'continue with this', text_elements: [] }],
    })
  })
}

describe('CodexService turn steering', () => {
  registerTurnModeParsingTests()
  registerTurnModeStartTests()
  registerTurnResumeTests()
  registerLegacyResumeTests()
  registerImageAndSteerTests()
})
