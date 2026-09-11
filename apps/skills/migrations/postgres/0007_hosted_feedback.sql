-- Hosted feedback: `skills feedback` and the MCP send_feedback tool reach the
-- instance instead of the machine they run on.
--
-- Before this table there was no feedback route at all, so the client had two
-- local answers and no hosted one: a SQLite insert into ~/.hasna/skills/skills.db
-- in local mode, and an append to ~/.hasna/skills/feedback.jsonl on a keyed
-- station (hasna/apps#1613, #1632). The JSONL half was the worse of the two -
-- it looked hosted, reported "saved", and left the message on one laptop where
-- nobody who could act on it would ever read it.
--
-- Row identity is a minted id, not (org, principal, message): feedback is an
-- append-only event stream, and the same message sent twice is two events, not
-- an upsert. `principal` stores the api_keys.id that sent it (ApiPrincipal.apiKeyId),
-- matching skills_pins, so a read can be scoped to one key's submissions while the
-- org still sees all of its own. Nothing here references skills_registry: feedback
-- is about the service, not about a skill.

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
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (category IN ('bug','feature','general'))
);

CREATE INDEX IF NOT EXISTS skills_feedback_org_created_idx
  ON skills_feedback (org_id, created_at DESC);
