import type { Database } from "bun:sqlite";

// Idempotent DDL + a schema_migrations ledger. No ORM (hand-rolled SQL).
// The append-only audit table is protected by triggers that RAISE(ABORT) on
// UPDATE/DELETE (SQLite) / RAISE EXCEPTION (Postgres) — BUILD-SPEC §4.7.

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS entities (
  entity_id TEXT PRIMARY KEY,
  entity_slug TEXT UNIQUE,
  name TEXT NOT NULL,
  base_currency TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS balance_snapshots (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(entity_id),
  account_ref TEXT NOT NULL,
  account_kind TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  as_of TEXT NOT NULL,
  source TEXT NOT NULL,
  captured_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_balances_entity ON balance_snapshots(entity_id);

CREATE TABLE IF NOT EXISTS fx_rates (
  id TEXT PRIMARY KEY,
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  rate REAL NOT NULL,
  as_of TEXT NOT NULL,
  source TEXT NOT NULL,
  captured_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fx_pair ON fx_rates(base_currency, quote_currency);

CREATE TABLE IF NOT EXISTS cost_feeds (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(entity_id),
  currency TEXT NOT NULL,
  monthly_burn_minor INTEGER NOT NULL,
  as_of TEXT NOT NULL,
  source TEXT NOT NULL,
  captured_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cost_entity ON cost_feeds(entity_id);

CREATE TABLE IF NOT EXISTS sweep_recommendations (
  id TEXT PRIMARY KEY,
  from_entity_id TEXT NOT NULL REFERENCES entities(entity_id),
  to_entity_id TEXT NOT NULL REFERENCES entities(entity_id),
  currency TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  rationale TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'recommended',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sweeps_from ON sweep_recommendations(from_entity_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id TEXT,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Keep the hash chain strictly linear under concurrent writers: each row's
-- prev_hash is the previous row's row_hash, so it is unique by construction.
-- A concurrent fork (two appends reading the same prev_hash) then loses the
-- race with a unique-violation instead of silently forking the chain (§4.7).
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_prev_hash ON audit_log(prev_hash);

CREATE TRIGGER IF NOT EXISTS audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
`;

export function runSqliteMigrations(db: Database): void {
  db.run(SQLITE_SCHEMA);
  db.run("INSERT OR IGNORE INTO schema_migrations (id) VALUES (1)");
}

/**
 * Logical migrations for cloud Postgres. Applied in order through the vendored
 * storage-kit executor. Kept in lockstep with the SQLite schema above.
 */
export const POSTGRES_MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
     id INTEGER PRIMARY KEY,
     applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `INSERT INTO schema_migrations (id) VALUES (1) ON CONFLICT DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS entities (
     entity_id TEXT PRIMARY KEY,
     entity_slug TEXT UNIQUE,
     name TEXT NOT NULL,
     base_currency TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS balance_snapshots (
     id TEXT PRIMARY KEY,
     entity_id TEXT NOT NULL REFERENCES entities(entity_id),
     account_ref TEXT NOT NULL,
     account_kind TEXT NOT NULL,
     currency TEXT NOT NULL,
     amount_minor BIGINT NOT NULL,
     as_of TEXT NOT NULL,
     source TEXT NOT NULL,
     captured_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_balances_entity ON balance_snapshots(entity_id)`,
  `CREATE TABLE IF NOT EXISTS fx_rates (
     id TEXT PRIMARY KEY,
     base_currency TEXT NOT NULL,
     quote_currency TEXT NOT NULL,
     rate DOUBLE PRECISION NOT NULL,
     as_of TEXT NOT NULL,
     source TEXT NOT NULL,
     captured_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_fx_pair ON fx_rates(base_currency, quote_currency)`,
  `CREATE TABLE IF NOT EXISTS cost_feeds (
     id TEXT PRIMARY KEY,
     entity_id TEXT NOT NULL REFERENCES entities(entity_id),
     currency TEXT NOT NULL,
     monthly_burn_minor BIGINT NOT NULL,
     as_of TEXT NOT NULL,
     source TEXT NOT NULL,
     captured_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_cost_entity ON cost_feeds(entity_id)`,
  `CREATE TABLE IF NOT EXISTS sweep_recommendations (
     id TEXT PRIMARY KEY,
     from_entity_id TEXT NOT NULL REFERENCES entities(entity_id),
     to_entity_id TEXT NOT NULL REFERENCES entities(entity_id),
     currency TEXT NOT NULL,
     amount_minor BIGINT NOT NULL,
     rationale TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'recommended',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_sweeps_from ON sweep_recommendations(from_entity_id)`,
  `CREATE TABLE IF NOT EXISTS audit_log (
     id BIGSERIAL PRIMARY KEY,
     entity_id TEXT,
     actor_id TEXT NOT NULL,
     action TEXT NOT NULL,
     detail TEXT NOT NULL,
     prev_hash TEXT NOT NULL,
     row_hash TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_prev_hash ON audit_log(prev_hash)`,
  `CREATE OR REPLACE FUNCTION treasury_audit_immutable() RETURNS trigger AS $$
   BEGIN RAISE EXCEPTION 'audit_log is append-only'; END; $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS audit_log_no_mutate ON audit_log`,
  `CREATE TRIGGER audit_log_no_mutate BEFORE UPDATE OR DELETE ON audit_log
     FOR EACH ROW EXECUTE FUNCTION treasury_audit_immutable()`,
];
