-- PREDEPLOY, OUTSIDE A TRANSACTION: keep short-reference resolution
-- (`GET /v1/tasks/:ref` -> resolveTaskRef) fast as the shared task set grows.
--
-- Two branches, two indexes:
--   1. short_id  -> LOWER(payload->>'short_id') = $1  (case-insensitive equality)
--   2. id prefix -> object_id COLLATE "C" >= $lo AND < $hi  (byte-order range)
--
-- The id-prefix range MUST use byte order (COLLATE "C"): the CLI computes the
-- upper bound by incrementing the final code unit, and under the RDS-default
-- locale collation (en_US.utf8) ':' sorts before '9', which would drop every ref
-- ending in '9'. The default btree/PK cannot serve a "C" range, so a dedicated
-- "C" index is required to keep the scan bounded.
--
-- Both OPTIONAL and non-blocking: resolution is already correct without them
-- (a filtered task-row scan / byte-ordered range), so these are pure latency
-- optimizations. CREATE INDEX CONCURRENTLY does not lock the shared table and
-- must run outside a transaction. Applied automatically by `todos-serve migrate`
-- (ensureCloudTaskShortIdIndex + ensureCloudTaskObjectIdIndex).
CREATE INDEX CONCURRENTLY IF NOT EXISTS todos_sync_records_task_short_id_idx
  ON todos_sync_records ((LOWER(payload->>'short_id')))
  WHERE object_type = 'tasks' AND deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS todos_sync_records_task_object_id_c_idx
  ON todos_sync_records (service, (object_id COLLATE "C"))
  WHERE object_type = 'tasks' AND deleted_at IS NULL;
