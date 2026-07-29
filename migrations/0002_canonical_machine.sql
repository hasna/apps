ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS canonical_machine TEXT;

CREATE INDEX IF NOT EXISTS idx_workspaces_canonical_machine
  ON workspaces(canonical_machine);
