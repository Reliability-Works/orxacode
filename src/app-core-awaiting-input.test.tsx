import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PermissionRequest, QuestionRequest } from '@opencode-ai/sdk/v2/client'
import { TEST_APP_PREFERENCES } from './components/settings-drawer/test-fixtures'
import { useAppCoreAwaitingInput } from './app-core-awaiting-input'

vi.mock('./app-core-notifications', () => ({
  useAppCoreNotifications: () => undefined,
}))

function createContext(
  overrides: Partial<Parameters<typeof useAppCoreAwaitingInput>[0]> = {}
): Parameters<typeof useAppCoreAwaitingInput>[0] {
  return {
    activePresentationProvider: 'opencode',
    activeProjectDir: '/repo',
    activeSessionID: 'session-1',
    activeSessionKey: 'opencode::/repo::session-1',
    appPreferences: { ...TEST_APP_PREFERENCES, confirmDangerousActions: false },
    effectiveSystemAddendum: undefined,
    followupQueue: [],
    isSessionInProgress: false,
    permissions: [],
    questions: [],
    requestConfirmation: vi.fn(async () => true),
    sendingQueuedId: undefined,
    setAppPreferences: vi.fn(),
    setFollowupQueue: vi.fn(),
    setPermissionDecisionPending: vi.fn(),
    setPermissionDecisionPendingRequestID: vi.fn(),
    setSendingQueuedId: vi.fn(),
    setStatusLine: vi.fn(),
    sendPrompt: vi.fn(async () => true),
    toolsPolicy: undefined,
    permissionDecisionPending: null,
    permissionDecisionPendingRequestID: null,
    ...overrides,
  }
}

describe('useAppCoreAwaitingInput', () => {
  it('replies to pending permissions without forcing a project refresh', async () => {
    const replyPermissionMock = vi.fn(async () => true)
    const refreshProjectMock = vi.fn(async () => true)
    const setStatusLine = vi.fn()

    Object.defineProperty(window, 'orxa', {
      configurable: true,
      value: {
        opencode: {
          replyPermission: replyPermissionMock,
          replyQuestion: vi.fn(async () => true),
          rejectQuestion: vi.fn(async () => true),
          refreshProject: refreshProjectMock,
        },
      },
    })

    const { result } = renderHook(() =>
      useAppCoreAwaitingInput(
        createContext({
          permissions: [{ id: 'perm-1', sessionID: 'session-1' } as PermissionRequest],
          setStatusLine,
        })
      )
    )

    await act(async () => {
      await result.current.replyPendingPermission('once')
    })

    expect(replyPermissionMock).toHaveBeenCalledWith('/repo', 'perm-1', 'once')
    expect(refreshProjectMock).not.toHaveBeenCalled()
    expect(setStatusLine).toHaveBeenCalledWith('Permission approved')
  })

  it('answers pending questions without forcing a project refresh', async () => {
    const replyQuestionMock = vi.fn(async () => true)
    const refreshProjectMock = vi.fn(async () => true)
    const setStatusLine = vi.fn()

    Object.defineProperty(window, 'orxa', {
      configurable: true,
      value: {
        opencode: {
          replyPermission: vi.fn(async () => true),
          replyQuestion: replyQuestionMock,
          rejectQuestion: vi.fn(async () => true),
          refreshProject: refreshProjectMock,
        },
      },
    })

    const { result } = renderHook(() =>
      useAppCoreAwaitingInput(
        createContext({
          questions: [
            {
              id: 'q-1',
              sessionID: 'session-1',
              questions: [{ id: 'question-1', question: 'Ship it?' }],
            } as unknown as QuestionRequest,
          ],
          setStatusLine,
        })
      )
    )

    await act(async () => {
      await result.current.replyPendingQuestion([['yes']])
    })

    expect(replyQuestionMock).toHaveBeenCalledWith('/repo', 'q-1', [['yes']])
    expect(refreshProjectMock).not.toHaveBeenCalled()
    expect(setStatusLine).toHaveBeenCalledWith('Question answered')
  })

  it('rejects pending questions without forcing a project refresh', async () => {
    const rejectQuestionMock = vi.fn(async () => true)
    const refreshProjectMock = vi.fn(async () => true)
    const setStatusLine = vi.fn()

    Object.defineProperty(window, 'orxa', {
      configurable: true,
      value: {
        opencode: {
          replyPermission: vi.fn(async () => true),
          replyQuestion: vi.fn(async () => true),
          rejectQuestion: rejectQuestionMock,
          refreshProject: refreshProjectMock,
        },
      },
    })

    const { result } = renderHook(() =>
      useAppCoreAwaitingInput(
        createContext({
          questions: [
            {
              id: 'q-1',
              sessionID: 'session-1',
              questions: [{ id: 'question-1', question: 'Ship it?' }],
            } as unknown as QuestionRequest,
          ],
          setStatusLine,
        })
      )
    )

    await act(async () => {
      await result.current.rejectPendingQuestion()
    })

    expect(rejectQuestionMock).toHaveBeenCalledWith('/repo', 'q-1')
    expect(refreshProjectMock).not.toHaveBeenCalled()
    expect(setStatusLine).toHaveBeenCalledWith('Question rejected')
  })

  it('auto-approves yolo permissions without forcing a project refresh', async () => {
    const replyPermissionMock = vi.fn(async () => true)
    const refreshProjectMock = vi.fn(async () => true)

    Object.defineProperty(window, 'orxa', {
      configurable: true,
      value: {
        opencode: {
          replyPermission: replyPermissionMock,
          replyQuestion: vi.fn(async () => true),
          rejectQuestion: vi.fn(async () => true),
          refreshProject: refreshProjectMock,
        },
      },
    })

    renderHook(() =>
      useAppCoreAwaitingInput(
        createContext({
          appPreferences: {
            ...TEST_APP_PREFERENCES,
            confirmDangerousActions: false,
            permissionMode: 'yolo-write',
          },
          permissions: [{ id: 'perm-1', sessionID: 'session-1' } as PermissionRequest],
        })
      )
    )

    await waitFor(() => {
      expect(replyPermissionMock).toHaveBeenCalledWith(
        '/repo',
        'perm-1',
        'once',
        'Auto-approved in Yolo mode'
      )
    })
    expect(refreshProjectMock).not.toHaveBeenCalled()
  })
})
