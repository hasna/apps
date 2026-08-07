-- Guarded project metadata mutation receipts.

CREATE TABLE IF NOT EXISTS guarded_project_mutation_receipts (
  receipt_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('forward', 'inverse')),
  idempotency_key TEXT NOT NULL,
  target_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  request_digest TEXT NOT NULL,
  precondition_digest TEXT NOT NULL,
  expected_revision TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('accepted', 'duplicate_of_accepted', 'terminal_nonacceptance')),
  reason TEXT,
  result_project_id TEXT,
  duplicate_of_receipt_id TEXT,
  before_json TEXT,
  after_json TEXT,
  post_revision TEXT,
  created_at TEXT NOT NULL DEFAULT NOW()::text
);

CREATE INDEX IF NOT EXISTS idx_guarded_project_mutation_receipts_lookup
  ON guarded_project_mutation_receipts(operation_id, step_id, direction, idempotency_key, target_id);
CREATE INDEX IF NOT EXISTS idx_guarded_project_mutation_receipts_target
  ON guarded_project_mutation_receipts(target_id, created_at);
