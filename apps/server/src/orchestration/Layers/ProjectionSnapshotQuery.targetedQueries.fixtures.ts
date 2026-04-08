import { Effect } from 'effect'
import * as SqlClient from 'effect/unstable/sql/SqlClient'

import { clearProjectionTables } from './ProjectionSnapshotQuery.test.helpers.ts'

const insertTargetedProjects = Effect.gen(function* () {
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
    VALUES
      (
        'project-active',
        'Active Project',
        '/tmp/workspace',
        '{"provider":"codex","model":"gpt-5-codex"}',
        '[]',
        '2026-03-01T00:00:00.000Z',
        '2026-03-01T00:00:01.000Z',
        NULL
      ),
      (
        'project-deleted',
        'Deleted Project',
        '/tmp/deleted',
        NULL,
        '[]',
        '2026-03-01T00:00:02.000Z',
        '2026-03-01T00:00:03.000Z',
        '2026-03-01T00:00:04.000Z'
      )
  `
})

const insertTargetedThreads = Effect.gen(function* () {
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
    VALUES
      (
        'thread-first',
        'project-active',
        'First Thread',
        '{"provider":"codex","model":"gpt-5-codex"}',
        'full-access',
        'default',
        NULL,
        NULL,
        NULL,
        '2026-03-01T00:00:05.000Z',
        '2026-03-01T00:00:06.000Z',
        NULL,
        NULL
      ),
      (
        'thread-second',
        'project-active',
        'Second Thread',
        '{"provider":"codex","model":"gpt-5-codex"}',
        'full-access',
        'default',
        NULL,
        NULL,
        NULL,
        '2026-03-01T00:00:07.000Z',
        '2026-03-01T00:00:08.000Z',
        NULL,
        NULL
      ),
      (
        'thread-deleted',
        'project-active',
        'Deleted Thread',
        '{"provider":"codex","model":"gpt-5-codex"}',
        'full-access',
        'default',
        NULL,
        NULL,
        NULL,
        '2026-03-01T00:00:09.000Z',
        '2026-03-01T00:00:10.000Z',
        NULL,
        '2026-03-01T00:00:11.000Z'
      )
  `
})

export const seedTargetedQueryFixture = Effect.gen(function* () {
  yield* clearProjectionTables(['projection_projects', 'projection_threads', 'projection_turns'])
  yield* insertTargetedProjects
  yield* insertTargetedThreads
})
