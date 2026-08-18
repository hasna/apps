-- Taxonomy vocabulary alignment (contracts-alignment-r2, taxonomy lane).
-- Queue lifecycle statuses move to admitted/leased/running/ambiguous (terminal
-- succeeded/failed/cancelled unchanged); the attempt lease is named
-- lease_token/lease_generation/lease_expires_at; the terminal receipt is named
-- receipt_json. Existing rows are preserved and re-mapped, never deleted.

PRAGMA ignore_check_constraints = ON;
-- The parent-table rebuilds below drop and recreate referenced tables; defer
-- foreign-key enforcement to the enclosing transaction so the drop-then-recreate
-- dance is validated against the rebuilt tables at commit time.
PRAGMA defer_foreign_keys = ON;

-- Rebuild operations with the taxonomy status CHECK and the receipt column.
CREATE TABLE operations_taxonomy (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('create', 'start', 'stop', 'quarantine', 'delete', 'exec', 'install', 'snapshot', 'restore')),
  status TEXT NOT NULL CHECK (status IN ('admitted', 'leased', 'running', 'ambiguous', 'succeeded', 'failed', 'cancelled')),
  policy_generation INTEGER NOT NULL CHECK (policy_generation > 0),
  idempotency_key TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK (json_valid(request_json) AND json_type(request_json) = 'object'),
  prior_computer_status TEXT CHECK (prior_computer_status IS NULL OR prior_computer_status IN ('provisioning', 'stopped', 'running', 'quarantined', 'deleting', 'deleted', 'error')),
  desired_computer_status TEXT CHECK (desired_computer_status IS NULL OR desired_computer_status IN ('provisioning', 'stopped', 'running', 'quarantined', 'deleting', 'deleted', 'error')),
  receipt_json TEXT CHECK (receipt_json IS NULL OR (json_valid(receipt_json) AND json_type(receipt_json) = 'object')),
  error_code TEXT,
  fence INTEGER NOT NULL DEFAULT 0 CHECK (fence >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, computer_id, kind, idempotency_key),
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id)
);
INSERT INTO operations_taxonomy SELECT
  id, tenant_id, computer_id, kind,
  CASE status WHEN 'pending' THEN 'admitted' WHEN 'accepted' THEN 'leased' WHEN 'unknown' THEN 'ambiguous' ELSE status END,
  policy_generation, idempotency_key, request_json, prior_computer_status, desired_computer_status,
  result_json, error_code, fence, created_at, updated_at
FROM operations;
DROP TABLE operations;
CREATE TABLE operations (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('create', 'start', 'stop', 'quarantine', 'delete', 'exec', 'install', 'snapshot', 'restore')),
  status TEXT NOT NULL CHECK (status IN ('admitted', 'leased', 'running', 'ambiguous', 'succeeded', 'failed', 'cancelled')),
  policy_generation INTEGER NOT NULL CHECK (policy_generation > 0),
  idempotency_key TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK (json_valid(request_json) AND json_type(request_json) = 'object'),
  prior_computer_status TEXT CHECK (prior_computer_status IS NULL OR prior_computer_status IN ('provisioning', 'stopped', 'running', 'quarantined', 'deleting', 'deleted', 'error')),
  desired_computer_status TEXT CHECK (desired_computer_status IS NULL OR desired_computer_status IN ('provisioning', 'stopped', 'running', 'quarantined', 'deleting', 'deleted', 'error')),
  receipt_json TEXT CHECK (receipt_json IS NULL OR (json_valid(receipt_json) AND json_type(receipt_json) = 'object')),
  error_code TEXT,
  fence INTEGER NOT NULL DEFAULT 0 CHECK (fence >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, computer_id, kind, idempotency_key),
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id)
);
-- The provider-binding FK references operations (tenant_id, id, computer_id), so the
-- 3-column unique index must exist before any parent row is inserted.
CREATE UNIQUE INDEX operations_assurance_computer_key ON operations (tenant_id, id, computer_id);
INSERT INTO operations SELECT * FROM operations_taxonomy;
DROP TABLE operations_taxonomy;

-- Rebuild operation_attempts with the taxonomy status CHECK and lease columns.
CREATE TABLE operation_attempts_taxonomy (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  provider_idempotency_key TEXT NOT NULL,
  provider_operation_id TEXT,
  resource_json TEXT CHECK (resource_json IS NULL OR (json_valid(resource_json) AND json_type(resource_json) = 'object')),
  status TEXT NOT NULL CHECK (status IN ('running', 'ambiguous', 'succeeded', 'failed')),
  fence INTEGER NOT NULL CHECK (fence >= 0),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  lease_token TEXT,
  lease_generation INTEGER NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
  lease_expires_at TEXT,
  UNIQUE (tenant_id, operation_id, attempt_number),
  UNIQUE (tenant_id, provider_idempotency_key),
  FOREIGN KEY (tenant_id, operation_id) REFERENCES operations (tenant_id, id)
);
INSERT INTO operation_attempts_taxonomy SELECT
  id, tenant_id, operation_id, attempt_number, provider_idempotency_key, provider_operation_id, resource_json,
  CASE status WHEN 'unknown' THEN 'ambiguous' ELSE status END,
  fence, started_at, completed_at, execution_owner_token, execution_owner_generation, execution_owner_expires_at
FROM operation_attempts;
DROP TABLE operation_attempts;
CREATE TABLE operation_attempts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  provider_idempotency_key TEXT NOT NULL,
  provider_operation_id TEXT,
  resource_json TEXT CHECK (resource_json IS NULL OR (json_valid(resource_json) AND json_type(resource_json) = 'object')),
  status TEXT NOT NULL CHECK (status IN ('running', 'ambiguous', 'succeeded', 'failed')),
  fence INTEGER NOT NULL CHECK (fence >= 0),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  lease_token TEXT,
  lease_generation INTEGER NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
  lease_expires_at TEXT,
  UNIQUE (tenant_id, operation_id, attempt_number),
  UNIQUE (tenant_id, provider_idempotency_key),
  FOREIGN KEY (tenant_id, operation_id) REFERENCES operations (tenant_id, id)
);
-- The provider-binding and assurance FKs reference operation_attempts
-- (tenant_id, operation_id, id), so the 3-column unique index must exist before
-- any parent row is inserted.
CREATE UNIQUE INDEX operation_attempts_assurance_operation_key ON operation_attempts (tenant_id, operation_id, id);
INSERT INTO operation_attempts SELECT * FROM operation_attempts_taxonomy;
DROP TABLE operation_attempts_taxonomy;

-- Restore the indexes the table rebuilds dropped, with taxonomy statuses.
CREATE UNIQUE INDEX operation_attempts_tenant_id_id ON operation_attempts (tenant_id, id);
CREATE UNIQUE INDEX operations_one_active_lifecycle
  ON operations (tenant_id, computer_id)
  WHERE kind IN ('create', 'start', 'stop', 'quarantine', 'delete', 'restore')
    AND status IN ('admitted', 'leased', 'running', 'ambiguous');

PRAGMA defer_foreign_keys = OFF;
PRAGMA ignore_check_constraints = OFF;

INSERT INTO schema_migrations (version, applied_at)
VALUES (4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
