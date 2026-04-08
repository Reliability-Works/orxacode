import type { OrchestrationEvent } from '@orxa-code/contracts'

import { makeEvent } from './projector.test.helpers.ts'

function makePruningFirstTurnMessageEvents(): ReadonlyArray<OrchestrationEvent> {
  return [
    makeEvent({
      sequence: 2,
      type: 'thread.message-sent',
      aggregateKind: 'thread',
      aggregateId: 'thread-1',
      occurredAt: '2026-02-23T10:00:01.000Z',
      commandId: 'cmd-user-1',
      payload: {
        threadId: 'thread-1',
        messageId: 'user-msg-1',
        role: 'user',
        text: 'First edit',
        turnId: null,
        streaming: false,
        createdAt: '2026-02-23T10:00:01.000Z',
        updatedAt: '2026-02-23T10:00:01.000Z',
      },
    }),
    makeEvent({
      sequence: 3,
      type: 'thread.message-sent',
      aggregateKind: 'thread',
      aggregateId: 'thread-1',
      occurredAt: '2026-02-23T10:00:02.000Z',
      commandId: 'cmd-assistant-1',
      payload: {
        threadId: 'thread-1',
        messageId: 'assistant-msg-1',
        role: 'assistant',
        text: 'Updated README to v2.\n',
        turnId: 'turn-1',
        streaming: false,
        createdAt: '2026-02-23T10:00:02.000Z',
        updatedAt: '2026-02-23T10:00:02.000Z',
      },
    }),
  ]
}

function makePruningFirstTurnMetadataEvents(): ReadonlyArray<OrchestrationEvent> {
  return [
    makeEvent({
      sequence: 4,
      type: 'thread.turn-diff-completed',
      aggregateKind: 'thread',
      aggregateId: 'thread-1',
      occurredAt: '2026-02-23T10:00:02.500Z',
      commandId: 'cmd-turn-1-complete',
      payload: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        checkpointTurnCount: 1,
        checkpointRef: 'refs/orxacode/checkpoints/thread-1/turn/1',
        status: 'ready',
        files: [],
        assistantMessageId: 'assistant-msg-1',
        completedAt: '2026-02-23T10:00:02.500Z',
      },
    }),
    makeEvent({
      sequence: 5,
      type: 'thread.activity-appended',
      aggregateKind: 'thread',
      aggregateId: 'thread-1',
      occurredAt: '2026-02-23T10:00:02.750Z',
      commandId: 'cmd-activity-1',
      payload: {
        threadId: 'thread-1',
        activity: {
          id: 'activity-1',
          tone: 'tool',
          kind: 'tool.started',
          summary: 'Edit file started',
          payload: { toolKind: 'command' },
          turnId: 'turn-1',
          createdAt: '2026-02-23T10:00:02.750Z',
        },
      },
    }),
  ]
}

function makePruningSecondTurnMessageEvents(): ReadonlyArray<OrchestrationEvent> {
  return [
    makeEvent({
      sequence: 6,
      type: 'thread.message-sent',
      aggregateKind: 'thread',
      aggregateId: 'thread-1',
      occurredAt: '2026-02-23T10:00:03.000Z',
      commandId: 'cmd-user-2',
      payload: {
        threadId: 'thread-1',
        messageId: 'user-msg-2',
        role: 'user',
        text: 'Second edit',
        turnId: null,
        streaming: false,
        createdAt: '2026-02-23T10:00:03.000Z',
        updatedAt: '2026-02-23T10:00:03.000Z',
      },
    }),
    makeEvent({
      sequence: 7,
      type: 'thread.message-sent',
      aggregateKind: 'thread',
      aggregateId: 'thread-1',
      occurredAt: '2026-02-23T10:00:04.000Z',
      commandId: 'cmd-assistant-2',
      payload: {
        threadId: 'thread-1',
        messageId: 'assistant-msg-2',
        role: 'assistant',
        text: 'Updated README to v3.\n',
        turnId: 'turn-2',
        streaming: false,
        createdAt: '2026-02-23T10:00:04.000Z',
        updatedAt: '2026-02-23T10:00:04.000Z',
      },
    }),
  ]
}

function makePruningSecondTurnMetadataEvents(): ReadonlyArray<OrchestrationEvent> {
  return [
    makeEvent({
      sequence: 8,
      type: 'thread.turn-diff-completed',
      aggregateKind: 'thread',
      aggregateId: 'thread-1',
      occurredAt: '2026-02-23T10:00:04.500Z',
      commandId: 'cmd-turn-2-complete',
      payload: {
        threadId: 'thread-1',
        turnId: 'turn-2',
        checkpointTurnCount: 2,
        checkpointRef: 'refs/orxacode/checkpoints/thread-1/turn/2',
        status: 'ready',
        files: [],
        assistantMessageId: 'assistant-msg-2',
        completedAt: '2026-02-23T10:00:04.500Z',
      },
    }),
    makeEvent({
      sequence: 9,
      type: 'thread.activity-appended',
      aggregateKind: 'thread',
      aggregateId: 'thread-1',
      occurredAt: '2026-02-23T10:00:04.750Z',
      commandId: 'cmd-activity-2',
      payload: {
        threadId: 'thread-1',
        activity: {
          id: 'activity-2',
          tone: 'tool',
          kind: 'tool.completed',
          summary: 'Edit file complete',
          payload: { toolKind: 'command' },
          turnId: 'turn-2',
          createdAt: '2026-02-23T10:00:04.750Z',
        },
      },
    }),
    makeEvent({
      sequence: 10,
      type: 'thread.reverted',
      aggregateKind: 'thread',
      aggregateId: 'thread-1',
      occurredAt: '2026-02-23T10:00:05.000Z',
      commandId: 'cmd-revert',
      payload: {
        threadId: 'thread-1',
        turnCount: 1,
      },
    }),
  ]
}

export function makePruningRevertEvents(): ReadonlyArray<OrchestrationEvent> {
  return [
    ...makePruningFirstTurnMessageEvents(),
    ...makePruningFirstTurnMetadataEvents(),
    ...makePruningSecondTurnMessageEvents(),
    ...makePruningSecondTurnMetadataEvents(),
  ]
}

function makeRemovedTurnCheckpointEvents(): ReadonlyArray<OrchestrationEvent> {
  return [
    makeEvent({
      sequence: 2,
      type: 'thread.turn-diff-completed',
      aggregateKind: 'thread',
      aggregateId: 'thread-revert',
      occurredAt: '2026-02-26T12:00:01.000Z',
      commandId: 'cmd-turn-1',
      payload: {
        threadId: 'thread-revert',
        turnId: 'turn-1',
        checkpointTurnCount: 1,
        checkpointRef: 'refs/orxacode/checkpoints/thread-revert/turn/1',
        status: 'ready',
        files: [],
        assistantMessageId: 'assistant-keep',
        completedAt: '2026-02-26T12:00:01.000Z',
      },
    }),
    makeEvent({
      sequence: 3,
      type: 'thread.message-sent',
      aggregateKind: 'thread',
      aggregateId: 'thread-revert',
      occurredAt: '2026-02-26T12:00:01.100Z',
      commandId: 'cmd-assistant-keep',
      payload: {
        threadId: 'thread-revert',
        messageId: 'assistant-keep',
        role: 'assistant',
        text: 'kept',
        turnId: 'turn-1',
        streaming: false,
        createdAt: '2026-02-26T12:00:01.100Z',
        updatedAt: '2026-02-26T12:00:01.100Z',
      },
    }),
    makeEvent({
      sequence: 4,
      type: 'thread.turn-diff-completed',
      aggregateKind: 'thread',
      aggregateId: 'thread-revert',
      occurredAt: '2026-02-26T12:00:02.000Z',
      commandId: 'cmd-turn-2',
      payload: {
        threadId: 'thread-revert',
        turnId: 'turn-2',
        checkpointTurnCount: 2,
        checkpointRef: 'refs/orxacode/checkpoints/thread-revert/turn/2',
        status: 'ready',
        files: [],
        assistantMessageId: 'assistant-remove',
        completedAt: '2026-02-26T12:00:02.000Z',
      },
    }),
  ]
}

function makeRemovedTurnMessageEvents(): ReadonlyArray<OrchestrationEvent> {
  return [
    makeEvent({
      sequence: 5,
      type: 'thread.message-sent',
      aggregateKind: 'thread',
      aggregateId: 'thread-revert',
      occurredAt: '2026-02-26T12:00:02.050Z',
      commandId: 'cmd-user-remove',
      payload: {
        threadId: 'thread-revert',
        messageId: 'user-remove',
        role: 'user',
        text: 'removed',
        turnId: 'turn-2',
        streaming: false,
        createdAt: '2026-02-26T12:00:02.050Z',
        updatedAt: '2026-02-26T12:00:02.050Z',
      },
    }),
    makeEvent({
      sequence: 6,
      type: 'thread.message-sent',
      aggregateKind: 'thread',
      aggregateId: 'thread-revert',
      occurredAt: '2026-02-26T12:00:02.100Z',
      commandId: 'cmd-assistant-remove',
      payload: {
        threadId: 'thread-revert',
        messageId: 'assistant-remove',
        role: 'assistant',
        text: 'removed',
        turnId: 'turn-2',
        streaming: false,
        createdAt: '2026-02-26T12:00:02.100Z',
        updatedAt: '2026-02-26T12:00:02.100Z',
      },
    }),
    makeEvent({
      sequence: 7,
      type: 'thread.reverted',
      aggregateKind: 'thread',
      aggregateId: 'thread-revert',
      occurredAt: '2026-02-26T12:00:03.000Z',
      commandId: 'cmd-revert',
      payload: {
        threadId: 'thread-revert',
        turnCount: 1,
      },
    }),
  ]
}

export function makeRemovedTurnRevertEvents(): ReadonlyArray<OrchestrationEvent> {
  return [...makeRemovedTurnCheckpointEvents(), ...makeRemovedTurnMessageEvents()]
}
