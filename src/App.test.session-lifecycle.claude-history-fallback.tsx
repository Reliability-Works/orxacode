import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { installAppTestEnvironment } from './App.test.shared'
import { useUnifiedRuntimeStore } from './state/unified-runtime-store'

beforeEach(() => {
  installAppTestEnvironment()
})

function seedClaudeHistoryFallbackSession() {
  const sessionKey = '/repo/reliabilityworks::session-claude-chat'
  window.localStorage.setItem('orxa:sessionTypes:v2', JSON.stringify({ [sessionKey]: 'claude-chat' }))

  useUnifiedRuntimeStore.setState({
    claudeChatSessions: {
      [sessionKey]: {
        key: sessionKey,
        directory: '/repo/reliabilityworks',
        connectionStatus: 'connected',
        providerThreadId: null,
        activeTurnId: null,
        messages: [],
        historyMessages: [
          {
            id: 'history-1',
            role: 'assistant',
            content: 'Hello',
            timestamp: Date.now(),
            sessionId: 'claude-thread-from-history',
          },
        ],
        pendingApproval: null,
        pendingUserInput: null,
        isStreaming: false,
        subagents: [],
      },
    },
  })

  const activeSession = {
    id: 'session-claude-chat',
    title: 'Claude Code (Chat)',
    slug: 'claude-chat',
    time: { created: Date.now(), updated: Date.now() },
  }
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

  return { bootstrapMock, selectProjectMock }
}

it('falls back to Claude history message session ids when renaming provider sessions', async () => {
  const { bootstrapMock, selectProjectMock } = seedClaudeHistoryFallbackSession()
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
  fireEvent.change(input, { target: { value: 'Renamed From History' } })
  fireEvent.click(screen.getByRole('button', { name: 'Rename' }))

  await waitFor(() => {
    expect(renameProviderSessionMock).toHaveBeenCalledWith(
      'claude-thread-from-history',
      'Renamed From History',
      '/repo/reliabilityworks'
    )
  })
})

it('falls back to Claude history message session ids when copying the session id', async () => {
  const { bootstrapMock, selectProjectMock } = seedClaudeHistoryFallbackSession()
  const clipboardWriteText = vi.fn(async () => undefined)

  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: clipboardWriteText },
    configurable: true,
  })

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

  const sessionButton = await screen.findByText('Claude Code (Chat)')
  fireEvent.contextMenu(sessionButton)
  fireEvent.click(await screen.findByText('Copy Claude Thread ID'))

  await waitFor(() => {
    expect(clipboardWriteText).toHaveBeenCalledWith('claude-thread-from-history')
  })
})
