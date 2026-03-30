import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import {
  installAppTestEnvironment,
} from './App.test.shared'
import { setPersistedCodexState } from './hooks/codex-session-storage'
import { useUnifiedRuntimeStore } from './state/unified-runtime-store'

beforeEach(() => {
  installAppTestEnvironment()
})

it('renders the shell', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Workspaces' })).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Config' })).toBeInTheDocument()
})

  it('wraps the shared opencode composer path in the centered rail', async () => {
    const now = Date.now()
    const projectData = {
      directory: '/repo/marketing-websites',
      path: {},
      sessions: [
        {
          id: 'session-1',
          slug: 'booking-site',
          title: 'Create a booking site',
          time: { created: now, updated: now },
        },
      ],
      sessionStatus: { 'session-1': { type: 'idle' as const } },
      providers: { all: [], connected: [], default: {} },
      agents: [],
      config: {},
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    }

    Object.defineProperty(window, 'orxa', {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: vi.fn(async () => ({
            projects: [
              {
                id: 'proj-1',
                name: 'marketing-websites',
                worktree: '/repo/marketing-websites',
                source: 'local' as const,
              },
            ],
            runtime: { status: 'disconnected' as const, managedServer: false },
          })),
          refreshProject: vi.fn(async () => projectData),
        },
      },
      configurable: true,
    })

    useUnifiedRuntimeStore.setState(state => ({
      ...state,
      activeWorkspaceDirectory: '/repo/marketing-websites',
      activeSessionID: 'session-1',
      projectDataByDirectory: {
        ...state.projectDataByDirectory,
        '/repo/marketing-websites': projectData as never,
      },
    }))

    const { container } = render(<App />)

    await waitFor(() => {
      expect(
        container.querySelector('.content-pane .center-pane-rail .composer-zone')
      ).toBeInTheDocument()
    })
  })

  it('shows preloaded sessions in the workspace list without selecting the workspace', async () => {
    const bootstrapMock = vi.fn(async () => ({
      projects: [
        {
          id: 'proj-1',
          name: 'marketing-websites',
          worktree: '/repo/marketing-websites',
          source: 'local' as const,
        },
      ],
      runtime: { status: 'disconnected' as const, managedServer: false },
    }))
    const selectProjectMock = vi.fn(async () => ({
      directory: '/repo/marketing-websites',
      path: {},
      sessions: [
        {
          id: 'session-1',
          slug: 'booking-site',
          title: 'Create a booking site',
          time: { created: Date.now(), updated: Date.now() },
        },
      ],
      sessionStatus: { 'session-1': { type: 'idle' as const } },
      providers: { all: [], connected: [], default: {} },
      agents: [],
      config: {},
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    }))

    Object.defineProperty(window, 'orxa', {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
        },
      },
      configurable: true,
    })

    render(<App />)

    expect(await screen.findByText('Create a booking site')).toBeInTheDocument()
    expect(selectProjectMock).toHaveBeenCalledWith('/repo/marketing-websites')
  })

  it('prefers the busy spinner over unread for inactive Codex sessions that are still streaming', async () => {
    window.localStorage.setItem(
      'orxa:sessionTypes:v2',
      JSON.stringify({ '/repo/marketing-websites::session-1': 'codex' })
    )
    window.localStorage.setItem(
      'orxa:sessionReadTimestamps:v1',
      JSON.stringify({ '/repo/marketing-websites::session-1': 1 })
    )
    setPersistedCodexState('/repo/marketing-websites::session-1', {
      messages: [],
      thread: { id: 'thr-1', preview: '', modelProvider: 'openai', createdAt: Date.now() },
      isStreaming: true,
      messageIdCounter: 0,
    })

    const bootstrapMock = vi.fn(async () => ({
      projects: [
        {
          id: 'proj-1',
          name: 'marketing-websites',
          worktree: '/repo/marketing-websites',
          source: 'local' as const,
        },
      ],
      runtime: { status: 'disconnected' as const, managedServer: false },
    }))
    const selectProjectMock = vi.fn(async () => ({
      directory: '/repo/marketing-websites',
      path: {},
      sessions: [
        {
          id: 'session-1',
          slug: 'booking-site',
          title: 'Create a booking site',
          time: { created: Date.now(), updated: 10 },
        },
      ],
      sessionStatus: { 'session-1': { type: 'idle' as const } },
      providers: { all: [], connected: [], default: {} },
      agents: [],
      config: {},
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    }))

    Object.defineProperty(window, 'orxa', {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
        },
      },
      configurable: true,
    })

    render(<App />)

    expect(await screen.findByText('Create a booking site')).toBeInTheDocument()
    expect(document.querySelector('.session-status-indicator.busy')).toBeInTheDocument()
    expect(document.querySelector('.session-status-indicator.unread')).toBeNull()
  })

  it('shows a busy sidebar indicator for inactive Claude Chat sessions with active subagents', async () => {
    window.localStorage.setItem(
      'orxa:sessionTypes:v2',
      JSON.stringify({ '/repo/marketing-websites::session-claude': 'claude-chat' })
    )
    useUnifiedRuntimeStore.setState({
      claudeChatSessions: {
        '/repo/marketing-websites::session-claude': {
          key: '/repo/marketing-websites::session-claude',
          directory: '/repo/marketing-websites',
          connectionStatus: 'connected',
          messages: [],
          historyMessages: [],
          pendingApproval: null,
          pendingUserInput: null,
          isStreaming: false,
          providerThreadId: 'thread-claude',
          activeTurnId: null,
          lastError: undefined,
          subagents: [
            {
              id: 'subagent-1',
              name: 'Scout',
              status: 'thinking',
              statusText: 'Delegating',
            },
          ],
        },
      },
    })

    const bootstrapMock = vi.fn(async () => ({
      projects: [
        {
          id: 'proj-1',
          name: 'marketing-websites',
          worktree: '/repo/marketing-websites',
          source: 'local' as const,
        },
      ],
      runtime: { status: 'disconnected' as const, managedServer: false },
    }))
    const selectProjectMock = vi.fn(async () => ({
      directory: '/repo/marketing-websites',
      path: {},
      sessions: [
        {
          id: 'session-claude',
          slug: 'claude-chat',
          title: 'Claude Code (Chat)',
          time: { created: Date.now(), updated: 10 },
        },
      ],
      sessionStatus: { 'session-claude': { type: 'idle' as const } },
      providers: { all: [], connected: [], default: {} },
      agents: [],
      config: {},
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    }))

    Object.defineProperty(window, 'orxa', {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
        },
      },
      configurable: true,
    })

    render(<App />)

    expect(await screen.findByText('Claude Code (Chat)')).toBeInTheDocument()
    expect(document.querySelector('.session-status-indicator.busy')).toBeInTheDocument()
  })

  it('hides Kanban management sessions from the workspace sidebar', async () => {
    const bootstrapMock = vi.fn(async () => ({
      projects: [
        {
          id: 'proj-1',
          name: 'marketing-websites',
          worktree: '/repo/marketing-websites',
          source: 'local' as const,
        },
      ],
      runtime: { status: 'disconnected' as const, managedServer: false },
    }))
    const selectProjectMock = vi.fn(async () => ({
      directory: '/repo/marketing-websites',
      path: {},
      sessions: [
        {
          id: 'session-bg',
          slug: 'kanban-board-manager',
          title: 'Kanban board manager',
          time: { created: Date.now(), updated: Date.now() },
        },
      ],
      sessionStatus: { 'session-bg': { type: 'busy' as const } },
      providers: { all: [], connected: [], default: {} },
      agents: [],
      config: {},
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    }))

    Object.defineProperty(window, 'orxa', {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
        },
        kanban: {
          ...window.orxa!.kanban,
          listWorkspaces: vi.fn(async () => [
            {
              directory: '/repo/marketing-websites',
              name: 'marketing-websites',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ]),
          getManagementSession: vi.fn(async (workspaceDir: string, provider: string) =>
            workspaceDir === '/repo/marketing-websites' && provider === 'opencode'
              ? {
                  workspaceDir,
                  provider: 'opencode' as const,
                  sessionKey: 'session-bg',
                  status: 'idle' as const,
                  transcript: [],
                  updatedAt: Date.now(),
                }
              : null
          ),
        },
      },
      configurable: true,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.queryByText('Kanban board manager')).not.toBeInTheDocument()
    })
  })

  it('keeps inactive Codex sessions polling in the background', async () => {
    window.localStorage.setItem(
      'orxa:sessionTypes:v2',
      JSON.stringify({ '/repo/marketing-websites::session-1': 'codex' })
    )
    setPersistedCodexState('/repo/marketing-websites::session-1', {
      messages: [],
      thread: { id: 'thr-1', preview: '', modelProvider: 'openai', createdAt: Date.now() },
      isStreaming: true,
      messageIdCounter: 0,
    })

    const bootstrapMock = vi.fn(async () => ({
      projects: [
        {
          id: 'proj-1',
          name: 'marketing-websites',
          worktree: '/repo/marketing-websites',
          source: 'local' as const,
        },
      ],
      runtime: { status: 'disconnected' as const, managedServer: false },
    }))
    const selectProjectMock = vi.fn(async () => ({
      directory: '/repo/marketing-websites',
      path: {},
      sessions: [
        {
          id: 'session-1',
          slug: 'booking-site',
          title: 'Create a booking site',
          time: { created: Date.now(), updated: Date.now() },
        },
      ],
      sessionStatus: { 'session-1': { type: 'idle' as const } },
      providers: { all: [], connected: [], default: {} },
      agents: [],
      config: {},
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    }))
    const getThreadRuntimeMock = vi.fn(async (threadId: string) => ({
      thread: {
        id: threadId,
        preview: 'Create a booking site',
        modelProvider: 'openai',
        createdAt: Date.now(),
        status: { type: 'inProgress' as const },
      },
      childThreads: [],
    }))

    Object.defineProperty(window, 'orxa', {
      value: {
        ...window.orxa,
        codex: {
          getThreadRuntime: getThreadRuntimeMock,
        },
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
        },
      },
      configurable: true,
    })

    render(<App />)

    expect(await screen.findByText('Create a booking site')).toBeInTheDocument()
    await waitFor(() => {
      expect(getThreadRuntimeMock).toHaveBeenCalledWith('thr-1')
    })
  })
