/**
 * PostgreSQL migrations for open-styles cloud sync.
 *
 * Equivalent of the SQLite schema in db.ts, translated for PostgreSQL.
 * Each element is a standalone SQL string that must be executed in order.
 */
export const PG_MIGRATIONS: string[] = [
  // Migration 1: Full schema
  `
  CREATE TABLE IF NOT EXISTS style_profiles (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    principles TEXT DEFAULT '[]',
    anti_patterns TEXT DEFAULT '[]',
    typography TEXT DEFAULT '{}',
    colors TEXT DEFAULT '{}',
    component_rules TEXT DEFAULT '{}',
    tags TEXT DEFAULT '[]',
    created_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS preferences (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'global',
    project_path TEXT,
    updated_at BIGINT NOT NULL,
    UNIQUE(key, scope, project_path)
  );

  CREATE TABLE IF NOT EXISTS project_configs (
    id TEXT PRIMARY KEY,
    project_path TEXT UNIQUE NOT NULL,
    profile_id TEXT,
    active_template_id TEXT,
    custom_overrides TEXT DEFAULT '{}',
    hook_installed INTEGER DEFAULT 0,
    created_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    style_profile_id TEXT,
    variables TEXT DEFAULT '{}',
    created_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS health_checks (
    id TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    run_at BIGINT NOT NULL,
    violations TEXT DEFAULT '[]',
    score INTEGER NOT NULL DEFAULT 100,
    status TEXT NOT NULL DEFAULT 'pass',
    cerebras_used INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS health_violations (
    id TEXT PRIMARY KEY,
    check_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    rule TEXT NOT NULL,
    message TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning',
    auto_task_id TEXT
  );

  CREATE TABLE IF NOT EXISTS extracted_style_kits (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    tokens TEXT NOT NULL,
    raw TEXT,
    screenshot TEXT,
    tags TEXT DEFAULT '[]',
    notes TEXT,
    extracted_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_presence (
    id TEXT NOT NULL DEFAULT '',
    agent TEXT PRIMARY KEY,
    session_id TEXT,
    role TEXT NOT NULL DEFAULT 'agent',
    project_id TEXT,
    status TEXT NOT NULL DEFAULT 'online',
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata TEXT
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  INSERT INTO _migrations (id) VALUES (1) ON CONFLICT DO NOTHING;
  `,
];
