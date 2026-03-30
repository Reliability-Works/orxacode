import { beforeEach, afterEach, expect, it } from 'vitest'
import { renderCodexPane, buildOrxaCodex, buildOrxaEvents, resetCodexPaneTestState } from './CodexPane.test-helpers'
import { screen, waitFor } from '@testing-library/react'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'

beforeEach(() => {
  resetCodexPaneTestState()
})

afterEach(() => {
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
