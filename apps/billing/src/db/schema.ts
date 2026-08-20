import type { Database } from "bun:sqlite";

/**
 * Idempotent SQLite schema for @hasna/billing. Hand-rolled SQL (no ORM,
 * BUILD-SPEC §4). Every domain row is anchored to `entity_id`. The audit table
 * is append-only and enforced via RAISE(ABORT) triggers on UPDATE/DELETE
 * (BUILD-SPEC §4.7).
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO schema_migrations (id) VALUES (1);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  entity_slug TEXT,
  stripe_customer_id TEXT,
  email TEXT NOT NULL,
  name TEXT,
  currency TEXT NOT NULL DEFAULT 'usd',
  delinquent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  stripe_subscription_id TEXT,
  plan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  subscription_id TEXT REFERENCES subscriptions(id),
  stripe_invoice_id TEXT,
  amount_due INTEGER NOT NULL DEFAULT 0,
  amount_paid INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'draft',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dunning_policies (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  name TEXT NOT NULL,
  rules_json TEXT NOT NULL DEFAULT '{}',
  pre_dunning_hours INTEGER NOT NULL DEFAULT 72,
  max_attempts INTEGER NOT NULL DEFAULT 4,
  downgrade_plan TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dunning_runs (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  policy_id TEXT NOT NULL REFERENCES dunning_policies(id),
  attempt INTEGER NOT NULL DEFAULT 0,
  decline_code TEXT,
  outcome TEXT NOT NULL DEFAULT 'scheduled',
  scheduled_at TEXT,
  executed_at TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  stripe_event_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  payload_json TEXT NOT NULL DEFAULT '{}',
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS accounting_reconciliation_events (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  accounting_entry_ref TEXT,
  amount INTEGER,
  currency TEXT,
  state TEXT NOT NULL DEFAULT 'pending',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Entity-scoped uniqueness: the same provider event under two different
  -- tenants is two rows, never one (cross-tenant collapse = lost accounting).
  UNIQUE (entity_id, source, source_id, event_type)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  entity_id TEXT,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_id TEXT,
  detail TEXT,
  prev_hash TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customers_entity ON customers(entity_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_entity ON subscriptions(entity_id);
CREATE INDEX IF NOT EXISTS idx_invoices_entity ON invoices(entity_id);
CREATE INDEX IF NOT EXISTS idx_dunning_policies_entity ON dunning_policies(entity_id);
CREATE INDEX IF NOT EXISTS idx_dunning_runs_entity ON dunning_runs(entity_id);
CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_id);
CREATE INDEX IF NOT EXISTS idx_accounting_reconciliation_entity ON accounting_reconciliation_events(entity_id);

-- Append-only enforcement: the audit_log admits INSERTs only.
CREATE TRIGGER IF NOT EXISTS audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only: UPDATE is forbidden');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only: DELETE is forbidden');
END;
`;

/**
 * Legacy 0.1.0 upgrade: the reconciliation table shipped with
 * `UNIQUE (source, source_id, event_type)`. The entity-scoped upsert
 * (ON CONFLICT(entity_id, source, source_id, event_type)) has no matching
 * unique index on such a database, so every reconciliation emit throws
 * "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint".
 * Rebuild the table with the entity-scoped constraint, preserving rows.
 * No-op when the table already carries the entity-scoped constraint (fresh
 * schema, or already upgraded), so it is safe to run on every open.
 */
export function upgradeLegacyReconciliationConstraint(db: Database): void {
  const row = db
    .query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'accounting_reconciliation_events'")
    .get() as { sql: string } | null;
  const sql = row?.sql;
  if (!sql || /UNIQUE\s*\(\s*entity_id\s*,\s*source\s*,\s*source_id\s*,\s*event_type\s*\)/i.test(sql)) {
    return;
  }

  // Standard SQLite table-rebuild: rename legacy, create the new shape,
  // copy rows, drop the legacy table, recreate the entity index that dies
  // with it. The copy aborts if legacy data ever collided across entities on
  // (source, source_id, event_type) — those rows cannot be merged safely.
  db.run("ALTER TABLE accounting_reconciliation_events RENAME TO accounting_reconciliation_events_legacy");
  db.run(`
CREATE TABLE accounting_reconciliation_events (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  accounting_entry_ref TEXT,
  amount INTEGER,
  currency TEXT,
  state TEXT NOT NULL DEFAULT 'pending',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (entity_id, source, source_id, event_type)
)`);
  db.run(`
INSERT INTO accounting_reconciliation_events
  (id, entity_id, source, source_id, event_type, accounting_entry_ref, amount, currency, state, payload_json, created_at, updated_at)
SELECT
  id, entity_id, source, source_id, event_type, accounting_entry_ref, amount, currency, state, payload_json, created_at, updated_at
FROM accounting_reconciliation_events_legacy`);
  db.run("DROP TABLE accounting_reconciliation_events_legacy");
  db.run("CREATE INDEX IF NOT EXISTS idx_accounting_reconciliation_entity ON accounting_reconciliation_events(entity_id)");
}

/** Apply the idempotent schema. Safe to call on every open. */
export function runMigrations(db: Database): void {
  db.run(SCHEMA);
  upgradeLegacyReconciliationConstraint(db);
}

/** Count of applied ledger rows — surfaced in storage_status. */
export function migrationsApplied(db: Database): number {
  const row = db.query("SELECT COUNT(*) AS c FROM schema_migrations").get() as { c: number } | null;
  return row?.c ?? 0;
}
