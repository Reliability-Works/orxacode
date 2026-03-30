import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { MessageFeed } from './MessageFeed'
import type { SessionMessageBundle } from '@shared/ipc'
import { createSessionMessageBundle, createTextPart } from '../test/session-message-bundle-factory'

it('renders persistent timeline rows for completed tool actions', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      createSessionMessageBundle({
        id: 'msg-assistant-actions',
        role: 'assistant',
        sessionID: 'session-1',
        createdAt: now,
        parts: [
          {
            id: 'tool-read-1',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-actions',
            callID: 'call-read-1',
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
        ],
      }),
    ]

    render(<MessageFeed messages={messages} workspaceDirectory="/repo" />)
    const exploredSummary = screen.getByText('Explored 1 file')
    expect(exploredSummary).toBeInTheDocument()
    expect(exploredSummary.closest('details')).not.toHaveAttribute('open')
    expect(screen.queryByText('Why this changed: Main agent via read')).not.toBeInTheDocument()
})

  it('does not classify completed read tools with file metadata as changed files', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      createSessionMessageBundle({
        id: 'msg-assistant-read-metadata',
        role: 'assistant',
        sessionID: 'session-1',
        createdAt: now,
        parts: [
          {
            id: 'tool-read-metadata',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-read-metadata',
            callID: 'call-read-metadata',
            tool: 'read_file',
            state: {
              status: 'completed',
              input: { path: '/repo/website/app/page.tsx' },
              output: '',
              title: 'read_file',
              metadata: {
                filepath: '/repo/website/app/page.tsx',
                additions: 120,
                deletions: 14,
              },
              time: { start: now, end: now },
            },
          },
        ],
      }),
    ]

    render(<MessageFeed messages={messages} workspaceDirectory="/repo" />)

    expect(screen.getByText('Explored 1 file')).toBeInTheDocument()
    expect(screen.queryByText('Changed files')).not.toBeInTheDocument()
    expect(screen.queryByText('Edited website/app/page.tsx')).not.toBeInTheDocument()
  })

  it('shows live tool cards for active edit tools while a session is streaming', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      createSessionMessageBundle({
        id: 'msg-assistant-active-edit',
        role: 'assistant',
        sessionID: 'session-1',
        createdAt: now,
        parts: [
          {
            id: 'tool-edit-1',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-active-edit',
            callID: 'call-edit-1',
            tool: 'apply_patch',
            state: {
              status: 'running',
              input:
                '*** Begin Patch\n*** Update File: src/App.tsx\n@@\n-old\n+new\n*** End Patch\n',
              output: '',
              title: 'apply_patch',
              metadata: {},
              time: { start: now, end: now },
            },
          },
        ],
      }),
    ]

    render(<MessageFeed messages={messages} workspaceDirectory="/repo" />)

    expect(screen.queryByText('Editing src/App.tsx...')).not.toBeInTheDocument()
  })

  it('shows assistant text and hides internal metadata/tool payloads', () => {
    const messages: SessionMessageBundle[] = [
      createSessionMessageBundle({
        id: 'msg-user-1',
        role: 'user',
        sessionID: 'session-1',
        parts: [
          createTextPart({
            id: 'part-user-1',
            sessionID: 'session-1',
            messageID: 'msg-user-1',
            text: 'hi',
          }),
        ],
      }),
      createSessionMessageBundle({
        id: 'msg-assistant-1',
        role: 'assistant',
        sessionID: 'session-1',
        parts: [
          createTextPart({
            id: 'part-start-1',
            sessionID: 'session-1',
            messageID: 'msg-assistant-1',
            text: '{"type":"step-start","id":"prt_1","sessionID":"session-1","messageID":"msg-assistant-1"}',
          }),
          {
            id: 'part-tool-1',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-1',
            callID: 'call-1',
            tool: 'todowrite',
            state: {
              status: 'completed',
              input: {},
              output: '[]',
              title: 'todo',
              metadata: {},
              time: { start: Date.now(), end: Date.now() },
            },
          },
          createTextPart({
            id: 'part-text-1',
            sessionID: 'session-1',
            messageID: 'msg-assistant-1',
            text: 'Hey! How can I help today?',
          }),
        ],
      }),
    ]

    render(<MessageFeed messages={messages} />)

    expect(screen.getByText('Hey! How can I help today?')).toBeInTheDocument()
    expect(screen.queryByText(/step-start/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/todowrite/i)).not.toBeInTheDocument()
  })

  it('wraps transcript rows in the shared centered rail', () => {
    const messages: SessionMessageBundle[] = [
      createSessionMessageBundle({
        id: 'msg-assistant-rail',
        role: 'assistant',
        sessionID: 'session-1',
        parts: [
          createTextPart({
            id: 'part-assistant-rail',
            sessionID: 'session-1',
            messageID: 'msg-assistant-rail',
            text: 'Rail-wrapped transcript row',
          }),
        ],
      }),
    ]

    render(<MessageFeed messages={messages} />)

    expect(
      screen.getByText('Rail-wrapped transcript row').closest('.center-pane-rail')
    ).toBeInTheDocument()
  })

  it('hides internal ORXA browser machine-result user prompts', () => {
    const messages: SessionMessageBundle[] = [
      createSessionMessageBundle({
        id: 'msg-user-machine-result',
        role: 'user',
        sessionID: 'session-1',
        parts: [
          createTextPart({
            id: 'part-user-machine-result',
            sessionID: 'session-1',
            messageID: 'msg-user-machine-result',
            text: '[ORXA_BROWSER_RESULT]{"id":"action-1","action":"navigate","ok":true}',
          }),
        ],
      }),
      createSessionMessageBundle({
        id: 'msg-assistant-visible',
        role: 'assistant',
        sessionID: 'session-1',
        parts: [
          createTextPart({
            id: 'part-assistant-visible',
            sessionID: 'session-1',
            messageID: 'msg-assistant-visible',
            text: 'Captured first source. Continuing evidence collection.',
          }),
        ],
      }),
    ]

    render(<MessageFeed messages={messages} />)

    expect(screen.queryByText(/\[ORXA_BROWSER_RESULT\]/)).not.toBeInTheDocument()
    expect(
      screen.getByText('Captured first source. Continuing evidence collection.')
    ).toBeInTheDocument()
  })

  it('keeps visible user text when a bundle also contains internal machine-result lines', () => {
    const messages: SessionMessageBundle[] = [
      createSessionMessageBundle({
        id: 'msg-user-mixed',
        role: 'user',
        sessionID: 'session-1',
        parts: [
          createTextPart({
            id: 'part-user-visible',
            sessionID: 'session-1',
            messageID: 'msg-user-mixed',
            text: 'Research and summarize top DeFi news from 2026.',
          }),
          createTextPart({
            id: 'part-user-internal',
            sessionID: 'session-1',
            messageID: 'msg-user-mixed',
            text: '[ORXA_BROWSER_RESULT]{"id":"action-1","action":"navigate","ok":true}',
          }),
        ],
      }),
    ]

    render(<MessageFeed messages={messages} />)

    expect(screen.getByText('Research and summarize top DeFi news from 2026.')).toBeInTheDocument()
    expect(screen.queryByText(/\[ORXA_BROWSER_RESULT\]/)).not.toBeInTheDocument()
  })

  it('renders all visible user text parts instead of truncating to the first one', () => {
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-user-multipart',
          role: 'user',
          sessionID: 'session-1',
          time: { created: Date.now(), updated: Date.now() },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'part-user-line-1',
            type: 'text',
            sessionID: 'session-1',
            messageID: 'msg-user-multipart',
            text: 'Line one.',
          },
          {
            id: 'part-user-line-2',
            type: 'text',
            sessionID: 'session-1',
            messageID: 'msg-user-multipart',
            text: 'Line two.',
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} />)

    expect(screen.getByText('Line one.')).toBeInTheDocument()
    expect(screen.getByText('Line two.')).toBeInTheDocument()
  })

  it('hides ORXA browser action tags from chat text', () => {
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-browser-action',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: Date.now(), updated: Date.now() },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'part-assistant-browser-action',
            type: 'text',
            sessionID: 'session-1',
            messageID: 'msg-assistant-browser-action',
            text: '<orxa_browser_action>{"id":"action-1","action":"navigate","args":{"url":"https://defillama.com"}}</orxa_browser_action>',
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} showAssistantPlaceholder />)

    expect(screen.queryByText(/<orxa_browser_action>/i)).not.toBeInTheDocument()
  })

  it('keeps ORXA screenshot machine-result attachments out of user chat messages', () => {
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-user-machine-screenshot',
          role: 'user',
          sessionID: 'session-1',
          time: { created: Date.now(), updated: Date.now() },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'part-user-machine-screenshot-text',
            type: 'text',
            sessionID: 'session-1',
            messageID: 'msg-user-machine-screenshot',
            text: '[ORXA_BROWSER_RESULT]{"id":"shot-1","action":"screenshot","ok":true}',
          },
          {
            id: 'part-user-machine-screenshot-file',
            type: 'file',
            sessionID: 'session-1',
            messageID: 'msg-user-machine-screenshot',
            mime: 'image/png',
            url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} showAssistantPlaceholder />)

    expect(screen.queryByText(/Attached file:/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/ORXA_BROWSER_RESULT/i)).not.toBeInTheDocument()
  })

  it('hides internal SUPERMEMORY user context lines from chat', () => {
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-user-supermemory',
          role: 'user',
          sessionID: 'session-1',
          time: { created: Date.now(), updated: Date.now() },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'part-user-supermemory',
            type: 'text',
            sessionID: 'session-1',
            messageID: 'msg-user-supermemory',
            text: '[SUPERMEMORY] injected 4 items',
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} showAssistantPlaceholder />)

    expect(screen.queryByText(/\[SUPERMEMORY\]/)).not.toBeInTheDocument()
  })

  it('ignores non-status SUPERMEMORY payload text', () => {
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-user-supermemory-noise',
          role: 'user',
          sessionID: 'session-1',
          time: { created: Date.now(), updated: Date.now() },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'part-user-supermemory-noise',
            type: 'text',
            sessionID: 'session-1',
            messageID: 'msg-user-supermemory-noise',
            text: '[SUPERMEMORY] Recent Context: fixed startup config and UI cleanup notes',
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} showAssistantPlaceholder />)

    expect(screen.queryByText('Applied in-app memory context')).not.toBeInTheDocument()
    expect(screen.queryByText(/Recent Context:/)).not.toBeInTheDocument()
  })
