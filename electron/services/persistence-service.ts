import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { app } from 'electron'

const DATABASE_NAME = 'orxa-persistence.sqlite'
const RENDERER_NAMESPACE = 'renderer'

export function getPersistenceDatabasePath() {
  return path.join(app.getPath('userData'), DATABASE_NAME)
}

export type PersistedValueRow = {
  namespace: string
  key: string
  value: string
  updatedAt: number
}

type PersistenceDatabase = {
  exec(sql: string): unknown
  prepare(sql: string): {
    get(...params: unknown[]): unknown
    run(...params: unknown[]): unknown
    all(...params: unknown[]): unknown
  }
}

const require = createRequire(import.meta.url)

function createDatabase(databasePath: string): PersistenceDatabase {
  try {
    const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3')
    return new BetterSqlite3(databasePath)
  } catch (error) {
    if (process.versions.electron) {
      throw error
    }
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
    return new DatabaseSync(databasePath)
  }
}

export class PersistenceService {
  private readonly database: PersistenceDatabase

  constructor(databasePath?: string) {
    const resolvedPath = databasePath ?? getPersistenceDatabasePath()
    mkdirSync(path.dirname(resolvedPath), { recursive: true })
    this.database = createDatabase(resolvedPath)
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS persisted_values (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (namespace, key)
      );
      CREATE INDEX IF NOT EXISTS idx_persisted_values_updated_at
        ON persisted_values(updated_at);
    `)
  }

  getValue(namespace: string, key: string): string | null {
    const row = this.database
      .prepare('SELECT value FROM persisted_values WHERE namespace = ? AND key = ?')
      .get(namespace, key) as { value?: string } | undefined
    return typeof row?.value === 'string' ? row.value : null
  }

  setValue(namespace: string, key: string, value: string): void {
    this.database
      .prepare(
        `
        INSERT INTO persisted_values (namespace, key, value, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(namespace, key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `
      )
      .run(namespace, key, value, Date.now())
  }

  removeValue(namespace: string, key: string): void {
    this.database
      .prepare('DELETE FROM persisted_values WHERE namespace = ? AND key = ?')
      .run(namespace, key)
  }

  listValues(namespace: string): PersistedValueRow[] {
    const rows = this.database
      .prepare(
        `
        SELECT namespace, key, value, updated_at
        FROM persisted_values
        WHERE namespace = ?
        ORDER BY updated_at DESC, key ASC
      `
      )
      .all(namespace) as Array<{
      namespace?: string
      key?: string
      value?: string
      updated_at?: number
    }>
    return rows.flatMap(row => {
      if (
        typeof row.namespace !== 'string' ||
        typeof row.key !== 'string' ||
        typeof row.value !== 'string' ||
        typeof row.updated_at !== 'number'
      ) {
        return []
      }
      return [
        {
          namespace: row.namespace,
          key: row.key,
          value: row.value,
          updatedAt: row.updated_at,
        },
      ]
    })
  }

  getRendererValue(key: string): string | null {
    return this.getValue(RENDERER_NAMESPACE, key)
  }

  setRendererValue(key: string, value: string): void {
    this.setValue(RENDERER_NAMESPACE, key, value)
  }

  removeRendererValue(key: string): void {
    this.removeValue(RENDERER_NAMESPACE, key)
  }
}
