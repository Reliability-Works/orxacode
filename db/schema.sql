-- Orxa Code Database Schema
-- SQLite database used by the Electron main process

-- =============================================================================
-- Persistence Service (Key-Value Store)
-- =============================================================================

CREATE TABLE IF NOT EXISTS key_value (
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (namespace, key)
);

CREATE INDEX IF NOT EXISTS idx_key_value_namespace ON key_value(namespace);
CREATE INDEX IF NOT EXISTS idx_key_value_updated_at ON key_value(updated_at);

-- =============================================================================
-- Diagnostics (Error Logging)
-- =============================================================================

CREATE TABLE IF NOT EXISTS diagnostics (
    id TEXT PRIMARY KEY,
    level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    context TEXT,
    timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_diagnostics_level ON diagnostics(level);
CREATE INDEX IF NOT EXISTS idx_diagnostics_timestamp ON diagnostics(timestamp);
