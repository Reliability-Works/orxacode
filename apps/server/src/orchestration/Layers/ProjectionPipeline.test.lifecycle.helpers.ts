import {
  CheckpointRef,
  CommandId,
  CorrelationId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
} from '@orxa-code/contracts'
import { assert } from '@effect/vitest'
import { Effect } from 'effect'
import * as SqlClient from 'effect/unstable/sql/SqlClient'

import { OrchestrationEventStore } from '../../persistence/Services/OrchestrationEventStore.ts'
import { OrchestrationProjectionPipeline } from '../Services/ProjectionPipeline.ts'
import { makeAppendAndProject } from './ProjectionPipeline.test.shared.helpers.ts'

// ---------------- keepAssistantTextOnEmptyCompletion ----------------

function* seedEmptyCompletionProjectAndThread(now: string) {
  const eventStore = yield* OrchestrationEventStore

  yield* eventStore.append({
    type: 'project.created',
    eventId: EventId.makeUnsafe('evt-empty-1'),
    aggregateKind: 'project',
    aggregateId: ProjectId.makeUnsafe('project-empty'),
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-empty-1'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-empty-1'),
    metadata: {},
    payload: {
      projectId: ProjectId.makeUnsafe('project-empty'),
      title: 'Project Empty',
      workspaceRoot: '/tmp/project-empty',
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  })

  yield* eventStore.append({
    type: 'thread.created',
    eventId: EventId.makeUnsafe('evt-empty-2'),
    aggregateKind: 'thread',
    aggregateId: ThreadId.makeUnsafe('thread-empty'),
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-empty-2'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-empty-2'),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe('thread-empty'),
      projectId: ProjectId.makeUnsafe('project-empty'),
      title: 'Thread Empty',
      modelSelection: { provider: 'codex', model: 'gpt-5-codex' },
      runtimeMode: 'full-access',
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
    },
  })
}

function* seedEmptyCompletionMessages(now: string) {
  const eventStore = yield* OrchestrationEventStore

  yield* eventStore.append({
    type: 'thread.message-sent',
    eventId: EventId.makeUnsafe('evt-empty-3'),
    aggregateKind: 'thread',
    aggregateId: ThreadId.makeUnsafe('thread-empty'),
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-empty-3'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-empty-3'),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe('thread-empty'),
      messageId: MessageId.makeUnsafe('assistant-empty'),
      role: 'assistant',
      text: 'Hello',
      turnId: null,
      streaming: true,
      createdAt: now,
      updatedAt: now,
    },
  })

  yield* eventStore.append({
    type: 'thread.message-sent',
    eventId: EventId.makeUnsafe('evt-empty-4'),
    aggregateKind: 'thread',
    aggregateId: ThreadId.makeUnsafe('thread-empty'),
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-empty-4'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-empty-4'),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe('thread-empty'),
      messageId: MessageId.makeUnsafe('assistant-empty'),
      role: 'assistant',
      text: ' world',
      turnId: null,
      streaming: true,
      createdAt: now,
      updatedAt: now,
    },
  })

  yield* eventStore.append({
    type: 'thread.message-sent',
    eventId: EventId.makeUnsafe('evt-empty-5'),
    aggregateKind: 'thread',
    aggregateId: ThreadId.makeUnsafe('thread-empty'),
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-empty-5'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-empty-5'),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe('thread-empty'),
      messageId: MessageId.makeUnsafe('assistant-empty'),
      role: 'assistant',
      text: '',
      turnId: null,
      streaming: false,
      createdAt: now,
      updatedAt: now,
    },
  })
}

function* assertEmptyCompletionRow() {
  const sql = yield* SqlClient.SqlClient
  const messageRows = yield* sql<{
    readonly text: string
    readonly isStreaming: unknown
  }>`
    SELECT
      text,
      is_streaming AS "isStreaming"
    FROM projection_thread_messages
    WHERE message_id = 'assistant-empty'
  `
  assert.equal(messageRows.length, 1)
  assert.equal(messageRows[0]?.text, 'Hello world')
  assert.isFalse(Boolean(messageRows[0]?.isStreaming))
}

export function* keepAssistantTextOnEmptyCompletionProgram() {
  const projectionPipeline = yield* OrchestrationProjectionPipeline
  const now = new Date().toISOString()
  yield* seedEmptyCompletionProjectAndThread(now)
  yield* seedEmptyCompletionMessages(now)
  yield* projectionPipeline.bootstrap
  yield* assertEmptyCompletionRow()
}

export const keepAssistantTextOnEmptyCompletionEffect = () =>
  Effect.gen(keepAssistantTextOnEmptyCompletionProgram)

// ---------------- resolveTurnCountConflicts (inline arrow at 1014) ----------------

function* seedConflictProjectAndThread() {
  const appendAndProject = yield* makeAppendAndProject()

  yield* appendAndProject({
    type: 'project.created',
    eventId: EventId.makeUnsafe('evt-conflict-1'),
    aggregateKind: 'project',
    aggregateId: ProjectId.makeUnsafe('project-conflict'),
    occurredAt: '2026-02-26T13:00:00.000Z',
    commandId: CommandId.makeUnsafe('cmd-conflict-1'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-conflict-1'),
    metadata: {},
    payload: {
      projectId: ProjectId.makeUnsafe('project-conflict'),
      title: 'Project Conflict',
      workspaceRoot: '/tmp/project-conflict',
      defaultModelSelection: null,
      scripts: [],
      createdAt: '2026-02-26T13:00:00.000Z',
      updatedAt: '2026-02-26T13:00:00.000Z',
    },
  })

  yield* appendAndProject({
    type: 'thread.created',
    eventId: EventId.makeUnsafe('evt-conflict-2'),
    aggregateKind: 'thread',
    aggregateId: ThreadId.makeUnsafe('thread-conflict'),
    occurredAt: '2026-02-26T13:00:01.000Z',
    commandId: CommandId.makeUnsafe('cmd-conflict-2'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-conflict-2'),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe('thread-conflict'),
      projectId: ProjectId.makeUnsafe('project-conflict'),
      title: 'Thread Conflict',
      modelSelection: { provider: 'codex', model: 'gpt-5-codex' },
      runtimeMode: 'full-access',
      branch: null,
      worktreePath: null,
      createdAt: '2026-02-26T13:00:01.000Z',
      updatedAt: '2026-02-26T13:00:01.000Z',
    },
  })
}

function* seedConflictTurnInterruptAndCompletion() {
  const appendAndProject = yield* makeAppendAndProject()

  yield* appendAndProject({
    type: 'thread.turn-interrupt-requested',
    eventId: EventId.makeUnsafe('evt-conflict-3'),
    aggregateKind: 'thread',
    aggregateId: ThreadId.makeUnsafe('thread-conflict'),
    occurredAt: '2026-02-26T13:00:02.000Z',
    commandId: CommandId.makeUnsafe('cmd-conflict-3'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-conflict-3'),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe('thread-conflict'),
      turnId: TurnId.makeUnsafe('turn-interrupted'),
      createdAt: '2026-02-26T13:00:02.000Z',
    },
  })

  yield* appendAndProject({
    type: 'thread.message-sent',
    eventId: EventId.makeUnsafe('evt-conflict-4'),
    aggregateKind: 'thread',
    aggregateId: ThreadId.makeUnsafe('thread-conflict'),
    occurredAt: '2026-02-26T13:00:03.000Z',
    commandId: CommandId.makeUnsafe('cmd-conflict-4'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-conflict-4'),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe('thread-conflict'),
      messageId: MessageId.makeUnsafe('assistant-conflict'),
      role: 'assistant',
      text: 'done',
      turnId: TurnId.makeUnsafe('turn-completed'),
      streaming: false,
      createdAt: '2026-02-26T13:00:03.000Z',
      updatedAt: '2026-02-26T13:00:03.000Z',
    },
  })

  yield* appendAndProject({
    type: 'thread.turn-diff-completed',
    eventId: EventId.makeUnsafe('evt-conflict-5'),
    aggregateKind: 'thread',
    aggregateId: ThreadId.makeUnsafe('thread-conflict'),
    occurredAt: '2026-02-26T13:00:04.000Z',
    commandId: CommandId.makeUnsafe('cmd-conflict-5'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-conflict-5'),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe('thread-conflict'),
      turnId: TurnId.makeUnsafe('turn-completed'),
      checkpointTurnCount: 1,
      checkpointRef: CheckpointRef.makeUnsafe('refs/orxacode/checkpoints/thread-conflict/turn/1'),
      status: 'ready',
      files: [],
      assistantMessageId: MessageId.makeUnsafe('assistant-conflict'),
      completedAt: '2026-02-26T13:00:04.000Z',
    },
  })
}

function* assertConflictTurnRows() {
  const sql = yield* SqlClient.SqlClient
  const turnRows = yield* sql<{
    readonly turnId: string
    readonly checkpointTurnCount: number | null
    readonly status: string
  }>`
    SELECT
      turn_id AS "turnId",
      checkpoint_turn_count AS "checkpointTurnCount",
      state AS "status"
    FROM projection_turns
    WHERE thread_id = 'thread-conflict'
    ORDER BY
      CASE
        WHEN checkpoint_turn_count IS NULL THEN 1
        ELSE 0
      END ASC,
      checkpoint_turn_count ASC,
      requested_at ASC
  `
  assert.deepEqual(turnRows, [
    { turnId: 'turn-completed', checkpointTurnCount: 1, status: 'completed' },
    { turnId: 'turn-interrupted', checkpointTurnCount: null, status: 'interrupted' },
  ])
}

export function* resolveTurnCountConflictsProgram() {
  yield* seedConflictProjectAndThread()
  yield* seedConflictTurnInterruptAndCompletion()
  yield* assertConflictTurnRows()
}

export const resolveTurnCountConflictsEffect = () => Effect.gen(resolveTurnCountConflictsProgram)

// ---------------- doesNotFallbackRetainMessages (inline arrow at 1160) ----------------

function* seedRevertMessagesProjectAndThread() {
  const appendAndProject = yield* makeAppendAndProject()

  yield* appendAndProject({
    type: 'project.created',
    eventId: EventId.makeUnsafe('evt-revert-1'),
    aggregateKind: 'project',
    aggregateId: ProjectId.makeUnsafe('project-revert'),
    occurredAt: '2026-02-26T12:00:00.000Z',
    commandId: CommandId.makeUnsafe('cmd-revert-1'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-revert-1'),
    metadata: {},
    payload: {
      projectId: ProjectId.makeUnsafe('project-revert'),
      title: 'Project Revert',
      workspaceRoot: '/tmp/project-revert',
      defaultModelSelection: null,
      scripts: [],
      createdAt: '2026-02-26T12:00:00.000Z',
      updatedAt: '2026-02-26T12:00:00.000Z',
    },
  })

  yield* appendAndProject({
    type: 'thread.created',
    eventId: EventId.makeUnsafe('evt-revert-2'),
    aggregateKind: 'thread',
    aggregateId: ThreadId.makeUnsafe('thread-revert'),
    occurredAt: '2026-02-26T12:00:01.000Z',
    commandId: CommandId.makeUnsafe('cmd-revert-2'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-revert-2'),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe('thread-revert'),
      projectId: ProjectId.makeUnsafe('project-revert'),
      title: 'Thread Revert',
      modelSelection: { provider: 'codex', model: 'gpt-5-codex' },
      runtimeMode: 'full-access',
      branch: null,
      worktreePath: null,
      createdAt: '2026-02-26T12:00:01.000Z',
      updatedAt: '2026-02-26T12:00:01.000Z',
    },
  })
}

function* seedRevertMessagesKeepTurn() {
  const appendAndProject = yield* makeAppendAndProject()

  yield* appendAndProject({
    type: 'thread.turn-diff-completed',
    eventId: EventId.makeUnsafe('evt-revert-3'),
    aggregateKind: 'thread',
    aggregateId: ThreadId.makeUnsafe('thread-revert'),
    occurredAt: '2026-02-26T12:00:02.000Z',
    commandId: CommandId.makeUnsafe('cmd-revert-3'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-revert-3'),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe('thread-revert'),
      turnId: TurnId.makeUnsafe('turn-1'),
      checkpointTurnCount: 1,
      checkpointRef: CheckpointRef.makeUnsafe('refs/orxacode/checkpoints/thread-revert/turn/1'),
      status: 'ready',
      files: [],
      assistantMessageId: MessageId.makeUnsafe('assistant-keep'),
      completedAt: '2026-02-26T12:00:02.000Z',
    },
  })

  yield* appendAndProject({
    type: 'thread.message-sent',
    eventId: EventId.makeUnsafe('evt-revert-4'),
    aggregateKind: 'thread',
    aggregateId: ThreadId.makeUnsafe('thread-revert'),
    occurredAt: '2026-02-26T12:00:02.100Z',
    commandId: CommandId.makeUnsafe('cmd-revert-4'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-revert-4'),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe('thread-revert'),
      messageId: MessageId.makeUnsafe('assistant-keep'),
      role: 'assistant',
      text: 'kept',
      turnId: TurnId.makeUnsafe('turn-1'),
      streaming: false,
      createdAt: '2026-02-26T12:00:02.100Z',
      updatedAt: '2026-02-26T12:00:02.100Z',
    },
  })
}

function* seedRevertMessagesRemoveTurn() {
  const appendAndProject = yield* makeAppendAndProject()

  yield* appendAndProject({
    type: 'thread.turn-diff-completed',
    eventId: EventId.makeUnsafe('evt-revert-5'),
    aggregateKind: 'thread',
    aggregateId: ThreadId.makeUnsafe('thread-revert'),
    occurredAt: '2026-02-26T12:00:03.000Z',
    commandId: CommandId.makeUnsafe('cmd-revert-5'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-revert-5'),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe('thread-revert'),
      turnId: TurnId.makeUnsafe('turn-2'),
      checkpointTurnCount: 2,
      checkpointRef: CheckpointRef.makeUnsafe('refs/orxacode/checkpoints/thread-revert/turn/2'),
      status: 'ready',
      files: [],
      assistantMessageId: MessageId.makeUnsafe('assistant-remove'),
      completedAt: '2026-02-26T12:00:03.000Z',
    },
  })

  yield* appendAndProject({
    type: 'thread.message-sent',
    eventId: EventId.makeUnsafe('evt-revert-6'),
    aggregateKind: 'thread',
    aggregateId: ThreadId.makeUnsafe('thread-revert'),
    occurredAt: '2026-02-26T12:00:03.050Z',
    commandId: CommandId.makeUnsafe('cmd-revert-6'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-revert-6'),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe('thread-revert'),
      messageId: MessageId.makeUnsafe('user-remove'),
      role: 'user',
      text: 'removed',
      turnId: TurnId.makeUnsafe('turn-2'),
      streaming: false,
      createdAt: '2026-02-26T12:00:03.050Z',
      updatedAt: '2026-02-26T12:00:03.050Z',
    },
  })

  yield* appendAndProject({
    type: 'thread.message-sent',
    eventId: EventId.makeUnsafe('evt-revert-7'),
    aggregateKind: 'thread',
    aggregateId: ThreadId.makeUnsafe('thread-revert'),
    occurredAt: '2026-02-26T12:00:03.100Z',
    commandId: CommandId.makeUnsafe('cmd-revert-7'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-revert-7'),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe('thread-revert'),
      messageId: MessageId.makeUnsafe('assistant-remove'),
      role: 'assistant',
      text: 'removed',
      turnId: TurnId.makeUnsafe('turn-2'),
      streaming: false,
      createdAt: '2026-02-26T12:00:03.100Z',
      updatedAt: '2026-02-26T12:00:03.100Z',
    },
  })
}

function* dispatchRevertMessagesAndAssert() {
  const appendAndProject = yield* makeAppendAndProject()
  yield* appendAndProject({
    type: 'thread.reverted',
    eventId: EventId.makeUnsafe('evt-revert-8'),
    aggregateKind: 'thread',
    aggregateId: ThreadId.makeUnsafe('thread-revert'),
    occurredAt: '2026-02-26T12:00:04.000Z',
    commandId: CommandId.makeUnsafe('cmd-revert-8'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-revert-8'),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe('thread-revert'),
      turnCount: 1,
    },
  })

  const sql = yield* SqlClient.SqlClient
  const messageRows = yield* sql<{
    readonly messageId: string
    readonly turnId: string | null
    readonly role: string
  }>`
    SELECT
      message_id AS "messageId",
      turn_id AS "turnId",
      role
    FROM projection_thread_messages
    WHERE thread_id = 'thread-revert'
    ORDER BY created_at ASC, message_id ASC
  `
  assert.deepEqual(messageRows, [
    {
      messageId: 'assistant-keep',
      turnId: 'turn-1',
      role: 'assistant',
    },
  ])
}

export function* doesNotFallbackRetainRevertedMessagesProgram() {
  yield* seedRevertMessagesProjectAndThread()
  yield* seedRevertMessagesKeepTurn()
  yield* seedRevertMessagesRemoveTurn()
  yield* dispatchRevertMessagesAndAssert()
}

export const doesNotFallbackRetainRevertedMessagesEffect = () =>
  Effect.gen(doesNotFallbackRetainRevertedMessagesProgram)
