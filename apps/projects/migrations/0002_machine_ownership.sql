-- First-class canonical machine ownership and the fleet machine registry.

CREATE TABLE IF NOT EXISTS machines (
  slug TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',
  role TEXT NOT NULL CHECK(role IN ('mirror-hub', 'assignable', 'avoid'))
);

INSERT INTO machines (slug, status, role) VALUES
  ('spark01', 'active', 'mirror-hub'),
  ('spark02', 'active', 'mirror-hub'),
  ('apple01', 'active', 'assignable'),
  ('apple03', 'active', 'assignable'),
  ('apple06', 'active', 'avoid'),
  ('machine001', 'active', 'assignable'),
  ('machine002', 'active', 'assignable'),
  ('machine003', 'active', 'assignable'),
  ('machine004', 'active', 'assignable'),
  ('machine005', 'active', 'assignable'),
  ('machine006', 'active', 'assignable'),
  ('machine007', 'active', 'assignable'),
  ('machine008', 'active', 'assignable'),
  ('machine009', 'active', 'assignable'),
  ('machine010', 'active', 'assignable'),
  ('machine011', 'active', 'assignable')
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS canonical_machine TEXT NULL;

UPDATE workspaces
SET canonical_machine = NULLIF(BTRIM(metadata::jsonb ->> 'canonical_machine'), '')
WHERE canonical_machine IS NULL
  AND jsonb_typeof(metadata::jsonb -> 'canonical_machine') = 'string';

UPDATE workspaces
SET metadata = (metadata::jsonb - 'canonical_machine')::text
WHERE metadata::jsonb ? 'canonical_machine';

CREATE INDEX IF NOT EXISTS idx_workspaces_canonical_machine ON workspaces(canonical_machine);
