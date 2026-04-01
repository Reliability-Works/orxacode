import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { MessageFeed } from './MessageFeed'
import type { SessionMessageBundle } from '@shared/ipc'

  it('does not show copy button for assistant messages', () => {
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-copy-disabled',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: Date.now(), updated: Date.now() },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'part-assistant-copy-disabled',
            type: 'text',
            sessionID: 'session-1',
            messageID: 'msg-assistant-copy-disabled',
            text: 'Assistant text should not render a copy affordance.',
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} />)

    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument()
  })

  it('shows command output in expandable tool call card', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-run-output',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-run-output',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-run-output',
            callID: 'call-run-output',
            tool: 'bash',
            state: {
              status: 'completed',
              input: { cmd: 'pwd' },
              output: '/Users/callumspencer/Repos/macapp/orxacode',
              title: 'pwd',
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} />)

    // pwd is recognized as a shell command, so it renders as "Ran pwd" in a tool call card
    expect(screen.getByText(/Ran pwd/i)).toBeInTheDocument()
  })

  it('does not show copy button for timeline-only messages', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-timeline-only',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-read-timeline-only',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-timeline-only',
            callID: 'call-read-timeline-only',
            tool: 'read_file',
            state: {
              status: 'completed',
              input: { path: '/repo/src/app.tsx' },
              output: '',
              title: 'read_file',
              metadata: {},
              time: { start: now, end: now },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} workspaceDirectory="/repo" />)
    expect(screen.queryByRole('button', { name: /copy message/i })).not.toBeInTheDocument()
  })

  it('does not show copy button on thinking placeholder', () => {
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-thinking-copy',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: Date.now(), updated: Date.now() },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'part-step-thinking-copy',
            type: 'step-finish',
            sessionID: 'session-1',
            messageID: 'msg-assistant-thinking-copy',
            reason: 'tool-calls',
            snapshot: 'snap-1',
            cost: 0,
            tokens: {
              input: 10,
              output: 2,
              reasoning: 0,
              cache: { read: 4, write: 0 },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} showAssistantPlaceholder />)
    expect(screen.getByText('Thinking...')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /copy message/i })).not.toBeInTheDocument()
  })

  it('uses mode-aware assistant label', () => {
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-label',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: Date.now(), updated: Date.now() },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'part-text-label',
            type: 'text',
            sessionID: 'session-1',
            messageID: 'msg-assistant-label',
            text: 'Done.',
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} assistantLabel="Assistant" />)

    expect(screen.getByText('Assistant')).toBeInTheDocument()
  })

  it('renders an optimistic first user prompt while the assistant placeholder is active', () => {
    render(
      <MessageFeed
        messages={[]}
        optimisticUserPrompt={{ text: 'hi', timestamp: Date.now() }}
        showAssistantPlaceholder
      />
    )

    expect(screen.queryByText(/No messages yet/i)).not.toBeInTheDocument()
    expect(screen.getByText('hi')).toBeInTheDocument()
    expect(screen.getByText('Thinking...')).toBeInTheDocument()
  })

  it('renders expandable thinking details when the presentation includes reasoning content', () => {
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-thinking-footer',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: Date.now(), updated: Date.now() },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'msg-thinking-footer-part',
            type: 'step-finish',
            sessionID: 'session-1',
            messageID: 'msg-thinking-footer',
            reason: 'tool-calls',
            snapshot: 'snap-1',
            cost: 0,
            tokens: {
              input: 10,
              output: 2,
              reasoning: 0,
              cache: { read: 4, write: 0 },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(
      <MessageFeed
        messages={messages}
        showAssistantPlaceholder
        presentation={{
          provider: 'opencode',
          rows: [],
          latestActivity: { id: 'thinking-1', label: 'Planning the next edits' },
          latestActivityContent:
            'I have created the directory and I am preparing package.json next.',
          placeholderTimestamp: Date.now(),
        }}
      />
    )

    expect(screen.queryByText('Planning the next edits')).toBeNull()
    fireEvent.click(screen.getByText('Thinking...'))
    expect(
      screen.getByText(/I have created the directory and I am preparing package\.json next\./i)
    ).toBeInTheDocument()
  })

  it('auto-scrolls to bottom when user is at bottom and new messages arrive', async () => {
    const now = Date.now()
    const makeMessage = (id: string, text: string): SessionMessageBundle => ({
      info: {
        id,
        role: 'assistant',
        sessionID: 'session-scroll',
        time: { created: now, updated: now },
      } as unknown as SessionMessageBundle['info'],
      parts: [
        {
          id: `${id}-part`,
          type: 'text',
          sessionID: 'session-scroll',
          messageID: id,
          text,
        },
      ] as SessionMessageBundle['parts'],
    })

    const initialMessages = [makeMessage('msg-1', 'Hello')]
    const { rerender } = render(<MessageFeed messages={initialMessages} />)

    const scrollEl = document.querySelector('.messages-scroll') as HTMLElement
    expect(scrollEl).toBeTruthy()

    // Simulate user being at the bottom (jsdom starts at scrollTop=0, scrollHeight=0)
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 500 })
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 400 })
    Object.defineProperty(scrollEl, 'scrollTop', { configurable: true, writable: true, value: 100 })

    const updatedMessages = [...initialMessages, makeMessage('msg-2', 'New message')]
    rerender(<MessageFeed messages={updatedMessages} />)

    await waitFor(() => {
      // scrollTop should have been set to scrollHeight (500)
      expect(scrollEl.scrollTop).toBe(500)
    })
  })

  it('does not auto-scroll when user has scrolled up', async () => {
    const now = Date.now()
    const makeMessage = (id: string, text: string): SessionMessageBundle => ({
      info: {
        id,
        role: 'assistant',
        sessionID: 'session-scroll-up',
        time: { created: now, updated: now },
      } as unknown as SessionMessageBundle['info'],
      parts: [
        {
          id: `${id}-part`,
          type: 'text',
          sessionID: 'session-scroll-up',
          messageID: id,
          text,
        },
      ] as SessionMessageBundle['parts'],
    })

    const initialMessages = [makeMessage('msg-a', 'First message')]
    const { rerender } = render(<MessageFeed messages={initialMessages} />)

    const scrollEl = document.querySelector('.messages-scroll') as HTMLElement
    expect(scrollEl).toBeTruthy()

    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 400 })
    Object.defineProperty(scrollEl, 'scrollTop', { configurable: true, writable: true, value: 0 })

    // Simulate user scrolling up — fire a scroll event so the handler marks isAtBottom as false
    fireEvent.scroll(scrollEl)

    // Record the scrollTop before the rerender
    const scrollTopBefore = scrollEl.scrollTop

    const updatedMessages = [...initialMessages, makeMessage('msg-b', 'Another message')]
    rerender(<MessageFeed messages={updatedMessages} />)

    await waitFor(() => {
      // scrollTop should NOT have changed because user scrolled up
      expect(scrollEl.scrollTop).toBe(scrollTopBefore)
    })
  })

  it('renders the shared feed without transcript virtualization', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-no-virtualizer',
          role: 'assistant',
          sessionID: 'session-plain',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'msg-no-virtualizer-part',
            type: 'text',
            sessionID: 'session-plain',
            messageID: 'msg-no-virtualizer',
            text: 'Transcript rows stay in normal document flow.',
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    const { container } = render(<MessageFeed messages={messages} />)

    expect(container.querySelector('.messages-virtual-row')).toBeNull()
    expect(container.querySelector('.messages-virtual-spacer')).toBeNull()
  })
