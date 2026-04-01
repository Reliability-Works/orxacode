import { act } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { EMPTY_WORKSPACE_SESSIONS_KEY } from './useWorkspaceState'
import { normalizeMessageBundles } from '../lib/opencode-event-reducer'
import {
  createProjectBootstrap,
  createRuntimeSnapshot,
  renderWorkspaceStateHook,
  resetWorkspaceStateForTests,
} from './useWorkspaceState.test-helpers'

beforeEach(() => {
  resetWorkspaceStateForTests()
})

it('creates sessions with the requested permission mode', async () => {
  const directory = '/repo'
  const now = Date.now()
  const createdSession = {
    id: 'session-created',
    slug: 'session-created',
    title: 'OpenCode Session',
    time: { created: now, updated: now },
  }
  const selectProjectMock = vi.fn(async () => createProjectBootstrap(directory, []))
  const refreshProjectMock = vi.fn(async () =>
    createProjectBootstrap(directory, [{ id: createdSession.id, time: { updated: now } }])
  )
  const createSessionMock = vi.fn(async () => createdSession)

  Object.defineProperty(window, 'orxa', {
    configurable: true,
    value: {
      opencode: {
        selectProject: selectProjectMock,
        refreshProject: refreshProjectMock,
        createSession: createSessionMock,
        getSessionRuntime: vi.fn(async (_directory: string, sessionID: string) =>
          createRuntimeSnapshot(directory, sessionID, [])
        ),
        sendPrompt: vi.fn(async () => true),
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
    )(directory, undefined, {
      availableAgentNames: new Set<string>(),
      permissionMode: 'yolo-write',
    })
  })

  expect(createSessionMock).toHaveBeenCalledWith(directory, 'OpenCode Session', 'yolo-write')
})

it('merges duplicate message bundle ids without dropping visible parts', () => {
  const now = Date.now()
  const bundles = [
    {
      info: {
        id: 'message-1',
        role: 'user',
        sessionID: 'session-1',
        time: { created: now, updated: now },
      },
      parts: [
        {
          id: 'part-1',
          type: 'text',
          sessionID: 'session-1',
          messageID: 'message-1',
          text: 'First part',
        },
      ],
    },
    {
      info: {
        id: 'message-1',
        role: 'user',
        sessionID: 'session-1',
        time: { created: now, updated: now + 1 },
      },
      parts: [
        {
          id: 'part-2',
          type: 'text',
          sessionID: 'session-1',
          messageID: 'message-1',
          text: 'Second part',
        },
      ],
    },
  ] as never

  const normalized = normalizeMessageBundles(bundles)

  expect(normalized).toHaveLength(1)
  expect(normalized[0]?.parts).toHaveLength(2)
})

it('opens the created session when creating in another workspace', async () => {
  const sourceDirectory = '/repo/source'
  const targetDirectory = '/repo/target'
  const now = Date.now()
  const createdSession = {
    id: 'session-created',
    slug: 'session-created',
    title: 'OpenCode Session',
    time: { created: now, updated: now },
  }

  const sourceBootstrap = createProjectBootstrap(sourceDirectory, [
    { id: 'session-source', time: { updated: now - 1000 } },
  ])
  const targetBootstrap = createProjectBootstrap(targetDirectory, [])
  const targetWithCreatedSession = createProjectBootstrap(targetDirectory, [
    { id: createdSession.id, time: { updated: now } },
  ])

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
          if (directory === targetDirectory) return targetWithCreatedSession
          if (directory === sourceDirectory) return sourceBootstrap
          throw new Error(`unexpected directory ${directory}`)
        }),
        refreshProjectDelta: vi.fn(async (directory: string) => {
          const bootstrap =
            directory === targetDirectory
              ? targetWithCreatedSession
              : directory === sourceDirectory
                ? sourceBootstrap
                : targetBootstrap
          return {
            directory,
            sessions: bootstrap.sessions,
            sessionStatus: bootstrap.sessionStatus,
            permissions: bootstrap.permissions,
            questions: bootstrap.questions,
            commands: bootstrap.commands,
            ptys: bootstrap.ptys,
          }
        }),
        createSession: vi.fn(async () => createdSession),
        getSessionRuntime: vi.fn(async (directory: string, sessionID: string) =>
          createRuntimeSnapshot(directory, sessionID, [])
        ),
        sendPrompt: vi.fn(async () => true),
        deleteSession: vi.fn(async () => true),
      },
    },
  })

  const { result } = renderWorkspaceStateHook()

  await act(async () => {
    result.current.setActiveProjectDir(sourceDirectory)
    result.current.setActiveSessionID('session-source')
  })

  await act(async () => {
    await (
      result.current.createSession as unknown as (
        directory: string,
        prompt?: string,
        options?: unknown
      ) => Promise<void>
    )(targetDirectory)
  })

  expect(result.current.activeProjectDir).toBe(targetDirectory)
  expect(result.current.activeSessionID).toBe(createdSession.id)
})

it('deletes an empty OpenCode session before creating the next one in the same workspace', async () => {
  const directory = '/repo'
  const now = Date.now()
  const createSessionMock = vi
    .fn()
    .mockResolvedValueOnce({
      id: 'session-empty',
      slug: 'session-empty',
      title: 'OpenCode Session',
      time: { created: now, updated: now },
    })
    .mockResolvedValueOnce({
      id: 'session-next',
      slug: 'session-next',
      title: 'OpenCode Session',
      time: { created: now + 1, updated: now + 1 },
    })
  const deleteSessionMock = vi.fn(async () => true)
  const refreshProjectMock = vi
    .fn()
    .mockResolvedValueOnce(
      createProjectBootstrap(directory, [{ id: 'session-empty', time: { updated: now } }])
    )
    .mockResolvedValueOnce(
      createProjectBootstrap(directory, [{ id: 'session-next', time: { updated: now + 1 } }])
    )

  Object.defineProperty(window, 'orxa', {
    configurable: true,
    value: {
      opencode: {
        selectProject: vi.fn(async () => createProjectBootstrap(directory, [])),
        refreshProject: refreshProjectMock,
        refreshProjectDelta: vi.fn(async () => {
          const bootstrap = createProjectBootstrap(directory, [
            { id: 'session-empty', time: { updated: now } },
          ])
          return {
            directory,
            sessions: bootstrap.sessions,
            sessionStatus: bootstrap.sessionStatus,
            permissions: bootstrap.permissions,
            questions: bootstrap.questions,
            commands: bootstrap.commands,
            ptys: bootstrap.ptys,
          }
        }),
        createSession: createSessionMock,
        deleteSession: deleteSessionMock,
        getSessionRuntime: vi.fn(async (currentDirectory: string, sessionID: string) =>
          createRuntimeSnapshot(currentDirectory, sessionID, [])
        ),
        sendPrompt: vi.fn(async () => true),
      },
    },
  })

  const { result } = renderWorkspaceStateHook()

  await act(async () => {
    result.current.setActiveProjectDir(directory)
    await (result.current.createSession as unknown as (directory: string) => Promise<void>)(
      directory
    )
  })

  await act(async () => {
    await (result.current.createSession as unknown as (directory: string) => Promise<void>)(
      directory
    )
  })

  expect(deleteSessionMock).toHaveBeenCalledWith(directory, 'session-empty')
  expect(deleteSessionMock.mock.invocationCallOrder[0]).toBeLessThan(
    createSessionMock.mock.invocationCallOrder[1] ?? Number.MAX_SAFE_INTEGER
  )
  expect(result.current.activeSessionID).toBe('session-next')
})

it('can switch workspaces without forcing the landing state when a target session is known', async () => {
  const targetDirectory = '/repo/target'
  const targetSessionID = 'session-target'
  const now = Date.now()
  const targetBootstrap = createProjectBootstrap(targetDirectory, [
    { id: targetSessionID, time: { updated: now } },
  ])

  Object.defineProperty(window, 'orxa', {
    configurable: true,
    value: {
      opencode: {
        selectProject: vi.fn(async () => targetBootstrap),
        refreshProject: vi.fn(async () => targetBootstrap),
        refreshProjectDelta: vi.fn(async () => ({
          directory: targetDirectory,
          sessions: targetBootstrap.sessions,
          sessionStatus: targetBootstrap.sessionStatus,
          permissions: targetBootstrap.permissions,
          questions: targetBootstrap.questions,
          commands: targetBootstrap.commands,
          ptys: targetBootstrap.ptys,
        })),
        createSession: vi.fn(async () => ({
          id: 'unused',
          slug: 'unused',
          title: 'unused',
          time: { created: now, updated: now },
        })),
        getSessionRuntime: vi.fn(async (directory: string, sessionID: string) =>
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
      result.current.selectProject as unknown as (
        directory: string,
        options?: unknown
      ) => Promise<void>
    )(targetDirectory, { showLanding: false, sessionID: targetSessionID })
  })

  expect(result.current.activeProjectDir).toBe(targetDirectory)
  expect(result.current.activeSessionID).toBe(targetSessionID)
})

it('cleans up persisted empty sessions on startup', async () => {
  const directory = '/repo'
  const deleteSessionMock = vi.fn(async () => true)
  const onCleanupEmptySession = vi.fn(async () => undefined)

  window.localStorage.setItem(
    EMPTY_WORKSPACE_SESSIONS_KEY,
    JSON.stringify({
      'session-empty': directory,
    })
  )

  Object.defineProperty(window, 'orxa', {
    configurable: true,
    value: {
      opencode: {
        selectProject: vi.fn(async () => createProjectBootstrap(directory, [])),
        refreshProject: vi.fn(async () => createProjectBootstrap(directory, [])),
        refreshProjectDelta: vi.fn(async () => {
          const bootstrap = createProjectBootstrap(directory, [])
          return {
            directory,
            sessions: bootstrap.sessions,
            sessionStatus: bootstrap.sessionStatus,
            permissions: bootstrap.permissions,
            questions: bootstrap.questions,
            commands: bootstrap.commands,
            ptys: bootstrap.ptys,
          }
        }),
        createSession: vi.fn(async () => ({
          id: 'unused',
          slug: 'unused',
          title: 'unused',
          time: { created: 1, updated: 1 },
        })),
        deleteSession: deleteSessionMock,
        getSessionRuntime: vi.fn(async (currentDirectory: string, sessionID: string) =>
          createRuntimeSnapshot(currentDirectory, sessionID, [])
        ),
        sendPrompt: vi.fn(async () => true),
      },
    },
  })

  const { result } = renderWorkspaceStateHook({ onCleanupEmptySession })

  await act(async () => {
    await result.current.cleanupPersistedEmptySessions()
  })

  expect(deleteSessionMock).toHaveBeenCalledWith(directory, 'session-empty')
  expect(onCleanupEmptySession).toHaveBeenCalledWith(directory, 'session-empty')
  expect(window.localStorage.getItem(EMPTY_WORKSPACE_SESSIONS_KEY)).toBeNull()
})
