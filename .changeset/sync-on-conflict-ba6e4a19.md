---
"@hasna/todos": patch
---

Sync push classifies scoped-slug unique violations as typed conflicts (ba6e4a19). pushSnapshot's ON CONFLICT arbiter is the table PRIMARY KEY, but the deployed uniqueness invariants are the partial expression indexes todos_sync_records_task_list_scope_slug_uidx and todos_sync_records_project_task_list_slug_uidx, so a slug collision on a different object_id bypassed the upsert and raised a raw 23505 that the mirror (5x) and durable outbox (8x) retried as transient — the duplicate-key retry storm under load. pushSnapshot now maps 23505 to ResourceConflictError codes TASK_LIST_SLUG_CONFLICT / PROJECT_SLUG_CONFLICT (with a metadata-less fallback re-read, mirroring the adapter's renameProjectAtomic), runs the destination-conflict read plus inserts in the client's transaction when available, and the mirror/outbox retry machinery parks typed conflicts immediately instead of re-enqueueing them.
