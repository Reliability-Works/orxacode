import { expect, it, vi } from 'vitest'
import type { SessionType } from '~/types/canvas'
import { createSessionAction } from './app-core-session'

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
