import {
  CommandId,
  CorrelationId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
} from '@orxa-code/contracts'
import { assert } from '@effect/vitest'
import { Effect, Path } from 'effect'
import * as SqlClient from 'effect/unstable/sql/SqlClient'

import { OrchestrationEventStore } from '../../persistence/Services/OrchestrationEventStore.ts'
import { OrchestrationProjectionPipeline } from '../Services/ProjectionPipeline.ts'
import { ServerConfig } from '../../config.ts'
import { exists, makeAppendAndProject } from './ProjectionPipeline.test.shared.helpers.ts'

interface SingleImageUserMessageInput {
  readonly eventTag: string
  readonly commandTag: string
  readonly threadId: string
  readonly messageId: string
  readonly text: string
  readonly attachmentId: string
  readonly attachmentName: string
  readonly occurredAt: string
  readonly createdAt: string
  readonly updatedAt: string
}

function buildSingleImageUserMessageEvent(input: SingleImageUserMessageInput) {
  return {
    type: 'thread.message-sent' as const,
    eventId: EventId.makeUnsafe(input.eventTag),
    aggregateKind: 'thread' as const,
    aggregateId: ThreadId.makeUnsafe(input.threadId),
    occurredAt: input.occurredAt,
    commandId: CommandId.makeUnsafe(input.commandTag),
    causationEventId: null,
    correlationId: CommandId.makeUnsafe(input.commandTag),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe(input.threadId),
      messageId: MessageId.makeUnsafe(input.messageId),
      role: 'user' as const,
      text: input.text,
      attachments: [
        {
          type: 'image' as const,
          id: input.attachmentId,
          name: input.attachmentName,
          mimeType: 'image/png',
          sizeBytes: 5,
        },
      ],
      turnId: null,
      streaming: false,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    },
  }
}

// ---------------- passThroughEmptyAttachments ----------------

function* seedClearAttachmentsProjectAndThread(now: string) {
  const eventStore = yield* OrchestrationEventStore

  yield* eventStore.append({
    type: 'project.created',
    eventId: EventId.makeUnsafe('evt-clear-attachments-1'),
    aggregateKind: 'project',
    aggregateId: ProjectId.makeUnsafe('project-clear-attachments'),
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-clear-attachments-1'),
    causationEventId: null,
    correlationId: CommandId.makeUnsafe('cmd-clear-attachments-1'),
    metadata: {},
    payload: {
      projectId: ProjectId.makeUnsafe('project-clear-attachments'),
      title: 'Project Clear Attachments',
      workspaceRoot: '/tmp/project-clear-attachments',
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  })

  yield* eventStore.append({
    type: 'thread.created',
    eventId: EventId.makeUnsafe('evt-clear-attachments-2'),
    aggregateKind: 'thread',
    aggregateId: ThreadId.makeUnsafe('thread-clear-attachments'),
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-clear-attachments-2'),
    causationEventId: null,
    correlationId: CommandId.makeUnsafe('cmd-clear-attachments-2'),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe('thread-clear-attachments'),
      projectId: ProjectId.makeUnsafe('project-clear-attachments'),
      title: 'Thread Clear Attachments',
      modelSelection: { provider: 'codex', model: 'gpt-5-codex' },
      runtimeMode: 'full-access',
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
    },
  })
}

function* seedClearAttachmentsMessages(now: string, later: string) {
  const eventStore = yield* OrchestrationEventStore

  yield* eventStore.append(
    buildSingleImageUserMessageEvent({
      eventTag: 'evt-clear-attachments-3',
      commandTag: 'cmd-clear-attachments-3',
      threadId: 'thread-clear-attachments',
      messageId: 'message-clear-attachments',
      text: 'Has attachments',
      attachmentId: 'thread-clear-attachments-att-1',
      attachmentName: 'clear.png',
      occurredAt: now,
      createdAt: now,
      updatedAt: now,
    })
  )

  yield* eventStore.append({
    type: 'thread.message-sent',
    eventId: EventId.makeUnsafe('evt-clear-attachments-4'),
    aggregateKind: 'thread',
    aggregateId: ThreadId.makeUnsafe('thread-clear-attachments'),
    occurredAt: later,
    commandId: CommandId.makeUnsafe('cmd-clear-attachments-4'),
    causationEventId: null,
    correlationId: CommandId.makeUnsafe('cmd-clear-attachments-4'),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe('thread-clear-attachments'),
      messageId: MessageId.makeUnsafe('message-clear-attachments'),
      role: 'user',
      text: '',
      attachments: [],
      turnId: null,
      streaming: false,
      createdAt: now,
      updatedAt: later,
    },
  })
}

function* assertClearedAttachmentsRow() {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ readonly attachmentsJson: string | null }>`
    SELECT
      attachments_json AS "attachmentsJson"
    FROM projection_thread_messages
    WHERE message_id = 'message-clear-attachments'
  `
  assert.equal(rows.length, 1)
  assert.deepEqual(JSON.parse(rows[0]?.attachmentsJson ?? 'null'), [])
}

export function* passThroughEmptyAttachmentsProgram() {
  const projectionPipeline = yield* OrchestrationProjectionPipeline
  const now = new Date().toISOString()
  const later = new Date(Date.now() + 1_000).toISOString()
  yield* seedClearAttachmentsProjectAndThread(now)
  yield* seedClearAttachmentsMessages(now, later)
  yield* projectionPipeline.bootstrap
  yield* assertClearedAttachmentsRow()
}

export const passThroughEmptyAttachmentsEffect = () =>
  Effect.gen(passThroughEmptyAttachmentsProgram)

// ---------------- overwriteAttachmentReferences ----------------

function* seedOverwriteProjectAndThread(now: string) {
  const eventStore = yield* OrchestrationEventStore

  yield* eventStore.append({
    type: 'project.created',
    eventId: EventId.makeUnsafe('evt-overwrite-1'),
    aggregateKind: 'project',
    aggregateId: ProjectId.makeUnsafe('project-overwrite'),
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-overwrite-1'),
    causationEventId: null,
    correlationId: CommandId.makeUnsafe('cmd-overwrite-1'),
    metadata: {},
    payload: {
      projectId: ProjectId.makeUnsafe('project-overwrite'),
      title: 'Project Overwrite',
      workspaceRoot: '/tmp/project-overwrite',
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  })

  yield* eventStore.append({
    type: 'thread.created',
    eventId: EventId.makeUnsafe('evt-overwrite-2'),
    aggregateKind: 'thread',
    aggregateId: ThreadId.makeUnsafe('thread-overwrite'),
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-overwrite-2'),
    causationEventId: null,
    correlationId: CommandId.makeUnsafe('cmd-overwrite-2'),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe('thread-overwrite'),
      projectId: ProjectId.makeUnsafe('project-overwrite'),
      title: 'Thread Overwrite',
      modelSelection: { provider: 'codex', model: 'gpt-5-codex' },
      runtimeMode: 'full-access',
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
    },
  })
}

function* seedOverwriteMessages(now: string, later: string) {
  const eventStore = yield* OrchestrationEventStore

  yield* eventStore.append(
    buildSingleImageUserMessageEvent({
      eventTag: 'evt-overwrite-3',
      commandTag: 'cmd-overwrite-3',
      threadId: 'thread-overwrite',
      messageId: 'message-overwrite',
      text: 'first image',
      attachmentId: 'thread-overwrite-att-1',
      attachmentName: 'file.png',
      occurredAt: now,
      createdAt: now,
      updatedAt: now,
    })
  )

  yield* eventStore.append({
    type: 'thread.message-sent',
    eventId: EventId.makeUnsafe('evt-overwrite-4'),
    aggregateKind: 'thread',
    aggregateId: ThreadId.makeUnsafe('thread-overwrite'),
    occurredAt: later,
    commandId: CommandId.makeUnsafe('cmd-overwrite-4'),
    causationEventId: null,
    correlationId: CommandId.makeUnsafe('cmd-overwrite-4'),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe('thread-overwrite'),
      messageId: MessageId.makeUnsafe('message-overwrite'),
      role: 'user',
      text: '',
      attachments: [
        {
          type: 'image',
          id: 'thread-overwrite-att-2',
          name: 'file.png',
          mimeType: 'image/png',
          sizeBytes: 5,
        },
      ],
      turnId: null,
      streaming: false,
      createdAt: now,
      updatedAt: later,
    },
  })
}

function* assertOverwriteAttachmentRow() {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ readonly attachmentsJson: string | null }>`
    SELECT attachments_json AS "attachmentsJson"
    FROM projection_thread_messages
    WHERE message_id = 'message-overwrite'
  `
  assert.equal(rows.length, 1)
  assert.deepEqual(JSON.parse(rows[0]?.attachmentsJson ?? 'null'), [
    {
      type: 'image',
      id: 'thread-overwrite-att-2',
      name: 'file.png',
      mimeType: 'image/png',
      sizeBytes: 5,
    },
  ])
}

export function* overwriteAttachmentReferencesProgram() {
  const projectionPipeline = yield* OrchestrationProjectionPipeline
  const now = new Date().toISOString()
  const later = new Date(Date.now() + 1_000).toISOString()
  yield* seedOverwriteProjectAndThread(now)
  yield* seedOverwriteMessages(now, later)
  yield* projectionPipeline.bootstrap
  yield* assertOverwriteAttachmentRow()
}

export const overwriteAttachmentReferencesEffect = () =>
  Effect.gen(overwriteAttachmentReferencesProgram)

// ---------------- rollbackAttachmentProjection ----------------

function* seedRollbackProjectAndThread(now: string) {
  const appendAndProject = yield* makeAppendAndProject()

  yield* appendAndProject({
    type: 'project.created',
    eventId: EventId.makeUnsafe('evt-rollback-1'),
    aggregateKind: 'project',
    aggregateId: ProjectId.makeUnsafe('project-rollback'),
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-rollback-1'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-rollback-1'),
    metadata: {},
    payload: {
      projectId: ProjectId.makeUnsafe('project-rollback'),
      title: 'Project Rollback',
      workspaceRoot: '/tmp/project-rollback',
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  })

  yield* appendAndProject({
    type: 'thread.created',
    eventId: EventId.makeUnsafe('evt-rollback-2'),
    aggregateKind: 'thread',
    aggregateId: ThreadId.makeUnsafe('thread-rollback'),
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-rollback-2'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-rollback-2'),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe('thread-rollback'),
      projectId: ProjectId.makeUnsafe('project-rollback'),
      title: 'Thread Rollback',
      modelSelection: { provider: 'codex', model: 'gpt-5-codex' },
      runtimeMode: 'full-access',
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
    },
  })
}

function* installRollbackTrigger() {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    CREATE TRIGGER fail_thread_messages_projection_state_update
    BEFORE UPDATE ON projection_state
    WHEN NEW.projector = 'projection.thread-messages'
    BEGIN
      SELECT RAISE(ABORT, 'forced-projection-state-failure');
    END;
  `
}

function* attemptRollbackMessageAppend(now: string) {
  const appendAndProject = yield* makeAppendAndProject()
  const result = yield* Effect.result(
    appendAndProject({
      type: 'thread.message-sent',
      eventId: EventId.makeUnsafe('evt-rollback-3'),
      aggregateKind: 'thread',
      aggregateId: ThreadId.makeUnsafe('thread-rollback'),
      occurredAt: now,
      commandId: CommandId.makeUnsafe('cmd-rollback-3'),
      causationEventId: null,
      correlationId: CorrelationId.makeUnsafe('cmd-rollback-3'),
      metadata: {},
      payload: {
        threadId: ThreadId.makeUnsafe('thread-rollback'),
        messageId: MessageId.makeUnsafe('message-rollback'),
        role: 'user',
        text: 'Rollback me',
        attachments: [
          {
            type: 'image',
            id: 'thread-rollback-att-1',
            name: 'rollback.png',
            mimeType: 'image/png',
            sizeBytes: 5,
          },
        ],
        turnId: null,
        streaming: false,
        createdAt: now,
        updatedAt: now,
      },
    })
  )
  assert.equal(result._tag, 'Failure')
}

function* assertRollbackArtifactsAbsent() {
  const sql = yield* SqlClient.SqlClient
  const path = yield* Path.Path
  const rows = yield* sql<{ readonly count: number }>`
    SELECT COUNT(*) AS "count"
    FROM projection_thread_messages
    WHERE message_id = 'message-rollback'
  `
  assert.equal(rows[0]?.count ?? 0, 0)

  const { attachmentsDir } = yield* ServerConfig
  const attachmentPath = path.join(attachmentsDir, 'thread-rollback-att-1.png')
  assert.isFalse(yield* exists(attachmentPath))
  yield* sql`DROP TRIGGER IF EXISTS fail_thread_messages_projection_state_update`
}

export function* rollbackAttachmentProjectionProgram() {
  const now = new Date().toISOString()
  yield* seedRollbackProjectAndThread(now)
  yield* installRollbackTrigger()
  yield* attemptRollbackMessageAppend(now)
  yield* assertRollbackArtifactsAbsent()
}

export const rollbackAttachmentProjectionEffect = () =>
  Effect.gen(rollbackAttachmentProjectionProgram)
