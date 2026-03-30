import { act, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { SessionMessageBundle } from '@shared/ipc'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'
import {
  createProjectBootstrap,
  createRuntimeSnapshot,
  renderWorkspaceStateHook,
  resetWorkspaceStateForTests,
} from './useWorkspaceState.test-helpers'

beforeEach(() => {
  resetWorkspaceStateForTests()
})

it('clears stale busy status when a fresh runtime snapshot no longer confirms it', async () => {
  const directory = '/repo'
  const sessionID = 'session-stale-busy'
  const now = Date.now()
  const getSessionRuntimeMock = vi.fn(async (_directory: string, currentSessionID: string) =>
    createRuntimeSnapshot(directory, currentSessionID, [])
  )

  Object.defineProperty(window, 'orxa', {
    configurable: true,
    value: {
      opencode: {
        selectProject: vi.fn(async () => ({
          ...createProjectBootstrap(directory, [{ id: sessionID, time: { updated: now } }]),
          sessionStatus: { [sessionID]: { type: 'busy' } },
        })),
        refreshProject: vi.fn(async () => ({
          ...createProjectBootstrap(directory, [{ id: sessionID, time: { updated: now } }]),
          sessionStatus: { [sessionID]: { type: 'busy' } },
        })),
        createSession: vi.fn(async () => ({
          id: 'unused',
          slug: 'unused',
          title: 'unused',
          time: { created: now, updated: now },
        })),
        getSessionRuntime: getSessionRuntimeMock,
        sendPrompt: vi.fn(async () => true),
      },
    },
  })

  const { result } = renderWorkspaceStateHook()

  await act(async () => {
    await (
      result.current.selectProject as unknown as (
        directory: string,
        options?: unknown
      ) => Promise<void>
    )(directory, { showLanding: false, sessionID })
  })

  await act(async () => {
    await result.current.selectSession(sessionID, directory)
  })

  await waitFor(() => {
    const runtime =
      useUnifiedRuntimeStore.getState().opencodeSessions[`opencode::${directory}::${sessionID}`]
        ?.runtimeSnapshot
    expect(runtime?.sessionStatus?.type).toBe('idle')
  })
})

it('refreshes messages immediately after sending the initial prompt for a new session', async () => {
  const directory = '/repo'
  const now = Date.now()
  const createdSession = {
    id: 'session-created',
    slug: 'session-created',
    title: 'Which agent are you',
    time: { created: now, updated: now },
  }

  const sendPromptMock = vi.fn(async () => true)
  const getSessionRuntimeMock = vi.fn(async (_directory: string, sessionID: string) =>
    createRuntimeSnapshot(directory, sessionID, [])
  )

  Object.defineProperty(window, 'orxa', {
    configurable: true,
    value: {
      opencode: {
        selectProject: vi.fn(async () => createProjectBootstrap(directory, [])),
        refreshProject: vi.fn(async () =>
          createProjectBootstrap(directory, [{ id: createdSession.id, time: { updated: now } }])
        ),
        createSession: vi.fn(async () => createdSession),
        getSessionRuntime: getSessionRuntimeMock,
        sendPrompt: sendPromptMock,
        deleteSession: vi.fn(async () => true),
      },
    },
  })

  const { result } = renderWorkspaceStateHook()

  await act(async () => {
    await (
      result.current.createSession as unknown as (
        directory: string,
        prompt?: string,
        options?: unknown
      ) => Promise<void>
    )(directory, 'Which agent are you', {
      selectedAgent: 'builder',
      availableAgentNames: new Set(['builder']),
    })
  })

  expect(sendPromptMock).toHaveBeenCalledWith(
    expect.objectContaining({
      agent: 'builder',
      text: 'Which agent are you',
    })
  )
  expect(getSessionRuntimeMock).toHaveBeenCalledWith(expect.any(String), createdSession.id)
})

it('applies raw opencode stream events to the active session without waiting for a refresh', async () => {
  const directory = '/repo'
  const now = Date.now()
  const createdSession = {
    id: 'session-created',
    slug: 'session-created',
    title: 'OpenCode Session',
    time: { created: now, updated: now },
  }

  Object.defineProperty(window, 'orxa', {
    configurable: true,
    value: {
      opencode: {
        selectProject: vi.fn(async () => createProjectBootstrap(directory, [])),
        refreshProject: vi.fn(async () => ({
          ...createProjectBootstrap(directory, [{ id: createdSession.id, time: { updated: now } }]),
          sessionStatus: {
            [createdSession.id]: { type: 'busy' },
          },
        })),
        createSession: vi.fn(async () => createdSession),
        getSessionRuntime: vi.fn(async (_directory: string, sessionID: string) =>
          createRuntimeSnapshot(directory, sessionID, [])
        ),
        sendPrompt: vi.fn(async () => true),
        deleteSession: vi.fn(async () => true),
      },
    },
  })

  const { result } = renderWorkspaceStateHook()

  await act(async () => {
    await (
      result.current.createSession as unknown as (
        directory: string,
        prompt?: string,
        options?: unknown
      ) => Promise<void>
    )(directory, 'Build this', { availableAgentNames: new Set<string>() })
  })

  await act(async () => {
    result.current.applyOpencodeStreamEvent(directory, {
      type: 'message.updated',
      properties: {
        info: {
          id: 'assistant-1',
          role: 'assistant',
          sessionID: createdSession.id,
          time: { created: now + 1, updated: now + 1 },
        },
      },
    } as never)
  })

  const state = useUnifiedRuntimeStore.getState()
  const sessionKey = `opencode::${directory}::${createdSession.id}`
  expect(state.opencodeSessions[sessionKey]?.messages.map(bundle => bundle.info.id)).toContain(
    'assistant-1'
  )
})

it('can select a session in another workspace immediately after selecting that workspace', async () => {
  const sourceDirectory = '/repo/source'
  const targetDirectory = '/repo/target'
  const sourceSessionId = 'session-source'
  const targetSessionId = 'session-target'
  const now = Date.now()

  const sourceBootstrap = createProjectBootstrap(sourceDirectory, [
    { id: sourceSessionId, time: { updated: now - 100 } },
  ])
  const targetBootstrap = createProjectBootstrap(targetDirectory, [
    { id: targetSessionId, time: { updated: now } },
  ])
  const targetMessages = [
    {
      info: {
        id: 'msg-target',
        role: 'assistant',
        sessionID: targetSessionId,
        time: { created: now, updated: now },
      },
      parts: [],
    },
  ] as unknown as SessionMessageBundle[]

  const getSessionRuntimeMock = vi.fn(async (directory: string, sessionID: string) => {
    if (directory === targetDirectory && sessionID === targetSessionId) {
      return createRuntimeSnapshot(directory, sessionID, targetMessages)
    }
    return createRuntimeSnapshot(directory, sessionID, [])
  })

  Object.defineProperty(window, 'orxa', {
    configurable: true,
    value: {
      opencode: {
        selectProject: vi.fn(async (directory: string) => {
          if (directory === sourceDirectory) return sourceBootstrap
          if (directory === targetDirectory) return targetBootstrap
          throw new Error(`unexpected directory ${directory}`)
        }),
        refreshProject: vi.fn(async (directory: string) => {
          if (directory === targetDirectory) return targetBootstrap
          return sourceBootstrap
        }),
        createSession: vi.fn(async () => ({
          id: 'unused',
          slug: 'unused',
          title: 'unused',
          time: { created: now, updated: now },
        })),
        getSessionRuntime: getSessionRuntimeMock,
        sendPrompt: vi.fn(async () => true),
        deleteSession: vi.fn(async () => true),
      },
    },
  })

  const { result } = renderWorkspaceStateHook()

  await act(async () => {
    result.current.setActiveProjectDir(sourceDirectory)
    result.current.setActiveSessionID(sourceSessionId)
    await result.current.selectProject(targetDirectory)
    result.current.selectSession(targetSessionId, targetDirectory)
  })

  expect(result.current.activeProjectDir).toBe(targetDirectory)
  expect(result.current.activeSessionID).toBe(targetSessionId)
  expect(getSessionRuntimeMock).toHaveBeenCalledWith(targetDirectory, targetSessionId)
})
