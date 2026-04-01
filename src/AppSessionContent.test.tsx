import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AppSessionContent, type AppSessionContentProps } from './AppSessionContent'
import {
  buildDefaultBranchProps,
  buildOrxaCodex,
  buildOrxaEvents,
  mockOnExit,
  resetCodexPaneTestState,
} from './components/CodexPane.test-helpers'

function buildProps(sessionID: string): AppSessionContentProps {
  return {
    sidebarMode: 'projects',
    activeProjectDir: '/workspace/project',
    activeSessionID: sessionID,
    activeSessionType: 'codex',
    pendingSessionId: undefined,
    dashboardProps: {} as AppSessionContentProps['dashboardProps'],
    skillsProps: {} as AppSessionContentProps['skillsProps'],
    workspaceLandingProps: {} as AppSessionContentProps['workspaceLandingProps'],
    canvasPaneProps: {} as AppSessionContentProps['canvasPaneProps'],
    claudeChatPaneProps: {} as AppSessionContentProps['claudeChatPaneProps'],
    claudeTerminalPaneProps: {} as AppSessionContentProps['claudeTerminalPaneProps'],
    codexPaneProps: {
      directory: '/workspace/project',
      sessionStorageKey: `/workspace/project::${sessionID}`,
      onExit: mockOnExit,
      ...buildDefaultBranchProps(),
    },
    messageFeedProps: {} as AppSessionContentProps['messageFeedProps'],
    composerPanelProps: {} as AppSessionContentProps['composerPanelProps'],
    terminalPanelProps: undefined,
  }
}

beforeEach(() => {
  resetCodexPaneTestState()
})

afterEach(() => {
  // @ts-expect-error test teardown
  delete window.orxa
})

it('remounts the Codex pane for each session key so model defaults refresh on session switch', async () => {
  const codex = buildOrxaCodex()
  codex.getState = vi.fn(async () => ({
    status: 'connected' as const,
    serverInfo: { name: 'codex', version: '1.0.0' },
  })) as unknown as typeof codex.getState
  codex.listModels = vi
    .fn()
    .mockResolvedValueOnce([
      {
        id: 'gpt-5.4',
        model: 'gpt-5.4',
        name: 'GPT-5.4',
        isDefault: true,
        supportedReasoningEfforts: ['medium'],
        defaultReasoningEffort: 'medium',
      },
    ])
    .mockResolvedValue([
      {
        id: 'gpt-5.5',
        model: 'gpt-5.5',
        name: 'GPT-5.5',
        isDefault: true,
        supportedReasoningEfforts: ['high'],
        defaultReasoningEffort: 'high',
      },
    ])

  window.orxa = {
    codex,
    events: buildOrxaEvents(),
  } as unknown as typeof window.orxa

  const { rerender } = render(<AppSessionContent {...buildProps('session-1')} />)

  await waitFor(() => {
    expect(screen.getByTitle('Codex/GPT-5.4')).toBeInTheDocument()
  })

  rerender(<AppSessionContent {...buildProps('session-2')} />)

  await waitFor(() => {
    expect(screen.getByTitle('Codex/GPT-5.5')).toBeInTheDocument()
  })
})
