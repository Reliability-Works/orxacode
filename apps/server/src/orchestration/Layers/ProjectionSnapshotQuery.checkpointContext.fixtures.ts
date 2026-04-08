import { ThreadId } from '@orxa-code/contracts'
import { Effect } from 'effect'
import * as SqlClient from 'effect/unstable/sql/SqlClient'

import type { ProjectionThreadCheckpointContext } from '../Services/ProjectionSnapshotQuery.ts'
import {
  asCheckpointRef,
  asProjectId,
  asTurnId,
  clearProjectionTables,
} from './ProjectionSnapshotQuery.test.helpers.ts'

const insertCheckpointContextProject = Effect.gen(function* () {
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
      'project-context',
      'Context Project',
      '/tmp/context-workspace',
      NULL,
      '[]',
      '2026-03-02T00:00:00.000Z',
      '2026-03-02T00:00:01.000Z',
      NULL
    )
  `
})

const insertCheckpointContextThread = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    INSERT INTO projection_threads (
      thread_id,
      project_id,
      title,
      model_selection_json,
      runtime_mode,
      interaction_mode,
      branch,
      worktree_path,
      latest_turn_id,
      created_at,
      updated_at,
      archived_at,
      deleted_at
    )
    VALUES (
      'thread-context',
      'project-context',
      'Context Thread',
      '{"provider":"codex","model":"gpt-5-codex"}',
      'full-access',
      'default',
      'feature/perf',
      '/tmp/context-worktree',
      NULL,
      '2026-03-02T00:00:02.000Z',
      '2026-03-02T00:00:03.000Z',
      NULL,
      NULL
    )
  `
})

const insertCheckpointContextTurns = Effect.gen(function* () {
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
    VALUES
      (
        'thread-context',
        'turn-1',
        NULL,
        NULL,
        NULL,
        NULL,
        'completed',
        '2026-03-02T00:00:04.000Z',
        '2026-03-02T00:00:04.000Z',
        '2026-03-02T00:00:04.000Z',
        1,
        'checkpoint-a',
        'ready',
        '[]'
      ),
      (
        'thread-context',
        'turn-2',
        NULL,
        NULL,
        NULL,
        NULL,
        'completed',
        '2026-03-02T00:00:05.000Z',
        '2026-03-02T00:00:05.000Z',
        '2026-03-02T00:00:05.000Z',
        2,
        'checkpoint-b',
        'ready',
        '[]'
      )
  `
})

export const seedCheckpointContextFixture = Effect.gen(function* () {
  yield* clearProjectionTables(['projection_projects', 'projection_threads', 'projection_turns'])
  yield* insertCheckpointContextProject
  yield* insertCheckpointContextThread
  yield* insertCheckpointContextTurns
})

export const expectedCheckpointContext: ProjectionThreadCheckpointContext = {
  threadId: ThreadId.makeUnsafe('thread-context'),
  projectId: asProjectId('project-context'),
  workspaceRoot: '/tmp/context-workspace',
  worktreePath: '/tmp/context-worktree',
  checkpoints: [
    {
      turnId: asTurnId('turn-1'),
      checkpointTurnCount: 1,
      checkpointRef: asCheckpointRef('checkpoint-a'),
      status: 'ready',
      files: [],
      assistantMessageId: null,
      completedAt: '2026-03-02T00:00:04.000Z',
    },
    {
      turnId: asTurnId('turn-2'),
      checkpointTurnCount: 2,
      checkpointRef: asCheckpointRef('checkpoint-b'),
      status: 'ready',
      files: [],
      assistantMessageId: null,
      completedAt: '2026-03-02T00:00:05.000Z',
    },
  ],
}
