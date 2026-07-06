import { AUDIT_TABLE } from "./audit.js";
import { DATA_TABLES } from "./store.js";

// Idempotent schema for both dialects. Local uses bun:sqlite; cloud uses the
// vendored Postgres kit. Both keep a `schema_migrations` ledger and an
// append-only, tamper-evident `audit_log` (UPDATE/DELETE blocked by triggers in
// SQLite; by role grants in Postgres).

function dataTableSqlite(table: string): string {
  return `CREATE TABLE IF NOT EXISTS ${table} (
  id TEXT PRIMARY KEY,
  entity_id TEXT,
  period TEXT,
  run_id TEXT,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_${table}_entity ON ${table}(entity_id);
CREATE INDEX IF NOT EXISTS idx_${table}_period ON ${table}(period);
CREATE INDEX IF NOT EXISTS idx_${table}_run ON ${table}(run_id);`;
}

function dataTablePg(table: string): string {
  return `CREATE TABLE IF NOT EXISTS ${table} (
  id TEXT PRIMARY KEY,
  entity_id TEXT,
  period TEXT,
  run_id TEXT,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_${table}_entity ON ${table}(entity_id);
CREATE INDEX IF NOT EXISTS idx_${table}_period ON ${table}(period);
CREATE INDEX IF NOT EXISTS idx_${table}_run ON ${table}(run_id);`;
}

const AUDIT_SQLITE = `CREATE TABLE IF NOT EXISTS ${AUDIT_TABLE} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS ${AUDIT_TABLE}_no_update
BEFORE UPDATE ON ${AUDIT_TABLE}
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ${AUDIT_TABLE}_no_delete
BEFORE DELETE ON ${AUDIT_TABLE}
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;`;

const AUDIT_PG = `CREATE TABLE IF NOT EXISTS ${AUDIT_TABLE} (
  id BIGSERIAL PRIMARY KEY,
  event TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE RULE ${AUDIT_TABLE}_no_update AS ON UPDATE TO ${AUDIT_TABLE} DO INSTEAD NOTHING;
CREATE OR REPLACE RULE ${AUDIT_TABLE}_no_delete AS ON DELETE TO ${AUDIT_TABLE} DO INSTEAD NOTHING;`;

const MIGRATIONS_SQLITE = `CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;

/** Full local (SQLite) schema, idempotent. */
export function sqliteSchema(): string {
  return [
    MIGRATIONS_SQLITE,
    ...DATA_TABLES.map(dataTableSqlite),
    AUDIT_SQLITE,
  ].join("\n\n");
}

/** Ordered per-table Postgres DDL statements, idempotent (applied via the kit). */
export function pgSchemaStatements(): string[] {
  return [
    ...DATA_TABLES.map(dataTablePg),
    AUDIT_PG,
  ];
}
