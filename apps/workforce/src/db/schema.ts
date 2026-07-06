import type { Database } from "bun:sqlite";

// Idempotent DDL + schema_migrations ledger for @hasna/workforce.
//
// The lifecycle_events table is append-only and tamper-evident (§4.7): SQLite
// triggers RAISE(ABORT) on UPDATE/DELETE, and rows are hash-chained in
// src/db/audit.ts. The same shape maps onto Postgres in cloud mode via role
// grants (no UPDATE/DELETE) applied through the migration plan.

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO schema_migrations (id) VALUES (1);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('human','contractor','agent')),
  name TEXT NOT NULL,
  owner_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  role TEXT NOT NULL DEFAULT '',
  home_entity_id TEXT NOT NULL,
  home_entity_slug TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','offboarded')),
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_members_entity ON members(home_entity_id);
CREATE INDEX IF NOT EXISTS idx_members_owner ON members(owner_id);
CREATE INDEX IF NOT EXISTS idx_members_kind ON members(kind);

CREATE TABLE IF NOT EXISTS capabilities (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  level TEXT NOT NULL DEFAULT 'intermediate' CHECK (level IN ('novice','intermediate','advanced','expert')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_capabilities_member ON capabilities(member_id);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL,
  project TEXT,
  role_on_assignment TEXT NOT NULL DEFAULT '',
  allocation_pct INTEGER NOT NULL DEFAULT 100,
  start_date TEXT NOT NULL,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_assignments_member ON assignments(member_id);
CREATE INDEX IF NOT EXISTS idx_assignments_entity ON assignments(entity_id);

-- Append-only, tamper-evident lifecycle audit (joiner-mover-leaver).
CREATE TABLE IF NOT EXISTS lifecycle_events (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('hire','role_change','suspend','reactivate','offboard')),
  effective_date TEXT NOT NULL,
  from_role TEXT,
  to_role TEXT,
  reason TEXT,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  prev_hash TEXT NOT NULL,
  row_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifecycle_member ON lifecycle_events(member_id);

CREATE TRIGGER IF NOT EXISTS lifecycle_events_no_update
BEFORE UPDATE ON lifecycle_events
BEGIN
  SELECT RAISE(ABORT, 'lifecycle_events is append-only: UPDATE is forbidden');
END;

CREATE TRIGGER IF NOT EXISTS lifecycle_events_no_delete
BEFORE DELETE ON lifecycle_events
BEGIN
  SELECT RAISE(ABORT, 'lifecycle_events is append-only: DELETE is forbidden');
END;
`;

/** Apply the idempotent schema to a local SQLite database. */
export function applySchema(db: Database): void {
  db.run(SCHEMA_SQL);
}

/** Tables that are append-only audit and must NEVER be pushed/pulled/overwritten. */
export const AUDIT_TABLES = new Set<string>(["lifecycle_events"]);

/** Tables eligible for storage push/pull/sync (excludes audit + ledger). */
export const SYNCABLE_TABLES = ["members", "capabilities", "assignments"] as const;
