import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import {
  createBootstrapMock,
  createProjectData,
  installAppTestEnvironment,
  seedClaudeChatRuntimeState,
} from './App.test.shared'
import { useUnifiedRuntimeStore } from './state/unified-runtime-store'

beforeEach(() => {
  installAppTestEnvironment()
})

  it('removes an archived session from the sidebar instead of falling back to New session', async () => {
    const bootstrapMock = createBootstrapMock('dreamweaver', '/repo/dreamweaver')
    const activeSession = {
      id: 'session-1',
      slug: 'booking-site',
      title: 'Build Spa Booking Site',
      time: { created: Date.now(), updated: Date.now() },
    }
    const selectProjectMock = vi.fn(async () => createProjectData('/repo/dreamweaver', [activeSession]))
    const refreshProjectMock = vi.fn(async () => createProjectData('/repo/dreamweaver', []))
    const archiveSessionMock = vi.fn(async () => ({
      ...activeSession,
      time: { ...activeSession.time, archived: Date.now() },
    }))

    Object.defineProperty(window, 'orxa', {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
          refreshProject: refreshProjectMock,
          archiveSession: archiveSessionMock,
        },
      },
      configurable: true,
    })

    useUnifiedRuntimeStore.setState(state => ({
      ...state,
      activeWorkspaceDirectory: '/repo/dreamweaver',
      activeSessionID: 'session-1',
      projectDataByDirectory: {
        ...state.projectDataByDirectory,
        '/repo/dreamweaver': createProjectData('/repo/dreamweaver', [activeSession]) as never,
      },
    }))

    const { container } = render(<App />)

    const sessionButton = await screen.findByText('Build Spa Booking Site')
    const selectProjectCallsBeforeArchive = selectProjectMock.mock.calls.length
    fireEvent.contextMenu(sessionButton)
    fireEvent.click(await screen.findByText('Archive Session'))

    await waitFor(() => {
      expect(archiveSessionMock).toHaveBeenCalledWith('/repo/dreamweaver', 'session-1')
      expect(screen.queryByText('Build Spa Booking Site')).not.toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.queryByText('Opening session...')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(container.querySelectorAll('.workspace-landing-card').length).toBeGreaterThan(0)
    })
    expect(selectProjectMock).toHaveBeenCalledTimes(selectProjectCallsBeforeArchive + 1)
  })

  it('archives inactive sessions without rerouting the current workspace view', async () => {
    const activeSession = {
      id: 'session-active',
      slug: 'active-session',
      title: 'Keep Me Open',
      time: { created: Date.now(), updated: Date.now() },
    }
    const archivedSession = {
      id: 'session-archive',
      slug: 'archive-me',
      title: 'Archive Me',
      time: { created: Date.now() - 1000, updated: Date.now() - 1000 },
    }
    const projectData = {
      directory: '/repo/dreamweaver',
      path: {},
      sessions: [activeSession, archivedSession],
      sessionStatus: {
        'session-active': { type: 'idle' as const },
        'session-archive': { type: 'idle' as const },
      },
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

    const bootstrapMock = vi.fn(async () => ({
      projects: [
        {
          id: 'proj-1',
          name: 'dreamweaver',
          worktree: '/repo/dreamweaver',
          source: 'local' as const,
        },
      ],
      runtime: { status: 'disconnected' as const, managedServer: false },
    }))
    const selectProjectMock = vi.fn(async () => projectData)
    const refreshProjectMock = vi.fn(async () => ({
      ...projectData,
      sessions: [activeSession],
      sessionStatus: { 'session-active': { type: 'idle' as const } },
    }))
    const archiveSessionMock = vi.fn(async () => ({
      ...archivedSession,
      time: { ...archivedSession.time, archived: Date.now() },
    }))

    Object.defineProperty(window, 'orxa', {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
          refreshProject: refreshProjectMock,
          archiveSession: archiveSessionMock,
        },
      },
      configurable: true,
    })

    render(<App />)

    expect(await screen.findByText('Keep Me Open')).toBeInTheDocument()
    fireEvent.contextMenu(await screen.findByText('Archive Me'))
    fireEvent.click(await screen.findByText('Archive Session'))

    await waitFor(() => {
      expect(archiveSessionMock).toHaveBeenCalledWith('/repo/dreamweaver', 'session-archive')
      expect(screen.queryByText('Archive Me')).not.toBeInTheDocument()
    })
    expect(selectProjectMock).toHaveBeenCalledTimes(1)
  })

  it('clears Claude chat runtime state when archiving from the App shell', async () => {
    const sessionKey = '/repo/reliabilityworks::session-claude-chat'
    window.localStorage.setItem(
      'orxa:sessionTypes:v2',
      JSON.stringify({ [sessionKey]: 'claude-chat' })
    )

    seedClaudeChatRuntimeState(sessionKey)

    const bootstrapMock = createBootstrapMock('reliabilityworks', '/repo/reliabilityworks')
    const activeSession = {
      id: 'session-claude-chat',
      slug: 'claude-chat',
      title: 'Claude Code (Chat)',
      time: { created: Date.now(), updated: Date.now() },
    }
    const selectProjectMock = vi.fn(async () =>
      createProjectData('/repo/reliabilityworks', [activeSession])
    )
    const refreshProjectMock = vi.fn(async () =>
      createProjectData('/repo/reliabilityworks', [])
    )

    Object.defineProperty(window, 'orxa', {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
          refreshProject: refreshProjectMock,
          archiveSession: vi.fn(async () => ({
            ...activeSession,
            time: { ...activeSession.time, archived: Date.now() },
          })),
        },
        claudeChat: {
          ...window.orxa!.claudeChat,
          archiveSession: vi.fn(async () => undefined),
        },
      },
      configurable: true,
    })

    render(<App />)

    const sessionButton = await screen.findByText('Claude Code (Chat)')
    fireEvent.contextMenu(sessionButton)
    fireEvent.click(await screen.findByText('Archive Session'))

    await waitFor(() => {
      expect(useUnifiedRuntimeStore.getState().claudeChatSessions[sessionKey]).toBeUndefined()
    })
  })

  it('clears Codex runtime state when archiving from the App shell', async () => {
    const sessionKey = '/repo/reliabilityworks::session-codex'
    window.localStorage.setItem('orxa:sessionTypes:v2', JSON.stringify({ [sessionKey]: 'codex' }))

    useUnifiedRuntimeStore.setState(state => ({
      ...state,
      codexSessions: {
        ...state.codexSessions,
        [sessionKey]: {
          key: sessionKey,
          directory: '/repo/reliabilityworks',
          connectionStatus: 'connected',
          thread: {
            id: 'codex-thread-1',
            preview: '',
            modelProvider: 'openai',
            createdAt: Date.now(),
          },
          runtimeSnapshot: null,
          messages: [],
          pendingApproval: null,
          pendingUserInput: null,
          isStreaming: false,
          subagents: [],
          planItems: [],
          childThreadMessages: {},
          activeSubagentThreadId: null,
          dismissedPlanIds: [],
          observedTokenTotal: 0,
          turnTokenTotals: [],
        },
      },
    }))

    const activeSession = { id: 'session-codex', slug: 'session-codex', title: 'Codex Session', time: { created: Date.now(), updated: Date.now() } }
    const selectProjectMock = vi.fn(async () => createProjectData('/repo/reliabilityworks', [activeSession]))

    Object.defineProperty(window, 'orxa', {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: createBootstrapMock('reliabilityworks', '/repo/reliabilityworks'),
          selectProject: selectProjectMock,
        },
        codex: {
          ...window.orxa!.codex,
          archiveThreadTree: vi.fn(async () => undefined),
        },
      },
      configurable: true,
    })

    render(<App />)

    const sessionButton = await screen.findByText('Codex Session')
    fireEvent.contextMenu(sessionButton)
    fireEvent.click(await screen.findByText('Archive Session'))

    await waitFor(() => {
      expect(useUnifiedRuntimeStore.getState().codexSessions[sessionKey]).toBeUndefined()
    })
  })

  it('renames Claude chat provider sessions from the App shell', async () => {
    const sessionKey = '/repo/reliabilityworks::session-claude-chat'
    window.localStorage.setItem('orxa:sessionTypes:v2', JSON.stringify({ [sessionKey]: 'claude-chat' }))

    useUnifiedRuntimeStore.setState({
      claudeChatSessions: {
        [sessionKey]: {
          key: sessionKey,
          directory: '/repo/reliabilityworks',
          connectionStatus: 'connected',
          providerThreadId: 'claude-thread-1',
          activeTurnId: null,
          messages: [],
          historyMessages: [],
          pendingApproval: null,
          pendingUserInput: null,
          isStreaming: false,
          subagents: [],
        },
      },
    })

    const activeSession = { id: 'session-claude-chat', title: 'Claude Code (Chat)', slug: 'claude-chat', time: { created: Date.now(), updated: Date.now() } }

    const bootstrapMock = vi.fn(async () => ({
      projects: [
        {
          id: 'proj-1',
          name: 'reliabilityworks',
          worktree: '/repo/reliabilityworks',
          source: 'local' as const,
        },
      ],
      runtime: { status: 'connected' as const, managedServer: false },
    }))
    const selectProjectMock = vi.fn(async () => ({
      directory: '/repo/reliabilityworks',
      path: {},
      sessions: [activeSession],
      sessionStatus: { 'session-claude-chat': { type: 'idle' as const } },
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
    const renameProviderSessionMock = vi.fn(async () => undefined)

    Object.defineProperty(window, 'orxa', {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
        },
        claudeChat: {
          ...window.orxa!.claudeChat,
          renameProviderSession: renameProviderSessionMock,
        },
      },
      configurable: true,
    })

    render(<App />)

    const sessionButton = await screen.findByText('Claude Code (Chat)')
    fireEvent.contextMenu(sessionButton)
    fireEvent.click(await screen.findByText('Rename Session'))

    const input = await screen.findByPlaceholderText('Session title')
    fireEvent.change(input, { target: { value: 'Renamed Claude Session' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))

    await waitFor(() => {
      expect(renameProviderSessionMock).toHaveBeenCalledWith(
        'claude-thread-1',
        'Renamed Claude Session',
        '/repo/reliabilityworks'
      )
    })
  })
