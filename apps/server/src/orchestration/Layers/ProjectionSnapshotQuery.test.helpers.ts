import { CheckpointRef, EventId, MessageId, ProjectId, TurnId } from '@orxa-code/contracts'
import { it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import * as SqlClient from 'effect/unstable/sql/SqlClient'

import { SqlitePersistenceMemory } from '../../persistence/Layers/Sqlite.ts'
import { OrchestrationProjectionSnapshotQueryLive } from './ProjectionSnapshotQuery.ts'

export const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value)
export const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value)
export const asMessageId = (value: string): MessageId => MessageId.makeUnsafe(value)
export const asEventId = (value: string): EventId => EventId.makeUnsafe(value)
export const asCheckpointRef = (value: string): CheckpointRef => CheckpointRef.makeUnsafe(value)

export const projectionSnapshotLayer = it.layer(
  OrchestrationProjectionSnapshotQueryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory))
)

export const clearProjectionTables = (tables: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    for (const table of tables) {
      yield* sql.unsafe(`DELETE FROM ${table}`)
    }
  })
