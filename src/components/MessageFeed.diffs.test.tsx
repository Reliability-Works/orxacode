import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { MessageFeed } from './MessageFeed'
import type { SessionMessageBundle } from '@shared/ipc'

  it('does not render low-signal completed action rows without command context', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-no-completed-action-noise',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-run-generic',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-no-completed-action-noise',
            callID: 'call-run-generic',
            tool: 'run',
            state: {
              status: 'completed',
              input: {},
              output: '',
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]
    const view = render(<MessageFeed messages={messages} />)
    expect(within(view.container).queryByText(/^Completed action$/i)).not.toBeInTheDocument()
  })

  it('does not render low-signal working rows without command context', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-no-working-noise',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-run-generic-active',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-no-working-noise',
            callID: 'call-run-generic-active',
            tool: 'run',
            state: {
              status: 'running',
              input: {},
              metadata: {},
              time: { start: now },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]
    const view = render(<MessageFeed messages={messages} showAssistantPlaceholder />)
    expect(within(view.container).queryByText(/^Working\.\.\.$/i)).not.toBeInTheDocument()
  })

  it('does not echo active opencode file actions inside the thinking footer', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-active-write-footer',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-write-active-footer',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-active-write-footer',
            callID: 'call-write-active-footer',
            tool: 'write',
            state: {
              status: 'running',
              input: {
                filePath: '/repo/barbershop/package.json',
                content: '{\n  "name": "barbershop"\n}\n',
              },
              output: '',
              title: 'barbershop/package.json',
              metadata: {
                filepath: '/repo/barbershop/package.json',
                exists: false,
              },
              time: { start: now },
            },
          },
        ] as unknown as SessionMessageBundle['parts'],
      },
    ]

    const view = render(
      <MessageFeed messages={messages} workspaceDirectory="/repo" showAssistantPlaceholder />
    )

    expect(screen.queryByText('barbershop/package.json')).not.toBeInTheDocument()
    expect(view.container.querySelector('.thinking-summary')?.textContent ?? '').not.toMatch(
      /Writing/i
    )
  })

  it('renders loaded skill label without synthetic command line', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-loaded-skill',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-loaded-skill',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-loaded-skill',
            callID: 'call-loaded-skill',
            tool: 'run',
            state: {
              status: 'completed',
              input: {},
              output: '',
              title: 'Loaded skill: frontend-design',
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} />)
    expect(screen.getAllByText('Loaded skill: frontend-design').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Command: Loaded skill: frontend-design/i)).not.toBeInTheDocument()
  })

  it('treats non-shell command titles as narrative labels', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-loaded-skill-command',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-loaded-skill-command',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-loaded-skill-command',
            callID: 'call-loaded-skill-command',
            tool: 'run',
            state: {
              status: 'completed',
              input: { command: 'Loaded skill: frontend-design' },
              output: '',
              title: 'Loaded skill: frontend-design',
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} />)
    expect(screen.getAllByText('Loaded skill: frontend-design').length).toBeGreaterThan(0)
    expect(screen.queryByText(/^Ran Loaded skill:/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Command: Loaded skill: frontend-design/i)).not.toBeInTheDocument()
  })

  it('renders additions/deletions with diff color classes in timeline labels', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-diff-color',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-write-diff-color',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-diff-color',
            callID: 'call-write-diff-color',
            tool: 'write',
            state: {
              status: 'completed',
              input: {
                filePath: '/repo/src/app.tsx',
                content: 'line 1\nline 2',
              },
              output: '',
              title: 'write',
              metadata: {
                filepath: '/repo/src/app.tsx',
                exists: false,
              },
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} workspaceDirectory="/repo" />)
    expect(screen.getByText('+2')).toHaveClass('diff-block-stat--add')
    expect(screen.getByText('-0')).toHaveClass('diff-block-stat--del')
  })

  it('renders opencode edit tools inside the shared changed files cluster', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-changed-files',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-apply-patch-1',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-changed-files',
            callID: 'call-apply-patch-1',
            tool: 'apply_patch',
            state: {
              status: 'completed',
              input: {
                patch: [
                  '*** Begin Patch',
                  '*** Update File: /repo/src/app.tsx',
                  '@@',
                  '-old',
                  '+new',
                  '*** Add File: /repo/src/new.ts',
                  '+export const created = true;',
                  '*** End Patch',
                ].join('\n'),
              },
              output: '',
              title: 'apply_patch',
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} workspaceDirectory="/repo" />)

    expect(screen.getByText('Changed files')).toBeInTheDocument()
    expect(screen.getByText('src/app.tsx')).toBeInTheDocument()
    expect(screen.getByText('src/new.ts')).toBeInTheDocument()
  })

  it('hydrates expandable opencode changed-file diffs from metadata patch payloads', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-metadata-patch',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-edit-metadata-patch',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-metadata-patch',
            callID: 'call-edit-metadata-patch',
            tool: 'edit_file',
            state: {
              status: 'completed',
              input: {},
              output: '',
              title: 'edit_file',
              metadata: {
                diff: [
                  '*** Begin Patch',
                  '*** Update File: /repo/website/components/SiteNav.tsx',
                  '@@',
                  '-old value',
                  '+new value',
                  '*** End Patch',
                ].join('\n'),
              },
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} workspaceDirectory="/repo" />)

    fireEvent.click(
      screen.getByRole('button', { name: /Editedwebsite\/components\/SiteNav\.tsx\+1-1/i })
    )
    expect(screen.getByText('+new value')).toBeInTheDocument()
  })

  it('renders session stop notices with reason text', () => {
    const now = Date.now()
    render(
      <MessageFeed
        messages={[]}
        sessionNotices={[
          {
            id: 'notice-1',
            time: now,
            label: 'Session stopped due to an error',
            detail: 'Permission request rejected by user',
            tone: 'error',
          },
        ]}
      />
    )

    expect(screen.getByText('Session stopped due to an error')).toBeInTheDocument()
    expect(screen.getByText(/Reason: Permission request rejected by user/i)).toBeInTheDocument()
  })

  it('shows copy button on user messages and copies visible text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-user-copy',
          role: 'user',
          sessionID: 'session-1',
          time: { created: Date.now(), updated: Date.now() },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'part-text-copy-1',
            type: 'text',
            sessionID: 'session-1',
            messageID: 'msg-user-copy',
            text: 'Here is the answer.',
          },
          {
            id: 'part-text-copy-2',
            type: 'text',
            sessionID: 'session-1',
            messageID: 'msg-user-copy',
            text: 'And a follow-up.',
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} />)

    const copyBtn = screen.getByRole('button', { name: /copy message/i })
    expect(copyBtn).toBeInTheDocument()
    expect(copyBtn).toHaveClass('message-copy-btn')

    fireEvent.click(copyBtn)

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('Here is the answer.\n\nAnd a follow-up.')
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument()
    })
  })
