/**
 * PostgreSQL migrations for a future open-prompts remote storage boundary.
 *
 * Equivalent to the SQLite schema in database.ts, translated for PostgreSQL.
 */

export const PG_MIGRATIONS: string[] = [
  // Migration 1: _migrations tracking table
  `CREATE TABLE IF NOT EXISTS _migrations (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 2: collections table
  `CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 3: seed default collection
  `INSERT INTO collections (id, name, description, created_at)
   VALUES ('default', 'default', 'Default collection', NOW()::text)
   ON CONFLICT (id) DO NOTHING`,

  // Migration 4: prompts table
  `CREATE TABLE IF NOT EXISTS prompts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    description TEXT,
    collection TEXT NOT NULL DEFAULT 'default' REFERENCES collections(name) ON UPDATE CASCADE,
    tags TEXT NOT NULL DEFAULT '[]',
    variables TEXT NOT NULL DEFAULT '[]',
    is_template BOOLEAN NOT NULL DEFAULT FALSE,
    source TEXT NOT NULL DEFAULT 'manual',
    version INTEGER NOT NULL DEFAULT 1,
    use_count INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    next_prompt TEXT,
    expires_at TEXT,
    project_id TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_prompts_collection ON prompts(collection)`,

  `CREATE INDEX IF NOT EXISTS idx_prompts_source ON prompts(source)`,

  `CREATE INDEX IF NOT EXISTS idx_prompts_is_template ON prompts(is_template)`,

  `CREATE INDEX IF NOT EXISTS idx_prompts_use_count ON prompts(use_count DESC)`,

  `CREATE INDEX IF NOT EXISTS idx_prompts_last_used ON prompts(last_used_at DESC)`,

  `CREATE INDEX IF NOT EXISTS idx_prompts_project_id ON prompts(project_id)`,

  // Migration 5: prompt_versions table
  `CREATE TABLE IF NOT EXISTS prompt_versions (
    id TEXT PRIMARY KEY,
    prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    version INTEGER NOT NULL,
    changed_by TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_versions_prompt_id ON prompt_versions(prompt_id)`,

  // Migration 6: agents table
  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    active_project_id TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    last_seen_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 7: projects table
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    path TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 8: usage_log table
  `CREATE TABLE IF NOT EXISTS usage_log (
    id TEXT PRIMARY KEY,
    prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    used_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_usage_log_prompt_id ON usage_log(prompt_id)`,

  `CREATE INDEX IF NOT EXISTS idx_usage_log_used_at ON usage_log(used_at)`,

  // Migration 9: prompt_schedules table
  `CREATE TABLE IF NOT EXISTS prompt_schedules (
    id TEXT PRIMARY KEY,
    prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    prompt_slug TEXT NOT NULL,
    cron TEXT NOT NULL,
    vars TEXT NOT NULL DEFAULT '{}',
    agent_id TEXT,
    last_run_at TEXT,
    next_run_at TEXT NOT NULL,
    run_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_prompt_schedules_next_run ON prompt_schedules(next_run_at)`,

  `CREATE INDEX IF NOT EXISTS idx_prompt_schedules_prompt_id ON prompt_schedules(prompt_id)`,

  // Migration 10: feedback table
  `CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 11: body-object columns (additive; inline body retained as
  // rollback data until the verified cutover).
  `ALTER TABLE prompts ADD COLUMN IF NOT EXISTS tenant_id TEXT`,
  `ALTER TABLE prompts ADD COLUMN IF NOT EXISTS body_uri TEXT`,
  `ALTER TABLE prompts ADD COLUMN IF NOT EXISTS body_sha256 TEXT`,
  `ALTER TABLE prompts ADD COLUMN IF NOT EXISTS body_bytes BIGINT`,
  `ALTER TABLE prompts ADD COLUMN IF NOT EXISTS body_media_type TEXT`,
  `ALTER TABLE prompt_versions ADD COLUMN IF NOT EXISTS body_uri TEXT`,
  `ALTER TABLE prompt_versions ADD COLUMN IF NOT EXISTS body_sha256 TEXT`,
  `ALTER TABLE prompt_versions ADD COLUMN IF NOT EXISTS body_bytes BIGINT`,
  `CREATE INDEX IF NOT EXISTS idx_prompts_tenant_id ON prompts(tenant_id)`,

  // Migration 12: body registry table (immutable object ledger).
  `CREATE TABLE IF NOT EXISTS prompt_bodies (
    body_uri TEXT PRIMARY KEY,
    body_sha256 TEXT NOT NULL,
    body_bytes BIGINT NOT NULL,
    body_media_type TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE INDEX IF NOT EXISTS idx_prompt_bodies_sha256 ON prompt_bodies(body_sha256)`,

  // Migration 13: storage events (dual-read fallbacks, migration writes).
  `CREATE TABLE IF NOT EXISTS prompt_storage_events (
    id TEXT PRIMARY KEY,
    event_kind TEXT NOT NULL,
    prompt_id TEXT NOT NULL,
    version BIGINT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE INDEX IF NOT EXISTS idx_storage_events_prompt ON prompt_storage_events(prompt_id)`,

  // Migration 14: application-built tsvector search (PG full-text index).
  `ALTER TABLE prompts ADD COLUMN IF NOT EXISTS search_vector tsvector`,
  `CREATE INDEX IF NOT EXISTS idx_prompts_search_vector ON prompts USING GIN (search_vector)`,
  `CREATE OR REPLACE FUNCTION prompts_set_search_vector() RETURNS trigger AS $$
    BEGIN
      NEW.search_vector :=
        setweight(to_tsvector('simple', coalesce(NEW.name, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(NEW.slug, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(NEW.body, '')), 'C') ||
        setweight(to_tsvector('simple', coalesce(NEW.description, '')), 'D');
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS prompts_search_vector_trigger ON prompts`,
  `CREATE TRIGGER prompts_search_vector_trigger
    BEFORE INSERT OR UPDATE OF name, slug, title, body, description ON prompts
    FOR EACH ROW EXECUTE FUNCTION prompts_set_search_vector()`,
];
