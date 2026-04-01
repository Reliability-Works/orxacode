import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderCodexPane, buildOrxaCodex, buildOrxaEvents, resetCodexPaneTestState } from './CodexPane.test-helpers'
import { setPersistedCodexState } from '../hooks/codex-session-storage'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'

beforeEach(() => {
  resetCodexPaneTestState()
})

afterEach(() => {
  // @ts-expect-error test teardown
  delete window.orxa
})

it('shows Codex reasoning effort beside the model selector and sends it with the turn', async () => {
  const codex = buildOrxaCodex()
  codex.listModels = vi.fn(async () => [
    {
      id: 'gpt-5.4',
      model: 'gpt-5.4',
      name: 'GPT-5.4',
      isDefault: true,
      supportedReasoningEfforts: ['low', 'medium', 'high'],
      defaultReasoningEffort: 'high',
    },
  ])
  window.orxa = {
    codex,
    events: buildOrxaEvents(),
  } as unknown as typeof window.orxa

  renderCodexPane({}, { defaultReasoningEffort: 'medium' })

  await waitFor(() => {
    expect(codex.startThread).toHaveBeenCalled()
  })
  const effortSelect = await screen.findByLabelText('Reasoning effort')
  expect((effortSelect as HTMLSelectElement).value).toBe('medium')

  const composer = screen.getByRole('textbox')
  fireEvent.change(effortSelect, { target: { value: 'low' } })
  await act(async () => {
    fireEvent.change(composer, { target: { value: 'Ship the implementation.' } })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
  })

  await waitFor(() => {
    expect(codex.startTurn).toHaveBeenCalledWith(
      'thr-1',
      'Ship the implementation.',
      '/workspace/project',
      'gpt-5.4',
      'low',
      undefined,
      undefined
    )
  })
})

it('passes attached images through to Codex turns', async () => {
  const codex = buildOrxaCodex()
  const pickImage = vi.fn(async () => ({
    path: '/tmp/codex.png',
    url: 'data:image/png;base64,AAAA',
    filename: 'codex.png',
    mime: 'image/png',
  }))
  window.orxa = {
    codex,
    opencode: {
      pickImage,
    },
    events: buildOrxaEvents(),
  } as unknown as typeof window.orxa

  const store = useUnifiedRuntimeStore.getState()
  store.initCodexSession('/workspace/project::session-1', '/workspace/project')
  store.setCodexConnectionState('/workspace/project::session-1', 'connected', {
    name: 'codex',
    version: '1.0.0',
  })
  store.setCodexThread('/workspace/project::session-1', {
    id: 'thr-1',
    preview: '',
    modelProvider: 'openai',
    createdAt: Date.now(),
  })

  renderCodexPane()

  fireEvent.click(screen.getByRole('button', { name: 'Add attachment' }))
  await waitFor(() => expect(screen.getByText('codex.png')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: /send prompt/i }))

  await waitFor(() => {
    expect(codex.startTurn).toHaveBeenCalledWith(
      'thr-1',
      '',
      '/workspace/project',
      undefined,
      undefined,
      undefined,
      [{ type: 'image', url: 'data:image/png;base64,AAAA' }]
    )
  })
})

it('renders the Codex transcript without virtualization', async () => {
  window.orxa = {
    codex: buildOrxaCodex(),
    events: buildOrxaEvents(),
  } as unknown as typeof window.orxa

  setPersistedCodexState('/workspace/project::session-1', {
    messages: [
      {
        id: 'msg-assistant-1',
        kind: 'message',
        role: 'assistant',
        content: 'Transcript rows stay in normal flow.',
        timestamp: Date.now(),
      },
    ],
    thread: { id: 'thr-1', preview: '', modelProvider: 'openai', createdAt: Date.now() },
    isStreaming: false,
    messageIdCounter: 1,
  })

  const { container } = renderCodexPane()

  await waitFor(() => {
    expect(screen.getByText('Transcript rows stay in normal flow.')).toBeInTheDocument()
  })
  expect(
    container.querySelector('.codex-messages .center-pane-rail .message-card.message-assistant')
  ).toBeInTheDocument()
  expect(container.querySelector('.messages-virtual-row')).toBeNull()
  expect(container.querySelector('.messages-virtual-spacer')).toBeNull()
})

it('shows the bottom copy action for persisted user messages', async () => {
  window.orxa = {
    codex: buildOrxaCodex(),
    events: buildOrxaEvents(),
  } as unknown as typeof window.orxa

  setPersistedCodexState('/workspace/project::session-1', {
    messages: [
      {
        id: 'msg-user-1',
        kind: 'message',
        role: 'user',
        content: 'hello from user',
        timestamp: Date.now(),
      },
    ],
    thread: { id: 'thr-1', preview: '', modelProvider: 'openai', createdAt: Date.now() },
    isStreaming: false,
    messageIdCounter: 1,
  })

  renderCodexPane()

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })
})

it('renders completed file changes even when Codex does not provide diff hunks or line counts', async () => {
  window.orxa = {
    codex: buildOrxaCodex(),
    events: buildOrxaEvents(),
  } as unknown as typeof window.orxa

  setPersistedCodexState('/workspace/project::session-1', {
    messages: [
      {
        id: 'msg-diff-1',
        kind: 'diff',
        path: '/workspace/project/src/app/page.tsx',
        type: 'modified',
        status: 'completed',
        timestamp: Date.now(),
      },
    ],
    thread: { id: 'thr-1', preview: '', modelProvider: 'openai', createdAt: Date.now() },
    isStreaming: false,
    messageIdCounter: 1,
  })

  renderCodexPane()

  await waitFor(() => {
    expect(screen.getByText(/page\.tsx$/)).toBeInTheDocument()
    expect(screen.getByText('Edited')).toBeInTheDocument()
  })
})

it('accepting a plan switches the next Codex turn to explicit default mode', async () => {
  const codex = buildOrxaCodex()
  codex.listModels = vi.fn(async () => [
    {
      id: 'gpt-5.4',
      model: 'gpt-5.4',
      name: 'GPT-5.4',
      isDefault: true,
      supportedReasoningEfforts: ['low', 'medium', 'high'],
      defaultReasoningEffort: 'high',
    },
  ])
  codex.listCollaborationModes = vi.fn(async () => [
    { id: 'default', label: 'Default', mode: 'default', model: '', reasoningEffort: '', developerInstructions: '' },
    { id: 'plan', label: 'Plan', mode: 'plan', model: '', reasoningEffort: '', developerInstructions: '' },
  ])

  window.orxa = {
    codex,
    events: buildOrxaEvents(),
  } as unknown as typeof window.orxa

  setPersistedCodexState('/workspace/project::session-1', {
    messages: [
      {
        id: 'plan-tool-1',
        kind: 'tool',
        toolType: 'plan',
        title: 'plan',
        status: 'completed',
        output: '## Plan\n\n- First step',
        timestamp: Date.now(),
      },
    ],
    thread: { id: 'thr-1', preview: '', modelProvider: 'openai', createdAt: Date.now() },
    isStreaming: false,
    messageIdCounter: 1,
  })

  renderCodexPane({}, { defaultReasoningEffort: 'medium' })

  await waitFor(() => {
    expect(screen.getByText('Implement this plan?')).toBeInTheDocument()
  })

  fireEvent.click(screen.getByRole('button', { name: /yes, implement this plan/i }))
  fireEvent.click(screen.getByRole('button', { name: /submit/i }))

  await waitFor(() => {
    expect(codex.startTurn).toHaveBeenCalledWith(
      'thr-1',
      'Implement the plan.',
      '/workspace/project',
      undefined,
      undefined,
      'default',
      undefined
    )
  })
})

it('clusters multiple edited files under a changed files section for the assistant turn', async () => {
  window.orxa = {
    codex: buildOrxaCodex(),
    events: buildOrxaEvents(),
  } as unknown as typeof window.orxa

  setPersistedCodexState('/workspace/project::session-1', {
    messages: [
      {
        id: 'assistant-1',
        kind: 'message',
        role: 'assistant',
        content: 'I have updated the scaffold.',
        timestamp: Date.now(),
      },
      {
        id: 'diff-1',
        kind: 'diff',
        path: '/workspace/project/northline-barber/.env.example',
        type: 'modified',
        status: 'completed',
        insertions: 20,
        deletions: 2,
        timestamp: Date.now(),
      },
      {
        id: 'diff-2',
        kind: 'diff',
        path: '/workspace/project/northline-barber/package.json',
        type: 'modified',
        status: 'completed',
        insertions: 10,
        deletions: 1,
        timestamp: Date.now(),
      },
    ],
    thread: { id: 'thr-1', preview: '', modelProvider: 'openai', createdAt: Date.now() },
    isStreaming: false,
    messageIdCounter: 3,
  })

  renderCodexPane()

  await waitFor(() => {
    expect(screen.getByText('Changed files')).toBeInTheDocument()
    expect(screen.getByText('.env.example')).toBeInTheDocument()
    expect(screen.getByText('package.json')).toBeInTheDocument()
  })
})

it('starts new threads with full access in yolo mode', async () => {
  const codex = buildOrxaCodex()
  window.orxa = {
    codex,
    events: buildOrxaEvents(),
  } as unknown as typeof window.orxa

  renderCodexPane({ permissionMode: 'yolo-write' as const })

  await waitFor(() => {
    expect(codex.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        sandbox: 'danger-full-access',
        approvalPolicy: 'never',
      })
    )
  })
})

it('auto-approves Codex approvals in yolo mode', async () => {
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

  renderCodexPane({ permissionMode: 'yolo-write' as const })

  await waitFor(() => {
    expect(codex.startThread).toHaveBeenCalled()
  })

  act(() => {
    notify?.({
      type: 'codex.approval',
      payload: {
        id: 42,
        method: 'item/fileChange/requestApproval',
        itemId: 'item-1',
        threadId: '',
        turnId: 'turn-1',
        reason: '',
        availableDecisions: ['accept', 'acceptForSession'],
        changes: [{ path: 'src/foo.ts', type: 'modify' }],
      },
    })
  })

  await waitFor(() => {
    expect(codex.approve).toHaveBeenCalledWith(42, 'acceptForSession')
  })
})

it('generates and persists a Codex title from the first user message', async () => {
  const codex = buildOrxaCodex()
  const onTitleChange = vi.fn()
  window.orxa = {
    codex,
    events: buildOrxaEvents(),
  } as unknown as typeof window.orxa

  renderCodexPane({}, { onTitleChange })

  await waitFor(() => {
    expect(codex.startThread).toHaveBeenCalled()
  })

  const composer = screen.getByRole('textbox')
  await act(async () => {
    fireEvent.change(composer, { target: { value: 'Fix the workspace session naming flow' } })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
  })

  await waitFor(() => {
    expect(codex.generateRunMetadata).toHaveBeenCalledWith(
      '/workspace/project',
      'Fix the workspace session naming flow'
    )
  })

  await waitFor(() => {
    expect(codex.setThreadName).toHaveBeenCalledWith('thr-1', 'Fix Workspace Session Naming')
    expect(onTitleChange).toHaveBeenCalledWith('Fix Workspace Session Naming')
  })
})

it('renders a newly sent message immediately in a fresh session while Codex starts work', async () => {
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

  renderCodexPane()

  await waitFor(() => {
    expect(notify).toBeTypeOf('function')
  })
  await waitFor(() => {
    expect(codex.startThread).toHaveBeenCalled()
  })

  const composer = screen.getByRole('textbox')
  await act(async () => {
    fireEvent.change(composer, { target: { value: 'Build the workspace session flow' } })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
  })

  act(() => {
    notify?.({
      type: 'codex.notification',
      payload: {
        method: 'turn/started',
        params: { threadId: 'thr-1', turn: { id: 'turn-1' } },
      },
    })
    notify?.({
      type: 'codex.notification',
      payload: {
        method: 'turn/plan/updated',
        params: {
          threadId: 'thr-1',
          plan: [{ step: 'Inspect repo', status: 'in_progress' }],
        },
      },
    })
  })

  expect(screen.getByText('Build the workspace session flow')).toBeInTheDocument()
  expect(screen.getByText(/updated task list/i)).toBeInTheDocument()
})
