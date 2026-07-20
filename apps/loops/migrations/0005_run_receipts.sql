-- @generated mirror of POSTGRES_STORAGE_MIGRATIONS["0005_run_receipts"] — DO NOT EDIT.
-- Source of truth: src/lib/storage/postgres-schema.ts
-- Runner: loops-serve migrate  (checksum: sha256:27228e19e0101d31ce9da18d76d918a96dd8afff576fb291cbf8d018e97fe5d6)

CREATE TABLE IF NOT EXISTS run_receipts (
  run_id TEXT PRIMARY KEY,
  loop_id TEXT NOT NULL,
  machine_json JSONB NOT NULL,
  repo TEXT NOT NULL,
  task_ids_json JSONB NOT NULL,
  knowledge_ids_json JSONB NOT NULL,
  digest_id TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  exit_code INTEGER,
  summary_json JSONB NOT NULL,
  evidence_paths_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_receipts_loop ON run_receipts(loop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_receipts_repo ON run_receipts(repo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_receipts_digest ON run_receipts(digest_id);
CREATE INDEX IF NOT EXISTS idx_run_receipts_status ON run_receipts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_receipts_task_ids ON run_receipts USING GIN (task_ids_json);
CREATE INDEX IF NOT EXISTS idx_run_receipts_knowledge_ids ON run_receipts USING GIN (knowledge_ids_json);
