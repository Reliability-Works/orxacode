import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'
import { useClaudeChatSessionLiveSync } from './useClaudeChatSessionLiveSync'

const DIRECTORY = '/repo'
const SESSION_KEY = '/repo::claude-chat-live-sync'

describe('useClaudeChatSessionLiveSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useUnifiedRuntimeStore.setState(state => ({
      ...state,
      claudeChatSessions: {},
    }))

    window.orxa = {
      claudeChat: {
        getState: vi.fn(async () => ({
          sessionKey: SESSION_KEY,
          status: 'connected',
          providerThreadId: 'provider-thread-1',
          activeTurnId: null,
          lastError: undefined,
        })),
        getSessionMessages: vi.fn(async () => []),
      },
      events: {
        subscribe: vi.fn(() => () => undefined),
      },
    } as unknown as typeof window.orxa
  })

  afterEach(() => {
    vi.useRealTimers()
    // @ts-expect-error test cleanup
    delete window.orxa
  })

  it('uses one-shot reconcile + resume sync without perpetual interval polling', async () => {
    renderHook(() =>
      useClaudeChatSessionLiveSync(DIRECTORY, SESSION_KEY, {
        providerThreadId: 'provider-thread-1',
        isStreaming: false,
        pendingApproval: null,
        pendingUserInput: null,
        subagents: [],
      })
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(window.orxa?.claudeChat.getState).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    expect(window.orxa?.claudeChat.getState).toHaveBeenCalledTimes(1)

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(window.orxa?.claudeChat.getState).toHaveBeenCalledTimes(2)
  })
})
