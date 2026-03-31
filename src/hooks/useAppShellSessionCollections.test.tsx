import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAppShellSessionCollections } from './useAppShellSessionCollections'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'

function resetAppShellSessionCollectionsState() {
  useUnifiedRuntimeStore.setState({
    opencodeSessions: {},
    codexSessions: {},
    claudeSessions: {},
    claudeChatSessions: {},
    workspaceRootByDirectory: {},
    sessionReadTimestamps: {},
    projectDataByDirectory: {},
  })
}

describe('useAppShellSessionCollections', () => {
  beforeEach(() => {
    resetAppShellSessionCollectionsState()
  })

  registerBackgroundSessionHidingTest()
  registerWorkspaceDetailAggregationTest()
})

function registerBackgroundSessionHidingTest() {
  it('hides live background Claude Chat session ids from the active project session list', () => {
    const now = Date.now()
    const projectData = {
      directory: '/repo/marketing-websites',
      path: {} as never,
      sessions: [
        {
          id: 'session-main',
          projectID: 'proj-1',
          directory: '/repo/marketing-websites',
          slug: 'claude-chat',
          title: 'Claude Code (Chat)',
          version: '1',
          time: { created: now, updated: now },
        },
        {
          id: 'session-bg-1',
          projectID: 'proj-1',
          directory: '/repo/marketing-websites',
          slug: 'claude-chat',
          title: 'Claude Code (Chat)',
          version: '1',
          time: { created: now, updated: now },
        },
        {
          id: 'session-bg-2',
          projectID: 'proj-1',
          directory: '/repo/marketing-websites',
          slug: 'claude-chat',
          title: 'Claude Code (Chat)',
          version: '1',
          time: { created: now, updated: now },
        },
      ],
      sessionStatus: {
        'session-main': { type: 'idle' as const },
        'session-bg-1': { type: 'idle' as const },
        'session-bg-2': { type: 'idle' as const },
      },
      providers: { all: [], connected: [], default: {} },
      agents: [],
      config: {} as never,
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    }

    const { result } = renderHook(() =>
      useAppShellSessionCollections({
        projectData,
        projectDataByDirectory: {
          '/repo/marketing-websites': projectData,
        },
        activeProjectDir: '/repo/marketing-websites',
        activeSessionID: 'session-main',
        projectCacheVersion: 0,
        pinnedSessions: {},
        archivedBackgroundAgentIds: {},
        hiddenBackgroundSessionIdsByProject: {},
        backgroundSessionDescriptors: [
          {
            key: 'claude-chat:/repo/marketing-websites::session-bg-1',
            provider: 'claude-chat',
            directory: '/repo/marketing-websites',
            sessionStorageKey: '/repo/marketing-websites::session-bg-1',
          },
          {
            key: 'claude-chat:/repo/marketing-websites::session-bg-2',
            provider: 'claude-chat',
            directory: '/repo/marketing-websites',
            sessionStorageKey: '/repo/marketing-websites::session-bg-2',
          },
        ],
        getSessionType: () => 'claude-chat',
        normalizePresentationProvider: sessionType =>
          sessionType === 'codex' || sessionType === 'claude' || sessionType === 'claude-chat'
            ? sessionType
            : sessionType
              ? 'opencode'
              : undefined,
      })
    )

    expect(result.current.sessions.map(session => session.id)).toEqual(['session-main'])
    expect(result.current.hiddenSessionIDsByProject['/repo/marketing-websites']).toEqual(
      expect.arrayContaining(['session-bg-1', 'session-bg-2'])
    )
  })
}

function registerWorkspaceDetailAggregationTest() {
  it('aggregates root-workspace and worktree sessions into the workspace detail collection', () => {
    const now = Date.now()
    const rootProjectData = {
      directory: '/repo/project',
      path: {} as never,
      sessions: [
        {
          id: 'session-root',
          projectID: 'proj-root',
          directory: '/repo/project',
          slug: 'opencode',
          title: 'Root Session',
          version: '1',
          time: { created: now - 10, updated: now - 5 },
        },
      ],
      sessionStatus: {},
      providers: { all: [], connected: [], default: {} },
      agents: [],
      config: {} as never,
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    }
    const worktreeProjectData = {
      ...rootProjectData,
      directory: '/repo/project/.worktrees/feature-a',
      sessions: [
        {
          id: 'session-worktree',
          projectID: 'proj-worktree',
          directory: '/repo/project/.worktrees/feature-a',
          slug: 'codex',
          title: 'Feature Session',
          version: '1',
          time: { created: now - 3, updated: now - 1 },
        },
      ],
    }

    useUnifiedRuntimeStore.setState(state => ({
      ...state,
      workspaceRootByDirectory: {
        '/repo/project': '/repo/project',
        '/repo/project/.worktrees/feature-a': '/repo/project',
      },
    }))

    const { result } = renderHook(() =>
      useAppShellSessionCollections({
        projectData: worktreeProjectData,
        projectDataByDirectory: {
          '/repo/project': rootProjectData,
        },
        activeProjectDir: '/repo/project/.worktrees/feature-a',
        activeSessionID: 'session-worktree',
        projectCacheVersion: 0,
        pinnedSessions: {},
        archivedBackgroundAgentIds: {},
        hiddenBackgroundSessionIdsByProject: {},
        backgroundSessionDescriptors: [],
        getSessionType: sessionID =>
          sessionID === 'session-worktree' ? 'codex' : 'opencode',
        normalizePresentationProvider: sessionType =>
          sessionType === 'codex' || sessionType === 'claude' || sessionType === 'claude-chat'
            ? sessionType
            : sessionType
              ? 'opencode'
              : undefined,
      })
    )

    expect(result.current.workspaceDetailDirectory).toBe('/repo/project')
    expect(result.current.workspaceDetailSessions).toEqual([
      expect.objectContaining({
        id: 'session-worktree',
        directory: '/repo/project/.worktrees/feature-a',
      }),
      expect.objectContaining({
        id: 'session-root',
        directory: '/repo/project',
      }),
    ])
  })
}
