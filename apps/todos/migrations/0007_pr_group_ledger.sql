-- Authoritative PR-group execution ledger.
--
-- Dedicated relational rows provide transaction/row-lock fencing for one
-- active writer generation. Events and receipts are append-only. This DDL is
-- additive and idempotent; it does not rewrite existing Todos JSONB records.
CREATE TABLE IF NOT EXISTS todos_pr_groups (
  schema_version integer NOT NULL DEFAULT 1,
  id text PRIMARY KEY,
  identity_key text NOT NULL UNIQUE,
  root_request_id text NOT NULL,
  repository text NOT NULL,
  leaf_task_id text NOT NULL,
  branch text NOT NULL,
  pr_number integer,
  base_sha text,
  state text NOT NULL,
  active_attempt_id text,
  active_generation text,
  repair_cycle_count integer NOT NULL DEFAULT 0,
  repair_cycle_limit integer NOT NULL DEFAULT 2,
  terminal_attempt_id text,
  terminal_generation text,
  terminal_outcome text,
  terminal_head_sha text,
  terminal_at timestamptz,
  cleanup_eligible_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS todos_pr_groups_root_repository_idx
  ON todos_pr_groups (root_request_id, repository);
CREATE INDEX IF NOT EXISTS todos_pr_groups_active_generation_idx
  ON todos_pr_groups (active_generation);

CREATE TABLE IF NOT EXISTS todos_pr_group_attempts (
  schema_version integer NOT NULL DEFAULT 1,
  id text PRIMARY KEY,
  group_id text NOT NULL REFERENCES todos_pr_groups(id) ON DELETE CASCADE,
  leaf_task_id text NOT NULL,
  dispatch_attempt text NOT NULL,
  writer_generation text NOT NULL,
  previous_attempt_id text REFERENCES todos_pr_group_attempts(id) ON DELETE SET NULL,
  worktree text NOT NULL,
  branch text NOT NULL,
  repository text NOT NULL,
  pr_number integer,
  base_sha text,
  provider text,
  provider_run_id text,
  profile_alias text,
  status text NOT NULL,
  admitted_at timestamptz NOT NULL,
  started_at timestamptz,
  last_heartbeat_at timestamptz,
  handed_off_at timestamptz,
  fenced_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (group_id, leaf_task_id, dispatch_attempt),
  UNIQUE (group_id, writer_generation)
);

CREATE INDEX IF NOT EXISTS todos_pr_group_attempts_group_idx
  ON todos_pr_group_attempts (group_id, created_at, id);
CREATE INDEX IF NOT EXISTS todos_pr_group_attempts_generation_idx
  ON todos_pr_group_attempts (group_id, writer_generation);

CREATE TABLE IF NOT EXISTS todos_pr_group_events (
  schema_version integer NOT NULL DEFAULT 1,
  id text PRIMARY KEY,
  group_id text NOT NULL REFERENCES todos_pr_groups(id) ON DELETE CASCADE,
  attempt_id text NOT NULL REFERENCES todos_pr_group_attempts(id) ON DELETE CASCADE,
  writer_generation text NOT NULL,
  sequence integer NOT NULL,
  idempotency_key text NOT NULL,
  event_type text NOT NULL,
  state text NOT NULL,
  message text,
  head_sha text,
  receipt_key text,
  review_receipt_key text,
  conditional_merge_receipt_key text,
  outcome text,
  repository text NOT NULL,
  pr_number integer,
  base_sha text,
  actor_id text,
  actor_run_id text,
  expected_reviewer_id text,
  expected_reviewer_run_id text,
  repair_cycle integer,
  ci_proof jsonb,
  cleanup_proof jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (group_id, sequence),
  UNIQUE (group_id, idempotency_key),
  UNIQUE (group_id, receipt_key)
);

CREATE INDEX IF NOT EXISTS todos_pr_group_events_group_sequence_idx
  ON todos_pr_group_events (group_id, sequence);
CREATE INDEX IF NOT EXISTS todos_pr_group_events_attempt_idx
  ON todos_pr_group_events (attempt_id, sequence);
CREATE INDEX IF NOT EXISTS todos_pr_group_events_receipt_idx
  ON todos_pr_group_events (group_id, receipt_key);
CREATE UNIQUE INDEX IF NOT EXISTS todos_pr_group_events_receipt_global_uidx
  ON todos_pr_group_events (receipt_key) WHERE receipt_key IS NOT NULL;

ALTER TABLE todos_pr_groups ADD COLUMN IF NOT EXISTS leaf_task_id text;
ALTER TABLE todos_pr_groups ADD COLUMN IF NOT EXISTS branch text;
ALTER TABLE todos_pr_groups ADD COLUMN IF NOT EXISTS pr_number integer;
ALTER TABLE todos_pr_groups ADD COLUMN IF NOT EXISTS base_sha text;
ALTER TABLE todos_pr_groups ADD COLUMN IF NOT EXISTS repair_cycle_count integer NOT NULL DEFAULT 0;
ALTER TABLE todos_pr_groups ADD COLUMN IF NOT EXISTS repair_cycle_limit integer NOT NULL DEFAULT 2;
ALTER TABLE todos_pr_group_attempts ADD COLUMN IF NOT EXISTS repository text;
ALTER TABLE todos_pr_group_attempts ADD COLUMN IF NOT EXISTS pr_number integer;
ALTER TABLE todos_pr_group_attempts ADD COLUMN IF NOT EXISTS base_sha text;
ALTER TABLE todos_pr_group_events ADD COLUMN IF NOT EXISTS review_receipt_key text;
ALTER TABLE todos_pr_group_events ADD COLUMN IF NOT EXISTS conditional_merge_receipt_key text;
ALTER TABLE todos_pr_group_events ADD COLUMN IF NOT EXISTS repository text;
ALTER TABLE todos_pr_group_events ADD COLUMN IF NOT EXISTS pr_number integer;
ALTER TABLE todos_pr_group_events ADD COLUMN IF NOT EXISTS base_sha text;
ALTER TABLE todos_pr_group_events ADD COLUMN IF NOT EXISTS actor_id text;
ALTER TABLE todos_pr_group_events ADD COLUMN IF NOT EXISTS actor_run_id text;
ALTER TABLE todos_pr_group_events ADD COLUMN IF NOT EXISTS expected_reviewer_id text;
ALTER TABLE todos_pr_group_events ADD COLUMN IF NOT EXISTS expected_reviewer_run_id text;
ALTER TABLE todos_pr_group_events ADD COLUMN IF NOT EXISTS repair_cycle integer;
ALTER TABLE todos_pr_group_events ADD COLUMN IF NOT EXISTS ci_proof jsonb;
ALTER TABLE todos_pr_group_events ADD COLUMN IF NOT EXISTS cleanup_proof jsonb;

UPDATE todos_pr_groups AS groups
SET leaf_task_id = COALESCE(groups.leaf_task_id, (
      SELECT attempt.leaf_task_id
      FROM todos_pr_group_attempts AS attempt
      WHERE attempt.group_id = groups.id
      ORDER BY CASE WHEN attempt.id = groups.active_attempt_id THEN 0 ELSE 1 END,
               attempt.created_at ASC, attempt.id ASC
      LIMIT 1
    )),
    branch = COALESCE(groups.branch, (
      SELECT attempt.branch
      FROM todos_pr_group_attempts AS attempt
      WHERE attempt.group_id = groups.id
      ORDER BY CASE WHEN attempt.id = groups.active_attempt_id THEN 0 ELSE 1 END,
               attempt.created_at ASC, attempt.id ASC
      LIMIT 1
    )),
    pr_number = COALESCE(groups.pr_number, (
      SELECT attempt.pr_number
      FROM todos_pr_group_attempts AS attempt
      WHERE attempt.group_id = groups.id AND attempt.pr_number IS NOT NULL
      ORDER BY CASE WHEN attempt.id = groups.active_attempt_id THEN 0 ELSE 1 END,
               attempt.created_at ASC, attempt.id ASC
      LIMIT 1
    )),
    base_sha = COALESCE(groups.base_sha, (
      SELECT attempt.base_sha
      FROM todos_pr_group_attempts AS attempt
      WHERE attempt.group_id = groups.id AND attempt.base_sha IS NOT NULL
      ORDER BY CASE WHEN attempt.id = groups.active_attempt_id THEN 0 ELSE 1 END,
               attempt.created_at ASC, attempt.id ASC
      LIMIT 1
    ))
WHERE groups.leaf_task_id IS NULL
   OR groups.branch IS NULL
   OR groups.pr_number IS NULL
   OR groups.base_sha IS NULL;

UPDATE todos_pr_group_attempts AS attempt
SET repository = COALESCE(attempt.repository, groups.repository),
    pr_number = COALESCE(attempt.pr_number, groups.pr_number),
    base_sha = COALESCE(attempt.base_sha, groups.base_sha)
FROM todos_pr_groups AS groups
WHERE groups.id = attempt.group_id
  AND (attempt.repository IS NULL OR attempt.pr_number IS NULL OR attempt.base_sha IS NULL);

UPDATE todos_pr_group_events AS event
SET repository = COALESCE(event.repository, attempt.repository, groups.repository),
    pr_number = COALESCE(event.pr_number, attempt.pr_number, groups.pr_number),
    base_sha = COALESCE(event.base_sha, attempt.base_sha, groups.base_sha)
FROM todos_pr_group_attempts AS attempt, todos_pr_groups AS groups
WHERE attempt.id = event.attempt_id
  AND groups.id = event.group_id
  AND (event.repository IS NULL OR event.pr_number IS NULL OR event.base_sha IS NULL);

ALTER TABLE todos_pr_groups ALTER COLUMN leaf_task_id SET NOT NULL;
ALTER TABLE todos_pr_groups ALTER COLUMN branch SET NOT NULL;
ALTER TABLE todos_pr_group_attempts ALTER COLUMN repository SET NOT NULL;
ALTER TABLE todos_pr_group_events ALTER COLUMN repository SET NOT NULL;
