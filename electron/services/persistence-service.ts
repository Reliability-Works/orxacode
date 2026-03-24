import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { app } from "electron";

const DATABASE_NAME = "orxa-persistence.sqlite";
const RENDERER_NAMESPACE = "renderer";

type PersistenceDatabase = {
  exec(sql: string): unknown;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
  };
};

const require = createRequire(import.meta.url);

function createDatabase(databasePath: string): PersistenceDatabase {
  try {
    const BetterSqlite3 = require("better-sqlite3") as typeof import("better-sqlite3");
    return new BetterSqlite3(databasePath);
  } catch (error) {
    if (process.versions.electron) {
      throw error;
    }
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    return new DatabaseSync(databasePath);
  }
}

export class PersistenceService {
  private readonly database: PersistenceDatabase;

  constructor(databasePath?: string) {
    const resolvedPath = databasePath ?? path.join(app.getPath("userData"), DATABASE_NAME);
    mkdirSync(path.dirname(resolvedPath), { recursive: true });
    this.database = createDatabase(resolvedPath);
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
    `);
  }

  getRendererValue(key: string): string | null {
    const row = this.database
      .prepare("SELECT value FROM persisted_values WHERE namespace = ? AND key = ?")
      .get(RENDERER_NAMESPACE, key) as { value?: string } | undefined;
    return typeof row?.value === "string" ? row.value : null;
  }

  setRendererValue(key: string, value: string): void {
    this.database
      .prepare(`
        INSERT INTO persisted_values (namespace, key, value, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(namespace, key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `)
      .run(RENDERER_NAMESPACE, key, value, Date.now());
  }

  removeRendererValue(key: string): void {
    this.database
      .prepare("DELETE FROM persisted_values WHERE namespace = ? AND key = ?")
      .run(RENDERER_NAMESPACE, key);
  }
}
