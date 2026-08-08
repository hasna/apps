-- @hasna/contacts cloud schema — versioned, replay-safe contact-project membership authority.

CREATE TABLE IF NOT EXISTS contact_project_membership_states (
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  linked BOOLEAN NOT NULL,
  revision BIGINT NOT NULL DEFAULT 0 CHECK(revision >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (contact_id, project_id)
);

INSERT INTO contact_project_membership_states
  (contact_id, project_id, linked, revision, updated_at)
SELECT contact_id, project_id, TRUE, 0, NOW()
FROM contact_projects
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS contact_project_membership_receipts (
  receipt_id TEXT PRIMARY KEY,
  direction TEXT NOT NULL CHECK(direction IN ('attach', 'detach')),
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  expected_version TEXT NOT NULL,
  before_json JSONB NOT NULL,
  after_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(operation_id, step_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_project_membership_states_project
  ON contact_project_membership_states(project_id, linked, contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_project_membership_receipts_target
  ON contact_project_membership_receipts(contact_id, project_id, created_at);

INSERT INTO _migrations (version) VALUES (14) ON CONFLICT DO NOTHING;
