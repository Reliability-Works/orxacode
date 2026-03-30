import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BackgroundAgentsPanel } from './BackgroundAgentsPanel'

describe('BackgroundAgentsPanel summary', () => {
  it('hides the tagging hint when none is provided', () => {
    render(
      <BackgroundAgentsPanel
        agents={[
          {
            id: 'agent-1',
            provider: 'opencode',
            name: 'build',
            status: 'thinking',
            statusText: 'thinking',
            sessionID: 'child-1',
          },
        ]}
        selectedAgentId={null}
        onOpenAgent={() => undefined}
        onBack={() => undefined}
        taggingHint={null}
      />
    )

    expect(screen.queryByText(/tag agents/i)).toBeNull()
    expect(screen.queryByText(/tag subagents/i)).toBeNull()
  })

  it('keeps a single header row for the drawer toggle', () => {
    render(
      <BackgroundAgentsPanel
        agents={[
          {
            id: 'agent-1',
            provider: 'opencode',
            name: 'build',
            status: 'idle',
            statusText: 'idle',
            sessionID: 'child-1',
          },
        ]}
        selectedAgentId={null}
        onOpenAgent={() => undefined}
        onBack={() => undefined}
      />
    )

    expect(screen.getByText('1 background agent')).toBeInTheDocument()
    expect(screen.getAllByText('1 background agent')).toHaveLength(1)
  })

})

describe('BackgroundAgentsPanel interactions', () => {
  it('shows active counts only when at least one background agent is active', () => {
    const { rerender } = render(
      <BackgroundAgentsPanel
        agents={[
          {
            id: 'agent-1',
            provider: 'opencode',
            name: 'build',
            status: 'idle',
            statusText: 'idle',
            sessionID: 'child-1',
          },
          {
            id: 'agent-2',
            provider: 'codex',
            name: 'review',
            status: 'completed',
            statusText: 'completed',
            sessionID: 'child-2',
          },
        ]}
        selectedAgentId={null}
        onOpenAgent={() => undefined}
        onBack={() => undefined}
      />
    )

    expect(screen.getByText('2 background agents')).toBeInTheDocument()
    expect(screen.queryByText(/active\)/i)).toBeNull()

    rerender(
      <BackgroundAgentsPanel
        agents={[
          {
            id: 'agent-1',
            provider: 'opencode',
            name: 'build',
            status: 'idle',
            statusText: 'idle',
            sessionID: 'child-1',
          },
          {
            id: 'agent-2',
            provider: 'claude-chat',
            name: 'research',
            status: 'thinking',
            statusText: 'is running',
            sessionID: 'child-2',
          },
          {
            id: 'agent-3',
            provider: 'codex',
            name: 'qa',
            status: 'awaiting_instruction',
            statusText: 'awaiting input',
            sessionID: 'child-3',
          },
        ]}
        selectedAgentId={null}
        onOpenAgent={() => undefined}
        onBack={() => undefined}
      />
    )

    expect(screen.getByText('3 background agents (2 active)')).toBeInTheDocument()
  })
})

describe('BackgroundAgentsPanel modal', () => {
  it('renders selected agent details inside a modal overlay instead of inline', () => {
    const onBack = vi.fn()
    render(
      <BackgroundAgentsPanel
        agents={[
          {
            id: 'agent-1',
            provider: 'opencode',
            name: 'build',
            status: 'thinking',
            statusText: 'thinking',
            sessionID: 'child-1',
            modelLabel: 'openai/gpt-5.4',
          },
        ]}
        selectedAgentId="agent-1"
        onOpenAgent={() => undefined}
        onBack={onBack}
        detailBody={<div>Agent transcript</div>}
      />
    )

    expect(screen.getByRole('dialog', { name: 'Background agent' })).toBeInTheDocument()
    expect(screen.getByText('Agent transcript')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close background agent' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('BackgroundAgentsPanel drawer actions', () => {
  it('starts the background-agent drawer collapsed by default', () => {
    render(
      <BackgroundAgentsPanel
        agents={[
          {
            id: 'agent-1',
            provider: 'opencode',
            name: 'build',
            status: 'thinking',
            statusText: 'thinking',
            sessionID: 'child-1',
          },
        ]}
        selectedAgentId={null}
        onOpenAgent={() => undefined}
        onBack={() => undefined}
      />
    )

    expect(screen.queryByText('build')).not.toBeInTheDocument()
  })

  it('allows opening a background agent even before a provider session id is attached', () => {
    const onOpenAgent = vi.fn()
    render(
      <BackgroundAgentsPanel
        agents={[
          {
            id: 'agent-1',
            provider: 'claude-chat',
            name: 'explore',
            status: 'thinking',
            statusText: 'thinking',
          },
        ]}
        selectedAgentId={null}
        onOpenAgent={onOpenAgent}
        onBack={() => undefined}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand background agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open explore' }))
    expect(onOpenAgent).toHaveBeenCalledWith('agent-1')
  })

  it('calls archive from the drawer row and modal', () => {
    const onArchiveAgent = vi.fn()
    render(
      <BackgroundAgentsPanel
        agents={[
          {
            id: 'agent-1',
            provider: 'opencode',
            name: 'build',
            status: 'thinking',
            statusText: 'thinking',
            sessionID: 'child-1',
          },
        ]}
        selectedAgentId="agent-1"
        onOpenAgent={() => undefined}
        onBack={() => undefined}
        onArchiveAgent={onArchiveAgent}
        detailBody={<div>Agent transcript</div>}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand background agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archive build' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archive background agent' }))
    expect(onArchiveAgent).toHaveBeenCalledTimes(2)
  })
})
