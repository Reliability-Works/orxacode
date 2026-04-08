import { ThreadId } from '@orxa-code/contracts'
import * as SqlClient from 'effect/unstable/sql/SqlClient'
import * as SqlSchema from 'effect/unstable/sql/SqlSchema'
import { Effect, Layer, Option, Schema, Struct } from 'effect'

import {
  toPersistenceDecodeError,
  toPersistenceSqlError,
  toPersistenceSqlOrDecodeError as toPersistenceSqlOrDecodeErrorBase,
  type ProviderSessionRuntimeRepositoryError,
} from '../Errors.ts'
import {
  ProviderSessionRuntime,
  ProviderSessionRuntimeRepository,
  type ProviderSessionRuntimeRepositoryShape,
} from '../Services/ProviderSessionRuntime.ts'

const ProviderSessionRuntimeDbRowSchema = ProviderSessionRuntime.mapFields(
  Struct.assign({
    resumeCursor: Schema.NullOr(Schema.fromJsonString(Schema.Unknown)),
    runtimePayload: Schema.NullOr(Schema.fromJsonString(Schema.Unknown)),
  })
)

const decodeRuntime = Schema.decodeUnknownEffect(ProviderSessionRuntime)

const GetRuntimeRequestSchema = Schema.Struct({
  threadId: ThreadId,
})

const DeleteRuntimeRequestSchema = GetRuntimeRequestSchema

const toPersistenceSqlOrDecodeError = (
  sqlOperation: string,
  decodeOperation: string
): ((cause: unknown) => ProviderSessionRuntimeRepositoryError) =>
  toPersistenceSqlOrDecodeErrorBase(sqlOperation, decodeOperation)

function decodeRuntimeRow(
  row: Schema.Schema.Type<typeof ProviderSessionRuntimeDbRowSchema>,
  operation: string
) {
  return decodeRuntime(row).pipe(Effect.mapError(toPersistenceDecodeError(operation)))
}

function makeUpsertRuntimeRow(sql: SqlClient.SqlClient) {
  return SqlSchema.void({
    Request: ProviderSessionRuntimeDbRowSchema,
    execute: runtime =>
      sql`
        INSERT INTO provider_session_runtime (
          thread_id,
          provider_name,
          adapter_key,
          runtime_mode,
          status,
          last_seen_at,
          resume_cursor_json,
          runtime_payload_json
        )
        VALUES (
          ${runtime.threadId},
          ${runtime.providerName},
          ${runtime.adapterKey},
          ${runtime.runtimeMode},
          ${runtime.status},
          ${runtime.lastSeenAt},
          ${runtime.resumeCursor},
          ${runtime.runtimePayload}
        )
        ON CONFLICT (thread_id)
        DO UPDATE SET
          provider_name = excluded.provider_name,
          adapter_key = excluded.adapter_key,
          runtime_mode = excluded.runtime_mode,
          status = excluded.status,
          last_seen_at = excluded.last_seen_at,
          resume_cursor_json = excluded.resume_cursor_json,
          runtime_payload_json = excluded.runtime_payload_json
      `,
  })
}

function makeGetRuntimeRowByThreadId(sql: SqlClient.SqlClient) {
  return SqlSchema.findOneOption({
    Request: GetRuntimeRequestSchema,
    Result: ProviderSessionRuntimeDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          provider_name AS "providerName",
          adapter_key AS "adapterKey",
          runtime_mode AS "runtimeMode",
          status,
          last_seen_at AS "lastSeenAt",
          resume_cursor_json AS "resumeCursor",
          runtime_payload_json AS "runtimePayload"
        FROM provider_session_runtime
        WHERE thread_id = ${threadId}
      `,
  })
}

function makeListRuntimeRows(sql: SqlClient.SqlClient) {
  return SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProviderSessionRuntimeDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          provider_name AS "providerName",
          adapter_key AS "adapterKey",
          runtime_mode AS "runtimeMode",
          status,
          last_seen_at AS "lastSeenAt",
          resume_cursor_json AS "resumeCursor",
          runtime_payload_json AS "runtimePayload"
        FROM provider_session_runtime
        ORDER BY last_seen_at ASC, thread_id ASC
      `,
  })
}

function makeDeleteRuntimeByThreadId(sql: SqlClient.SqlClient) {
  return SqlSchema.void({
    Request: DeleteRuntimeRequestSchema,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM provider_session_runtime
        WHERE thread_id = ${threadId}
      `,
  })
}

const makeProviderSessionRuntimeRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const upsertRuntimeRow = makeUpsertRuntimeRow(sql)
  const getRuntimeRowByThreadId = makeGetRuntimeRowByThreadId(sql)
  const listRuntimeRows = makeListRuntimeRows(sql)
  const deleteRuntimeByThreadId = makeDeleteRuntimeByThreadId(sql)

  const upsert: ProviderSessionRuntimeRepositoryShape['upsert'] = runtime =>
    upsertRuntimeRow(runtime).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          'ProviderSessionRuntimeRepository.upsert:query',
          'ProviderSessionRuntimeRepository.upsert:encodeRequest'
        )
      )
    )

  const getByThreadId: ProviderSessionRuntimeRepositoryShape['getByThreadId'] = input =>
    getRuntimeRowByThreadId(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          'ProviderSessionRuntimeRepository.getByThreadId:query',
          'ProviderSessionRuntimeRepository.getByThreadId:decodeRow'
        )
      ),
      Effect.flatMap(runtimeRowOption =>
        Option.match(runtimeRowOption, {
          onNone: () => Effect.succeed(Option.none()),
          onSome: row =>
            decodeRuntimeRow(
              row,
              'ProviderSessionRuntimeRepository.getByThreadId:rowToRuntime'
            ).pipe(Effect.map(Option.some)),
        })
      )
    )

  const list: ProviderSessionRuntimeRepositoryShape['list'] = () =>
    listRuntimeRows(undefined).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          'ProviderSessionRuntimeRepository.list:query',
          'ProviderSessionRuntimeRepository.list:decodeRows'
        )
      ),
      Effect.flatMap(rows =>
        Effect.forEach(
          rows,
          row => decodeRuntimeRow(row, 'ProviderSessionRuntimeRepository.list:rowToRuntime'),
          { concurrency: 'unbounded' }
        )
      )
    )

  const deleteByThreadId: ProviderSessionRuntimeRepositoryShape['deleteByThreadId'] = input =>
    deleteRuntimeByThreadId(input).pipe(
      Effect.mapError(
        toPersistenceSqlError('ProviderSessionRuntimeRepository.deleteByThreadId:query')
      )
    )

  return {
    upsert,
    getByThreadId,
    list,
    deleteByThreadId,
  } satisfies ProviderSessionRuntimeRepositoryShape
})

export const ProviderSessionRuntimeRepositoryLive = Layer.effect(
  ProviderSessionRuntimeRepository,
  makeProviderSessionRuntimeRepository
)
