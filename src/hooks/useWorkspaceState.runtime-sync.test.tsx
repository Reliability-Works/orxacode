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
        refreshProjectDelta: vi.fn(async () => ({
          ...(() => {
            const bootstrap = createProjectBootstrap(directory, [
              { id: sessionID, time: { updated: now } },
            ])
            return {
              directory,
              sessions: bootstrap.sessions,
              sessionStatus: { [sessionID]: { type: 'busy' } },
              permissions: bootstrap.permissions,
              questions: bootstrap.questions,
              commands: bootstrap.commands,
              ptys: bootstrap.ptys,
            }
          })(),
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
        refreshProjectDelta: vi.fn(async () => ({
          ...(() => {
            const bootstrap = createProjectBootstrap(directory, [
              { id: createdSession.id, time: { updated: now } },
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
          })(),
        })),
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
        refreshProjectDelta: vi.fn(async () => ({
          ...(() => {
            const bootstrap = createProjectBootstrap(directory, [
              { id: createdSession.id, time: { updated: now } },
            ])
            return {
              directory,
              sessions: bootstrap.sessions,
              sessionStatus: {
                [createdSession.id]: { type: 'busy' },
              },
              permissions: bootstrap.permissions,
              questions: bootstrap.questions,
              commands: bootstrap.commands,
              ptys: bootstrap.ptys,
            }
          })(),
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
        refreshProjectDelta: vi.fn(async (directory: string) => {
          const bootstrap = directory === targetDirectory ? targetBootstrap : sourceBootstrap
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

it('batches burst opencode stream events into a single flush while preserving order', async () => {
  const directory = '/repo'
  const now = Date.now()
  const createdSession = {
    id: 'session-batched-events',
    slug: 'session-batched-events',
    title: 'Batched events',
    time: { created: now, updated: now },
  }
  const reportPerfMock = vi.fn(async () => undefined)

  Object.defineProperty(window, 'orxa', {
    configurable: true,
    value: {
      app: {
        reportPerf: reportPerfMock,
      },
      opencode: {
        selectProject: vi.fn(async () => createProjectBootstrap(directory, [])),
        refreshProject: vi.fn(async () =>
          createProjectBootstrap(directory, [{ id: createdSession.id, time: { updated: now } }])
        ),
        refreshProjectDelta: vi.fn(async () => ({
          ...(() => {
            const bootstrap = createProjectBootstrap(directory, [
              { id: createdSession.id, time: { updated: now } },
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
          })(),
        })),
        createSession: vi.fn(async () => createdSession),
        getSessionRuntimeCore: vi.fn(async (_directory: string, sessionID: string) =>
          createRuntimeSnapshot(directory, sessionID, [])
        ),
        getSessionRuntime: vi.fn(async (_directory: string, sessionID: string) =>
          createRuntimeSnapshot(directory, sessionID, [])
        ),
        loadSessionDiff: vi.fn(async () => []),
        loadExecutionLedger: vi.fn(async () => ({ cursor: 0, records: [] })),
        loadChangeProvenance: vi.fn(async () => ({ cursor: 0, records: [] })),
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
    )(directory, 'Batch stream updates', { availableAgentNames: new Set<string>() })
  })

  let hadSecondMessageBeforeFlush = false
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
    result.current.applyOpencodeStreamEvent(directory, {
      type: 'message.updated',
      properties: {
        info: {
          id: 'assistant-2',
          role: 'assistant',
          sessionID: createdSession.id,
          time: { created: now + 2, updated: now + 2 },
        },
      },
    } as never)

    const earlyState = useUnifiedRuntimeStore.getState()
    const sessionKey = `opencode::${directory}::${createdSession.id}`
    hadSecondMessageBeforeFlush =
      earlyState.opencodeSessions[sessionKey]?.messages.some(
        bundle => bundle.info.id === 'assistant-2'
      ) ?? false
  })

  expect(hadSecondMessageBeforeFlush).toBe(false)

  await waitFor(() => {
    const state = useUnifiedRuntimeStore.getState()
    const sessionKey = `opencode::${directory}::${createdSession.id}`
    const ids = state.opencodeSessions[sessionKey]?.messages.map(bundle => bundle.info.id) ?? []
    expect(ids).toContain('assistant-1')
    expect(ids).toContain('assistant-2')
    expect(ids.indexOf('assistant-1')).toBeLessThan(ids.indexOf('assistant-2'))
  })

  await waitFor(() => {
    const perfCalls = reportPerfMock.mock.calls as unknown as Array<
      [
        {
          metric?: string
          value?: number
        },
      ]
    >
    const metrics = perfCalls.map(call => call[0]?.metric)
    expect(metrics).toContain('event.batch.size')
    expect(metrics).toContain('event.batch.flush_ms')
    expect(
      perfCalls.some(call => call[0]?.metric === 'event.batch.size' && call[0]?.value === 2)
    ).toBe(true)
  })
})

it('yields large stream bursts across multiple bounded flushes', async () => {
  const directory = '/repo'
  const now = Date.now()
  const createdSession = {
    id: 'session-large-burst',
    slug: 'session-large-burst',
    title: 'Large burst',
    time: { created: now, updated: now },
  }
  const reportPerfMock = vi.fn(async () => undefined)

  Object.defineProperty(window, 'orxa', {
    configurable: true,
    value: {
      app: {
        reportPerf: reportPerfMock,
      },
      opencode: {
        selectProject: vi.fn(async () => createProjectBootstrap(directory, [])),
        refreshProject: vi.fn(async () =>
          createProjectBootstrap(directory, [{ id: createdSession.id, time: { updated: now } }])
        ),
        refreshProjectDelta: vi.fn(async () => ({
          ...(() => {
            const bootstrap = createProjectBootstrap(directory, [
              { id: createdSession.id, time: { updated: now } },
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
          })(),
        })),
        createSession: vi.fn(async () => createdSession),
        getSessionRuntimeCore: vi.fn(async (_directory: string, sessionID: string) =>
          createRuntimeSnapshot(directory, sessionID, [])
        ),
        getSessionRuntime: vi.fn(async (_directory: string, sessionID: string) =>
          createRuntimeSnapshot(directory, sessionID, [])
        ),
        loadSessionDiff: vi.fn(async () => []),
        loadExecutionLedger: vi.fn(async () => ({ cursor: 0, records: [] })),
        loadChangeProvenance: vi.fn(async () => ({ cursor: 0, records: [] })),
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
    )(directory, 'Batch stream updates', { availableAgentNames: new Set<string>() })
  })

  const burstCount = 220
  await act(async () => {
    for (let index = 0; index < burstCount; index += 1) {
      result.current.applyOpencodeStreamEvent(directory, {
        type: 'message.updated',
        properties: {
          info: {
            id: `assistant-${index}`,
            role: 'assistant',
            sessionID: createdSession.id,
            time: { created: now + index + 1, updated: now + index + 1 },
          },
        },
      } as never)
    }
  })

  await waitFor(() => {
    const state = useUnifiedRuntimeStore.getState()
    const sessionKey = `opencode::${directory}::${createdSession.id}`
    expect(state.opencodeSessions[sessionKey]?.messages).toHaveLength(burstCount)
  })

  await waitFor(() => {
    const perfCalls = reportPerfMock.mock.calls as unknown as Array<
      [
        {
          metric?: string
          value?: number
        },
      ]
    >
    const batchSizes = perfCalls
      .filter(call => call[0]?.metric === 'event.batch.size')
      .map(call => Number(call[0]?.value ?? 0))
      .filter(value => Number.isFinite(value) && value > 0)
    expect(batchSizes.length).toBeGreaterThan(1)
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(100)
    expect(batchSizes.reduce((sum, value) => sum + value, 0)).toBe(burstCount)
  })
})

it('hydrates runtime extras lazily after loading core session runtime', async () => {
  const directory = '/repo'
  const now = Date.now()
  const createdSession = {
    id: 'session-core-runtime',
    slug: 'session-core-runtime',
    title: 'Core runtime',
    time: { created: now, updated: now },
  }

  const getSessionRuntimeCoreMock = vi.fn(async (_directory: string, sessionID: string) =>
    createRuntimeSnapshot(directory, sessionID, [])
  )
  const getSessionRuntimeMock = vi.fn(async (_directory: string, sessionID: string) =>
    createRuntimeSnapshot(directory, sessionID, [])
  )
  const loadSessionDiffMock = vi.fn(
    async () =>
      [
        {
          path: 'src/App.tsx',
          type: 'M',
          diff: '@@ -1 +1 @@\n-old\n+new\n',
        },
      ] as never[]
  )
  const loadExecutionLedgerMock = vi.fn(async () => ({
    cursor: 1,
    records: [
      {
        id: 'ledger-1',
        directory,
        sessionID: createdSession.id,
        timestamp: now,
        kind: 'edit',
        summary: 'Updated App.tsx',
        actor: { type: 'main' },
      },
    ],
  }))
  const loadChangeProvenanceMock = vi.fn(async () => ({
    cursor: 1,
    records: [
      {
        filePath: 'src/App.tsx',
        operation: 'edit',
        actorType: 'main',
        eventID: 'event-1',
        timestamp: now,
      },
    ],
  }))

  Object.defineProperty(window, 'orxa', {
    configurable: true,
    value: {
      opencode: {
        selectProject: vi.fn(async () => createProjectBootstrap(directory, [])),
        refreshProject: vi.fn(async () =>
          createProjectBootstrap(directory, [{ id: createdSession.id, time: { updated: now } }])
        ),
        refreshProjectDelta: vi.fn(async () => ({
          ...(() => {
            const bootstrap = createProjectBootstrap(directory, [
              { id: createdSession.id, time: { updated: now } },
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
          })(),
        })),
        createSession: vi.fn(async () => createdSession),
        getSessionRuntimeCore: getSessionRuntimeCoreMock,
        getSessionRuntime: getSessionRuntimeMock,
        loadSessionDiff: loadSessionDiffMock,
        loadExecutionLedger: loadExecutionLedgerMock,
        loadChangeProvenance: loadChangeProvenanceMock,
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
    )(directory, 'Ship this', { availableAgentNames: new Set<string>() })
  })

  expect(getSessionRuntimeCoreMock).toHaveBeenCalledWith(directory, createdSession.id)
  expect(getSessionRuntimeMock).not.toHaveBeenCalled()

  await waitFor(() => {
    expect(loadSessionDiffMock).toHaveBeenCalledWith(directory, createdSession.id)
    expect(loadExecutionLedgerMock).toHaveBeenCalledWith(directory, createdSession.id, 0)
    expect(loadChangeProvenanceMock).toHaveBeenCalledWith(directory, createdSession.id, 0)
  })

  const runtime =
    useUnifiedRuntimeStore.getState().opencodeSessions[
      `opencode::${directory}::${createdSession.id}`
    ]?.runtimeSnapshot
  expect(runtime?.sessionDiff).toHaveLength(1)
  expect(runtime?.executionLedger.cursor).toBe(1)
  expect(runtime?.changeProvenance.cursor).toBe(1)
})

it('replays execution artifacts from stored cursors after loading core runtime snapshots', async () => {
  const directory = '/repo'
  const now = Date.now()
  const createdSession = {
    id: 'session-core-replay',
    slug: 'session-core-replay',
    title: 'Core replay runtime',
    time: { created: now, updated: now },
  }

  const getSessionRuntimeCoreMock = vi.fn(async (_directory: string, sessionID: string) =>
    createRuntimeSnapshot(directory, sessionID, [])
  )
  const getSessionRuntimeMock = vi.fn(async (_directory: string, sessionID: string) =>
    createRuntimeSnapshot(directory, sessionID, [])
  )
  const loadSessionDiffMock = vi.fn(async () => [] as never[])
  const loadExecutionLedgerMock = vi.fn(
    async (_directory: string, _sessionID: string, cursor = 0) => {
      if (cursor === 1) {
        return {
          cursor: 2,
          records: [
            {
              id: 'ledger-2',
              directory,
              sessionID: createdSession.id,
              timestamp: now + 1,
              kind: 'edit',
              summary: 'Updated README.md',
              actor: { type: 'main' },
            },
          ],
        }
      }
      return {
        cursor: 2,
        records: [],
      }
    }
  )
  const loadChangeProvenanceMock = vi.fn(
    async (_directory: string, _sessionID: string, cursor = 0) => {
      if (cursor === 1) {
        return {
          cursor: 2,
          records: [
            {
              filePath: 'README.md',
              operation: 'edit',
              actorType: 'main',
              eventID: 'event-2',
              timestamp: now + 1,
            },
          ],
        }
      }
      return {
        cursor: 2,
        records: [],
      }
    }
  )

  Object.defineProperty(window, 'orxa', {
    configurable: true,
    value: {
      opencode: {
        selectProject: vi.fn(async () => createProjectBootstrap(directory, [])),
        refreshProject: vi.fn(async () =>
          createProjectBootstrap(directory, [{ id: createdSession.id, time: { updated: now } }])
        ),
        refreshProjectDelta: vi.fn(async () => ({
          ...(() => {
            const bootstrap = createProjectBootstrap(directory, [
              { id: createdSession.id, time: { updated: now } },
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
          })(),
        })),
        createSession: vi.fn(async () => createdSession),
        getSessionRuntimeCore: getSessionRuntimeCoreMock,
        getSessionRuntime: getSessionRuntimeMock,
        loadSessionDiff: loadSessionDiffMock,
        loadExecutionLedger: loadExecutionLedgerMock,
        loadChangeProvenance: loadChangeProvenanceMock,
        sendPrompt: vi.fn(async () => true),
        deleteSession: vi.fn(async () => true),
      },
    },
  })

  const { result } = renderWorkspaceStateHook()
  const sessionKey = `opencode::${directory}::${createdSession.id}`
  const seededRuntime = createRuntimeSnapshot(directory, createdSession.id, [])
  seededRuntime.executionLedger = {
    cursor: 1,
    records: [
      {
        id: 'ledger-1',
        directory,
        sessionID: createdSession.id,
        timestamp: now,
        kind: 'read',
        summary: 'Read README.md',
        actor: { type: 'main' },
      },
    ],
  }
  seededRuntime.changeProvenance = {
    cursor: 1,
    records: [
      {
        filePath: 'README.md',
        operation: 'edit',
        actorType: 'main',
        eventID: 'event-1',
        timestamp: now,
      },
    ],
  }

  useUnifiedRuntimeStore.setState(state => ({
    ...state,
    opencodeSessions: {
      ...state.opencodeSessions,
      [sessionKey]: {
        key: sessionKey,
        directory,
        sessionID: createdSession.id,
        runtimeSnapshot: seededRuntime,
        messages: [],
        todoItems: [],
      },
    },
  }))

  await act(async () => {
    await (
      result.current.createSession as unknown as (
        directory: string,
        prompt?: string,
        options?: unknown
      ) => Promise<void>
    )(directory, 'Ship replay cursor support', { availableAgentNames: new Set<string>() })
  })

  await waitFor(() => {
    expect(loadSessionDiffMock).toHaveBeenCalledWith(directory, createdSession.id)
    expect(loadExecutionLedgerMock).toHaveBeenCalledWith(directory, createdSession.id, 1)
    expect(loadChangeProvenanceMock).toHaveBeenCalledWith(directory, createdSession.id, 1)
  })

  expect(loadExecutionLedgerMock).not.toHaveBeenCalledWith(directory, createdSession.id, 0)
  expect(loadChangeProvenanceMock).not.toHaveBeenCalledWith(directory, createdSession.id, 0)

  const runtime = useUnifiedRuntimeStore.getState().opencodeSessions[sessionKey]?.runtimeSnapshot
  expect(runtime?.executionLedger.cursor).toBe(2)
  expect(runtime?.executionLedger.records.map(record => record.id)).toEqual([
    'ledger-1',
    'ledger-2',
  ])
  expect(runtime?.changeProvenance.cursor).toBe(2)
  expect(runtime?.changeProvenance.records.map(record => record.eventID)).toEqual([
    'event-1',
    'event-2',
  ])
})
