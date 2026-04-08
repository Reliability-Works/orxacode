import { Effect, Layer, Option, Schema, Struct } from 'effect'
import * as SqlClient from 'effect/unstable/sql/SqlClient'
import * as SqlSchema from 'effect/unstable/sql/SqlSchema'

import { OrchestrationCheckpointFile } from '@orxa-code/contracts'

import { passThroughOptionalRow } from './ProjectionShared.ts'
import { toPersistenceSqlError, toPersistenceSqlOrDecodeError } from '../Errors.ts'
import {
  DeleteByThreadIdInput,
  GetByThreadAndTurnCountInput,
  ListByThreadIdInput,
  ProjectionCheckpoint,
  ProjectionCheckpointRepository,
  type ProjectionCheckpointRepositoryShape,
} from '../Services/ProjectionCheckpoints.ts'

const ProjectionCheckpointDbRowSchema = ProjectionCheckpoint.mapFields(
  Struct.assign({
    files: Schema.fromJsonString(Schema.Array(OrchestrationCheckpointFile)),
  })
)

function makeClearCheckpointConflict(sql: SqlClient.SqlClient) {
  return SqlSchema.void({
    Request: GetByThreadAndTurnCountInput,
    execute: ({ threadId, checkpointTurnCount }) =>
      sql`
        UPDATE projection_turns
        SET
          checkpoint_turn_count = NULL,
          checkpoint_ref = NULL,
          checkpoint_status = NULL,
          checkpoint_files_json = '[]'
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count = ${checkpointTurnCount}
      `,
  })
}

function makeUpsertProjectionCheckpointRow(sql: SqlClient.SqlClient) {
  return SqlSchema.void({
    Request: ProjectionCheckpointDbRowSchema,
    execute: row =>
      sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
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
          NULL,
          ${row.assistantMessageId},
          ${row.status === 'error' ? 'error' : 'completed'},
          ${row.completedAt},
          ${row.completedAt},
          ${row.completedAt},
          ${row.checkpointTurnCount},
          ${row.checkpointRef},
          ${row.status},
          ${row.files}
        )
        ON CONFLICT (thread_id, turn_id)
        DO UPDATE SET
          assistant_message_id = excluded.assistant_message_id,
          state = excluded.state,
          completed_at = excluded.completed_at,
          checkpoint_turn_count = excluded.checkpoint_turn_count,
          checkpoint_ref = excluded.checkpoint_ref,
          checkpoint_status = excluded.checkpoint_status,
          checkpoint_files_json = excluded.checkpoint_files_json
      `,
  })
}

function makeListProjectionCheckpointRows(sql: SqlClient.SqlClient) {
  return SqlSchema.findAll({
    Request: ListByThreadIdInput,
    Result: ProjectionCheckpointDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "status",
          checkpoint_files_json AS "files",
          assistant_message_id AS "assistantMessageId",
          completed_at AS "completedAt"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count IS NOT NULL
        ORDER BY checkpoint_turn_count ASC
      `,
  })
}

function makeGetProjectionCheckpointRow(sql: SqlClient.SqlClient) {
  return SqlSchema.findOneOption({
    Request: GetByThreadAndTurnCountInput,
    Result: ProjectionCheckpointDbRowSchema,
    execute: ({ threadId, checkpointTurnCount }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "status",
          checkpoint_files_json AS "files",
          assistant_message_id AS "assistantMessageId",
          completed_at AS "completedAt"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count = ${checkpointTurnCount}
      `,
  })
}

function makeDeleteProjectionCheckpointRows(sql: SqlClient.SqlClient) {
  return SqlSchema.void({
    Request: DeleteByThreadIdInput,
    execute: ({ threadId }) =>
      sql`
        UPDATE projection_turns
        SET
          checkpoint_turn_count = NULL,
          checkpoint_ref = NULL,
          checkpoint_status = NULL,
          checkpoint_files_json = '[]'
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count IS NOT NULL
      `,
  })
}

function upsertCheckpointRow(
  sql: SqlClient.SqlClient,
  clearCheckpointConflict: ReturnType<typeof makeClearCheckpointConflict>,
  upsertProjectionCheckpointRow: ReturnType<typeof makeUpsertProjectionCheckpointRow>,
  row: Schema.Schema.Type<typeof ProjectionCheckpointDbRowSchema>
) {
  return sql.withTransaction(
    clearCheckpointConflict({
      threadId: row.threadId,
      checkpointTurnCount: row.checkpointTurnCount,
    }).pipe(Effect.flatMap(() => upsertProjectionCheckpointRow(row)))
  )
}

const makeProjectionCheckpointRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const clearCheckpointConflict = makeClearCheckpointConflict(sql)
  const upsertProjectionCheckpointRow = makeUpsertProjectionCheckpointRow(sql)
  const listProjectionCheckpointRows = makeListProjectionCheckpointRows(sql)
  const getProjectionCheckpointRow = makeGetProjectionCheckpointRow(sql)
  const deleteProjectionCheckpointRows = makeDeleteProjectionCheckpointRows(sql)

  const upsert: ProjectionCheckpointRepositoryShape['upsert'] = row =>
    upsertCheckpointRow(sql, clearCheckpointConflict, upsertProjectionCheckpointRow, row).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          'ProjectionCheckpointRepository.upsert:query',
          'ProjectionCheckpointRepository.upsert:encodeRequest'
        )
      )
    )

  const listByThreadId: ProjectionCheckpointRepositoryShape['listByThreadId'] = input =>
    listProjectionCheckpointRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          'ProjectionCheckpointRepository.listByThreadId:query',
          'ProjectionCheckpointRepository.listByThreadId:decodeRows'
        )
      ),
      Effect.map(rows => rows as ReadonlyArray<Schema.Schema.Type<typeof ProjectionCheckpoint>>)
    )

  const getByThreadAndTurnCount: ProjectionCheckpointRepositoryShape['getByThreadAndTurnCount'] =
    input =>
      getProjectionCheckpointRow(input).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            'ProjectionCheckpointRepository.getByThreadAndTurnCount:query',
            'ProjectionCheckpointRepository.getByThreadAndTurnCount:decodeRow'
          )
        ),
        Effect.flatMap(rowOption =>
          passThroughOptionalRow(
            rowOption as Option.Option<Schema.Schema.Type<typeof ProjectionCheckpoint>>
          )
        )
      )

  const deleteByThreadId: ProjectionCheckpointRepositoryShape['deleteByThreadId'] = input =>
    deleteProjectionCheckpointRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError('ProjectionCheckpointRepository.deleteByThreadId:query')
      )
    )

  return {
    upsert,
    listByThreadId,
    getByThreadAndTurnCount,
    deleteByThreadId,
  } satisfies ProjectionCheckpointRepositoryShape
})

export const ProjectionCheckpointRepositoryLive = Layer.effect(
  ProjectionCheckpointRepository,
  makeProjectionCheckpointRepository
)
