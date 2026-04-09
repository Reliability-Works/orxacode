import * as SqlClient from 'effect/unstable/sql/SqlClient'
import * as Effect from 'effect/Effect'

import { runStatements } from './_shared.ts'

const statements = [
  `
    ALTER TABLE projection_threads
    ADD COLUMN handoff_json TEXT
  `,
] as const

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* runStatements(sql, statements)
})
