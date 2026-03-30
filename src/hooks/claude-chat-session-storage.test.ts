import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearPersistedClaudeChatState,
  getPersistedClaudeChatState,
  resetPersistedClaudeChatStateForTests,
  setPersistedClaudeChatState,
} from './claude-chat-session-storage'

const SESSION_KEY = '/workspace::claude-chat-1'

function createPersistedState(partial: Partial<ReturnType<typeof getPersistedClaudeChatState>>) {
  return {
    providerThreadId: 'thread-1',
    messages: partial.messages ?? [],
    historyMessages: partial.historyMessages ?? [],
    isStreaming: partial.isStreaming ?? false,
    messageIdCounter: partial.messageIdCounter ?? 0,
    subagents: partial.subagents ?? [],
  }
}

function createExpectedState(partial: Partial<ReturnType<typeof getPersistedClaudeChatState>>) {
  return {
    messages: partial.messages ?? [],
    historyMessages: partial.historyMessages ?? [],
    isStreaming: partial.isStreaming ?? false,
    messageIdCounter: partial.messageIdCounter ?? 0,
    subagents: partial.subagents ?? [],
  }
}

function persistStateToLocalStorage(
  sessionKey: string,
  state: ReturnType<typeof createPersistedState>
) {
  window.localStorage.setItem(`orxa:claudeChatSession:v1:${sessionKey}`, JSON.stringify(state))
}

describe('claude-chat-session-storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetPersistedClaudeChatStateForTests()
  })

  it('hydrates persisted Claude chat state from localStorage after cache reset', () => {
    persistStateToLocalStorage(
      SESSION_KEY,
      createPersistedState({
        messages: [{ id: 'msg-1', kind: 'message', role: 'assistant', content: 'Saved', timestamp: 1 }],
        historyMessages: [{ id: 'history-1', role: 'assistant', content: 'Saved', timestamp: 1, sessionId: 'thread-1' }],
        isStreaming: true,
        messageIdCounter: 4,
        subagents: [{ id: 'task-1', name: 'Explorer', status: 'completed', statusText: 'Done', sessionID: 'child-1' }],
      })
    )

    resetPersistedClaudeChatStateForTests()

    expect(getPersistedClaudeChatState(SESSION_KEY)).toEqual(
      createExpectedState({
        messages: [{ id: 'msg-1', kind: 'message', role: 'assistant', content: 'Saved', timestamp: 1 }],
        historyMessages: [{ id: 'history-1', role: 'assistant', content: 'Saved', timestamp: 1, sessionId: 'thread-1' }],
        isStreaming: false,
        messageIdCounter: 4,
        subagents: [{ id: 'task-1', name: 'Explorer', status: 'completed', statusText: 'Done', sessionID: 'child-1' }],
      })
    )
  })

  it('clears persisted Claude chat state from localStorage', () => {
    setPersistedClaudeChatState(
      SESSION_KEY,
      createExpectedState({
        messages: [{ id: 'msg-1', kind: 'message', role: 'assistant', content: 'Saved', timestamp: 1 }],
        historyMessages: [{ id: 'history-1', role: 'assistant', content: 'Saved', timestamp: 1, sessionId: 'thread-1' }],
        messageIdCounter: 4,
        subagents: [{ id: 'task-1', name: 'Explorer', status: 'completed', statusText: 'Done', sessionID: 'child-1' }],
      })
    )

    clearPersistedClaudeChatState(SESSION_KEY)
    resetPersistedClaudeChatStateForTests()

    expect(getPersistedClaudeChatState(SESSION_KEY)).toEqual(createExpectedState({}))
  })

  it('preserves a legacy provider thread id while runtime snapshots rewrite the persisted state', () => {
    persistStateToLocalStorage(SESSION_KEY, {
      providerThreadId: 'thread-legacy',
      messages: [],
      historyMessages: [],
      isStreaming: false,
      messageIdCounter: 0,
      subagents: [],
    })

    setPersistedClaudeChatState(SESSION_KEY, {
      messages: [{ id: 'msg-2', kind: 'message', role: 'assistant', content: 'Updated', timestamp: 2 }],
      historyMessages: [],
      isStreaming: false,
      messageIdCounter: 0,
      subagents: [],
    })

    expect(
      JSON.parse(window.localStorage.getItem(`orxa:claudeChatSession:v1:${SESSION_KEY}`) ?? '{}')
    ).toEqual(
      expect.objectContaining({
        providerThreadId: 'thread-legacy',
        messages: [{ id: 'msg-2', kind: 'message', role: 'assistant', content: 'Updated', timestamp: 2 }],
      })
    )
  })
})
