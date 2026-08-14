// Idempotent DDL + schema_migrations ledger + append-only tamper-evident audit.
// No ORM: hand-rolled CREATE TABLE IF NOT EXISTS statements (§4).

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO schema_migrations (id) VALUES (1);

-- Cached entity references (entity-anchoring, §1c). entity_id is an unguessable UUIDv4.
CREATE TABLE IF NOT EXISTS entities (
  entity_id   TEXT PRIMARY KEY,
  entity_slug TEXT UNIQUE,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assets (
  id          TEXT PRIMARY KEY,
  entity_id   TEXT NOT NULL REFERENCES entities(entity_id),
  kind        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'draft',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assets_entity ON assets(entity_id);
CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind);

CREATE TABLE IF NOT EXISTS registrations (
  id                TEXT PRIMARY KEY,
  asset_id          TEXT NOT NULL REFERENCES assets(id),
  jurisdiction      TEXT NOT NULL,
  office            TEXT,
  kind              TEXT NOT NULL DEFAULT 'application',
  app_number        TEXT,
  reg_number        TEXT,
  filing_date       TEXT,
  registration_date TEXT,
  status            TEXT NOT NULL DEFAULT 'filed',
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_registrations_asset ON registrations(asset_id);

CREATE TABLE IF NOT EXISTS renewals (
  id               TEXT PRIMARY KEY,
  asset_id         TEXT NOT NULL REFERENCES assets(id),
  registration_id  TEXT REFERENCES registrations(id),
  due_date         TEXT NOT NULL,
  fee_amount       REAL,
  fee_currency     TEXT,
  status           TEXT NOT NULL DEFAULT 'upcoming',
  reminder_days    INTEGER NOT NULL DEFAULT 30,
  last_reminded_at TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_renewals_asset ON renewals(asset_id);
CREATE INDEX IF NOT EXISTS idx_renewals_due ON renewals(due_date);

CREATE TABLE IF NOT EXISTS classes (
  id          TEXT PRIMARY KEY,
  asset_id    TEXT NOT NULL REFERENCES assets(id),
  nice_class  INTEGER NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_classes_asset ON classes(asset_id);

CREATE TABLE IF NOT EXISTS documents (
  id         TEXT PRIMARY KEY,
  asset_id   TEXT NOT NULL REFERENCES assets(id),
  title      TEXT NOT NULL,
  doc_type   TEXT NOT NULL DEFAULT 'filing',
  doc_ref    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_documents_asset ON documents(asset_id);

-- Append-only, tamper-evident audit ledger (§4.7). Insert-only + hash-chained.
CREATE TABLE IF NOT EXISTS audit_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    TEXT NOT NULL UNIQUE,
  entity_id   TEXT,
  action      TEXT NOT NULL,
  resource    TEXT NOT NULL,
  resource_id TEXT,
  actor_id    TEXT NOT NULL,
  payload     TEXT NOT NULL DEFAULT '{}',
  prev_hash   TEXT NOT NULL,
  row_hash    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Immutability triggers: audit rows can never be updated or deleted (§4.7).
CREATE TRIGGER IF NOT EXISTS audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events is append-only: UPDATE forbidden');
END;

CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events is append-only: DELETE forbidden');
END;
`;

/** Tables that must never be pushed/pulled/synced (§4.6/§4.7). */
export const AUDIT_TABLES = ["audit_events"] as const;

/** All domain tables eligible for storage push/pull/sync. */
export const SYNC_TABLES = [
  "entities",
  "assets",
  "registrations",
  "renewals",
  "classes",
  "documents",
] as const;
