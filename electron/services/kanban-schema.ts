import { createRequire } from 'node:module'
import { asString } from './kanban-parsers'

const require = createRequire(import.meta.url)

export type PersistenceDatabase = {
  exec(sql: string): unknown
  prepare(sql: string): {
    get(...params: unknown[]): unknown
    run(...params: unknown[]): unknown
    all(...params: unknown[]): unknown
  }
}

export function createDatabase(databasePath: string): PersistenceDatabase {
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

export function tableColumns(database: PersistenceDatabase, table: string) {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>
  return new Set(rows.map(row => asString(row.name)).filter(Boolean))
}

export function ensureColumn(
  database: PersistenceDatabase,
  table: string,
  column: string,
  definition: string
) {
  const columns = tableColumns(database, table)
  if (!columns.has(column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

function createKanbanCoreTables(database: PersistenceDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS kanban_workspaces (
      workspace_dir TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kanban_boards (
      workspace_dir TEXT PRIMARY KEY,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kanban_tasks (
      id TEXT PRIMARY KEY,
      workspace_dir TEXT NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      description TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_config_json TEXT NOT NULL DEFAULT '{}',
      column_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      status_summary TEXT NOT NULL,
      worktree_path TEXT,
      base_ref TEXT,
      task_branch TEXT,
      provider_session_key TEXT,
      provider_thread_id TEXT,
      latest_run_id TEXT,
      auto_start_when_unblocked INTEGER NOT NULL,
      ship_status TEXT,
      trash_status TEXT NOT NULL DEFAULT 'active',
      restore_column_id TEXT,
      latest_preview TEXT,
      latest_activity_kind TEXT,
      merge_status TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      trashed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS kanban_task_dependencies (
      id TEXT PRIMARY KEY,
      workspace_dir TEXT NOT NULL,
      from_task_id TEXT NOT NULL,
      to_task_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kanban_runs (
      id TEXT PRIMARY KEY,
      workspace_dir TEXT NOT NULL,
      task_id TEXT,
      automation_id TEXT,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      session_key TEXT,
      provider_thread_id TEXT,
      ship_status TEXT,
      error TEXT,
      logs_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS kanban_automations (
      id TEXT PRIMARY KEY,
      workspace_dir TEXT NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      provider TEXT NOT NULL,
      browser_mode_enabled INTEGER NOT NULL,
      enabled INTEGER NOT NULL,
      auto_start INTEGER NOT NULL,
      schedule_json TEXT NOT NULL,
      last_run_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kanban_review_comments (
      id TEXT PRIMARY KEY,
      workspace_dir TEXT NOT NULL,
      task_id TEXT NOT NULL,
      run_id TEXT,
      file_path TEXT NOT NULL,
      line INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kanban_settings (
      workspace_dir TEXT PRIMARY KEY,
      auto_commit INTEGER NOT NULL,
      auto_pr INTEGER NOT NULL,
      default_provider TEXT NOT NULL,
      provider_defaults_json TEXT NOT NULL DEFAULT '{}',
      script_shortcuts_json TEXT NOT NULL,
      worktree_include_json TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL
    );
  `)
}

function createKanbanExtensionTables(database: PersistenceDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS kanban_task_runtime (
      task_id TEXT PRIMARY KEY,
      workspace_dir TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      resume_token TEXT,
      terminal_id TEXT,
      worktree_path TEXT,
      base_ref TEXT,
      task_branch TEXT,
      last_event_summary TEXT,
      latest_preview TEXT,
      latest_activity_kind TEXT,
      merge_status TEXT,
      trash_status TEXT NOT NULL DEFAULT 'active',
      checkpoint_cursor TEXT,
      last_checkpoint_id TEXT,
      updated_at INTEGER NOT NULL,
      trashed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS kanban_task_checkpoints (
      id TEXT PRIMARY KEY,
      workspace_dir TEXT NOT NULL,
      task_id TEXT NOT NULL,
      run_id TEXT,
      label TEXT NOT NULL,
      source TEXT NOT NULL,
      session_key TEXT,
      provider_thread_id TEXT,
      git_revision TEXT,
      diff_raw TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kanban_management_sessions (
      workspace_dir TEXT NOT NULL,
      provider TEXT NOT NULL,
      session_key TEXT NOT NULL,
      provider_thread_id TEXT,
      status TEXT NOT NULL,
      transcript_json TEXT NOT NULL,
      last_error TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_dir, provider)
    );
    CREATE TABLE IF NOT EXISTS kanban_worktrees (
      id TEXT PRIMARY KEY,
      workspace_dir TEXT NOT NULL,
      task_id TEXT,
      label TEXT NOT NULL,
      provider TEXT,
      repo_root TEXT NOT NULL,
      directory TEXT NOT NULL,
      branch TEXT NOT NULL,
      base_ref TEXT NOT NULL,
      status TEXT NOT NULL,
      merge_status TEXT NOT NULL,
      latest_preview TEXT,
      latest_activity_kind TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      trashed_at INTEGER
    );
  `)
}

function createKanbanIndexes(database: PersistenceDatabase): void {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_kanban_tasks_workspace_position
      ON kanban_tasks(workspace_dir, column_id, position, updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_task_dependencies_unique
      ON kanban_task_dependencies(workspace_dir, from_task_id, to_task_id);
    CREATE INDEX IF NOT EXISTS idx_kanban_runs_workspace_updated
      ON kanban_runs(workspace_dir, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_kanban_task_checkpoints_task
      ON kanban_task_checkpoints(workspace_dir, task_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_kanban_worktrees_workspace_updated
      ON kanban_worktrees(workspace_dir, updated_at DESC);
  `)
}

export function initKanbanDatabase(database: PersistenceDatabase): void {
  createKanbanCoreTables(database)
  createKanbanExtensionTables(database)
  createKanbanIndexes(database)
}

export function migrateKanbanSchema(database: PersistenceDatabase): void {
  migrateLegacyKanbanSchema(database)
  ensureColumn(database, 'kanban_tasks', 'trash_status', "TEXT NOT NULL DEFAULT 'active'")
  ensureColumn(database, 'kanban_tasks', 'provider_config_json', "TEXT NOT NULL DEFAULT '{}'")
  ensureColumn(database, 'kanban_tasks', 'restore_column_id', 'TEXT')
  ensureColumn(database, 'kanban_tasks', 'latest_preview', 'TEXT')
  ensureColumn(database, 'kanban_tasks', 'latest_activity_kind', 'TEXT')
  ensureColumn(database, 'kanban_tasks', 'merge_status', 'TEXT')
  ensureColumn(database, 'kanban_tasks', 'trashed_at', 'INTEGER')
  ensureColumn(
    database,
    'kanban_settings',
    'provider_defaults_json',
    "TEXT NOT NULL DEFAULT '{}'"
  )
  ensureColumn(database, 'kanban_settings', 'worktree_include_json', "TEXT NOT NULL DEFAULT '{}'")
  ensureColumn(database, 'kanban_task_runtime', 'latest_preview', 'TEXT')
  ensureColumn(database, 'kanban_task_runtime', 'latest_activity_kind', 'TEXT')
  ensureColumn(database, 'kanban_task_runtime', 'merge_status', 'TEXT')
  ensureColumn(database, 'kanban_task_runtime', 'trash_status', "TEXT NOT NULL DEFAULT 'active'")
  ensureColumn(database, 'kanban_task_runtime', 'trashed_at', 'INTEGER')
  migrateLegacyArchiveTasks(database)
}

function migrateLegacyKanbanSchema(database: PersistenceDatabase): void {
  const settingsColumns = tableColumns(database, 'kanban_settings')
  if (settingsColumns.has('symlink_policy_json')) {
    database.exec(`
      ALTER TABLE kanban_settings RENAME TO kanban_settings_legacy;
      CREATE TABLE kanban_settings (
        workspace_dir TEXT PRIMARY KEY,
        auto_commit INTEGER NOT NULL,
        auto_pr INTEGER NOT NULL,
        default_provider TEXT NOT NULL,
        script_shortcuts_json TEXT NOT NULL,
        worktree_include_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL
      );
      INSERT INTO kanban_settings (
        workspace_dir, auto_commit, auto_pr, default_provider, script_shortcuts_json, worktree_include_json, updated_at
      )
      SELECT
        workspace_dir,
        auto_commit,
        auto_pr,
        default_provider,
        script_shortcuts_json,
        CASE
          WHEN worktree_include_json IS NULL OR TRIM(worktree_include_json) = '' THEN '{}'
          ELSE worktree_include_json
        END,
        updated_at
      FROM kanban_settings_legacy;
      DROP TABLE kanban_settings_legacy;
    `)
  }

  const runtimeColumns = tableColumns(database, 'kanban_task_runtime')
  if (runtimeColumns.has('archived_at')) {
    database.exec(`
      ALTER TABLE kanban_task_runtime RENAME TO kanban_task_runtime_legacy;
      CREATE TABLE kanban_task_runtime (
        task_id TEXT PRIMARY KEY,
        workspace_dir TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        resume_token TEXT,
        terminal_id TEXT,
        worktree_path TEXT,
        base_ref TEXT,
        task_branch TEXT,
        last_event_summary TEXT,
        latest_preview TEXT,
        latest_activity_kind TEXT,
        merge_status TEXT,
        trash_status TEXT NOT NULL DEFAULT 'active',
        checkpoint_cursor TEXT,
        last_checkpoint_id TEXT,
        updated_at INTEGER NOT NULL,
        trashed_at INTEGER
      );
      INSERT INTO kanban_task_runtime (
        task_id, workspace_dir, provider, status, resume_token, terminal_id, worktree_path, base_ref, task_branch,
        last_event_summary, latest_preview, latest_activity_kind, merge_status, trash_status, checkpoint_cursor,
        last_checkpoint_id, updated_at, trashed_at
      )
      SELECT
        task_id,
        workspace_dir,
        provider,
        status,
        resume_token,
        terminal_id,
        worktree_path,
        base_ref,
        task_branch,
        last_event_summary,
        latest_preview,
        latest_activity_kind,
        merge_status,
        COALESCE(trash_status, 'active'),
        checkpoint_cursor,
        last_checkpoint_id,
        updated_at,
        COALESCE(trashed_at, archived_at)
      FROM kanban_task_runtime_legacy;
      DROP TABLE kanban_task_runtime_legacy;
    `)
  }
}

function migrateLegacyArchiveTasks(database: PersistenceDatabase): void {
  database
    .prepare(
      `
    UPDATE kanban_tasks
    SET
      restore_column_id = COALESCE(restore_column_id, CASE WHEN column_id = 'archived' THEN 'done' ELSE column_id END),
      column_id = CASE WHEN column_id = 'archived' THEN 'done' ELSE column_id END,
      trash_status = CASE WHEN column_id = 'archived' OR trash_status = 'trashed' THEN 'trashed' ELSE trash_status END,
      trashed_at = COALESCE(trashed_at, completed_at, updated_at)
    WHERE column_id = 'archived' OR trash_status = 'trashed'
  `
    )
    .run()

  database
    .prepare(
      `
    UPDATE kanban_task_runtime
    SET
      trash_status = CASE WHEN status = 'archived' OR trash_status = 'trashed' THEN 'trashed' ELSE trash_status END,
      trashed_at = COALESCE(trashed_at, updated_at)
    WHERE status = 'archived' OR trash_status = 'trashed'
  `
    )
    .run()
}
