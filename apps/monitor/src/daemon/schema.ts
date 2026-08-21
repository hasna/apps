/**
 * monitor-v2 daemon schema — slugs, runs, attempts, leases, effects,
 * receipts, and daemon_state, per design.md section 5.
 *
 * This is the idempotent DDL the daemon applies to its own store (fresh or
 * migrated databases). It is column-for-column identical to the transactional
 * migration 008 (`src/db/migrations/008_monitor_v2.sql`, MON-V2-02) for the
 * v2 tables: applying both in either order is a no-op because every statement
 * is `CREATE TABLE IF NOT EXISTS`, and a daemon write that satisfies one
 * satisfies the other. Column constraints follow 008 exactly — NOT NULL
 * columns carry the same defaults (`slugs.description NOT NULL DEFAULT ''`,
 * `receipts.lease_generation NOT NULL`, `slug_runs.revision_id` nullable,
 * `slug_effects.target NOT NULL DEFAULT ''`, ...).
 */

import type { Database } from "bun:sqlite";

export const V2_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS slugs (
  id                TEXT    PRIMARY KEY,
  name              TEXT    NOT NULL UNIQUE,
  description       TEXT    NOT NULL DEFAULT '',
  desired_state     TEXT    NOT NULL DEFAULT 'stopped'
                      CHECK(desired_state IN ('stopped','draining','running')),
  active_revision_id TEXT REFERENCES slug_revisions(id),
  execution_epoch   INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS slug_revisions (
  id                TEXT    PRIMARY KEY,
  slug_id           TEXT    NOT NULL REFERENCES slugs(id) ON DELETE CASCADE,
  revision          INTEGER NOT NULL,
  definition_json   TEXT    NOT NULL,
  definition_digest TEXT    NOT NULL,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  created_by        TEXT    NOT NULL DEFAULT '',
  UNIQUE(slug_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_slug_revisions_slug
  ON slug_revisions (slug_id);

CREATE TABLE IF NOT EXISTS slug_control_requests (
  id                TEXT    PRIMARY KEY,
  idempotency_key   TEXT    NOT NULL,
  slug_id           TEXT    NOT NULL REFERENCES slugs(id) ON DELETE CASCADE,
  operation         TEXT    NOT NULL,
  request_digest    TEXT    NOT NULL,
  result_json       TEXT    NOT NULL DEFAULT '',
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(slug_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS slug_runs (
  id                TEXT    PRIMARY KEY,
  slug_id           TEXT    NOT NULL REFERENCES slugs(id) ON DELETE CASCADE,
  revision_id       TEXT    REFERENCES slug_revisions(id),
  admission_key     TEXT    NOT NULL UNIQUE,
  state             TEXT    NOT NULL DEFAULT 'admitted'
                      CHECK(state IN (
                        'admitted','leased','running','retry_wait',
                        'reconciling','cancel_requested','terminal'
                      )),
  scheduled_at      INTEGER NOT NULL,
  admitted_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at        INTEGER,
  finished_at       INTEGER,
  outcome           TEXT,
  execution_epoch   INTEGER NOT NULL DEFAULT 0,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  last_attempt_id   TEXT,
  terminal_receipt_id TEXT,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_slug_runs_slug_state_scheduled
  ON slug_runs (slug_id, state, scheduled_at);

CREATE TABLE IF NOT EXISTS slug_attempts (
  id                TEXT    PRIMARY KEY,
  run_id            TEXT    NOT NULL REFERENCES slug_runs(id) ON DELETE CASCADE,
  attempt_number    INTEGER NOT NULL,
  state             TEXT    NOT NULL DEFAULT 'leased'
                      CHECK(state IN (
                        'leased','running','reconciling','succeeded',
                        'failed','unknown','cancelled','expired'
                      )),
  worker_id         TEXT,
  lease_id          TEXT,
  started_at        INTEGER,
  finished_at       INTEGER,
  exit_code         INTEGER,
  outcome           TEXT,
  result_digest     TEXT,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(run_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS leases (
  id                TEXT    PRIMARY KEY,
  attempt_id        TEXT    NOT NULL REFERENCES slug_attempts(id) ON DELETE CASCADE,
  run_id            TEXT    NOT NULL REFERENCES slug_runs(id) ON DELETE CASCADE,
  worker_id         TEXT    NOT NULL,
  generation        INTEGER NOT NULL,
  fencing_token_digest TEXT NOT NULL,
  heartbeat_at      INTEGER,
  expires_at        INTEGER NOT NULL,
  revoked_at        INTEGER,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(run_id, generation)
);

-- Only one non-revoked active lease may exist for an attempt (design §5).
CREATE UNIQUE INDEX IF NOT EXISTS uq_leases_active_attempt
  ON leases (attempt_id) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leases_expires_at
  ON leases (expires_at);

CREATE INDEX IF NOT EXISTS idx_leases_worker ON leases (worker_id);

CREATE TABLE IF NOT EXISTS slug_effects (
  id                TEXT    PRIMARY KEY,
  run_id            TEXT    NOT NULL REFERENCES slug_runs(id) ON DELETE CASCADE,
  attempt_id        TEXT    REFERENCES slug_attempts(id) ON DELETE CASCADE,
  effect_key        TEXT    NOT NULL UNIQUE,
  integration       TEXT    NOT NULL,
  operation         TEXT    NOT NULL,
  target            TEXT    NOT NULL DEFAULT '',
  state             TEXT    NOT NULL DEFAULT 'planned'
                      CHECK(state IN ('planned','sent','confirmed','unknown','failed')),
  request_digest    TEXT    NOT NULL DEFAULT '',
  external_id       TEXT,
  result_pointer    TEXT,
  last_error_class  TEXT,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS receipts (
  id                TEXT    PRIMARY KEY,
  run_id            TEXT    NOT NULL UNIQUE REFERENCES slug_runs(id) ON DELETE CASCADE,
  attempt_id        TEXT    REFERENCES slug_attempts(id),
  lease_id          TEXT    REFERENCES leases(id),
  lease_generation  INTEGER NOT NULL,
  state             TEXT    NOT NULL DEFAULT 'terminal',
  reason            TEXT    NOT NULL DEFAULT '',
  durable_effect_pointer TEXT,
  evidence_pointer  TEXT,
  result_digest     TEXT    NOT NULL DEFAULT '',
  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_receipts_created_at ON receipts (created_at);

CREATE TABLE IF NOT EXISTS daemon_state (
  id                TEXT    PRIMARY KEY,
  daemon_id         TEXT    NOT NULL,
  state             TEXT    NOT NULL DEFAULT 'running',
  leader_epoch      INTEGER NOT NULL DEFAULT 0,
  worker_capacity   INTEGER NOT NULL DEFAULT 1,
  heartbeat_at      INTEGER,
  drain_started_at  INTEGER,
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
`;

/** Apply the v2 schema idempotently to a database. */
export function ensureV2Schema(db: Database): void {
  db.run(V2_SCHEMA_SQL);
}
