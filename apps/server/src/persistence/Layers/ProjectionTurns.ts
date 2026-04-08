import { OrchestrationCheckpointFile } from '@orxa-code/contracts'
import * as SqlClient from 'effect/unstable/sql/SqlClient'
import * as SqlSchema from 'effect/unstable/sql/SqlSchema'
import { Effect, Layer, Option, Schema, Struct } from 'effect'

import { toPersistenceSqlError, toPersistenceSqlOrDecodeError } from '../Errors.ts'
import { passThroughOptionalRow } from './ProjectionShared.ts'
import {
  ClearCheckpointTurnConflictInput,
  DeleteProjectionTurnsByThreadInput,
  GetProjectionPendingTurnStartInput,
  GetProjectionTurnByTurnIdInput,
  ListProjectionTurnsByThreadInput,
  ProjectionPendingTurnStart,
  ProjectionTurn,
  ProjectionTurnById,
  ProjectionTurnRepository,
  type ProjectionTurnRepositoryShape,
} from '../Services/ProjectionTurns.ts'

const ProjectionTurnDbRowSchema = ProjectionTurn.mapFields(
  Struct.assign({
    checkpointFiles: Schema.fromJsonString(Schema.Array(OrchestrationCheckpointFile)),
  })
)

const ProjectionTurnByIdDbRowSchema = ProjectionTurnById.mapFields(
  Struct.assign({
    checkpointFiles: Schema.fromJsonString(Schema.Array(OrchestrationCheckpointFile)),
  })
)

function createUpsertProjectionTurnById(sql: SqlClient.SqlClient) {
  return SqlSchema.void({
    Request: ProjectionTurnByIdDbRowSchema,
    execute: row =>
      sql`
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
          ${row.threadId},
          ${row.turnId},
          ${row.pendingMessageId},
          ${row.sourceProposedPlanThreadId},
          ${row.sourceProposedPlanId},
          ${row.assistantMessageId},
          ${row.state},
          ${row.requestedAt},
          ${row.startedAt},
          ${row.completedAt},
          ${row.checkpointTurnCount},
          ${row.checkpointRef},
          ${row.checkpointStatus},
          ${row.checkpointFiles}
        )
        ON CONFLICT (thread_id, turn_id)
        DO UPDATE SET
          pending_message_id = excluded.pending_message_id,
          source_proposed_plan_thread_id = excluded.source_proposed_plan_thread_id,
          source_proposed_plan_id = excluded.source_proposed_plan_id,
          assistant_message_id = excluded.assistant_message_id,
          state = excluded.state,
          requested_at = excluded.requested_at,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          checkpoint_turn_count = excluded.checkpoint_turn_count,
          checkpoint_ref = excluded.checkpoint_ref,
          checkpoint_status = excluded.checkpoint_status,
          checkpoint_files_json = excluded.checkpoint_files_json
      `,
  })
}

function createClearPendingProjectionTurnsByThread(sql: SqlClient.SqlClient) {
  return SqlSchema.void({
    Request: DeleteProjectionTurnsByThreadInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_turns
        WHERE thread_id = ${threadId}
          AND turn_id IS NULL
          AND state = 'pending'
          AND checkpoint_turn_count IS NULL
      `,
  })
}

function createInsertPendingProjectionTurn(sql: SqlClient.SqlClient) {
  return SqlSchema.void({
    Request: ProjectionPendingTurnStart,
    execute: row =>
      sql`
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
          ${row.threadId},
          NULL,
          ${row.messageId},
          ${row.sourceProposedPlanThreadId},
          ${row.sourceProposedPlanId},
          NULL,
          'pending',
          ${row.requestedAt},
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          '[]'
        )
      `,
  })
}

function createGetPendingProjectionTurn(sql: SqlClient.SqlClient) {
  return SqlSchema.findOneOption({
    Request: GetProjectionPendingTurnStartInput,
    Result: ProjectionPendingTurnStart,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          pending_message_id AS "messageId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId",
          requested_at AS "requestedAt"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND turn_id IS NULL
          AND state = 'pending'
          AND pending_message_id IS NOT NULL
          AND checkpoint_turn_count IS NULL
        ORDER BY requested_at DESC
        LIMIT 1
      `,
  })
}

function createListProjectionTurnsByThread(sql: SqlClient.SqlClient) {
  return SqlSchema.findAll({
    Request: ListProjectionTurnsByThreadInput,
    Result: ProjectionTurnDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          pending_message_id AS "pendingMessageId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId",
          assistant_message_id AS "assistantMessageId",
          state,
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "checkpointStatus",
          checkpoint_files_json AS "checkpointFiles"
        FROM projection_turns
        WHERE thread_id = ${threadId}
        ORDER BY
          CASE
            WHEN checkpoint_turn_count IS NULL THEN 1
            ELSE 0
          END ASC,
          checkpoint_turn_count ASC,
          requested_at ASC,
          turn_id ASC
      `,
  })
}

function createGetProjectionTurnByTurnId(sql: SqlClient.SqlClient) {
  return SqlSchema.findOneOption({
    Request: GetProjectionTurnByTurnIdInput,
    Result: ProjectionTurnByIdDbRowSchema,
    execute: ({ threadId, turnId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          pending_message_id AS "pendingMessageId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId",
          assistant_message_id AS "assistantMessageId",
          state,
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "checkpointStatus",
          checkpoint_files_json AS "checkpointFiles"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND turn_id = ${turnId}
        LIMIT 1
      `,
  })
}

function createClearCheckpointTurnConflictRow(sql: SqlClient.SqlClient) {
  return SqlSchema.void({
    Request: ClearCheckpointTurnConflictInput,
    execute: ({ threadId, turnId, checkpointTurnCount }) =>
      sql`
        UPDATE projection_turns
        SET
          checkpoint_turn_count = NULL,
          checkpoint_ref = NULL,
          checkpoint_status = NULL,
          checkpoint_files_json = '[]'
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count = ${checkpointTurnCount}
          AND (turn_id IS NULL OR turn_id <> ${turnId})
      `,
  })
}

function createDeleteProjectionTurnsByThread(sql: SqlClient.SqlClient) {
  return SqlSchema.void({
    Request: DeleteProjectionTurnsByThreadInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_turns
        WHERE thread_id = ${threadId}
      `,
  })
}

interface ProjectionTurnRepositoryQueries {
  readonly sql: SqlClient.SqlClient
  readonly upsertProjectionTurnById: ReturnType<typeof createUpsertProjectionTurnById>
  readonly clearPendingProjectionTurnsByThread: ReturnType<
    typeof createClearPendingProjectionTurnsByThread
  >
  readonly insertPendingProjectionTurn: ReturnType<typeof createInsertPendingProjectionTurn>
  readonly getPendingProjectionTurn: ReturnType<typeof createGetPendingProjectionTurn>
  readonly listProjectionTurnsByThread: ReturnType<typeof createListProjectionTurnsByThread>
  readonly getProjectionTurnByTurnId: ReturnType<typeof createGetProjectionTurnByTurnId>
  readonly clearCheckpointTurnConflictRow: ReturnType<typeof createClearCheckpointTurnConflictRow>
  readonly deleteProjectionTurnsByThread: ReturnType<typeof createDeleteProjectionTurnsByThread>
}

function createPendingTurnMethods(
  queries: ProjectionTurnRepositoryQueries
): Pick<
  ProjectionTurnRepositoryShape,
  'replacePendingTurnStart' | 'getPendingTurnStartByThreadId' | 'deletePendingTurnStartByThreadId'
> {
  const {
    sql,
    clearPendingProjectionTurnsByThread,
    insertPendingProjectionTurn,
    getPendingProjectionTurn,
  } = queries

  return {
    replacePendingTurnStart: row =>
      sql
        .withTransaction(
          clearPendingProjectionTurnsByThread({ threadId: row.threadId }).pipe(
            Effect.flatMap(() => insertPendingProjectionTurn(row))
          )
        )
        .pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              'ProjectionTurnRepository.replacePendingTurnStart:query',
              'ProjectionTurnRepository.replacePendingTurnStart:encodeRequest'
            )
          )
        ),
    getPendingTurnStartByThreadId: input =>
      getPendingProjectionTurn(input).pipe(
        Effect.mapError(
          toPersistenceSqlError('ProjectionTurnRepository.getPendingTurnStartByThreadId:query')
        )
      ),
    deletePendingTurnStartByThreadId: input =>
      clearPendingProjectionTurnsByThread(input).pipe(
        Effect.mapError(
          toPersistenceSqlError('ProjectionTurnRepository.deletePendingTurnStartByThreadId:query')
        )
      ),
  }
}

function createTurnLookupMethods(
  queries: ProjectionTurnRepositoryQueries
): Pick<ProjectionTurnRepositoryShape, 'upsertByTurnId' | 'listByThreadId' | 'getByTurnId'> {
  const { upsertProjectionTurnById, listProjectionTurnsByThread, getProjectionTurnByTurnId } =
    queries

  return {
    upsertByTurnId: row =>
      upsertProjectionTurnById(row).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            'ProjectionTurnRepository.upsertByTurnId:query',
            'ProjectionTurnRepository.upsertByTurnId:encodeRequest'
          )
        )
      ),
    listByThreadId: input =>
      listProjectionTurnsByThread(input).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            'ProjectionTurnRepository.listByThreadId:query',
            'ProjectionTurnRepository.listByThreadId:decodeRows'
          )
        ),
        Effect.map(rows => rows as ReadonlyArray<Schema.Schema.Type<typeof ProjectionTurn>>)
      ),
    getByTurnId: input =>
      getProjectionTurnByTurnId(input).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            'ProjectionTurnRepository.getByTurnId:query',
            'ProjectionTurnRepository.getByTurnId:decodeRow'
          )
        ),
        Effect.flatMap(rowOption =>
          passThroughOptionalRow(
            rowOption as Option.Option<Schema.Schema.Type<typeof ProjectionTurnById>>
          )
        )
      ),
  }
}

function createTurnCleanupMethods(
  queries: ProjectionTurnRepositoryQueries
): Pick<ProjectionTurnRepositoryShape, 'clearCheckpointTurnConflict' | 'deleteByThreadId'> {
  const { clearCheckpointTurnConflictRow, deleteProjectionTurnsByThread } = queries

  return {
    clearCheckpointTurnConflict: input =>
      clearCheckpointTurnConflictRow(input).pipe(
        Effect.mapError(
          toPersistenceSqlError('ProjectionTurnRepository.clearCheckpointTurnConflict:query')
        )
      ),
    deleteByThreadId: input =>
      deleteProjectionTurnsByThread(input).pipe(
        Effect.mapError(toPersistenceSqlError('ProjectionTurnRepository.deleteByThreadId:query'))
      ),
  }
}

function createProjectionTurnRepositoryShape(
  queries: ProjectionTurnRepositoryQueries
): ProjectionTurnRepositoryShape {
  return {
    ...createTurnLookupMethods(queries),
    ...createPendingTurnMethods(queries),
    ...createTurnCleanupMethods(queries),
  } satisfies ProjectionTurnRepositoryShape
}

const makeProjectionTurnRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  return createProjectionTurnRepositoryShape({
    sql,
    upsertProjectionTurnById: createUpsertProjectionTurnById(sql),
    clearPendingProjectionTurnsByThread: createClearPendingProjectionTurnsByThread(sql),
    insertPendingProjectionTurn: createInsertPendingProjectionTurn(sql),
    getPendingProjectionTurn: createGetPendingProjectionTurn(sql),
    listProjectionTurnsByThread: createListProjectionTurnsByThread(sql),
    getProjectionTurnByTurnId: createGetProjectionTurnByTurnId(sql),
    clearCheckpointTurnConflictRow: createClearCheckpointTurnConflictRow(sql),
    deleteProjectionTurnsByThread: createDeleteProjectionTurnsByThread(sql),
  })
})

export const ProjectionTurnRepositoryLive = Layer.effect(
  ProjectionTurnRepository,
  makeProjectionTurnRepository
)
