import type { Database } from "bun:sqlite";

// Idempotent DDL for fleet's OWNED config store + append-only audit.
// fleet persists ONLY its own config (SLOs, budgets, saved views, alert
// thresholds, annotations) plus a local entities cache for offline entity_slug
// resolution (§1c). Fused upstream observability data is NEVER stored here.

const CONFIG_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  name TEXT,
  checksum TEXT,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Local cache of entity references (id + optional slug) for offline resolution.
-- In cloud, resolution is a @hasna/entities MCP call; in local it is this cache.
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS saved_views (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  entity_slug TEXT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_saved_views_entity ON saved_views(entity_id);

CREATE TABLE IF NOT EXISTS slos (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  entity_slug TEXT,
  target_type TEXT NOT NULL,
  target_ref TEXT NOT NULL,
  name TEXT NOT NULL,
  objective TEXT NOT NULL,
  target_value REAL NOT NULL,
  window_days INTEGER NOT NULL DEFAULT 30,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_slos_entity ON slos(entity_id);

CREATE TABLE IF NOT EXISTS error_budget_policies (
  id TEXT PRIMARY KEY,
  slo_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  budget_percent REAL NOT NULL,
  burn_alert_threshold REAL NOT NULL DEFAULT 0.8,
  window_days INTEGER NOT NULL DEFAULT 30,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ebp_slo ON error_budget_policies(slo_id);
CREATE INDEX IF NOT EXISTS idx_ebp_entity ON error_budget_policies(entity_id);

CREATE TABLE IF NOT EXISTS alert_thresholds (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  slo_id TEXT,
  metric TEXT NOT NULL,
  comparator TEXT NOT NULL,
  threshold_value REAL NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  enabled INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_thresholds_entity ON alert_thresholds(entity_id);

CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  target_ref TEXT NOT NULL,
  at TEXT NOT NULL,
  text TEXT NOT NULL,
  author TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_annotations_entity ON annotations(entity_id);
`;

// Append-only, tamper-evident audit table (§4.7). Insert-only, hash-chained.
// SQLite enforces immutability via triggers that RAISE(ABORT) on UPDATE/DELETE.
const AUDIT_DDL = `
CREATE TABLE IF NOT EXISTS fleet_audit (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT NOT NULL DEFAULT '{}',
  prev_hash TEXT NOT NULL,
  row_hash TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS fleet_audit_no_update
BEFORE UPDATE ON fleet_audit
BEGIN
  SELECT RAISE(ABORT, 'fleet_audit is append-only: UPDATE is forbidden');
END;

CREATE TRIGGER IF NOT EXISTS fleet_audit_no_delete
BEFORE DELETE ON fleet_audit
BEGIN
  SELECT RAISE(ABORT, 'fleet_audit is append-only: DELETE is forbidden');
END;
`;

export function runMigrations(db: Database): void {
  db.run(CONFIG_DDL);
  db.run(AUDIT_DDL);
  db.run("INSERT OR IGNORE INTO schema_migrations (id, name, checksum) VALUES (?, ?, ?)", [
    "0000-baseline",
    "baseline idempotent fleet config + append-only audit",
    "legacy-ensure-table",
  ]);
}
