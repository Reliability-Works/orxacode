import { expect, it } from 'vitest'
import {
  buildCodexBackgroundAgentsFromChildThreads,
  buildCodexBackgroundAgentsFromMessages,
  buildOpencodeBackgroundAgents,
  extractCodexTodoItemsFromMessages,
  extractOpencodeTodoItems,
  filterOutCurrentCodexThreadAgent,
} from './session-presentation'
import { createSessionMessageBundle } from '../test/session-message-bundle-factory'

it('ignores unnamed Codex runtime child threads without metadata', () => {
  expect(
    buildCodexBackgroundAgentsFromChildThreads([
      {
        id: 'child-1',
        preview: '',
        modelProvider: 'openai',
        createdAt: Date.now(),
      } as never,
    ])
  ).toEqual([])
})

it('derives shared opencode background agents across assistant turns', () => {
  const now = Date.now()
  const messages = [
    createSessionMessageBundle({
      id: 'assistant-0',
      role: 'assistant',
      sessionID: 'session-1',
      createdAt: now - 10,
      parts: [
        {
          id: 'subtask-0',
          type: 'subtask',
          sessionID: 'child-session-0',
          messageID: 'assistant-0',
          prompt: 'Inspect the routing layer.',
          description: 'Inspect routing layer',
          agent: 'Librarian',
          model: { providerID: 'openai', modelID: 'gpt-5.4' },
        },
      ],
    }),
    createSessionMessageBundle({
      id: 'assistant-1',
      role: 'assistant',
      sessionID: 'session-1',
      createdAt: now,
      parts: [
        {
          id: 'subtask-1',
          type: 'subtask',
          sessionID: 'child-session-1',
          messageID: 'assistant-1',
          prompt: 'Inspect the booking routes.',
          description: 'Inspect booking routes',
          agent: 'Explorer',
          model: { providerID: 'openai', modelID: 'gpt-5.4' },
        },
      ],
    }),
  ]

  expect(
    buildOpencodeBackgroundAgents(messages, {
      'child-session-0': { type: 'idle' },
      'child-session-1': { type: 'busy' },
    })
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'child-session-0',
        provider: 'opencode',
        name: 'Librarian',
        status: 'idle',
      }),
      expect.objectContaining({
        id: 'child-session-1',
        provider: 'opencode',
        name: 'Explorer',
        modelLabel: 'openai/gpt-5.4',
        status: 'thinking',
      }),
    ])
  )
})

it('derives Codex background agents from task tool collab metadata when runtime state is empty', () => {
  expect(
    buildCodexBackgroundAgentsFromMessages([
      {
        id: 'task-1',
        kind: 'tool',
        toolType: 'task',
        title: 'Spawn worker',
        status: 'running',
        timestamp: Date.now(),
        collabReceivers: [{ threadId: 'child-1', nickname: 'Euclid', role: 'worker' }],
        collabStatuses: [{ threadId: 'child-1', nickname: 'Euclid', role: 'worker', status: 'done' }],
      },
    ])
  ).toEqual([
    expect.objectContaining({
      id: 'child-1',
      provider: 'codex',
      name: 'Euclid',
      status: 'completed',
    }),
  ])
})

it('derives Codex background agents from generic collab tool metadata too', () => {
  expect(
    buildCodexBackgroundAgentsFromMessages([
      {
        id: 'collab-1',
        kind: 'tool',
        toolType: 'collabToolCall',
        title: 'Spawn explorer',
        status: 'completed',
        timestamp: Date.now(),
        collabReceivers: [{ threadId: 'child-2', nickname: 'Scout', role: 'explorer' }],
      },
    ])
  ).toEqual([
    expect.objectContaining({
      id: 'child-2',
      provider: 'codex',
      name: 'Scout',
      role: 'explorer',
    }),
  ])
})

it('filters the active codex thread out of background agents', () => {
  expect(
    filterOutCurrentCodexThreadAgent(
      [
        {
          id: 'thr-main',
          sessionID: 'thr-main',
          provider: 'codex',
          name: 'main',
          status: 'thinking',
          statusText: 'is thinking',
        },
        {
          id: 'child-2',
          sessionID: 'child-2',
          provider: 'codex',
          name: 'Scout',
          status: 'thinking',
          statusText: 'is thinking',
        },
      ],
      'thr-main'
    )
  ).toEqual([
    expect.objectContaining({
      id: 'child-2',
      name: 'Scout',
    }),
  ])
})

it('keeps multiple opencode child agents when they share the same name', () => {
  const now = Date.now()
  const messages = [
    createSessionMessageBundle({
      id: 'assistant-shared-name',
      role: 'assistant',
      sessionID: 'session-1',
      createdAt: now,
      parts: [
        {
          id: 'subtask-1',
          type: 'subtask',
          messageID: 'assistant-shared-name',
          prompt: 'Inspect athena-pumping',
          description: 'Inspect athena-pumping',
          agent: 'explore',
          sessionID: 'child-1',
          model: { providerID: 'openai', modelID: 'gpt-5.4' },
        },
        {
          id: 'subtask-2',
          type: 'subtask',
          messageID: 'assistant-shared-name',
          prompt: 'Inspect sii-beauty-boutique',
          description: 'Inspect sii-beauty-boutique',
          agent: 'explore',
          sessionID: 'child-2',
          model: { providerID: 'openai', modelID: 'gpt-5.4' },
        },
      ],
    }),
  ]

  expect(
    buildOpencodeBackgroundAgents(messages, {
      'child-1': { type: 'idle' },
      'child-2': { type: 'idle' },
    })
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'child-1', sessionID: 'child-1', name: 'explore' }),
      expect.objectContaining({ id: 'child-2', sessionID: 'child-2', name: 'explore' }),
    ])
  )
})

it('derives Codex task-list items from assistant plan text when structured plan state is empty', () => {
  expect(
    extractCodexTodoItemsFromMessages([
      {
        id: 'assistant-plan',
        kind: 'message',
        role: 'assistant',
        timestamp: Date.now(),
        content: [
          'I created a task list and started maintaining it with these phases:',
          '1. Inspect repo and choose the new standalone site folder',
          '2. Scaffold the app and core dependencies',
          '3. Implement the booking product and UX',
        ].join('\n'),
      },
    ])
  ).toEqual([
    expect.objectContaining({
      content: 'Inspect repo and choose the new standalone site folder',
    }),
    expect.objectContaining({ content: 'Scaffold the app and core dependencies' }),
    expect.objectContaining({ content: 'Implement the booking product and UX' }),
  ])
})

it('surfaces provisional opencode background agents before child session ids arrive', () => {
  const now = Date.now()
  const messages = [
    createSessionMessageBundle({
      id: 'assistant-placeholder-subtask',
      role: 'assistant',
      sessionID: 'session-1',
      createdAt: now,
      parts: [
        {
          id: 'subtask-no-session',
          type: 'subtask',
          messageID: 'assistant-placeholder-subtask',
          prompt: 'Inspect the frontend.',
          description: 'Inspect frontend',
          agent: 'Frontend',
          model: { providerID: 'openai', modelID: 'gpt-5.4' },
        },
        {
          id: 'tool-task-no-session',
          type: 'tool',
          sessionID: 'session-1',
          messageID: 'assistant-placeholder-subtask',
          callID: 'call-task-no-session',
          tool: 'task',
          state: {
            status: 'running',
            input: {
              agent: 'build',
              prompt: 'Implement the feature.',
              description: 'Implement feature',
            },
            output: '',
            metadata: {},
            time: { start: now },
          },
        },
      ],
    }),
  ]

  expect(buildOpencodeBackgroundAgents(messages)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        provider: 'opencode',
        name: 'Frontend',
        status: 'thinking',
        sessionID: undefined,
      }),
      expect.objectContaining({
        provider: 'opencode',
        name: 'build',
        status: 'thinking',
        sessionID: undefined,
      }),
    ])
  )
})

it('extracts opencode todo items from the latest todo tool state', () => {
  const now = Date.now()
  const messages = [
    createSessionMessageBundle({
      id: 'assistant-1',
      role: 'assistant',
      sessionID: 'session-1',
      createdAt: now,
      parts: [
        {
          id: 'todo-1',
          type: 'tool',
          sessionID: 'session-1',
          messageID: 'assistant-1',
          callID: 'call-1',
          tool: 'todowrite',
          state: {
            status: 'completed',
            input: {},
            output: [
              { id: 'task-1', content: 'Audit providers', status: 'completed' },
              { id: 'task-2', content: 'Wire shared dock', status: 'in_progress' },
            ],
            title: 'todo',
            metadata: {},
            time: { start: now, end: now + 1 },
          },
        },
      ],
    }),
  ]

  expect(extractOpencodeTodoItems(messages)).toEqual([
    { id: 'task-1', content: 'Audit providers', status: 'completed' },
    { id: 'task-2', content: 'Wire shared dock', status: 'in_progress' },
  ])
})
