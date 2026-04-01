import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useBackgroundSessionDescriptors } from './useBackgroundSessionDescriptors'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'
import { resetPersistedCodexStateForTests, setPersistedCodexState } from './codex-session-storage'

const sessionKey = '/repo/project::session-1'

function resetBackgroundSessionDescriptorState() {
  resetPersistedCodexStateForTests()
  useUnifiedRuntimeStore.setState({
    opencodeSessions: {},
    codexSessions: {},
    claudeSessions: {},
    claudeChatSessions: {},
    projectDataByDirectory: {},
    workspaceMetaByDirectory: {},
    activeWorkspaceDirectory: undefined,
    activeSessionID: undefined,
    activeProvider: undefined,
    pendingSessionId: undefined,
  })
}

describe('useBackgroundSessionDescriptors codex persistence', () => {
  beforeEach(() => {
    resetBackgroundSessionDescriptorState()
  })

  it('does not background-supervise idle Codex sessions just because they have persisted messages', () => {
    const idleSessionKey = '/repo/project::session-2'
    setPersistedCodexState(idleSessionKey, {
      messages: [
        {
          id: 'assistant-1',
          kind: 'message',
          role: 'assistant',
          content: 'Historical output',
          timestamp: 1,
        },
      ],
      thread: {
        id: 'thread-2',
        preview: 'Idle Codex thread',
        modelProvider: 'openai',
        createdAt: 1,
      },
      isStreaming: false,
      messageIdCounter: 1,
    })

    const { result } = renderHook(() =>
      useBackgroundSessionDescriptors({
        activeProjectDir: '/repo/project',
        activeSessionID: 'active-session',
        activeSessionKey: '/repo/project::active-session',
        activeSessionType: 'opencode',
        cachedProjects: {
          '/repo/project': {
            directory: '/repo/project',
            path: {} as never,
            sessions: [
              {
                id: 'session-2',
                projectID: 'proj-1',
                directory: '/repo/project',
                slug: 'idle-codex',
                title: 'Idle Codex',
                version: '1',
                time: { created: 1, updated: 2 },
              },
            ],
            sessionStatus: {},
            providers: {} as never,
            agents: [],
            config: {} as never,
            permissions: [],
            questions: [],
            commands: [],
            mcp: {},
            lsp: [],
            formatter: [],
            ptys: [],
          },
        },
        archivedBackgroundAgentIds: {},
        getSessionType: () => 'codex',
        normalizePresentationProvider: sessionType =>
          sessionType === 'codex' || sessionType === 'claude' || sessionType === 'claude-chat'
            ? sessionType
            : sessionType
              ? 'opencode'
              : undefined,
      })
    )

    expect(result.current.backgroundSessionDescriptors).toEqual([])
  })

})

describe('useBackgroundSessionDescriptors codex busy sessions', () => {
  beforeEach(() => {
    resetBackgroundSessionDescriptorState()
  })

  it('still background-supervises busy Codex sessions', () => {
    const busySessionKey = '/repo/project::session-3'
    setPersistedCodexState(busySessionKey, {
      messages: [],
      thread: {
        id: 'thread-3',
        preview: 'Busy Codex thread',
        modelProvider: 'openai',
        createdAt: 1,
      },
      isStreaming: true,
      messageIdCounter: 0,
    })

    const { result } = renderHook(() =>
      useBackgroundSessionDescriptors({
        activeProjectDir: '/repo/project',
        activeSessionID: 'active-session',
        activeSessionKey: '/repo/project::active-session',
        activeSessionType: 'opencode',
        cachedProjects: {
          '/repo/project': {
            directory: '/repo/project',
            path: {} as never,
            sessions: [
              {
                id: 'session-3',
                projectID: 'proj-1',
                directory: '/repo/project',
                slug: 'busy-codex',
                title: 'Busy Codex',
                version: '1',
                time: { created: 1, updated: 2 },
              },
            ],
            sessionStatus: {},
            providers: {} as never,
            agents: [],
            config: {} as never,
            permissions: [],
            questions: [],
            commands: [],
            mcp: {},
            lsp: [],
            formatter: [],
            ptys: [],
          },
        },
        archivedBackgroundAgentIds: {},
        getSessionType: () => 'codex',
        normalizePresentationProvider: sessionType =>
          sessionType === 'codex' || sessionType === 'claude' || sessionType === 'claude-chat'
            ? sessionType
            : sessionType
              ? 'opencode'
              : undefined,
      })
    )

    expect(result.current.backgroundSessionDescriptors).toEqual([
      {
        key: 'codex:/repo/project::session-3',
        provider: 'codex',
        directory: '/repo/project',
        sessionStorageKey: '/repo/project::session-3',
      },
    ])
  })

})

describe('useBackgroundSessionDescriptors codex plan readiness', () => {
  beforeEach(() => {
    resetBackgroundSessionDescriptorState()
  })

  it('keeps Codex background supervision alive when a plan is ready', () => {
    const planReadySessionKey = '/repo/project::session-4'
    setPersistedCodexState(planReadySessionKey, {
      messages: [],
      thread: {
        id: 'thread-4',
        preview: 'Plan ready thread',
        modelProvider: 'openai',
        createdAt: 1,
      },
      isStreaming: false,
      messageIdCounter: 0,
    })
    useUnifiedRuntimeStore.setState({
      codexSessions: {
        [planReadySessionKey]: {
          key: planReadySessionKey,
          directory: '/repo/project',
          connectionStatus: 'connected',
          thread: {
            id: 'thread-4',
            preview: 'Plan ready thread',
            modelProvider: 'openai',
            createdAt: 1,
          },
          runtimeSnapshot: null,
          messages: [],
          pendingApproval: null,
          pendingUserInput: null,
          isStreaming: false,
          planItems: [{ id: 'plan-1', content: 'Review the patch', status: 'pending' }],
          dismissedPlanIds: [],
          subagents: [],
          activeSubagentThreadId: null,
        },
      },
    })

    const { result } = renderHook(() =>
      useBackgroundSessionDescriptors({
        activeProjectDir: '/repo/project',
        activeSessionID: 'active-session',
        activeSessionKey: '/repo/project::active-session',
        activeSessionType: 'opencode',
        cachedProjects: {
          '/repo/project': {
            directory: '/repo/project',
            path: {} as never,
            sessions: [
              {
                id: 'session-4',
                projectID: 'proj-1',
                directory: '/repo/project',
                slug: 'plan-ready-codex',
                title: 'Plan Ready Codex',
                version: '1',
                time: { created: 1, updated: 2 },
              },
            ],
            sessionStatus: {},
            providers: {} as never,
            agents: [],
            config: {} as never,
            permissions: [],
            questions: [],
            commands: [],
            mcp: {},
            lsp: [],
            formatter: [],
            ptys: [],
          },
        },
        archivedBackgroundAgentIds: {},
        getSessionType: () => 'codex',
        normalizePresentationProvider: sessionType =>
          sessionType === 'codex' || sessionType === 'claude' || sessionType === 'claude-chat'
            ? sessionType
            : sessionType
              ? 'opencode'
              : undefined,
      })
    )

    expect(result.current.backgroundSessionDescriptors).toEqual([
      {
        key: 'codex:/repo/project::session-4',
        provider: 'codex',
        directory: '/repo/project',
        sessionStorageKey: '/repo/project::session-4',
      },
    ])
  })

})

describe('useBackgroundSessionDescriptors claude runtime sessions', () => {
  beforeEach(() => {
    resetBackgroundSessionDescriptorState()
  })

  it('keeps Claude terminal supervision alive while runtime state exists', () => {
    useUnifiedRuntimeStore.setState({
      claudeSessions: {
        '/repo/project::session-claude': {
          key: '/repo/project::session-claude',
          directory: '/repo/project',
          busy: false,
          awaiting: false,
          activityAt: 1,
        },
      },
    })

    const { result } = renderHook(() =>
      useBackgroundSessionDescriptors({
        activeProjectDir: '/repo/project',
        activeSessionID: 'active-session',
        activeSessionKey: '/repo/project::active-session',
        activeSessionType: 'opencode',
        cachedProjects: {
          '/repo/project': {
            directory: '/repo/project',
            path: {} as never,
            sessions: [
              {
                id: 'session-claude',
                projectID: 'proj-1',
                directory: '/repo/project',
                slug: 'claude-terminal',
                title: 'Claude Code (Terminal)',
                version: '1',
                time: { created: 1, updated: 2 },
              },
            ],
            sessionStatus: {},
            providers: {} as never,
            agents: [],
            config: {} as never,
            permissions: [],
            questions: [],
            commands: [],
            mcp: {},
            lsp: [],
            formatter: [],
            ptys: [],
          },
        },
        archivedBackgroundAgentIds: {},
        getSessionType: () => 'claude',
        normalizePresentationProvider: sessionType =>
          sessionType === 'codex' || sessionType === 'claude' || sessionType === 'claude-chat'
            ? sessionType
            : sessionType
              ? 'opencode'
              : undefined,
      })
    )

    expect(result.current.backgroundSessionDescriptors).toEqual([
      {
        key: 'claude:/repo/project::session-claude',
        provider: 'claude',
        directory: '/repo/project',
        sessionStorageKey: '/repo/project::session-claude',
      },
    ])
  })

})

describe('useBackgroundSessionDescriptors background agent recompute', () => {
  beforeEach(() => {
    resetBackgroundSessionDescriptorState()
  })

  it('recomputes active background agents when codex runtime state changes without changing session identity', async () => {
    useUnifiedRuntimeStore.setState({
      codexSessions: {
        [sessionKey]: {
          key: sessionKey,
          directory: '/repo/project',
          connectionStatus: 'connected',
          thread: { id: 'thread-1', preview: 'Main thread', modelProvider: 'openai', createdAt: 1 },
          runtimeSnapshot: null,
          messages: [],
          pendingApproval: null,
          pendingUserInput: null,
          isStreaming: false,
          planItems: [],
          dismissedPlanIds: [],
          subagents: [],
          activeSubagentThreadId: null,
        },
      },
    })

    const { result } = renderHook(() =>
      useBackgroundSessionDescriptors({
        activeProjectDir: '/repo/project',
        activeSessionID: 'session-1',
        activeSessionKey: sessionKey,
        activeSessionType: 'codex',
        cachedProjects: {},
        archivedBackgroundAgentIds: {},
        getSessionType: () => 'codex',
        normalizePresentationProvider: sessionType =>
          sessionType === 'codex' || sessionType === 'claude' || sessionType === 'claude-chat'
            ? sessionType
            : sessionType
              ? 'opencode'
              : undefined,
      })
    )

    expect(result.current.activeBackgroundAgents).toEqual([])

    useUnifiedRuntimeStore.setState({
      codexSessions: {
        [sessionKey]: {
          key: sessionKey,
          directory: '/repo/project',
          connectionStatus: 'connected',
          thread: { id: 'thread-1', preview: 'Main thread', modelProvider: 'openai', createdAt: 1 },
          runtimeSnapshot: null,
          messages: [],
          pendingApproval: null,
          pendingUserInput: null,
          isStreaming: true,
          planItems: [],
          dismissedPlanIds: [],
          subagents: [
            {
              threadId: 'child-1',
              nickname: 'Scout',
              role: 'explorer',
              status: 'thinking',
              statusText: 'is thinking',
              spawnedAt: 2,
            },
          ],
          activeSubagentThreadId: null,
        },
      },
    })

    await waitFor(() => {
      expect(result.current.activeBackgroundAgents).toEqual([
        expect.objectContaining({
          id: 'child-1',
          name: 'Scout',
          status: 'thinking',
        }),
      ])
    })
  })
})
