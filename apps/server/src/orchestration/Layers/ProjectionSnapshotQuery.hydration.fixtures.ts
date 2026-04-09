import { ThreadId, type OrchestrationReadModel } from '@orxa-code/contracts'
import { Effect } from 'effect'
import * as SqlClient from 'effect/unstable/sql/SqlClient'

import {
  asCheckpointRef,
  asEventId,
  asMessageId,
  asProjectId,
  asTurnId,
  clearProjectionTables,
} from './ProjectionSnapshotQuery.test.helpers.ts'
import { ORCHESTRATION_PROJECTOR_NAMES } from './ProjectionPipeline.ts'

const insertHydratedProject = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    INSERT INTO projection_projects (
      project_id,
      title,
      workspace_root,
      default_model_selection_json,
      scripts_json,
      created_at,
      updated_at,
      deleted_at
    )
    VALUES (
      'project-1',
      'Project 1',
      '/tmp/project-1',
      '{"provider":"codex","model":"gpt-5-codex"}',
      '[{"id":"script-1","name":"Build","command":"bun run build","icon":"build","runOnWorktreeCreate":false}]',
      '2026-02-24T00:00:00.000Z',
      '2026-02-24T00:00:01.000Z',
      NULL
    )
  `
})

const insertHydratedThread = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    INSERT INTO projection_threads (
      thread_id,
      project_id,
      title,
      model_selection_json,
      branch,
      worktree_path,
      handoff_json,
      latest_turn_id,
      created_at,
      updated_at,
      deleted_at
    )
    VALUES (
      'thread-1',
      'project-1',
      'Thread 1',
      '{"provider":"codex","model":"gpt-5-codex"}',
      NULL,
      NULL,
      NULL,
      'turn-1',
      '2026-02-24T00:00:02.000Z',
      '2026-02-24T00:00:03.000Z',
      NULL
    )
  `
})

const insertHydratedMessage = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    INSERT INTO projection_thread_messages (
      message_id,
      thread_id,
      turn_id,
      role,
      text,
      is_streaming,
      created_at,
      updated_at
    )
    VALUES (
      'message-1',
      'thread-1',
      'turn-1',
      'assistant',
      'hello from projection',
      0,
      '2026-02-24T00:00:04.000Z',
      '2026-02-24T00:00:05.000Z'
    )
  `
})

const insertHydratedPlan = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    INSERT INTO projection_thread_proposed_plans (
      plan_id,
      thread_id,
      turn_id,
      plan_markdown,
      implemented_at,
      implementation_thread_id,
      created_at,
      updated_at
    )
    VALUES (
      'plan-1',
      'thread-1',
      'turn-1',
      '# Ship it',
      '2026-02-24T00:00:05.500Z',
      'thread-2',
      '2026-02-24T00:00:05.000Z',
      '2026-02-24T00:00:05.500Z'
    )
  `
})

const insertHydratedActivity = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    INSERT INTO projection_thread_activities (
      activity_id,
      thread_id,
      turn_id,
      tone,
      kind,
      summary,
      payload_json,
      created_at
    )
    VALUES (
      'activity-1',
      'thread-1',
      'turn-1',
      'info',
      'runtime.note',
      'provider started',
      '{"stage":"start"}',
      '2026-02-24T00:00:06.000Z'
    )
  `
})

const insertHydratedSession = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    INSERT INTO projection_thread_sessions (
      thread_id,
      status,
      provider_name,
      provider_session_id,
      provider_thread_id,
      runtime_mode,
      active_turn_id,
      last_error,
      updated_at
    )
    VALUES (
      'thread-1',
      'running',
      'codex',
      'provider-session-1',
      'provider-thread-1',
      'approval-required',
      'turn-1',
      NULL,
      '2026-02-24T00:00:07.000Z'
    )
  `
})

const insertHydratedTurn = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    INSERT INTO projection_turns (
      thread_id,
      turn_id,
      pending_message_id,
      source_proposed_plan_thread_id,
      source_proposed_plan_id,
      assistant_message_id,
      state,
      requested_at,
      started_at,
      completed_at,
      checkpoint_turn_count,
      checkpoint_ref,
      checkpoint_status,
      checkpoint_files_json
    )
    VALUES (
      'thread-1',
      'turn-1',
      NULL,
      'thread-1',
      'plan-1',
      'message-1',
      'completed',
      '2026-02-24T00:00:08.000Z',
      '2026-02-24T00:00:08.000Z',
      '2026-02-24T00:00:08.000Z',
      1,
      'checkpoint-1',
      'ready',
      '[{"path":"README.md","kind":"modified","additions":2,"deletions":1}]'
    )
  `
})

const insertProjectionStateRows = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  let sequence = 5
  for (const projector of Object.values(ORCHESTRATION_PROJECTOR_NAMES)) {
    yield* sql`
      INSERT INTO projection_state (
        projector,
        last_applied_sequence,
        updated_at
      )
      VALUES (
        ${projector},
        ${sequence},
        '2026-02-24T00:00:09.000Z'
      )
    `
    sequence += 1
  }
})

export const seedHydratedSnapshotFixture = Effect.gen(function* () {
  yield* clearProjectionTables([
    'projection_projects',
    'projection_state',
    'projection_thread_proposed_plans',
    'projection_turns',
  ])
  yield* insertHydratedProject
  yield* insertHydratedThread
  yield* insertHydratedMessage
  yield* insertHydratedPlan
  yield* insertHydratedActivity
  yield* insertHydratedSession
  yield* insertHydratedTurn
  yield* insertProjectionStateRows
})

export const expectedHydratedProjects: OrchestrationReadModel['projects'] = [
  {
    id: asProjectId('project-1'),
    title: 'Project 1',
    workspaceRoot: '/tmp/project-1',
    defaultModelSelection: {
      provider: 'codex',
      model: 'gpt-5-codex',
    },
    scripts: [
      {
        id: 'script-1',
        name: 'Build',
        command: 'bun run build',
        icon: 'build',
        runOnWorktreeCreate: false,
      },
    ],
    createdAt: '2026-02-24T00:00:00.000Z',
    updatedAt: '2026-02-24T00:00:01.000Z',
    deletedAt: null,
  },
]

export const expectedHydratedThreads: OrchestrationReadModel['threads'] = [
  {
    id: ThreadId.makeUnsafe('thread-1'),
    projectId: asProjectId('project-1'),
    title: 'Thread 1',
    modelSelection: {
      provider: 'codex',
      model: 'gpt-5-codex',
    },
    interactionMode: 'default',
    runtimeMode: 'full-access',
    branch: null,
    worktreePath: null,
    handoff: null,
    latestTurn: {
      turnId: asTurnId('turn-1'),
      state: 'completed',
      requestedAt: '2026-02-24T00:00:08.000Z',
      startedAt: '2026-02-24T00:00:08.000Z',
      completedAt: '2026-02-24T00:00:08.000Z',
      assistantMessageId: asMessageId('message-1'),
      sourceProposedPlan: {
        threadId: ThreadId.makeUnsafe('thread-1'),
        planId: 'plan-1',
      },
    },
    createdAt: '2026-02-24T00:00:02.000Z',
    updatedAt: '2026-02-24T00:00:03.000Z',
    archivedAt: null,
    deletedAt: null,
    messages: [
      {
        id: asMessageId('message-1'),
        role: 'assistant',
        text: 'hello from projection',
        turnId: asTurnId('turn-1'),
        streaming: false,
        createdAt: '2026-02-24T00:00:04.000Z',
        updatedAt: '2026-02-24T00:00:05.000Z',
      },
    ],
    proposedPlans: [
      {
        id: 'plan-1',
        turnId: asTurnId('turn-1'),
        planMarkdown: '# Ship it',
        implementedAt: '2026-02-24T00:00:05.500Z',
        implementationThreadId: ThreadId.makeUnsafe('thread-2'),
        createdAt: '2026-02-24T00:00:05.000Z',
        updatedAt: '2026-02-24T00:00:05.500Z',
      },
    ],
    activities: [
      {
        id: asEventId('activity-1'),
        tone: 'info',
        kind: 'runtime.note',
        summary: 'provider started',
        payload: { stage: 'start' },
        turnId: asTurnId('turn-1'),
        createdAt: '2026-02-24T00:00:06.000Z',
      },
    ],
    checkpoints: [
      {
        turnId: asTurnId('turn-1'),
        checkpointTurnCount: 1,
        checkpointRef: asCheckpointRef('checkpoint-1'),
        status: 'ready',
        files: [{ path: 'README.md', kind: 'modified', additions: 2, deletions: 1 }],
        assistantMessageId: asMessageId('message-1'),
        completedAt: '2026-02-24T00:00:08.000Z',
      },
    ],
    session: {
      threadId: ThreadId.makeUnsafe('thread-1'),
      status: 'running',
      providerName: 'codex',
      runtimeMode: 'approval-required',
      activeTurnId: asTurnId('turn-1'),
      lastError: null,
      updatedAt: '2026-02-24T00:00:07.000Z',
    },
  },
]
