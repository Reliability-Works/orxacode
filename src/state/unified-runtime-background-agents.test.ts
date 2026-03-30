import { beforeEach, expect, it } from 'vitest'
import { selectActiveBackgroundAgentsPresentation, useUnifiedRuntimeStore } from './unified-runtime-store'

beforeEach(() => {
  useUnifiedRuntimeStore.setState({
    codexSessions: {},
    claudeChatSessions: {},
  })
})

it('falls back to Codex child threads for background agents when subagent state is empty', () => {
  useUnifiedRuntimeStore.setState({
    codexSessions: {
      'codex::/tmp/workspace::thread-1': {
        key: 'codex::/tmp/workspace::thread-1',
        directory: '/tmp/workspace',
        connectionStatus: 'connected',
        thread: { id: 'thread-1', preview: 'Main thread', modelProvider: 'openai', createdAt: 1 },
        runtimeSnapshot: {
          thread: {
            id: 'thread-1',
            preview: 'Main thread',
            modelProvider: 'openai',
            createdAt: 1,
          },
          childThreads: [
            {
              id: 'child-1',
              preview: 'Explore repo structure',
              modelProvider: 'openai',
              createdAt: 2,
              status: { type: 'busy' },
            },
          ],
        },
        messages: [],
        pendingApproval: null,
        pendingUserInput: null,
        isStreaming: true,
        planItems: [],
        dismissedPlanIds: [],
        subagents: [],
        activeSubagentThreadId: null,
      },
    },
  })

  expect(
    selectActiveBackgroundAgentsPresentation({
      provider: 'codex',
      sessionKey: 'codex::/tmp/workspace::thread-1',
    })
  ).toEqual([
    expect.objectContaining({
      id: 'child-1',
      sessionID: 'child-1',
      name: 'Explore repo structure',
      status: 'thinking',
    }),
  ])
})

it('filters out the current Codex thread from background agents even before thread hydration completes', () => {
  useUnifiedRuntimeStore.setState({
    codexSessions: {
      'codex::/tmp/workspace::thread-1': {
        key: 'codex::/tmp/workspace::thread-1',
        directory: '/tmp/workspace',
        connectionStatus: 'connected',
        thread: null,
        runtimeSnapshot: {
          thread: {
            id: 'thread-1',
            preview: 'Main thread',
            modelProvider: 'openai',
            createdAt: 1,
          },
          childThreads: [
            {
              id: 'thread-1',
              preview: 'Main thread',
              modelProvider: 'openai',
              createdAt: 1,
              status: { type: 'busy' },
            },
            {
              id: 'child-1',
              preview: 'Explore repo structure',
              modelProvider: 'openai',
              createdAt: 2,
              status: { type: 'busy' },
            },
          ],
        },
        messages: [],
        pendingApproval: null,
        pendingUserInput: null,
        isStreaming: true,
        planItems: [],
        dismissedPlanIds: [],
        subagents: [],
        activeSubagentThreadId: null,
      },
    },
  })

  expect(
    selectActiveBackgroundAgentsPresentation({
      provider: 'codex',
      sessionKey: 'codex::/tmp/workspace::thread-1',
    })
  ).toEqual([
    expect.objectContaining({
      id: 'child-1',
      sessionID: 'child-1',
    }),
  ])
})
