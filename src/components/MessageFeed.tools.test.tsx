import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { MessageFeed } from './MessageFeed'
import type { SessionMessageBundle } from '@shared/ipc'
import { buildDelegatedGroupedOutputMessages, setOpencodeLoadMessagesMock } from './MessageFeed.test-helpers'

  it('does not mirror live search activity into the transcript footer', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-live-search',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-search-live',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-live-search',
            callID: 'call-search-live',
            tool: 'grep_search',
            state: {
              status: 'running',
              input: { query: 'booking', path: '/repo/src' },
              metadata: {},
              time: { start: now },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} showAssistantPlaceholder workspaceDirectory="/repo" />)

    expect(screen.getByText('Thinking...')).toBeInTheDocument()
    expect(screen.queryByText(/Searching/i)).not.toBeInTheDocument()
  })

  it('leaves delegated subagent transcript loading to the shared background-agent surface', async () => {
    const now = Date.now()
    const loadMessages = vi.fn(async () => buildDelegatedGroupedOutputMessages(now))
    setOpencodeLoadMessagesMock(loadMessages)

    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-grouped-output',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-task-grouped-output',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-grouped-output',
            callID: 'call-task-grouped-output',
            tool: 'task',
            state: {
              status: 'completed',
              input: {
                prompt: 'Inspect the project structure.',
                description: 'Inspect project structure',
                subagent_type: 'build',
              },
              output: 'task_id: child-grouped-output',
              title: 'Inspect project structure',
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} showAssistantPlaceholder workspaceDirectory="/repo" />)
    await waitFor(() => {
      expect(loadMessages).not.toHaveBeenCalled()
    })
    expect(
      screen.queryByText(/Delegated Inspect project structure to @build/i)
    ).not.toBeInTheDocument()
  })

  it('keeps delegation details out of the transcript placeholder', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-delegation-close-behavior',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'subtask-close-behavior',
            type: 'subtask',
            sessionID: 'session-1',
            messageID: 'msg-assistant-delegation-close-behavior',
            prompt: 'Do work.',
            description: 'Close behavior test',
            agent: 'build',
            model: { providerID: 'openai', modelID: 'gpt-5-codex' },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} showAssistantPlaceholder />)

    expect(screen.getByText(/thinking/i)).toBeInTheDocument()
    expect(screen.queryByText('Close behavior test')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /delegation:/i })).not.toBeInTheDocument()
  })

  it('shows in-place activity with current file target from tool calls', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-activity',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-read-1',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-activity',
            callID: 'call-read-1',
            tool: 'read_file',
            state: {
              status: 'completed',
              input: { path: '/Volumes/ExtSSD/Repos/macapp/OpencodeOrxa/src/App.tsx' },
              output: '',
              title: 'read',
              metadata: {},
              time: { start: now, end: now },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(
      <MessageFeed
        messages={messages}
        showAssistantPlaceholder
        workspaceDirectory="/Volumes/ExtSSD/Repos/macapp/OpencodeOrxa"
      />
    )

    expect(screen.getAllByText('Read').length).toBeGreaterThan(0)
    expect(screen.getByText('src/App.tsx')).toBeInTheDocument()
  })

  it('does not leak todo content as tool activity target', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-todo-activity',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-todo-1',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-todo-activity',
            callID: 'call-todo-1',
            tool: 'todowrite',
            state: {
              status: 'completed',
              input: { todos: [{ content: 'Add performance optimizations', status: 'pending' }] },
              output: '[]',
              title: 'todo',
              metadata: {},
              time: { start: now, end: now },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} showAssistantPlaceholder />)

    expect(screen.getAllByText(/Updated todo list/i).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Used tools Add performance/i)).not.toBeInTheDocument()
  })

  it('shows concrete file action for apply_patch run via exec command', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-patch-activity',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-exec-1',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-patch-activity',
            callID: 'call-exec-1',
            tool: 'exec_command',
            state: {
              status: 'completed',
              input: {
                cmd: "apply_patch <<'PATCH'\n*** Begin Patch\n*** Update File: src/App.tsx\n@@\n-foo\n+bar\n*** End Patch\nPATCH",
              },
              output: '',
              title: 'exec',
              metadata: {},
              time: { start: now, end: now },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(
      <MessageFeed
        messages={messages}
        showAssistantPlaceholder
        workspaceDirectory="/Volumes/ExtSSD/Repos/macapp/OpencodeOrxa"
      />
    )

    expect(screen.getByText(/apply_patch <<'PATCH'/i)).toBeInTheDocument()
    expect(screen.getByText('Changed files')).toBeInTheDocument()
    expect(screen.getByText('src/App.tsx')).toBeInTheDocument()
    expect(screen.queryByText(/Command: apply_patch <<'PATCH'/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Updated$/i)).not.toBeInTheDocument()
  })

  it('shows command text for generic run rows when tool title is present', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-run-title',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-run-title',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-run-title',
            callID: 'call-run-title',
            tool: 'bash',
            state: {
              status: 'completed',
              input: {},
              output: '',
              title: 'npm run typecheck',
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} />)

    expect(screen.getByText(/^Ran npm run typecheck$/i)).toBeInTheDocument()
    expect(screen.queryByText(/Command: npm run typecheck/i)).not.toBeInTheDocument()
  })

  it('does not render synthetic writing rows for active opencode file edits', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-write-active',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-write-active',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-write-active',
            callID: 'call-write-active',
            tool: 'write',
            state: {
              status: 'running',
              input: {
                filePath: '/repo/barbershop/package.json',
                content: '{}',
              },
              title: 'write',
              metadata: {
                filepath: '/repo/barbershop/package.json',
              },
              time: { start: now },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} workspaceDirectory="/repo" showAssistantPlaceholder />)

    expect(screen.queryByText(/Writing barbershop\/package\.json/i)).not.toBeInTheDocument()
    expect(screen.getByText('Thinking...')).toBeInTheDocument()
  })

  it('shows created file summary for write tool without fake command rows', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-write-created',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-write-created',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-write-created',
            callID: 'call-write-created',
            tool: 'write',
            state: {
              status: 'completed',
              input: {
                filePath: '/repo/src/components/ui/sheet.tsx',
                content: 'line one\nline two',
              },
              output: 'Wrote file successfully.',
              title: 'src/components/ui/sheet.tsx',
              metadata: {
                filepath: '/repo/src/components/ui/sheet.tsx',
                exists: false,
              },
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} workspaceDirectory="/repo" />)
    expect(screen.getByText('Changed files')).toBeInTheDocument()
    expect(screen.getByText('src/components/ui/sheet.tsx')).toBeInTheDocument()
    expect(screen.getByText('+2')).toHaveClass('diff-block-stat--add')
    expect(screen.getByText('-0')).toHaveClass('diff-block-stat--del')
    expect(screen.queryByText(/Command: src\/components\/ui\/sheet\.tsx/i)).not.toBeInTheDocument()
  })

  it('shows useful error details for failed tool entries', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-write-failed',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-write-failed',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-write-failed',
            callID: 'call-write-failed',
            tool: 'write',
            state: {
              status: 'error',
              input: {
                filePath: '/repo/package.json',
                content: '{}',
              },
              error: 'File not found: /repo/package.json',
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} workspaceDirectory="/repo" />)
    expect(screen.getAllByText(/^Write failed package\.json$/i).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /write failed package\.json/i }))
    expect(screen.getByText(/File not found: \/repo\/package\.json/i)).toBeInTheDocument()
  })

  it('does not render a generic ran-command row for non-command read-like titles', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-no-generic-run',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-read-title',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-no-generic-run',
            callID: 'call-read-title',
            tool: 'run',
            state: {
              status: 'completed',
              input: {},
              output: '',
              title: 'Read .',
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} />)
    expect(screen.getByText('Read .')).toBeInTheDocument()
    expect(screen.queryByText(/^Ran command$/i)).not.toBeInTheDocument()
  })

  it('renders timeline file labels with the relative path instead of basename-only pills', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-created-path',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-run-created-path',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-created-path',
            callID: 'call-run-created-path',
            tool: 'run',
            state: {
              status: 'completed',
              input: {
                command: 'touch /repo/website/app/private-ai-agents.tsx',
              },
              output: '',
              title: 'touch /repo/website/app/private-ai-agents.tsx',
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} workspaceDirectory="/repo" />)
    expect(
      screen.getByText(/^Ran touch \/repo\/website\/app\/private-ai-agents\.tsx$/i)
    ).toBeInTheDocument()
  })
