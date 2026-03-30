import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import {
  installAppTestEnvironment,
} from './App.test.shared'
import { EMPTY_WORKSPACE_SESSIONS_KEY } from './hooks/useWorkspaceState'
import { preferredAgentForMode } from './lib/app-mode'

let checkDependenciesMock: ReturnType<typeof installAppTestEnvironment>['checkDependenciesMock']

beforeEach(() => {
  checkDependenciesMock = installAppTestEnvironment().checkDependenciesMock
})

  it('deletes an unused Codex session when navigating away', async () => {
    const bootstrapMock = vi.fn(async () => ({
      projects: [
        {
          id: 'proj-1',
          name: 'marketing-websites',
          worktree: '/repo/marketing-websites',
          source: 'local' as const,
        },
        {
          id: 'proj-2',
          name: 'dreamweaver',
          worktree: '/repo/dreamweaver',
          source: 'local' as const,
        },
      ],
      runtime: { status: 'disconnected' as const, managedServer: false },
    }))
    const deleteSessionMock = vi.fn(async () => true)
    const selectProjectMock = vi.fn(async (directory: string) => {
      if (directory === '/repo/marketing-websites') {
        return {
          directory,
          path: {},
          sessions: [],
          sessionStatus: {},
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
      }
      return {
        directory,
        path: {},
        sessions: [],
        sessionStatus: {},
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
    })

    Object.defineProperty(window, 'orxa', {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
          deleteSession: deleteSessionMock,
        },
      },
      configurable: true,
    })

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'marketing-websites' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Create session for marketing-websites' })
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: /Codex/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'dreamweaver' }))

    await waitFor(() => {
      expect(deleteSessionMock).not.toHaveBeenCalled()
    })

    fireEvent.click(await screen.findByRole('button', { name: 'marketing-websites' }))
    await waitFor(() => {
      expect(screen.queryByText('Codex Session')).not.toBeInTheDocument()
    })
  })

  it('deletes an unused Claude chat session when navigating away', async () => {
    const bootstrapMock = vi.fn(async () => ({
      projects: [
        {
          id: 'proj-1',
          name: 'marketing-websites',
          worktree: '/repo/marketing-websites',
          source: 'local' as const,
        },
        {
          id: 'proj-2',
          name: 'dreamweaver',
          worktree: '/repo/dreamweaver',
          source: 'local' as const,
        },
      ],
      runtime: { status: 'disconnected' as const, managedServer: false },
    }))
    const deleteSessionMock = vi.fn(async () => true)
    const selectProjectMock = vi.fn(async (directory: string) => ({
      directory,
      path: {},
      sessions: [],
      sessionStatus: {},
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
          deleteSession: deleteSessionMock,
        },
      },
      configurable: true,
    })

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'marketing-websites' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Create session for marketing-websites' })
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: /Claude Chat/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'dreamweaver' }))

    await waitFor(() => {
      expect(deleteSessionMock).not.toHaveBeenCalled()
    })

    fireEvent.click(await screen.findByRole('button', { name: 'marketing-websites' }))
    await waitFor(() => {
      expect(screen.queryAllByText('Claude Code (Chat)')).toHaveLength(1)
    })
  })

  it('cleans up persisted empty sessions during startup', async () => {
    const deleteSessionMock = vi.fn(async () => true)

    window.localStorage.setItem(
      EMPTY_WORKSPACE_SESSIONS_KEY,
      JSON.stringify({
        'session-empty': '/repo/marketing-websites',
      })
    )

    Object.defineProperty(window, 'orxa', {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: vi.fn(async () => ({
            projects: [],
            runtime: { status: 'disconnected' as const, managedServer: false },
          })),
          deleteSession: deleteSessionMock,
        },
      },
      configurable: true,
    })

    render(<App />)

    await waitFor(() => {
      expect(deleteSessionMock).toHaveBeenCalledWith('/repo/marketing-websites', 'session-empty')
    })
    expect(window.localStorage.getItem(EMPTY_WORKSPACE_SESSIONS_KEY)).toBeNull()
  })

  it('chooses preferred agents', () => {
    expect(
      preferredAgentForMode({
        hasPlanAgent: true,
        serverAgentNames: new Set(['plan', 'build']),
        firstAgentName: 'plan',
      })
    ).toBe('build')

    expect(
      preferredAgentForMode({
        hasPlanAgent: true,
        serverAgentNames: new Set(['plan']),
        firstAgentName: 'plan',
      })
    ).toBe('plan')
  })

  it('loads the global Opencode agent registry independently of workspace-scoped agents', async () => {
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
    const selectProjectMock = vi.fn(async () => ({
      directory: '/repo/dreamweaver',
      path: {},
      sessions: [
        {
          id: 'session-1',
          slug: 'design-session',
          title: 'Design session',
          time: { created: Date.now(), updated: Date.now() },
        },
      ],
      sessionStatus: { 'session-1': { type: 'idle' as const } },
      providers: { all: [], connected: [], default: {} },
      agents: [{ name: 'plan', mode: 'primary', description: 'Plan' }],
      config: {},
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    }))
    const listAgentsMock = vi.fn(async () => [
      { name: 'plan', mode: 'primary', description: 'Plan' },
      { name: 'conductor', mode: 'primary', description: 'Conductor' },
      { name: 'builder', mode: 'primary', description: 'Builder' },
      { name: 'orchestrator', mode: 'primary', description: 'Orchestrator' },
    ])
    const listAgentFilesMock = vi.fn(async () => [
      {
        filename: 'plan.md',
        name: 'plan',
        mode: 'primary',
        description: 'Plan',
        model: 'openai/gpt-5.4',
        content: '',
        path: '/Users/test/.config/opencode/agents/plan.md',
      },
      {
        filename: 'conductor.md',
        name: 'conductor',
        mode: 'primary',
        description: 'Conductor',
        model: 'kimi-for-coding/kimi-k2.5',
        content: '',
        path: '/Users/test/.config/opencode/agents/conductor.md',
      },
      {
        filename: 'builder.md',
        name: 'builder',
        mode: 'primary',
        description: 'Builder',
        model: 'openai/gpt-5.4',
        content: '',
        path: '/Users/test/.config/opencode/agents/builder.md',
      },
      {
        filename: 'orchestrator.md',
        name: 'orchestrator',
        mode: 'primary',
        description: 'Orchestrator',
        model: 'openai/gpt-5.4',
        content: '',
        path: '/Users/test/.config/opencode/agents/orchestrator.md',
      },
    ])

    Object.defineProperty(window, 'orxa', {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
          listAgents: listAgentsMock,
          listAgentFiles: listAgentFilesMock,
        },
      },
      configurable: true,
    })

    render(<App />)

    await waitFor(() => {
      expect(listAgentsMock).toHaveBeenCalled()
      expect(listAgentFilesMock).toHaveBeenCalled()
    })
  })

  it('shows dependency modal when required runtime dependency is missing', async () => {
    checkDependenciesMock.mockResolvedValueOnce({
      checkedAt: Date.now(),
      missingAny: true,
      missingRequired: true,
      dependencies: [
        {
          key: 'opencode',
          label: 'OpenCode CLI',
          required: true,
          installed: false,
          description:
            'Core runtime and CLI backend used by the app for sessions, tools, and streaming.',
          reason: 'Required. Orxa Code depends on the OpenCode server and CLI APIs.',
          installCommand: 'npm install -g opencode-ai',
          sourceUrl: 'https://github.com/anomalyco/opencode',
        },
        {
          key: 'orxa',
          label: 'Orxa Code Plugin Package',
          required: false,
          installed: false,
          description:
            'Orxa workflows, agents, and plugin assets for the dedicated Orxa mode experience.',
          reason: 'Optional. Needed only when using Orxa mode features.',
          installCommand: 'npm install -g @reliabilityworks/opencode-orxa',
          sourceUrl: 'https://github.com/Reliability-Works/opencode-orxa',
        },
      ],
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Runtime Dependencies' })).toBeInTheDocument()
    })

    expect(screen.getByText('npm install -g opencode-ai')).toBeInTheDocument()
    expect(screen.getByText('npm install -g @reliabilityworks/opencode-orxa')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument()

    const overlay = document.querySelector('.dependency-overlay')
    expect(overlay).not.toBeNull()
    overlay?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(screen.getByRole('heading', { name: 'Runtime Dependencies' })).toBeInTheDocument()

    checkDependenciesMock.mockResolvedValueOnce({
      checkedAt: Date.now(),
      missingAny: false,
      missingRequired: false,
      dependencies: [
        {
          key: 'opencode',
          label: 'OpenCode CLI',
          required: true,
          installed: true,
          description:
            'Core runtime and CLI backend used by the app for sessions, tools, and streaming.',
          reason: 'Required. Orxa Code depends on the OpenCode server and CLI APIs.',
          installCommand: 'npm install -g opencode-ai',
          sourceUrl: 'https://github.com/anomalyco/opencode',
        },
        {
          key: 'orxa',
          label: 'Orxa Code Plugin Package',
          required: false,
          installed: true,
          description:
            'Orxa workflows, agents, and plugin assets for the dedicated Orxa mode experience.',
          reason: 'Optional. Needed only when using Orxa mode features.',
          installCommand: 'npm install -g @reliabilityworks/opencode-orxa',
          sourceUrl: 'https://github.com/Reliability-Works/opencode-orxa',
        },
      ],
    })
    const callsBeforeRetry = checkDependenciesMock.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: 'Runtime Dependencies' })
      ).not.toBeInTheDocument()
    })
    expect(checkDependenciesMock.mock.calls.length).toBeGreaterThanOrEqual(callsBeforeRetry + 1)
  })
