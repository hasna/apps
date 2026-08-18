-- Taxonomy vocabulary alignment (contracts-alignment-r2, taxonomy lane).
-- Queue lifecycle statuses move to admitted/leased/running/ambiguous (terminal
-- succeeded/failed/cancelled unchanged); the attempt lease is named
-- lease_token/lease_generation/lease_expires_at; the terminal receipt is named
-- receipt_json. Existing rows are preserved and re-mapped, never deleted.

-- Relax the status CHECKs first so existing rows can be re-mapped.
ALTER TABLE operations DROP CONSTRAINT IF EXISTS operations_status_check;
ALTER TABLE operation_attempts DROP CONSTRAINT IF EXISTS operation_attempts_status_check;

UPDATE operations SET status = CASE status
  WHEN 'pending' THEN 'admitted'
  WHEN 'accepted' THEN 'leased'
  WHEN 'unknown' THEN 'ambiguous'
  ELSE status END
WHERE status IN ('pending', 'accepted', 'unknown');
UPDATE operation_attempts SET status = 'ambiguous' WHERE status = 'unknown';

-- Rename the terminal receipt and the attempt lease columns.
ALTER TABLE operations RENAME COLUMN result_json TO receipt_json;
ALTER TABLE operation_attempts RENAME COLUMN execution_owner_token TO lease_token;
ALTER TABLE operation_attempts RENAME COLUMN execution_owner_generation TO lease_generation;
ALTER TABLE operation_attempts RENAME COLUMN execution_owner_expires_at TO lease_expires_at;

-- Re-apply the status CHECKs with taxonomy vocabulary.
ALTER TABLE operations ADD CONSTRAINT operations_status_check
  CHECK (status IN ('admitted', 'leased', 'running', 'ambiguous', 'succeeded', 'failed', 'cancelled'));
ALTER TABLE operation_attempts ADD CONSTRAINT operation_attempts_status_check
  CHECK (status IN ('running', 'ambiguous', 'succeeded', 'failed'));

-- Recreate the partial lifecycle index with taxonomy statuses.
DROP INDEX IF EXISTS operations_one_active_lifecycle;
CREATE UNIQUE INDEX operations_one_active_lifecycle
  ON operations (tenant_id, computer_id)
  WHERE kind IN ('create', 'start', 'stop', 'quarantine', 'delete', 'restore')
    AND status IN ('admitted', 'leased', 'running', 'ambiguous');

INSERT INTO schema_migrations (version, applied_at)
VALUES (4, now());
