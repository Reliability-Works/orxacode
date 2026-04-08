import { Effect, Layer, FileSystem, Path } from 'effect'
import * as SqlClient from 'effect/unstable/sql/SqlClient'

import { runMigrations } from '../Migrations.ts'
import { ServerConfig } from '../../config.ts'

type RuntimeSqliteLayerConfig = {
  readonly filename: string
}

type Loader = {
  layer: (config: RuntimeSqliteLayerConfig) => Layer.Layer<SqlClient.SqlClient>
}
const defaultSqliteClientLoader = () => import('../NodeSqliteClient.ts')

const makeRuntimeSqliteLayer = Effect.fn('makeRuntimeSqliteLayer')(function* (
  config: RuntimeSqliteLayerConfig
) {
  const clientModule = yield* Effect.promise<Loader>(defaultSqliteClientLoader)
  return clientModule.layer(config)
}, Layer.unwrap)

const setup = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`PRAGMA journal_mode = WAL;`
    yield* sql`PRAGMA foreign_keys = ON;`
    yield* runMigrations()
  })
)

export const makeSqlitePersistenceLive = Effect.fn('makeSqlitePersistenceLive')(function* (
  dbPath: string
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  yield* fs.makeDirectory(path.dirname(dbPath), { recursive: true })

  return Layer.provideMerge(setup, makeRuntimeSqliteLayer({ filename: dbPath }))
}, Layer.unwrap)

export const SqlitePersistenceMemory = Layer.provideMerge(
  setup,
  makeRuntimeSqliteLayer({ filename: ':memory:' })
)

export const layerConfig = Layer.unwrap(
  Effect.map(Effect.service(ServerConfig), ({ dbPath }) => makeSqlitePersistenceLive(dbPath))
)
