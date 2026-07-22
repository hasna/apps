-- @hasna/contacts cloud schema (A1 pure-remote) — generated from src/db/pg-migrations.ts
-- Idempotent and forward-only: supports GET /v1/contacts?tag_id=... filters.

CREATE INDEX IF NOT EXISTS idx_contact_tags_tag_contact ON contact_tags(tag_id, contact_id);

INSERT INTO _migrations (version) VALUES (13) ON CONFLICT DO NOTHING;
