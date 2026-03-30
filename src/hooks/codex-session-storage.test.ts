import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearPersistedCodexState,
  getPersistedCodexState,
  resetPersistedCodexStateForTests,
  setPersistedCodexState,
} from './codex-session-storage'

const SESSION_KEY = '/workspace::codex-1'

describe('codex-session-storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetPersistedCodexStateForTests()
  })

  it('hydrates persisted Codex state from localStorage after cache reset', () => {
    setPersistedCodexState(SESSION_KEY, {
      messages: [
        { id: 'msg-1', kind: 'message', role: 'assistant', content: 'Saved', timestamp: 1 },
      ],
      thread: { id: 'thr-1', preview: 'Saved', modelProvider: 'openai', createdAt: 1 },
      isStreaming: true,
      messageIdCounter: 7,
    })

    resetPersistedCodexStateForTests()

    expect(getPersistedCodexState(SESSION_KEY)).toEqual({
      messages: [
        { id: 'msg-1', kind: 'message', role: 'assistant', content: 'Saved', timestamp: 1 },
      ],
      thread: { id: 'thr-1', preview: 'Saved', modelProvider: 'openai', createdAt: 1 },
      isStreaming: false,
      messageIdCounter: 7,
    })
  })

  it('clears persisted Codex state from localStorage', () => {
    setPersistedCodexState(SESSION_KEY, {
      messages: [
        { id: 'msg-1', kind: 'message', role: 'assistant', content: 'Saved', timestamp: 1 },
      ],
      thread: { id: 'thr-1', preview: 'Saved', modelProvider: 'openai', createdAt: 1 },
      isStreaming: false,
      messageIdCounter: 7,
    })

    clearPersistedCodexState(SESSION_KEY)
    resetPersistedCodexStateForTests()

    expect(getPersistedCodexState(SESSION_KEY)).toEqual({
      messages: [],
      thread: null,
      isStreaming: false,
      messageIdCounter: 0,
    })
  })
})
