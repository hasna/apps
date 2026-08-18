-- Migration 008: monitor v2 — slug lifecycle, runs, attempts, leases, effects, receipts.
-- Executed by runMigrations() in db/client.ts, once, inside a transaction.
-- Idempotent via IF NOT EXISTS; table shapes follow the monitor-v2 design §5.

CREATE TABLE IF NOT EXISTS slugs (
  id                 TEXT    PRIMARY KEY,
  name               TEXT    NOT NULL UNIQUE,
  description        TEXT    NOT NULL DEFAULT '',
  desired_state      TEXT    NOT NULL DEFAULT 'stopped'
                     CHECK(desired_state IN ('stopped','running','draining','cancelling')),
  active_revision_id TEXT,
  execution_epoch    INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (active_revision_id) REFERENCES slug_revisions(id)
);

CREATE TABLE IF NOT EXISTS slug_revisions (
  id               TEXT    PRIMARY KEY,
  slug_id          TEXT    NOT NULL,
  revision         INTEGER NOT NULL,
  definition_json  TEXT    NOT NULL,
  definition_digest TEXT   NOT NULL,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  created_by       TEXT    NOT NULL DEFAULT '',
  UNIQUE(slug_id, revision),
  FOREIGN KEY (slug_id) REFERENCES slugs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS slug_control_requests (
  id              TEXT    PRIMARY KEY,
  idempotency_key TEXT    NOT NULL,
  slug_id         TEXT    NOT NULL,
  operation       TEXT    NOT NULL,
  request_digest  TEXT    NOT NULL,
  result_json     TEXT    NOT NULL,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(slug_id, idempotency_key, operation),
  FOREIGN KEY (slug_id) REFERENCES slugs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS slug_runs (
  id                TEXT    PRIMARY KEY,
  slug_id           TEXT    NOT NULL,
  revision_id       TEXT    NOT NULL,
  admission_key     TEXT    NOT NULL UNIQUE,
  state             TEXT    NOT NULL
                    CHECK(state IN ('admitted','leased','running','retry_wait',
                                    'reconciling','cancel_requested','terminal')),
  scheduled_at      INTEGER NOT NULL,
  admitted_at       INTEGER,
  started_at        INTEGER,
  finished_at       INTEGER,
  outcome           TEXT,
  execution_epoch   INTEGER NOT NULL DEFAULT 0,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  last_attempt_id   TEXT,
  terminal_receipt_id TEXT,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (slug_id) REFERENCES slugs(id) ON DELETE CASCADE,
  FOREIGN KEY (revision_id) REFERENCES slug_revisions(id),
  FOREIGN KEY (last_attempt_id) REFERENCES slug_attempts(id),
  FOREIGN KEY (terminal_receipt_id) REFERENCES receipts(id)
);

CREATE TABLE IF NOT EXISTS slug_attempts (
  id             TEXT    PRIMARY KEY,
  run_id         TEXT    NOT NULL,
  attempt_number INTEGER NOT NULL,
  state          TEXT    NOT NULL
                 CHECK(state IN ('leased','running','reconciling',
                                 'succeeded','failed','unknown','cancelled','expired')),
  worker_id      TEXT,
  lease_id       TEXT,
  started_at     INTEGER,
  finished_at    INTEGER,
  exit_code      INTEGER,
  outcome        TEXT,
  result_digest  TEXT,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(run_id, attempt_number),
  FOREIGN KEY (run_id) REFERENCES slug_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (lease_id) REFERENCES leases(id)
);

CREATE TABLE IF NOT EXISTS leases (
  id                  TEXT    PRIMARY KEY,
  attempt_id          TEXT    NOT NULL,
  run_id              TEXT    NOT NULL,
  worker_id           TEXT    NOT NULL,
  generation          INTEGER NOT NULL,
  fencing_token_digest TEXT   NOT NULL DEFAULT '',
  heartbeat_at        INTEGER,
  expires_at          INTEGER,
  revoked_at          INTEGER,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(run_id, generation),
  FOREIGN KEY (attempt_id) REFERENCES slug_attempts(id),
  FOREIGN KEY (run_id) REFERENCES slug_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS slug_effects (
  id               TEXT    PRIMARY KEY,
  run_id           TEXT    NOT NULL,
  attempt_id       TEXT,
  effect_key       TEXT    NOT NULL UNIQUE,
  integration      TEXT    NOT NULL,
  operation        TEXT    NOT NULL,
  target           TEXT,
  state            TEXT    NOT NULL
                   CHECK(state IN ('planned','sent','confirmed','unknown','failed')),
  request_digest   TEXT,
  external_id      TEXT,
  result_pointer   TEXT,
  last_error_class TEXT,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (run_id) REFERENCES slug_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (attempt_id) REFERENCES slug_attempts(id)
);

CREATE TABLE IF NOT EXISTS receipts (
  id                   TEXT    PRIMARY KEY,
  run_id               TEXT    NOT NULL UNIQUE,
  attempt_id           TEXT,
  lease_id             TEXT,
  lease_generation     INTEGER,
  state                TEXT    NOT NULL,
  reason               TEXT    NOT NULL,
  durable_effect_pointer TEXT,
  evidence_pointer     TEXT,
  result_digest        TEXT,
  created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (run_id) REFERENCES slug_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (attempt_id) REFERENCES slug_attempts(id),
  FOREIGN KEY (lease_id) REFERENCES leases(id)
);

CREATE TABLE IF NOT EXISTS daemon_state (
  id               TEXT    PRIMARY KEY,
  daemon_id        TEXT    NOT NULL,
  state            TEXT    NOT NULL,
  leader_epoch     INTEGER NOT NULL DEFAULT 0,
  worker_capacity  INTEGER NOT NULL DEFAULT 0,
  heartbeat_at     INTEGER,
  drain_started_at INTEGER,
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_slug_runs_slug_state
  ON slug_runs (slug_id, state, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_slug_runs_scheduled
  ON slug_runs (scheduled_at);
CREATE INDEX IF NOT EXISTS idx_leases_expires
  ON leases (expires_at);
CREATE INDEX IF NOT EXISTS idx_receipts_created
  ON receipts (created_at);
CREATE INDEX IF NOT EXISTS idx_slug_revisions_slug
  ON slug_revisions (slug_id, revision);
