-- Bound task-comment reads to one task and support stable keyset pagination.
-- Historical content redaction is intentionally NOT automatic; preview it with
-- `bun run backfill:comment-redaction` and obtain approval before using --apply.
CREATE INDEX IF NOT EXISTS todos_sync_records_comment_task_created_idx
  ON todos_sync_records (service, (payload->>'task_id'), (payload->>'created_at'), object_id)
  WHERE object_type = 'comments' AND deleted_at IS NULL;
