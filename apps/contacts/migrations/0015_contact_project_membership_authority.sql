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

CREATE OR REPLACE FUNCTION sync_contact_project_membership_state_from_legacy()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_contact_id TEXT;
  target_project_id TEXT;
  target_linked BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    target_contact_id := NEW.contact_id;
    target_project_id := NEW.project_id;
    target_linked := TRUE;
  ELSE
    target_contact_id := OLD.contact_id;
    target_project_id := OLD.project_id;
    target_linked := FALSE;
    IF NOT EXISTS (SELECT 1 FROM contacts WHERE id = target_contact_id) THEN
      RETURN OLD;
    END IF;
  END IF;

  INSERT INTO contact_project_membership_states
    (contact_id, project_id, linked, revision, updated_at)
  VALUES (target_contact_id, target_project_id, target_linked, 1, NOW())
  ON CONFLICT (contact_id, project_id) DO UPDATE SET
    linked = EXCLUDED.linked,
    revision = CASE
      WHEN contact_project_membership_states.linked IS DISTINCT FROM EXCLUDED.linked
        THEN contact_project_membership_states.revision + 1
      ELSE contact_project_membership_states.revision
    END,
    updated_at = CASE
      WHEN contact_project_membership_states.linked IS DISTINCT FROM EXCLUDED.linked
        THEN NOW()
      ELSE contact_project_membership_states.updated_at
    END;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS sync_contact_project_membership_state_from_legacy
  ON contact_projects;
CREATE TRIGGER sync_contact_project_membership_state_from_legacy
AFTER INSERT OR DELETE ON contact_projects
FOR EACH ROW EXECUTE FUNCTION sync_contact_project_membership_state_from_legacy();

INSERT INTO _migrations (version) VALUES (14) ON CONFLICT DO NOTHING;
