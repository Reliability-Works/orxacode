import {
  CommandId,
  CorrelationId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
} from '@orxa-code/contracts'
import { assert } from '@effect/vitest'
import { Effect } from 'effect'
import * as SqlClient from 'effect/unstable/sql/SqlClient'

import type { OrchestrationEventStoreShape } from '../../persistence/Services/OrchestrationEventStore.ts'
import { OrchestrationEventStore } from '../../persistence/Services/OrchestrationEventStore.ts'

interface AppendThreadCreatedInput {
  readonly eventId: string
  readonly commandId: string
  readonly correlationId: string
  readonly projectId: string
  readonly threadId: string
  readonly title: string
  readonly now: string
}

function appendThreadCreated(
  eventStore: OrchestrationEventStoreShape,
  input: AppendThreadCreatedInput
) {
  return eventStore.append({
    type: 'thread.created',
    eventId: EventId.makeUnsafe(input.eventId),
    aggregateKind: 'thread',
    aggregateId: ThreadId.makeUnsafe(input.threadId),
    occurredAt: input.now,
    commandId: CommandId.makeUnsafe(input.commandId),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe(input.correlationId),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe(input.threadId),
      projectId: ProjectId.makeUnsafe(input.projectId),
      title: input.title,
      modelSelection: { provider: 'codex', model: 'gpt-5-codex' },
      runtimeMode: 'full-access',
      branch: null,
      worktreePath: null,
      createdAt: input.now,
      updatedAt: input.now,
    },
  })
}
import { ORCHESTRATION_PROJECTOR_NAMES } from './ProjectionPipeline.ts'
import { OrchestrationProjectionPipeline } from '../Services/ProjectionPipeline.ts'

function* seedBootstrapProjectionRowsEvents(now: string) {
  const eventStore = yield* OrchestrationEventStore

  yield* eventStore.append({
    type: 'project.created',
    eventId: EventId.makeUnsafe('evt-1'),
    aggregateKind: 'project',
    aggregateId: ProjectId.makeUnsafe('project-1'),
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-1'),
    causationEventId: null,
    correlationId: CommandId.makeUnsafe('cmd-1'),
    metadata: {},
    payload: {
      projectId: ProjectId.makeUnsafe('project-1'),
      title: 'Project 1',
      workspaceRoot: '/tmp/project-1',
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  })

  yield* appendThreadCreated(eventStore, {
    eventId: 'evt-2',
    commandId: 'cmd-2',
    correlationId: 'cmd-2',
    projectId: 'project-1',
    threadId: 'thread-1',
    title: 'Thread 1',
    now,
  })

  yield* eventStore.append({
    type: 'thread.message-sent',
    eventId: EventId.makeUnsafe('evt-3'),
    aggregateKind: 'thread',
    aggregateId: ThreadId.makeUnsafe('thread-1'),
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-3'),
    causationEventId: null,
    correlationId: CommandId.makeUnsafe('cmd-3'),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe('thread-1'),
      messageId: MessageId.makeUnsafe('message-1'),
      role: 'assistant',
      text: 'hello',
      turnId: null,
      streaming: false,
      createdAt: now,
      updatedAt: now,
    },
  })
}

function* assertBootstrapProjectionRows() {
  const sql = yield* SqlClient.SqlClient

  const projectRows = yield* sql<{
    readonly projectId: string
    readonly title: string
    readonly scriptsJson: string
  }>`
    SELECT
      project_id AS "projectId",
      title,
      scripts_json AS "scriptsJson"
    FROM projection_projects
  `
  assert.deepEqual(projectRows, [{ projectId: 'project-1', title: 'Project 1', scriptsJson: '[]' }])

  const messageRows = yield* sql<{
    readonly messageId: string
    readonly text: string
  }>`
    SELECT
      message_id AS "messageId",
      text
    FROM projection_thread_messages
  `
  assert.deepEqual(messageRows, [{ messageId: 'message-1', text: 'hello' }])

  const stateRows = yield* sql<{
    readonly projector: string
    readonly lastAppliedSequence: number
  }>`
    SELECT
      projector,
      last_applied_sequence AS "lastAppliedSequence"
    FROM projection_state
    ORDER BY projector ASC
  `
  assert.equal(stateRows.length, Object.keys(ORCHESTRATION_PROJECTOR_NAMES).length)
  for (const row of stateRows) {
    assert.equal(row.lastAppliedSequence, 3)
  }
}

export function* bootstrapProjectionRowsProgram() {
  const projectionPipeline = yield* OrchestrationProjectionPipeline
  const now = new Date().toISOString()
  yield* seedBootstrapProjectionRowsEvents(now)
  yield* projectionPipeline.bootstrap
  yield* assertBootstrapProjectionRows()
}

export const bootstrapProjectionRowsEffect = () => Effect.gen(bootstrapProjectionRowsProgram)

function* seedResumeProjectorEvents(now: string) {
  const eventStore = yield* OrchestrationEventStore

  yield* eventStore.append({
    type: 'project.created',
    eventId: EventId.makeUnsafe('evt-a1'),
    aggregateKind: 'project',
    aggregateId: ProjectId.makeUnsafe('project-a'),
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-a1'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-a1'),
    metadata: {},
    payload: {
      projectId: ProjectId.makeUnsafe('project-a'),
      title: 'Project A',
      workspaceRoot: '/tmp/project-a',
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  })

  yield* appendThreadCreated(eventStore, {
    eventId: 'evt-a2',
    commandId: 'cmd-a2',
    correlationId: 'cmd-a2',
    projectId: 'project-a',
    threadId: 'thread-a',
    title: 'Thread A',
    now,
  })

  yield* eventStore.append({
    type: 'thread.message-sent',
    eventId: EventId.makeUnsafe('evt-a3'),
    aggregateKind: 'thread',
    aggregateId: ThreadId.makeUnsafe('thread-a'),
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-a3'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-a3'),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe('thread-a'),
      messageId: MessageId.makeUnsafe('message-a'),
      role: 'assistant',
      text: 'hello',
      turnId: null,
      streaming: false,
      createdAt: now,
      updatedAt: now,
    },
  })
}

function* appendStreamingDeltaForResume(now: string) {
  const eventStore = yield* OrchestrationEventStore
  yield* eventStore.append({
    type: 'thread.message-sent',
    eventId: EventId.makeUnsafe('evt-a4'),
    aggregateKind: 'thread',
    aggregateId: ThreadId.makeUnsafe('thread-a'),
    occurredAt: now,
    commandId: CommandId.makeUnsafe('cmd-a4'),
    causationEventId: null,
    correlationId: CorrelationId.makeUnsafe('cmd-a4'),
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe('thread-a'),
      messageId: MessageId.makeUnsafe('message-a'),
      role: 'assistant',
      text: ' world',
      turnId: null,
      streaming: true,
      createdAt: now,
      updatedAt: now,
    },
  })
}

function* assertResumeProjectorRows() {
  const sql = yield* SqlClient.SqlClient
  const messageRows = yield* sql<{ readonly text: string }>`
    SELECT text FROM projection_thread_messages WHERE message_id = 'message-a'
  `
  assert.deepEqual(messageRows, [{ text: 'hello world' }])

  const stateRows = yield* sql<{
    readonly projector: string
    readonly lastAppliedSequence: number
  }>`
    SELECT
      projector,
      last_applied_sequence AS "lastAppliedSequence"
    FROM projection_state
  `
  const maxSequenceRows = yield* sql<{ readonly maxSequence: number }>`
    SELECT MAX(sequence) AS "maxSequence" FROM orchestration_events
  `
  const maxSequence = maxSequenceRows[0]?.maxSequence ?? 0
  for (const row of stateRows) {
    assert.equal(row.lastAppliedSequence, maxSequence)
  }
}

export function* resumeFromProjectorLastAppliedSequenceProgram() {
  const projectionPipeline = yield* OrchestrationProjectionPipeline
  const now = new Date().toISOString()
  yield* seedResumeProjectorEvents(now)
  yield* projectionPipeline.bootstrap
  yield* appendStreamingDeltaForResume(now)
  yield* projectionPipeline.bootstrap
  yield* projectionPipeline.bootstrap
  yield* assertResumeProjectorRows()
}

export const resumeFromProjectorLastAppliedSequenceEffect = () =>
  Effect.gen(resumeFromProjectorLastAppliedSequenceProgram)
