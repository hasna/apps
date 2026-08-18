---
"@hasna/conversations": patch
---

Enforce the work-status lifecycle stream at write time (fleet mandate global-work-status-lifecycle): a pure schema module guards every write to #work-status on both the SQLite and Postgres paths, rejecting malformed event lines and same-state duplicate transitions within the dedupe window. The dedupe window is anchored on the STORED write time — parseStoredWriteTime now handles the pg timestamptz Date form, the bulk path drops the caller-supplied created_at anchor for stream rows, same-batch duplicate uuids are single-gated (ON CONFLICT skip, not a second gate pass), and edit/delete paths refuse to rewrite or remove append-only work-status rows. Renaming any channel to or from work-status is refused.
