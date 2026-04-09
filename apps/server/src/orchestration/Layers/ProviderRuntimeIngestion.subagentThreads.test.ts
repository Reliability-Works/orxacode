import { afterEach, expect, it } from 'vitest'
import { Effect } from 'effect'

import { CommandId, RuntimeItemId, type ProviderRuntimeEvent } from '@orxa-code/contracts'

import {
  asEventId,
  asThreadId,
  asTurnId,
  createHarness,
  createRuntimeRefs,
  disposeRuntimeRefs,
  waitForThread,
} from './ProviderRuntimeIngestion.test.helpers.ts'
import { opencodeChildTurnId } from '../../opencodeChildThreads.ts'

const refs = createRuntimeRefs()
afterEach(async () => {
  await disposeRuntimeRefs(refs)
})

const asCommandId = (value: string): CommandId => CommandId.makeUnsafe(value)
const asRuntimeItemId = (value: string): RuntimeItemId => RuntimeItemId.makeUnsafe(value)
const PARENT_THREAD_ID = asThreadId('thread-1')
const OPENCODE_ROOT_TURN_ID = asTurnId('turn-root')
const OPENCODE_CHILD_THREAD_ID = 'sess-child-1'
const OPENCODE_DELEGATED_PROMPT =
  'Inspect the provider runtime and summarize the session-routing gaps.'
const OPENCODE_DELEGATED_DESCRIPTION = 'Audit the runtime and report one inconsistency.'

function emitCodexSubagentLifecycle(
  harness: Awaited<ReturnType<typeof createHarness>>,
  now: string,
  childThreadId: ReturnType<typeof asThreadId>
) {
  const parentThreadId = asThreadId('thread-1')
  const childTurnId = asTurnId('turn-child')
  harness.emit({
    type: 'item.completed',
    eventId: asEventId('evt-collab-tool-completed'),
    provider: 'codex',
    createdAt: now,
    threadId: parentThreadId,
    turnId: asTurnId('turn-parent'),
    payload: {
      itemType: 'collab_agent_tool_call',
      status: 'completed',
      detail: 'Inspect the orchestration layers and summarize the routing gaps.',
      data: {
        item: {
          type: 'collabAgentToolCall',
          receiverThreadIds: ['child_provider_1'],
          prompt: 'Inspect the orchestration layers and summarize the routing gaps.',
          subagent_type: 'code-reviewer',
        },
      },
    },
  })
  harness.emit({
    type: 'turn.started',
    eventId: asEventId('evt-child-turn-started'),
    provider: 'codex',
    createdAt: now,
    threadId: childThreadId,
    turnId: childTurnId,
    payload: {},
  })
  harness.emit({
    type: 'content.delta',
    eventId: asEventId('evt-child-delta'),
    provider: 'codex',
    createdAt: now,
    threadId: childThreadId,
    turnId: childTurnId,
    itemId: asRuntimeItemId('msg-child'),
    payload: {
      streamKind: 'assistant_text',
      delta: 'Reviewing the provider ingestion path now.',
    },
  })
  harness.emit({
    type: 'item.completed',
    eventId: asEventId('evt-child-assistant-completed'),
    provider: 'codex',
    createdAt: now,
    threadId: childThreadId,
    turnId: childTurnId,
    itemId: asRuntimeItemId('msg-child'),
    payload: {
      itemType: 'assistant_message',
      status: 'completed',
      detail: 'Reviewing the provider ingestion path now.',
    },
  })
  harness.emit({
    type: 'turn.completed',
    eventId: asEventId('evt-child-turn-completed'),
    provider: 'codex',
    createdAt: now,
    threadId: childThreadId,
    turnId: childTurnId,
    payload: { state: 'completed' },
  })
}

async function assertCodexSubagentThread(
  harness: Awaited<ReturnType<typeof createHarness>>,
  childThreadId: ReturnType<typeof asThreadId>
) {
  const parentThread = await waitForThread(
    harness.engine,
    entry =>
      entry.id === 'thread-1' &&
      entry.activities.some(activity => activity.summary === 'Delegated to Code Reviewer')
  )
  const childThread = await waitForThread(
    harness.engine,
    entry =>
      entry.id === childThreadId &&
      entry.messages.some(
        message =>
          message.role === 'user' &&
          message.text === 'Inspect the orchestration layers and summarize the routing gaps.'
      ) &&
      entry.messages.some(
        message =>
          message.role === 'assistant' &&
          message.text.includes('Reviewing the provider ingestion path now.')
      ) &&
      entry.session?.providerThreadId === 'child_provider_1' &&
      entry.session?.status === 'ready',
    2000,
    childThreadId
  )

  expect(
    parentThread.activities.some(activity => activity.summary === 'Delegated to Code Reviewer')
  ).toBe(true)
  expect(childThread.title).toBe('Code Reviewer')
  expect(childThread.modelSelection).toEqual({
    provider: 'codex',
    model: 'gpt-5-codex',
  })
  expect(childThread.parentLink).toMatchObject({
    parentThreadId: 'thread-1',
    relationKind: 'subagent',
    parentTurnId: 'turn-parent',
    provider: 'codex',
    providerChildThreadId: 'child_provider_1',
    agentLabel: 'code-reviewer',
  })
}

async function primeOpencodeParentThread(
  harness: Awaited<ReturnType<typeof createHarness>>,
  now: string
) {
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.meta.update',
      commandId: asCommandId('cmd-opencode-thread-meta'),
      threadId: PARENT_THREAD_ID,
      modelSelection: {
        provider: 'opencode',
        model: 'anthropic/claude-sonnet-4-5',
        agentId: 'build',
      },
    })
  )
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.session.set',
      commandId: asCommandId('cmd-opencode-thread-session'),
      threadId: PARENT_THREAD_ID,
      session: {
        threadId: PARENT_THREAD_ID,
        status: 'running',
        providerName: 'opencode',
        providerSessionId: 'sess-root',
        providerThreadId: 'sess-root',
        runtimeMode: 'approval-required',
        activeTurnId: asTurnId('turn-root'),
        lastError: null,
        updatedAt: now,
      },
      createdAt: now,
    })
  )
  harness.setProviderSession({
    provider: 'opencode',
    status: 'running',
    runtimeMode: 'approval-required',
    threadId: PARENT_THREAD_ID,
    providerSessionId: 'sess-root',
    providerThreadId: 'sess-root',
    createdAt: now,
    updatedAt: now,
  })
}

function createOpencodeSubtaskEvent(now: string): ProviderRuntimeEvent {
  return {
    type: 'item.started',
    eventId: asEventId('evt-opencode-subtask-started'),
    provider: 'opencode',
    createdAt: now,
    threadId: PARENT_THREAD_ID,
    turnId: OPENCODE_ROOT_TURN_ID,
    itemId: asRuntimeItemId('item-opencode-subtask'),
    payload: {
      itemType: 'collab_agent_tool_call',
      status: 'inProgress',
      title: 'review',
      detail: OPENCODE_DELEGATED_DESCRIPTION,
      data: {
        item: {
          agent_label: 'review',
          prompt: OPENCODE_DELEGATED_PROMPT,
          description: OPENCODE_DELEGATED_DESCRIPTION,
          model: {
            providerID: 'anthropic',
            modelID: 'claude-sonnet-4-5',
          },
        },
      },
    },
    raw: {
      source: 'opencode.sdk.event',
      messageType: 'message.part.updated',
      payload: {
        sessionID: 'sess-root',
        part: {
          id: 'part-subtask-1',
          sessionID: 'sess-root',
          messageID: 'msg-parent-1',
          type: 'subtask',
          prompt: OPENCODE_DELEGATED_PROMPT,
          description: OPENCODE_DELEGATED_DESCRIPTION,
          agent: 'review',
          model: {
            providerID: 'anthropic',
            modelID: 'claude-sonnet-4-5',
          },
        },
        time: 1,
      },
    },
  }
}

function createOpencodeChildSessionCreatedEvent(now: string): ProviderRuntimeEvent {
  return {
    type: 'session.started',
    eventId: asEventId('evt-opencode-child-session-created'),
    provider: 'opencode',
    createdAt: now,
    threadId: PARENT_THREAD_ID,
    payload: {
      message: 'opencode session sess-child-1 created',
    },
    raw: {
      source: 'opencode.sdk.event',
      messageType: 'session.created',
      payload: {
        sessionID: OPENCODE_CHILD_THREAD_ID,
        info: {
          id: OPENCODE_CHILD_THREAD_ID,
          slug: 'review-child',
          projectID: 'proj-1',
          directory: '/tmp/opencode-child',
          parentID: 'sess-root',
          title: 'Review task',
          version: '1.0.0',
          time: { created: 1, updated: 1 },
        },
        delegation: {
          prompt: OPENCODE_DELEGATED_PROMPT,
          description: OPENCODE_DELEGATED_DESCRIPTION,
          agentLabel: 'review',
          modelSelection: {
            provider: 'opencode',
            model: 'anthropic/claude-sonnet-4-5',
            agentId: 'review',
          },
        },
      },
    },
  }
}

function emitOpencodeChildBootstrap(
  harness: Awaited<ReturnType<typeof createHarness>>,
  now: string
) {
  harness.emit(createOpencodeSubtaskEvent(now))
  harness.emit(createOpencodeChildSessionCreatedEvent(now))
}

async function assertOpencodeSubagentThread(
  harness: Awaited<ReturnType<typeof createHarness>>,
  childThreadId: ReturnType<typeof asThreadId>
) {
  const parentThread = await waitForThread(
    harness.engine,
    entry =>
      entry.id === 'thread-1' &&
      entry.activities.some(activity => activity.summary === 'Delegating to Review')
  )
  const childThread = await waitForThread(
    harness.engine,
    entry =>
      entry.id === childThreadId &&
      entry.messages.some(
        message =>
          message.role === 'user' &&
          message.text === 'Inspect the provider runtime and summarize the session-routing gaps.'
      ) &&
      entry.session?.status === 'running' &&
      entry.session?.activeTurnId === opencodeChildTurnId('sess-child-1'),
    2000,
    childThreadId
  )

  expect(
    parentThread.activities.some(activity => activity.summary === 'Delegating to Review')
  ).toBe(true)
  expect(parentThread.activities.some(activity => activity.summary === 'Subagent update')).toBe(
    false
  )
  expect(childThread.session?.providerThreadId).toBe('sess-child-1')
  expect(childThread.session?.providerSessionId).toBe('sess-child-1')
  expect(childThread.session?.status).toBe('running')
  expect(childThread.session?.activeTurnId).toBe(opencodeChildTurnId('sess-child-1'))
  expect(childThread.title).toBe('Review')
  expect(childThread.modelSelection).toEqual({
    provider: 'opencode',
    model: 'anthropic/claude-sonnet-4-5',
    agentId: 'review',
  })
  expect(childThread.parentLink).toMatchObject({
    parentThreadId: 'thread-1',
    relationKind: 'subagent',
    provider: 'opencode',
    providerChildThreadId: 'sess-child-1',
    agentLabel: 'review',
  })
}

function createOpencodeChildSessionUpdatedEvent(now: string): ProviderRuntimeEvent {
  return {
    type: 'session.state.changed',
    eventId: asEventId('evt-opencode-child-session-updated'),
    provider: 'opencode',
    createdAt: now,
    threadId: PARENT_THREAD_ID,
    payload: {
      state: 'running',
    },
    raw: {
      source: 'opencode.sdk.event',
      messageType: 'session.updated',
      payload: {
        sessionID: OPENCODE_CHILD_THREAD_ID,
        info: {
          id: OPENCODE_CHILD_THREAD_ID,
          slug: 'review-child',
          projectID: 'proj-1',
          directory: '/tmp/opencode-child',
          parentID: 'sess-root',
          title: 'Review task',
          version: '1.0.0',
          time: { created: 1, updated: 2 },
        },
      },
    },
  }
}

it('creates and populates Codex subagent child threads from collaboration tool calls', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()
  const childThreadId = asThreadId('codex-child:thread-1:child_provider_1')

  emitCodexSubagentLifecycle(harness, now, childThreadId)
  await assertCodexSubagentThread(harness, childThreadId)
})

it('creates and populates Opencode subagent child threads from child session events', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()
  const childThreadId = asThreadId('opencode-child:thread-1:sess-child-1')

  await primeOpencodeParentThread(harness, now)
  emitOpencodeChildBootstrap(harness, now)
  await assertOpencodeSubagentThread(harness, childThreadId)
})

it('fills Opencode child thread prompt and subagent label from parent delegation activity', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()
  const childThreadId = asThreadId('opencode-child:thread-1:sess-child-1')

  await primeOpencodeParentThread(harness, now)
  harness.emit(createOpencodeSubtaskEvent(now))
  harness.emit(createOpencodeChildSessionUpdatedEvent(now))

  const childThread = await waitForThread(
    harness.engine,
    entry =>
      entry.id === childThreadId &&
      entry.title === 'Review' &&
      entry.messages.some(
        message => message.role === 'user' && message.text === OPENCODE_DELEGATED_PROMPT
      ) &&
      entry.modelSelection.provider === 'opencode' &&
      entry.modelSelection.agentId === 'review',
    2000,
    childThreadId
  )

  expect(childThread.parentLink).toMatchObject({
    parentThreadId: 'thread-1',
    relationKind: 'subagent',
    agentLabel: 'review',
  })
})
