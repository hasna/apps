-- @hasna/contacts cloud schema (A1 pure-remote) — generated from src/db/pg-migrations.ts
-- Idempotent and forward-only: supports GET /v1/contacts?tag_id=... filters.

-- The contact_tags primary key is (contact_id, tag_id), which does not
-- support the public tag_id filter efficiently. Keep this forward-only and
-- idempotent for populated cloud deployments.
CREATE INDEX IF NOT EXISTS idx_contact_tags_tag_contact ON contact_tags(tag_id, contact_id);

INSERT INTO _migrations (version) VALUES (13) ON CONFLICT DO NOTHING;
