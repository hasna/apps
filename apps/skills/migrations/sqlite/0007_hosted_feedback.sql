-- Hosted feedback: SQLite dialect of 0007_hosted_feedback.
--
-- Read the Postgres file for the why; the only differences here are the
-- documented dialect mapping:
--   * timestamptz -> text holding a UTC ISO-8601 instant (created_at).
--
-- No RLS, for the same reason as skills_pins: the tenant fence is the
-- org-scoped predicate in the store, and every writer runs under the
-- requesting principal's org.

CREATE TABLE IF NOT EXISTS skills_feedback (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  principal text NOT NULL,
  message text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  email text,
  agent text,
  version text,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (category IN ('bug','feature','general'))
);

CREATE INDEX IF NOT EXISTS skills_feedback_org_created_idx
  ON skills_feedback (org_id, created_at DESC);
