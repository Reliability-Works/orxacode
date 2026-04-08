import * as SqlClient from 'effect/unstable/sql/SqlClient'
import * as Effect from 'effect/Effect'

/**
 * Shared migration helpers. Used by historical migration files to avoid
 * duplicated boilerplate. Behavior must remain replay-identical to the
 * original inline implementations.
 */
export const runStatements = (sql: SqlClient.SqlClient, statements: ReadonlyArray<string>) =>
  Effect.forEach(statements, statement => sql.unsafe(statement), { discard: true })
