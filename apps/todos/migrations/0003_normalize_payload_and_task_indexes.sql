-- 0003: repair double-encoded payloads + task filter indexes.
--
-- Earlier cloud writes bound JSON.stringify(value) to a $::jsonb param, which
-- Bun.SQL stores as a jsonb STRING scalar instead of an object. That broke every
-- server-side payload->>'field' filter/count and jsonb_set (short-id counter),
-- forcing list/count to load the whole tasks table into JS (O(n) heap → OOM).
--
-- The write path now binds the object directly; this migration converts existing
-- string-encoded rows back to real jsonb objects. Idempotent: only rows whose
-- payload is currently a jsonb string are touched.
UPDATE todos_sync_records
   SET payload = (payload #>> '{}')::jsonb
 WHERE jsonb_typeof(payload) = 'string';

-- Indexes that make the pushed-down task filters cheap. Created by the schema
-- runner (postgresTodosSyncSchemaSql) as well; repeated here for transparency.
CREATE INDEX IF NOT EXISTS todos_sync_records_task_status_idx
  ON todos_sync_records ((payload->>'status'))
  WHERE object_type = 'tasks' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS todos_sync_records_task_project_idx
  ON todos_sync_records ((payload->>'project_id'))
  WHERE object_type = 'tasks' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS todos_sync_records_payload_gin
  ON todos_sync_records USING gin (payload jsonb_path_ops);
