/**
 * PostgreSQL migrations for open-configs storage sync.
 *
 * Equivalent to the SQLite schema in database.ts, translated for PostgreSQL.
 */

export const PG_MIGRATIONS: string[] = [
  // Migration 1: configs table
  `CREATE TABLE IF NOT EXISTS configs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL DEFAULT 'file',
    category TEXT NOT NULL,
    agent TEXT NOT NULL DEFAULT 'global',
    target_path TEXT,
    outputs TEXT NOT NULL DEFAULT '[]',
    format TEXT NOT NULL DEFAULT 'text',
    content TEXT NOT NULL DEFAULT '',
    description TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    is_template BOOLEAN NOT NULL DEFAULT FALSE,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    synced_at TEXT
  )`,

  // Migration 2: config_snapshots table
  `CREATE TABLE IF NOT EXISTS config_snapshots (
    id TEXT PRIMARY KEY,
    config_id TEXT NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,

  // Migration 3: profiles table
  `CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    selectors TEXT NOT NULL DEFAULT '{}',
    variables TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // Migration 4: profile_configs join table
  `CREATE TABLE IF NOT EXISTS profile_configs (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    config_id TEXT NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (profile_id, config_id)
  )`,

  // Migration 5: machines table
  `CREATE TABLE IF NOT EXISTS machines (
    id TEXT PRIMARY KEY,
    hostname TEXT NOT NULL UNIQUE,
    os TEXT,
    arch TEXT,
    last_applied_at TEXT,
    created_at TEXT NOT NULL
  )`,

  // Migration 6: feedback table
  `CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 7: output fan-out metadata
  `ALTER TABLE configs ADD COLUMN IF NOT EXISTS outputs TEXT NOT NULL DEFAULT '[]'`,

  // Migration 8: schema-versioned profile instruction binding
  `ALTER TABLE profile_configs ADD COLUMN IF NOT EXISTS binding TEXT NOT NULL DEFAULT '{"schema":"hasna.instructions.profile-config-binding/v1","activation":{"mode":"always"},"required":true,"fallback":"fail"}'`,

  // Migration 9: schema-versioned profile asset bindings, separate from instructions
  `CREATE TABLE IF NOT EXISTS profile_assets (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    source_config_id TEXT NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
    asset_key TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    binding TEXT NOT NULL,
    PRIMARY KEY (profile_id, asset_key)
  )`,

  // Migration 10: efficient source cleanup and lookups
  `CREATE INDEX IF NOT EXISTS profile_assets_source_config_idx ON profile_assets (source_config_id)`,
];
