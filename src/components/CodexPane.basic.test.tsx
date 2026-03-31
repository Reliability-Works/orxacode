import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderCodexPane, buildOrxaCodex, buildOrxaEvents, resetCodexPaneTestState } from './CodexPane.test-helpers'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { CodexPane } from './CodexPane'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'

beforeEach(() => {
  resetCodexPaneTestState()
})

afterEach(() => {
  vi.useRealTimers()
  // @ts-expect-error test teardown
  delete window.orxa
})

it('shows unavailable message when codex bridge is not available', () => {
  window.orxa = {
    events: buildOrxaEvents(),
  } as unknown as typeof window.orxa

  renderCodexPane()

  expect(screen.getByText(/codex is not available/i)).toBeInTheDocument()
})

it('renders the composer input', () => {
  window.orxa = {
    codex: buildOrxaCodex(),
    events: buildOrxaEvents(),
  } as unknown as typeof window.orxa

  const { container } = renderCodexPane()

  expect(screen.getByPlaceholderText(/connecting to codex/i)).toBeInTheDocument()
  expect(
    container.querySelector('.codex-composer-area .center-pane-rail .composer-zone')
  ).toBeInTheDocument()
})

it('keeps draft codex sessions idle until the first message is sent', async () => {
  vi.useFakeTimers()
  const codex = buildOrxaCodex()
  window.orxa = {
    codex,
    events: buildOrxaEvents(),
  } as unknown as typeof window.orxa

  renderCodexPane({}, { isDraft: true })

  expect(screen.getByPlaceholderText(/send codex a message/i)).toBeInTheDocument()

  await vi.advanceTimersByTimeAsync(100)

  expect(codex.start).not.toHaveBeenCalled()
  expect(codex.startThread).not.toHaveBeenCalled()
})

it('connects and starts a thread on first send for draft codex sessions', async () => {
  const codex = buildOrxaCodex()
  window.orxa = {
    codex,
    events: buildOrxaEvents(),
  } as unknown as typeof window.orxa

  renderCodexPane({}, { isDraft: true })

  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ship it' } })
  fireEvent.click(screen.getByRole('button', { name: /send/i }))

  await waitFor(() => {
    expect(codex.start).toHaveBeenCalled()
    expect(codex.startThread).toHaveBeenCalled()
    expect(codex.startTurn).toHaveBeenCalledWith(
      'thr-1',
      'Ship it',
      '/workspace/project',
      undefined,
      undefined,
      undefined,
      undefined
    )
  })
})

it('shows cached Codex models before the live model fetch completes', async () => {
  window.orxa = {
    codex: buildOrxaCodex(),
    events: buildOrxaEvents(),
  } as unknown as typeof window.orxa

  renderCodexPane({
    cachedModels: [
      {
        id: 'gpt-5.4',
        model: 'gpt-5.4',
        name: 'GPT-5.4',
        isDefault: true,
        supportedReasoningEfforts: ['medium'],
        defaultReasoningEffort: 'medium',
      },
    ],
  })

  await waitFor(() => {
    expect(screen.getByTitle('Codex/GPT-5.4')).toBeInTheDocument()
  })
})

it('does not loop when a thread name syncs back into parent title state', async () => {
  const codex = buildOrxaCodex()
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  window.orxa = {
    codex,
    events: buildOrxaEvents(),
  } as unknown as typeof window.orxa

  function Harness() {
    const [title, setTitle] = useState('Codex Session')

    return (
      <>
        <div data-testid="session-title">{title}</div>
        <CodexPane
          directory="/workspace/project"
          sessionStorageKey="/workspace/project::session-1"
          onExit={vi.fn()}
          onTitleChange={setTitle}
          {...{
            branchMenuOpen: false,
            setBranchMenuOpen: vi.fn(),
            branchControlWidthCh: 20,
            branchLoading: false,
            branchSwitching: false,
            hasActiveProject: false,
            branchCurrent: undefined,
            branchDisplayValue: '',
            branchSearchInputRef: { current: null },
            branchQuery: '',
            setBranchQuery: vi.fn(),
            branchActionError: null,
            clearBranchActionError: vi.fn(),
            checkoutBranch: vi.fn(),
            filteredBranches: [],
            openBranchCreateModal: vi.fn(),
            permissionMode: 'ask-write' as const,
            onPermissionModeChange: vi.fn(),
          }}
        />
      </>
    )
  }

  render(<Harness />)

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
  store.setCodexThreadName('/workspace/project::session-1', 'Feature Kickoff')

  await waitFor(() => {
    expect(screen.getByTestId('session-title')).toHaveTextContent('Feature Kickoff')
  })

  expect(
    consoleError.mock.calls.some(call =>
      call.some(argument =>
        typeof argument === 'string' && argument.includes('Maximum update depth exceeded')
      )
    )
  ).toBe(false)
  consoleError.mockRestore()
})

it('shows a dedicated usage alert when Codex reports exhausted quota', async () => {
  window.orxa = {
    codex: buildOrxaCodex(),
    events: buildOrxaEvents(),
  } as unknown as typeof window.orxa

  const store = useUnifiedRuntimeStore.getState()
  store.initCodexSession('/workspace/project::session-1', '/workspace/project')
  store.setCodexConnectionState(
    '/workspace/project::session-1',
    'connected',
    { name: 'codex', version: '1.0.0' },
    'insufficient quota: account is out of credits'
  )
  store.setCodexThread('/workspace/project::session-1', {
    id: 'thr-1',
    preview: '',
    modelProvider: 'openai',
    createdAt: Date.now(),
  })

  const { container } = renderCodexPane()

  await waitFor(() => {
    expect(screen.getByRole('alert')).toHaveTextContent(/codex usage unavailable/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/no remaining codex credits or usage/i)
  })
  expect(
    container.querySelector('.codex-composer-area .center-pane-rail .codex-session-alert')
  ).toBeInTheDocument()
})

it('renders the send button', () => {
  window.orxa = {
    codex: buildOrxaCodex(),
    events: buildOrxaEvents(),
  } as unknown as typeof window.orxa

  renderCodexPane()

  expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument()
})

it('renders the conversation log area', () => {
  window.orxa = {
    codex: buildOrxaCodex(),
    events: buildOrxaEvents(),
  } as unknown as typeof window.orxa

  renderCodexPane()

  expect(screen.getByRole('log', { name: /codex conversation/i })).toBeInTheDocument()
})
