import { afterEach, expect, it } from 'vitest'
import { Effect } from 'effect'
import { RuntimeItemId, RuntimeTaskId } from '@orxa-code/contracts'

import type { ProviderRuntimeEvent } from '@orxa-code/contracts'
import { CommandId } from '@orxa-code/contracts'
import {
  asEventId,
  asThreadId,
  asTurnId,
  createHarness,
  createRuntimeRefs,
  disposeRuntimeRefs,
  waitForThread,
} from './ProviderRuntimeIngestion.test.helpers.ts'

const refs = createRuntimeRefs()
afterEach(async () => {
  await disposeRuntimeRefs(refs)
})

const PARENT_THREAD_ID = asThreadId('thread-1')
const CLAUDE_PARENT_TURN_ID = asTurnId('turn-claude-root')

function createClaudeDelegationEvent(now: string): ProviderRuntimeEvent {
  return {
    type: 'item.started',
    eventId: asEventId('evt-claude-subagent-started'),
    provider: 'claudeAgent',
    createdAt: now,
    threadId: PARENT_THREAD_ID,
    turnId: CLAUDE_PARENT_TURN_ID,
    itemId: RuntimeItemId.makeUnsafe('tool-claude-subagent-1'),
    payload: {
      itemType: 'collab_agent_tool_call',
      status: 'inProgress',
      title: 'Subagent task',
      detail: 'Inspect provider routing with the Explore subagent.',
      data: {
        toolName: 'Task',
        input: {
          description: 'Inspect provider routing with the Explore subagent.',
          prompt: 'Audit the provider routing code and summarize one risk.',
          subagent_type: 'Explore',
        },
      },
    },
    raw: {
      source: 'claude.sdk.message',
      method: 'claude/stream_event/content_block_start',
      messageType: 'stream_event',
      payload: {
        type: 'stream_event',
        session_id: 'sdk-session-root',
        uuid: 'stream-claude-subagent-start',
        parent_tool_use_id: null,
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'tool-claude-subagent-1',
            name: 'Task',
            input: {
              description: 'Inspect provider routing with the Explore subagent.',
              prompt: 'Audit the provider routing code and summarize one risk.',
              subagent_type: 'Explore',
            },
          },
        },
      },
    },
  }
}

function createClaudeChildDeltaEvent(now: string): ProviderRuntimeEvent {
  return {
    type: 'content.delta',
    eventId: asEventId('evt-claude-child-delta'),
    provider: 'claudeAgent',
    createdAt: now,
    threadId: PARENT_THREAD_ID,
    turnId: CLAUDE_PARENT_TURN_ID,
    itemId: RuntimeItemId.makeUnsafe('assistant-claude-child-1'),
    payload: {
      streamKind: 'assistant_text',
      delta: 'I am tracing the routing code now.',
    },
    raw: {
      source: 'claude.sdk.message',
      method: 'claude/stream_event/content_block_delta',
      messageType: 'stream_event',
      payload: {
        type: 'stream_event',
        session_id: 'sdk-session-root',
        uuid: 'stream-claude-child-delta',
        parent_tool_use_id: 'tool-claude-subagent-1',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'text_delta',
            text: 'I am tracing the routing code now.',
          },
        },
      },
    },
  }
}

function createClaudeChildAssistantCompletedEvent(now: string): ProviderRuntimeEvent {
  return {
    type: 'item.completed',
    eventId: asEventId('evt-claude-child-assistant-completed'),
    provider: 'claudeAgent',
    createdAt: now,
    threadId: PARENT_THREAD_ID,
    turnId: CLAUDE_PARENT_TURN_ID,
    itemId: RuntimeItemId.makeUnsafe('assistant-claude-child-1'),
    payload: {
      itemType: 'assistant_message',
      status: 'completed',
      detail: 'I am tracing the routing code now.',
    },
    raw: {
      source: 'claude.sdk.message',
      method: 'claude/assistant',
      messageType: 'assistant',
      payload: {
        type: 'assistant',
        session_id: 'sdk-session-root',
        uuid: 'assistant-claude-child-1',
        parent_tool_use_id: 'tool-claude-subagent-1',
        message: {
          id: 'assistant-claude-child-1',
          content: [{ type: 'text', text: 'I am tracing the routing code now.' }],
        },
      },
    },
  }
}

function createClaudeTaskCompletedEvent(now: string): ProviderRuntimeEvent {
  return {
    type: 'task.completed',
    eventId: asEventId('evt-claude-task-completed'),
    provider: 'claudeAgent',
    createdAt: now,
    threadId: PARENT_THREAD_ID,
    turnId: CLAUDE_PARENT_TURN_ID,
    payload: {
      taskId: RuntimeTaskId.makeUnsafe('claude-task-1'),
      status: 'completed',
      summary: 'Finished exploring provider routing.',
    },
    raw: {
      source: 'claude.sdk.message',
      method: 'claude/system:task_notification',
      messageType: 'system:task_notification',
      payload: {
        type: 'system',
        subtype: 'task_notification',
        session_id: 'sdk-session-root',
        uuid: 'system-claude-task-completed',
        task_id: 'claude-task-1',
        tool_use_id: 'tool-claude-subagent-1',
        status: 'completed',
        output_file: '',
        summary: 'Finished exploring provider routing.',
      },
    },
  }
}

async function primeClaudeParentThread(
  harness: Awaited<ReturnType<typeof createHarness>>,
  now: string
) {
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.meta.update',
      commandId: CommandId.makeUnsafe('cmd-claude-thread-meta'),
      threadId: PARENT_THREAD_ID,
      modelSelection: {
        provider: 'claudeAgent',
        model: 'claude-sonnet-4-6',
      },
    })
  )

  const parentProviderSession = {
    provider: 'claudeAgent' as const,
    status: 'running' as const,
    runtimeMode: 'approval-required' as const,
    threadId: PARENT_THREAD_ID,
    providerSessionId: 'sdk-session-root',
    providerThreadId: 'sdk-session-root',
    activeTurnId: CLAUDE_PARENT_TURN_ID,
    createdAt: now,
    updatedAt: now,
  }

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.session.set',
      commandId: CommandId.makeUnsafe('cmd-claude-thread-session'),
      threadId: PARENT_THREAD_ID,
      session: {
        threadId: PARENT_THREAD_ID,
        status: 'running',
        providerName: 'claudeAgent',
        providerSessionId: 'sdk-session-root',
        providerThreadId: 'sdk-session-root',
        runtimeMode: 'approval-required',
        activeTurnId: CLAUDE_PARENT_TURN_ID,
        updatedAt: now,
        lastError: null,
      },
      createdAt: now,
    })
  )
  harness.setProviderSession(parentProviderSession)
}

async function assertClaudeSubagentThread(harness: Awaited<ReturnType<typeof createHarness>>) {
  const childThreadId = asThreadId('claude-child:thread-1:tool-claude-subagent-1')
  const childThread = await waitForThread(
    harness.engine,
    entry =>
      entry.id === childThreadId &&
      entry.title === 'Explore' &&
      entry.messages.some(
        message =>
          message.role === 'user' &&
          message.text === 'Audit the provider routing code and summarize one risk.'
      ) &&
      entry.messages.some(
        message =>
          message.role === 'assistant' &&
          message.text.includes('I am tracing the routing code now.')
      ) &&
      entry.session?.status === 'ready',
    2000,
    childThreadId
  )

  expect(childThread.modelSelection).toEqual({
    provider: 'claudeAgent',
    model: 'claude-haiku-4-5',
  })
  expect(childThread.parentLink).toMatchObject({
    parentThreadId: 'thread-1',
    relationKind: 'subagent',
    parentTurnId: String(CLAUDE_PARENT_TURN_ID),
    provider: 'claudeAgent',
    providerChildThreadId: 'tool-claude-subagent-1',
    agentLabel: 'Explore',
  })

  const parentThread = await waitForThread(
    harness.engine,
    entry =>
      entry.id === 'thread-1' &&
      entry.activities.some(activity => activity.summary === 'Delegating to Explore'),
    2000,
    PARENT_THREAD_ID
  )
  expect(
    parentThread.activities.some(activity => activity.summary === 'Delegating to Explore')
  ).toBe(true)
}

it('creates and routes Claude subagent child threads from Task tool delegation', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()

  await primeClaudeParentThread(harness, now)
  harness.emit(createClaudeDelegationEvent(now))
  harness.emit(createClaudeChildDeltaEvent(now))
  harness.emit(createClaudeChildAssistantCompletedEvent(now))
  harness.emit(createClaudeTaskCompletedEvent(now))
  await harness.drain()
  await assertClaudeSubagentThread(harness)
})
