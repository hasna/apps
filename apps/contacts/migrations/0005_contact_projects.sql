-- @hasna/contacts cloud schema (A1 pure-remote) — generated from src/db/pg-migrations.ts
-- Idempotent: CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / ON CONFLICT.

ALTER TABLE groups ADD COLUMN IF NOT EXISTS project_id TEXT;

  CREATE TABLE IF NOT EXISTS contact_projects (
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    PRIMARY KEY (contact_id, project_id)
  );

  CREATE INDEX IF NOT EXISTS idx_contact_projects_project ON contact_projects(project_id);
  CREATE INDEX IF NOT EXISTS idx_contact_projects_contact ON contact_projects(contact_id);

  INSERT INTO contact_projects (contact_id, project_id)
  SELECT id, project_id FROM contacts WHERE project_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO _migrations (version) VALUES (4) ON CONFLICT DO NOTHING;
