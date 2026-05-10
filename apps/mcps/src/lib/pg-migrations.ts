/**
 * PostgreSQL migrations for open-mcps cloud sync.
 *
 * Equivalent to the SQLite schema in db.ts, translated for PostgreSQL.
 */

export const PG_MIGRATIONS: string[] = [
  // Migration 1: servers table
  `CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    command TEXT NOT NULL,
    args TEXT NOT NULL DEFAULT '[]',
    env TEXT NOT NULL DEFAULT '{}',
    transport TEXT NOT NULL DEFAULT 'stdio',
    url TEXT,
    source TEXT NOT NULL DEFAULT 'local',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_connected_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 2: tool_cache table
  `CREATE TABLE IF NOT EXISTS tool_cache (
    server_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    input_schema TEXT NOT NULL DEFAULT '{}',
    cached_at TEXT NOT NULL DEFAULT NOW()::text,
    PRIMARY KEY (server_id, name),
    FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
  )`,

  `CREATE INDEX IF NOT EXISTS idx_tool_cache_server ON tool_cache(server_id)`,

  // Migration 3: sources table
  `CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    url TEXT NOT NULL,
    description TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 4: feedback table
  `CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 5: provider profile catalog
  `CREATE TABLE IF NOT EXISTS provider_profiles (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description TEXT,
    endpoint TEXT,
    transport TEXT NOT NULL,
    auth_type TEXT NOT NULL,
    scopes TEXT NOT NULL DEFAULT '[]',
    token_mode TEXT NOT NULL DEFAULT 'none',
    install_fallback TEXT NOT NULL DEFAULT '{}',
    docs_url TEXT,
    safety TEXT NOT NULL DEFAULT '{}',
    provenance TEXT NOT NULL DEFAULT '{"source":"manual"}',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_provider_profiles_enabled ON provider_profiles(enabled)`,
];
