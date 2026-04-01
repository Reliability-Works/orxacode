import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderCodexPane, buildOrxaCodex, buildOrxaEvents, resetCodexPaneTestState } from './CodexPane.test-helpers'
import { setPersistedCodexState } from '../hooks/codex-session-storage'

beforeEach(() => {
  resetCodexPaneTestState()
})

afterEach(() => {
  // @ts-expect-error test teardown
  delete window.orxa
})

it('steers queued messages into the active turn', async () => {
  let notify: ((event: unknown) => void) | undefined
  const codex = buildOrxaCodex()
  setPersistedCodexState('/workspace/project::session-1', {
    messages: [],
    thread: { id: 'thr-1', preview: '', modelProvider: 'openai', createdAt: Date.now() },
    isStreaming: true,
    messageIdCounter: 0,
  })
  window.orxa = {
    codex,
    events: {
      subscribe: vi.fn((handler: (event: unknown) => void) => {
        notify = handler
        return vi.fn()
      }),
    },
  } as unknown as typeof window.orxa

  renderCodexPane()

  const composer = screen.getByRole('textbox')

  await act(async () => {
    fireEvent.change(composer, { target: { value: 'queued follow up' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
  })

  expect(screen.getByText(/followup message queued/i)).toBeInTheDocument()
  act(() => {
    notify?.({
      type: 'codex.notification',
      payload: {
        method: 'turn/started',
        params: { threadId: 'thr-1', turn: { id: 'turn-queued' } },
      },
    })
  })

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /steer message/i }))
  })

  await waitFor(() => {
    expect(codex.steerTurn).toHaveBeenCalledWith('thr-1', 'turn-queued', 'queued follow up')
  })

  expect(screen.getAllByText('queued follow up').length).toBeGreaterThan(0)
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
  expect(screen.queryByText(/followup message queued/i)).not.toBeInTheDocument()
})

it('keeps queued messages queued when steer is unavailable', async () => {
  const codex = buildOrxaCodex()
  setPersistedCodexState('/workspace/project::session-1', {
    messages: [],
    thread: { id: 'thr-1', preview: '', modelProvider: 'openai', createdAt: Date.now() },
    isStreaming: true,
    messageIdCounter: 0,
  })
  window.orxa = {
    codex,
    events: buildOrxaEvents(),
  } as unknown as typeof window.orxa

  renderCodexPane()

  const composer = screen.getByRole('textbox')

  await act(async () => {
    fireEvent.change(composer, { target: { value: 'interrupt and send this' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
  })

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /steer message/i }))
  })

  expect(codex.steerTurn).not.toHaveBeenCalled()
  expect(screen.getByText(/followup message queued/i)).toBeInTheDocument()
})

it('falls back to transcript-derived task list and subagent drawers when runtime state is empty', async () => {
  window.orxa = {
    codex: buildOrxaCodex(),
    events: buildOrxaEvents(),
  } as unknown as typeof window.orxa

  setPersistedCodexState('/workspace/project::session-1', {
    thread: { id: 'thr-1', preview: '', modelProvider: 'openai', createdAt: Date.now() },
    isStreaming: false,
    messageIdCounter: 0,
    messages: [
      {
        id: 'assistant-plan',
        kind: 'message',
        role: 'assistant',
        timestamp: Date.now(),
        content: [
          'I created a task list and started maintaining it with these phases:',
          '1. Inspect repo and choose the new standalone site folder',
          '2. Scaffold the app and core dependencies',
          '3. Implement the booking product and UX',
        ].join('\n'),
      },
      {
        id: 'task-tool',
        kind: 'tool',
        toolType: 'task',
        title: 'Spawn worker',
        status: 'running',
        timestamp: Date.now(),
        collabReceivers: [{ threadId: 'child-1', nickname: 'Euclid', role: 'worker' }],
        collabStatuses: [{ threadId: 'child-1', nickname: 'Euclid', role: 'worker', status: 'done' }],
      },
    ],
  })

  renderCodexPane()

  expect(screen.getByText(/task list/i)).toBeInTheDocument()
  expect(screen.getAllByText(/1 background agent/i).length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: 'Expand background agents' }))
  expect(screen.getByText('Euclid')).toBeInTheDocument()
})

it('shows the background-agent drawer from runtime child threads when transcript metadata is absent', async () => {
  const codex = buildOrxaCodex()
  codex.getThreadRuntime.mockResolvedValue({
    thread: {
      id: 'thr-1',
      preview: 'Main thread',
      modelProvider: 'openai',
      createdAt: Date.now(),
    },
    childThreads: [
      {
        id: 'child-1',
        preview: 'Scout repo',
        modelProvider: 'openai',
        createdAt: Date.now(),
        status: { type: 'busy' },
      },
    ],
  } as never)
  window.orxa = {
    codex,
    events: buildOrxaEvents(),
  } as unknown as typeof window.orxa

  setPersistedCodexState('/workspace/project::session-1', {
    thread: { id: 'thr-1', preview: '', modelProvider: 'openai', createdAt: Date.now() },
    isStreaming: true,
    messageIdCounter: 0,
    messages: [],
  })
  renderCodexPane()

  await waitFor(() => {
    expect(screen.getAllByText(/1 background agent/i).length).toBeGreaterThan(0)
  })
  fireEvent.click(screen.getByRole('button', { name: 'Expand background agents' }))
  await waitFor(() => {
    expect(screen.getByText('Scout repo')).toBeInTheDocument()
  })
})

it('surfaces a provisional Codex background agent from thread-started metadata during an active turn', async () => {
  let notify: ((event: unknown) => void) | undefined
  const codex = buildOrxaCodex()
  window.orxa = {
    codex,
    events: {
      subscribe: vi.fn((handler: (event: unknown) => void) => {
        notify = handler
        return vi.fn()
      }),
    },
  } as unknown as typeof window.orxa

  setPersistedCodexState('/workspace/project::session-1', {
    thread: { id: 'thr-1', preview: '', modelProvider: 'openai', createdAt: Date.now() },
    isStreaming: false,
    messageIdCounter: 0,
    messages: [],
  })

  renderCodexPane()

  await waitFor(() => {
    expect(notify).toBeTypeOf('function')
  })

  act(() => {
    notify?.({
      type: 'codex.notification',
      payload: {
        method: 'turn/started',
        params: {
          turn: {
            id: 'turn-1',
            threadId: 'thr-1',
          },
        },
      },
    })
    notify?.({
      type: 'codex.notification',
      payload: {
        method: 'thread/started',
        params: {
          thread: {
            id: 'child-provisional-1',
            preview: 'Scout repo',
            source: {
              subAgent: {
                kind: 'explorer',
                nickname: 'Scout',
                role: 'explorer',
              },
            },
          },
        },
      },
    })
  })

  await waitFor(() => {
    expect(screen.getAllByText(/1 background agent/i).length).toBeGreaterThan(0)
  })
  fireEvent.click(screen.getByRole('button', { name: 'Expand background agents' }))
  await waitFor(() => {
    expect(screen.getByText('Scout')).toBeInTheDocument()
  })
})
