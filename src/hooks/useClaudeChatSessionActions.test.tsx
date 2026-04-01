import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useClaudeChatSessionActions } from './useClaudeChatSessionActions'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'

const SESSION_KEY = '/workspace::claude-chat-1'

describe('useClaudeChatSessionActions', () => {
  beforeEach(() => {
    useUnifiedRuntimeStore.setState(state => ({
      ...state,
      claudeChatSessions: {},
    }))

    window.orxa = {
      claudeChat: {
        startTurn: vi.fn(async () => undefined),
        interruptTurn: vi.fn(async () => undefined),
        approve: vi.fn(async () => undefined),
        respondToUserInput: vi.fn(async () => undefined),
        archiveSession: vi.fn(async () => undefined),
        archiveProviderSession: vi.fn(async () => undefined),
        getSessionMessages: vi.fn(async () => []),
      },
    } as unknown as typeof window.orxa
  })

  it('marks Claude busy immediately before provider events arrive', async () => {
    let resolveStartTurn: (() => void) | null = null
    vi.mocked(window.orxa.claudeChat.startTurn).mockImplementation(
      () =>
        new Promise<void>(resolve => {
          resolveStartTurn = resolve
        })
    )

    const { result } = renderHook(() =>
      useClaudeChatSessionActions('/workspace', SESSION_KEY)
    )

    await act(async () => {
      void result.current.startTurn('Investigate the build')
      await Promise.resolve()
    })

    expect(useUnifiedRuntimeStore.getState().claudeChatSessions[SESSION_KEY]).toMatchObject({
      connectionStatus: 'connecting',
      isStreaming: true,
    })

    await act(async () => {
      resolveStartTurn?.()
      await Promise.resolve()
    })
  })
})
