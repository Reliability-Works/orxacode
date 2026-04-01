import { beforeEach, expect, it, vi } from 'vitest'
import { subscribeClaudeChatSessionEvents, type ClaudeChatSessionEventContext } from './claude-chat-session-events'
import type { ClaudeChatMessageItem } from './useClaudeChatSession'

let subscriptionHandler: ((event: { type: string; payload: Record<string, unknown> }) => void) | null = null
let currentMessages: ClaudeChatMessageItem[] = []

function createContext(): ClaudeChatSessionEventContext {
  return {
    directory: '/tmp/project',
    sessionKey: 'session-1',
    setClaudeChatConnectionState: vi.fn(),
    setClaudeChatProviderThreadId: vi.fn(),
    setClaudeChatPendingApproval: vi.fn(),
    setClaudeChatPendingUserInput: vi.fn(),
    setClaudeChatStreaming: vi.fn(),
    setClaudeChatTurnUsage: vi.fn(),
    setClaudeChatSubagents: vi.fn(),
    updateClaudeChatMessages: vi.fn((_sessionKey, updater) => {
      currentMessages = updater(currentMessages)
    }),
  }
}

beforeEach(() => {
  currentMessages = []
  subscriptionHandler = null
  window.orxa = {
    events: {
      subscribe: vi.fn(handler => {
        subscriptionHandler = handler as typeof subscriptionHandler
        return () => undefined
      }),
    },
  } as unknown as typeof window.orxa
})

it('turns Claude retry and blocked result notifications into transcript notices', () => {
  const context = createContext()
  const unsubscribe = subscribeClaudeChatSessionEvents(context)

  subscriptionHandler?.({
    type: 'claude-chat.notification',
    payload: {
      sessionKey: 'session-1',
      method: 'status/retry',
      params: {
        attempt: 2,
        maxRetries: 5,
        retryDelayMs: 750,
        error: '429 rate limit',
        timestamp: 1,
      },
    },
  })
  subscriptionHandler?.({
    type: 'claude-chat.notification',
    payload: {
      sessionKey: 'session-1',
      method: 'result',
      params: {
        subtype: 'permission_denied',
        isError: true,
        errors: ['Not allowed to fetch this URL'],
        timestamp: 2,
      },
    },
  })

  expect(currentMessages).toEqual([
    expect.objectContaining({
      kind: 'notice',
      label: 'Claude retrying',
      detail: 'Attempt 2 of 5 · Retrying in 750ms · 429 rate limit',
      tone: 'info',
    }),
    expect.objectContaining({
      kind: 'notice',
      label: 'Claude blocked',
      detail: 'Not allowed to fetch this URL',
      tone: 'error',
    }),
  ])

  unsubscribe()
})

it('uses Claude tool input metadata to keep bash commands and file edits structured', () => {
  const context = createContext()
  const unsubscribe = subscribeClaudeChatSessionEvents(context)

  subscriptionHandler?.({
    type: 'claude-chat.notification',
    payload: {
      sessionKey: 'session-1',
      method: 'tool/completed',
      params: {
        id: 'tool-bash-1',
        toolName: 'Bash',
        toolInput: { command: 'pnpm exec vitest run src/app.test.ts' },
        summary: 'Tests passed',
        timestamp: 1,
      },
    },
  })
  subscriptionHandler?.({
    type: 'claude-chat.notification',
    payload: {
      sessionKey: 'session-1',
      method: 'tool/completed',
      params: {
        id: 'tool-edit-1',
        toolName: 'Edit',
        toolInput: {
          file_path: '/workspace/src/app.ts',
          old_string: 'old line',
          new_string: 'new line',
        },
        summary: 'Updated src/app.ts',
        timestamp: 2,
      },
    },
  })

  expect(currentMessages).toEqual([
    expect.objectContaining({
      id: 'tool-bash-1',
      kind: 'tool',
      command: 'pnpm exec vitest run src/app.test.ts',
      output: 'Tests passed',
    }),
    expect.objectContaining({
      id: 'tool-edit-1',
      kind: 'diff',
      path: '/workspace/src/app.ts',
      type: 'modified',
      diff: '@@\n-old line\n+new line',
    }),
  ])

  unsubscribe()
})

it('records approval and user-input interruptions as transcript notices', () => {
  const context = createContext()
  const unsubscribe = subscribeClaudeChatSessionEvents(context)

  subscriptionHandler?.({
    type: 'claude-chat.approval',
    payload: {
      id: 'approval-1',
      sessionKey: 'session-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-1',
      toolName: 'WebFetch',
      reason: 'WebFetch: https://example.com',
      availableDecisions: ['accept', 'decline'],
    },
  })
  subscriptionHandler?.({
    type: 'claude-chat.userInput',
    payload: {
      id: 'input-1',
      sessionKey: 'session-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      message: 'Which deployment target should I use?',
      options: [{ label: 'staging', value: 'staging' }],
    },
  })

  expect(currentMessages).toEqual([
    expect.objectContaining({
      kind: 'notice',
      label: 'Claude needs permission',
      detail: 'WebFetch: https://example.com',
      tone: 'info',
    }),
    expect.objectContaining({
      kind: 'notice',
      label: 'Claude needs input',
      detail: 'Which deployment target should I use?',
      tone: 'info',
    }),
  ])

  unsubscribe()
})

it('records non-exploration subagent lifecycle notices in the transcript', () => {
  const context = createContext()
  const unsubscribe = subscribeClaudeChatSessionEvents(context)

  subscriptionHandler?.({
    type: 'claude-chat.notification',
    payload: {
      sessionKey: 'session-1',
      method: 'task/started',
      params: {
        taskId: 'task-1',
        description: 'Implement the payment webhook fix',
        taskType: 'worker',
        timestamp: 1,
      },
    },
  })
  subscriptionHandler?.({
    type: 'claude-chat.notification',
    payload: {
      sessionKey: 'session-1',
      method: 'task/progress',
      params: {
        taskId: 'task-1',
        description: 'Implement the payment webhook fix',
        summary: 'Updating the Stripe webhook mutation and tests',
        timestamp: 2,
      },
    },
  })
  subscriptionHandler?.({
    type: 'claude-chat.notification',
    payload: {
      sessionKey: 'session-1',
      method: 'task/completed',
      params: {
        taskId: 'task-1',
        status: 'completed',
        summary: 'Webhook handling updated and regression tests added',
        timestamp: 3,
      },
    },
  })

  expect(currentMessages).toEqual([
    expect.objectContaining({
      kind: 'notice',
      label: 'Subagent started',
      detail: 'Implement the payment webhook fix',
      tone: 'info',
    }),
    expect.objectContaining({
      kind: 'notice',
      label: 'Subagent progress',
      detail: 'Updating the Stripe webhook mutation and tests',
      tone: 'info',
    }),
    expect.objectContaining({
      kind: 'notice',
      label: 'Subagent completed',
      detail: 'Webhook handling updated and regression tests added',
      tone: 'info',
    }),
  ])

  unsubscribe()
})
