import { render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { MessageFeed } from './MessageFeed'
import type { SessionMessageBundle } from '@shared/ipc'

  it('hides assistant ORXA memory lines from chat', () => {
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-orxa-memory',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: Date.now(), updated: Date.now() },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'part-assistant-orxa-memory',
            type: 'text',
            sessionID: 'session-1',
            messageID: 'msg-assistant-orxa-memory',
            text:
              '[ORXA_MEMORY] workspace="/repo-a" type="decision" tags="memory" content="Keep local memory only."\n' +
              '[ORXA_MEMORY] workspace="/repo-a" type="fact" tags="guardrail" content="External memory tools disabled."',
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} showAssistantPlaceholder />)

    expect(screen.queryByText(/\[ORXA_MEMORY\]/)).not.toBeInTheDocument()
  })

  it('shows thinking shimmer when busy with no visible parts', () => {
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-2',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: Date.now(), updated: Date.now() },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'part-step-2',
            type: 'step-finish',
            sessionID: 'session-1',
            messageID: 'msg-assistant-2',
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

    expect(document.querySelector('.message-thinking')).toBeInTheDocument()
  })

  it('cleans up thinking timer when placeholder is turned off', () => {
    vi.useFakeTimers()
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-thinking-cleanup',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'part-text-thinking-cleanup',
            type: 'text',
            sessionID: 'session-1',
            messageID: 'msg-assistant-thinking-cleanup',
            text: 'Working...',
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    try {
      const view = render(<MessageFeed messages={messages} showAssistantPlaceholder />)
      expect(view.container.querySelector('.message-thinking')).not.toBeNull()
      vi.advanceTimersByTime(500)
      view.rerender(<MessageFeed messages={messages} showAssistantPlaceholder={false} />)
      expect(view.container.querySelector('.message-thinking')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  // Live events display removed — internal events are now represented by tool cards and shimmer

  it('keeps live task delegation out of the transcript surface', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-task-running',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-task-running',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-task-running',
            callID: 'call-task-running',
            tool: 'task',
            state: {
              status: 'running',
              input: {
                prompt: 'Build the full Spencer Solutions website.',
                description: 'Build Spencer Solutions site',
                subagent_type: 'build',
                command: '/spencer',
              },
              title: 'Build Spencer Solutions site',
              metadata: {
                model: {
                  providerID: 'openai',
                  modelID: 'gpt-5-codex',
                },
              },
              time: { start: now },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} showAssistantPlaceholder />)

    expect(screen.getByText('Thinking...')).toBeInTheDocument()
    expect(screen.queryByText(/Delegating .* to @build/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /build/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /delegation:/i })).not.toBeInTheDocument()
  })

  it('keeps completed task delegation summaries out of the transcript', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-task-complete',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-task-complete',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-task-complete',
            callID: 'call-task-complete',
            tool: 'task',
            state: {
              status: 'completed',
              input: {
                prompt: 'Build the full Spencer Solutions website.',
                description: 'Build Spencer Solutions site',
                subagent_type: 'build',
              },
              output: 'done',
              title: 'Build Spencer Solutions site',
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} />)

    expect(
      screen.queryByText(/Delegated Build Spencer Solutions site to @build/i)
    ).not.toBeInTheDocument()
    expect(screen.getByText(/No messages yet/i)).toBeInTheDocument()
  })

  it('keeps delegated task result output out of the transcript', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-task-result',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-task-result',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-task-result',
            callID: 'call-task-result',
            tool: 'task',
            state: {
              status: 'completed',
              input: {
                prompt: 'Build the full Spencer Solutions website.',
                description: 'Build Spencer Solutions site',
                subagent_type: 'build',
              },
              output:
                'task_id: abc123\n\n<task_result>\nImplemented homepage and contact page.\n</task_result>',
              title: 'Build Spencer Solutions site',
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} showAssistantPlaceholder />)
    expect(
      screen.queryByText(/Delegated Build Spencer Solutions site to @build/i)
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/Implemented homepage and contact page\./i)).not.toBeInTheDocument()
  })

  it('does not load delegated session output inside the transcript surface', async () => {
    const now = Date.now()
    const loadMessages = vi.fn(async () => [])
    const currentOrxa = (window as { orxa?: unknown }).orxa as
      | { opencode?: Record<string, unknown> }
      | undefined
    const nextOpencode = { ...(currentOrxa?.opencode ?? {}), loadMessages }
    Object.defineProperty(window, 'orxa', {
      value: { ...(currentOrxa ?? {}), opencode: nextOpencode },
      configurable: true,
    })

    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-task-session-fallback',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-task-session-fallback',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-task-session-fallback',
            callID: 'call-task-session-fallback',
            tool: 'task',
            state: {
              status: 'completed',
              input: {
                prompt: 'Build the full Spencer Solutions website.',
                description: 'Build Spencer Solutions site',
                subagent_type: 'build',
              },
              output: 'task_id: abc123\n\n<task_result>\nDone.\n</task_result>',
              title: 'Build Spencer Solutions site',
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
  })

  it('keeps delegated patch transcript loading out of MessageFeed', async () => {
    const now = Date.now()
    const loadMessages = vi.fn(async () => [
      {
        info: {
          id: 'child-msg-1',
          role: 'assistant',
          sessionID: 'child-1',
          time: { created: now + 10, updated: now + 10 },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'child-tool-patch-1',
            type: 'tool',
            sessionID: 'child-1',
            messageID: 'child-msg-1',
            callID: 'child-call-patch-1',
            tool: 'apply_patch',
            state: {
              status: 'completed',
              input: {
                patch:
                  '*** Begin Patch\n*** Update File: /repo/package.json\n@@\n-  "name": "old"\n+  "name": "new"\n+  "version": "1.2.3"\n*** End Patch',
              },
              output: '',
              title: 'apply_patch',
              metadata: {},
              time: { start: now + 10, end: now + 11 },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ])
    const currentOrxa = (window as { orxa?: unknown }).orxa as
      | { opencode?: Record<string, unknown> }
      | undefined
    const nextOpencode = { ...(currentOrxa?.opencode ?? {}), loadMessages }
    Object.defineProperty(window, 'orxa', {
      value: { ...(currentOrxa ?? {}), opencode: nextOpencode },
      configurable: true,
    })

    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-task-patch-summary',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'tool-task-patch-summary',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-task-patch-summary',
            callID: 'call-task-patch-summary',
            tool: 'task',
            state: {
              status: 'completed',
              input: {
                prompt: 'Build the full Spencer Solutions website.',
                description: 'Build Spencer Solutions site',
                subagent_type: 'build',
              },
              output: 'task_id: child-1',
              title: 'Build Spencer Solutions site',
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
  })

  it('keeps sub-agent delegation out of the transcript surface', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-delegation',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'subtask-1',
            type: 'subtask',
            sessionID: 'session-1',
            messageID: 'msg-assistant-delegation',
            prompt: 'Inspect files and implement a fix.',
            description: 'Fix the bug in renderer state handling',
            agent: 'reviewer',
            model: { providerID: 'openai', modelID: 'gpt-5-codex' },
          },
          {
            id: 'tool-subtask-1',
            type: 'tool',
            sessionID: 'session-1',
            messageID: 'msg-assistant-delegation',
            callID: 'call-subtask-1',
            tool: 'apply_patch',
            state: {
              status: 'completed',
              input: {},
              output: '{}',
              title: 'apply_patch',
              metadata: {},
              time: { start: now, end: now },
            },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} showAssistantPlaceholder />)

    expect(
      screen.queryByText(/Delegated to reviewer: Fix the bug in renderer state handling/i)
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reviewer/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /delegation:/i })).not.toBeInTheDocument()
  })

  it('does not mirror live delegation status into the transcript footer', () => {
    const now = Date.now()
    const messages: SessionMessageBundle[] = [
      {
        info: {
          id: 'msg-assistant-live-delegation',
          role: 'assistant',
          sessionID: 'session-1',
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle['info'],
        parts: [
          {
            id: 'subtask-live-1',
            type: 'subtask',
            sessionID: 'child-1',
            messageID: 'msg-assistant-live-delegation',
            prompt: 'Inspect the stack.',
            description: 'Inspect the stack',
            agent: 'explorer',
            model: { providerID: 'openai', modelID: 'gpt-5.4' },
          },
        ] as SessionMessageBundle['parts'],
      },
    ]

    render(<MessageFeed messages={messages} showAssistantPlaceholder />)

    expect(screen.getByText('Thinking...')).toBeInTheDocument()
    expect(screen.queryByText(/Delegating/i)).not.toBeInTheDocument()
  })
