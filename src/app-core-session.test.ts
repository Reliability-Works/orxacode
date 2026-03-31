import { expect, it, vi } from 'vitest'
import type { SessionType } from '~/types/canvas'
import { createSessionAction, openBoundLocalProviderSessionAction } from './app-core-session'

it('creates Codex sessions as local drafts until the first prompt is sent', async () => {
  const setSessionTypes = vi.fn()
  const setSessionTitles = vi.fn()
  const setManualSessionTitles = vi.fn()
  const markSessionUsed = vi.fn()
  const registerLocalProviderSession = vi.fn(record => record)
  const setActiveSessionID = vi.fn()

  await createSessionAction(
    {
      activeProjectDir: '/repo/orxacode',
      appPermissionMode: 'ask-write',
      availableAgentNames: new Set<string>(),
      clearPendingSession: vi.fn(),
      createWorkspaceSession: vi.fn(),
      describeClaudeHealthFailure: vi.fn(),
      markSessionUsed,
      registerLocalProviderSession,
      selectProject: vi.fn(),
      selectedAgent: undefined,
      selectedModelPayload: undefined,
      selectedVariant: undefined,
      setActiveProjectDir: vi.fn(),
      setActiveSessionID,
      setManualSessionTitles,
      setSessionTitles,
      setSessionTypes,
      setSidebarMode: vi.fn(),
      setStatusLine: vi.fn(),
    },
    '/repo/orxacode',
    'codex' satisfies SessionType
  )

  expect(registerLocalProviderSession).toHaveBeenCalledTimes(1)
  const [{ sessionID, draft }] = registerLocalProviderSession.mock.calls[0] as [
    { sessionID: string; draft: boolean }
  ]
  expect(setActiveSessionID).toHaveBeenCalledWith(sessionID)
  expect(draft).toBe(true)
  expect(markSessionUsed).not.toHaveBeenCalled()
})

it('creates opencode sessions as local drafts until the first prompt is sent', async () => {
  const registerLocalProviderSession = vi.fn(record => record)
  const createWorkspaceSession = vi.fn()
  const setActiveSessionID = vi.fn()
  const markSessionUsed = vi.fn()

  await createSessionAction(
    {
      activeProjectDir: '/repo/orxacode',
      appPermissionMode: 'ask-write',
      availableAgentNames: new Set<string>(),
      clearPendingSession: vi.fn(),
      createWorkspaceSession,
      describeClaudeHealthFailure: vi.fn(),
      markSessionUsed,
      registerLocalProviderSession,
      selectProject: vi.fn(),
      selectedAgent: undefined,
      selectedModelPayload: undefined,
      selectedVariant: undefined,
      setActiveProjectDir: vi.fn(),
      setActiveSessionID,
      setManualSessionTitles: vi.fn(),
      setSessionTitles: vi.fn(),
      setSessionTypes: vi.fn(),
      setSidebarMode: vi.fn(),
      setStatusLine: vi.fn(),
    },
    '/repo/orxacode',
    'opencode' satisfies SessionType
  )

  expect(createWorkspaceSession).not.toHaveBeenCalled()
  expect(registerLocalProviderSession).toHaveBeenCalledTimes(1)
  const [record] = registerLocalProviderSession.mock.calls[0] as [
    { sessionID: string; type: string; draft: boolean }
  ]
  expect(record.type).toBe('opencode')
  expect(record.draft).toBe(true)
  expect(setActiveSessionID).toHaveBeenCalledWith(record.sessionID)
  expect(markSessionUsed).not.toHaveBeenCalled()
})

it('opens an existing Codex thread as a bound local provider session', async () => {
  const registerLocalProviderSession = vi.fn(record => record)
  const setActiveSessionID = vi.fn()
  const markSessionUsed = vi.fn()

  await openBoundLocalProviderSessionAction(
    {
      activeProjectDir: '/repo/orxacode',
      clearPendingSession: vi.fn(),
      markSessionUsed,
      registerLocalProviderSession,
      selectProject: vi.fn(),
      setActiveProjectDir: vi.fn(),
      setActiveSessionID,
      setManualSessionTitles: vi.fn(),
      setSessionTitles: vi.fn(),
      setSessionTypes: vi.fn(),
      setSidebarMode: vi.fn(),
      setStatusLine: vi.fn(),
    },
    {
      directory: '/repo/orxacode/.worktrees/feature-a',
      sessionID: 'thread-123',
      sessionType: 'codex',
      title: 'Recovered Codex Thread',
    }
  )

  expect(registerLocalProviderSession).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionID: 'thread-123',
      directory: '/repo/orxacode/.worktrees/feature-a',
      type: 'codex',
      draft: false,
    })
  )
  expect(setActiveSessionID).toHaveBeenCalledWith('thread-123')
  expect(markSessionUsed).toHaveBeenCalledWith('thread-123')
})

it('opens an imported Claude provider session as a bound local provider session', async () => {
  const registerLocalProviderSession = vi.fn(record => record)
  const setActiveSessionID = vi.fn()
  const markSessionUsed = vi.fn()

  await openBoundLocalProviderSessionAction(
    {
      activeProjectDir: '/repo/orxacode',
      clearPendingSession: vi.fn(),
      markSessionUsed,
      registerLocalProviderSession,
      selectProject: vi.fn(),
      setActiveProjectDir: vi.fn(),
      setActiveSessionID,
      setManualSessionTitles: vi.fn(),
      setSessionTitles: vi.fn(),
      setSessionTypes: vi.fn(),
      setSidebarMode: vi.fn(),
      setStatusLine: vi.fn(),
    },
    {
      directory: '/repo/orxacode',
      sessionID: 'provider-thread-claude',
      sessionType: 'claude-chat',
      title: 'Recovered Claude Session',
    }
  )

  expect(registerLocalProviderSession).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionID: 'provider-thread-claude',
      directory: '/repo/orxacode',
      type: 'claude-chat',
      draft: false,
    })
  )
  expect(setActiveSessionID).toHaveBeenCalledWith('provider-thread-claude')
  expect(markSessionUsed).toHaveBeenCalledWith('provider-thread-claude')
})
