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

/** Apply the idempotent schema. Safe to call on every open. */
export function runMigrations(db: Database): void {
  db.run(SCHEMA);
}

/** Count of applied ledger rows — surfaced in storage_status. */
export function migrationsApplied(db: Database): number {
  const row = db.query("SELECT COUNT(*) AS c FROM schema_migrations").get() as { c: number } | null;
  return row?.c ?? 0;
}
