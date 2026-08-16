-- Migration 0005: immutable full project-registration manifests and receipts.

CREATE TABLE IF NOT EXISTS project_registration_manifests (
  operation_id TEXT PRIMARY KEY,
  route TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  project_id TEXT NOT NULL,
  project_slug TEXT NOT NULL,
  plan_json JSONB NOT NULL,
  created_at TEXT NOT NULL DEFAULT NOW()::text
);

CREATE TABLE IF NOT EXISTS project_registration_receipts (
  receipt_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES project_registration_manifests(operation_id),
  sequence INTEGER NOT NULL,
  step_id TEXT NOT NULL,
  authority TEXT NOT NULL,
  resource_kind TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('forward', 'inverse')),
  idempotency_key TEXT NOT NULL,
  target_id TEXT,
  request_digest TEXT NOT NULL,
  precondition_digest TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('accepted', 'duplicate_of_accepted', 'terminal_nonacceptance')),
  reason TEXT,
  result_revision TEXT,
  result_digest TEXT,
  duplicate_of_receipt_id TEXT,
  authority_receipt_json JSONB,
  artifacts_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  preconditions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  rollback_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TEXT NOT NULL DEFAULT NOW()::text,
  UNIQUE(operation_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_project_registration_receipts_lookup
  ON project_registration_receipts(operation_id, step_id, direction, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_project_registration_receipts_target
  ON project_registration_receipts(authority, resource_kind, target_id, created_at);

CREATE OR REPLACE FUNCTION reject_project_registration_history_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'project registration history is immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS project_registration_manifests_no_update ON project_registration_manifests;
CREATE TRIGGER project_registration_manifests_no_update
BEFORE UPDATE OR DELETE ON project_registration_manifests
FOR EACH ROW EXECUTE FUNCTION reject_project_registration_history_mutation();

DROP TRIGGER IF EXISTS project_registration_receipts_no_update ON project_registration_receipts;
CREATE TRIGGER project_registration_receipts_no_update
BEFORE UPDATE OR DELETE ON project_registration_receipts
FOR EACH ROW EXECUTE FUNCTION reject_project_registration_history_mutation();
