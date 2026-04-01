import { act } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
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

it('keeps previously loaded workspace sessions cached when selecting another workspace', async () => {
  const sourceDirectory = '/repo/source'
  const targetDirectory = '/repo/target'
  const now = Date.now()
  const sourceBootstrap = createProjectBootstrap(sourceDirectory, [
    { id: 'session-source', time: { updated: now - 100 } },
  ])
  const targetBootstrap = createProjectBootstrap(targetDirectory, [
    { id: 'session-target', time: { updated: now } },
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
          if (directory === sourceDirectory) return sourceBootstrap
          if (directory === targetDirectory) return targetBootstrap
          throw new Error(`unexpected directory ${directory}`)
        }),
        createSession: vi.fn(),
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
    await result.current.selectProject(sourceDirectory)
  })

  await act(async () => {
    await result.current.selectProject(targetDirectory)
  })

  const state = useUnifiedRuntimeStore.getState()
  expect(state.projectDataByDirectory[sourceDirectory]?.sessions.map(session => session.id)).toEqual([
    'session-source',
  ])
  expect(state.projectDataByDirectory[targetDirectory]?.sessions.map(session => session.id)).toEqual([
    'session-target',
  ])
})

it('closes the integrated terminal when switching workspaces', async () => {
  const directory = '/repo/target'
  const projectBootstrap = createProjectBootstrap(directory, [])
  const setTerminalOpen = vi.fn()

  Object.defineProperty(window, 'orxa', {
    configurable: true,
    value: {
      opencode: {
        selectProject: vi.fn(async () => projectBootstrap),
        refreshProject: vi.fn(async () => projectBootstrap),
        createSession: vi.fn(async () => ({
          id: 'unused',
          slug: 'unused',
          title: 'unused',
          time: { created: Date.now(), updated: Date.now() },
        })),
        getSessionRuntime: vi.fn(async (_directory: string, sessionID: string) =>
          createRuntimeSnapshot(directory, sessionID, [])
        ),
        sendPrompt: vi.fn(async () => true),
        deleteSession: vi.fn(async () => true),
      },
    },
  })

  const { result } = renderWorkspaceStateHook({ setTerminalOpen })

  await act(async () => {
    await result.current.selectProject(directory)
  })

  expect(setTerminalOpen).toHaveBeenCalledWith(false)
})

it('hydrates integrated terminal tabs from workspace-owned PTYs', async () => {
  const directory = '/repo/target'
  const projectBootstrap = createProjectBootstrap(directory, [], [
    {
      id: 'pty-shell',
      title: 'shell',
      directory,
      cwd: directory,
      owner: 'workspace',
      status: 'running',
      pid: 1,
      exitCode: null,
      createdAt: Date.now(),
    },
  ])
  const setTerminalTabs = vi.fn()
  const setActiveTerminalId = vi.fn()

  Object.defineProperty(window, 'orxa', {
    configurable: true,
    value: {
      opencode: {
        selectProject: vi.fn(async () => projectBootstrap),
        refreshProject: vi.fn(async () => projectBootstrap),
        createSession: vi.fn(async () => ({
          id: 'unused',
          slug: 'unused',
          title: 'unused',
          time: { created: Date.now(), updated: Date.now() },
        })),
        getSessionRuntime: vi.fn(async (_directory: string, sessionID: string) =>
          createRuntimeSnapshot(directory, sessionID, [])
        ),
        sendPrompt: vi.fn(async () => true),
        deleteSession: vi.fn(async () => true),
      },
    },
  })

  const { result } = renderWorkspaceStateHook({
    setTerminalTabs,
    setActiveTerminalId,
  })

  await act(async () => {
    await result.current.selectProject(directory)
  })

  expect(setTerminalTabs).toHaveBeenCalledWith([{ id: 'pty-shell', label: 'Tab 1' }])
  expect(setActiveTerminalId).toHaveBeenCalledWith('pty-shell')
})
