-- @generated mirror of POSTGRES_STORAGE_MIGRATIONS["0016_loop_revisions"] — DO NOT EDIT.
-- Source of truth: src/lib/storage/postgres-schema.ts
-- Runner: loops-serve migrate  (checksum: sha256:c5ef0f1fbc0f61de7736a4af1a558c993f9d916bc0ee7623ba0d5709196d754e)

GRANT USAGE, CREATE ON SCHEMA public TO open_loops_owner;
SET ROLE open_loops_owner;

ALTER TABLE loops ADD COLUMN IF NOT EXISTS bundle_name TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS loops_bundle_name_key
  ON loops(tenant_id, bundle_name) WHERE bundle_name IS NOT NULL;
ALTER TABLE loops ADD COLUMN IF NOT EXISTS bundle_pinned_version INTEGER;

-- Run provenance: which bundle version produced a run. Nullable, so every
-- receipt written before bundles existed keeps its exact digest.
ALTER TABLE run_receipts ADD COLUMN IF NOT EXISTS bundle_json JSONB;

CREATE TABLE loop_revisions (
  tenant_id        TEXT NOT NULL REFERENCES tenants(id),
  loop_id          TEXT NOT NULL,
  version          INTEGER NOT NULL CHECK (version >= 1),
  bundle_name      TEXT NOT NULL,
  bundle_digest    TEXT NOT NULL CHECK (bundle_digest ~ '^sha256:[0-9a-f]{64}$'),
  archive_sha256   TEXT NOT NULL CHECK (archive_sha256 ~ '^[0-9a-f]{64}$'),
  archive_bytes    INTEGER NOT NULL CHECK (archive_bytes > 0),
  storage_kind     TEXT NOT NULL DEFAULT 'db' CHECK (storage_kind IN ('db','s3')),
  storage_key      TEXT,
  manifest_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  loop_json        JSONB NOT NULL,
  carries_prompt   BOOLEAN NOT NULL DEFAULT false,
  author           TEXT NOT NULL,
  source_station   TEXT,
  source_agent     TEXT,
  reason           TEXT,
  rolled_back_from INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, loop_id, version),
  FOREIGN KEY (tenant_id, loop_id) REFERENCES loops(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT loop_revisions_s3_key CHECK (storage_kind <> 's3' OR storage_key IS NOT NULL)
);
CREATE INDEX loop_revisions_loop_created_idx
  ON loop_revisions(tenant_id, loop_id, version DESC);
CREATE INDEX loop_revisions_digest_idx
  ON loop_revisions(tenant_id, bundle_digest);
CREATE UNIQUE INDEX loop_revisions_name_version_key
  ON loop_revisions(tenant_id, bundle_name, version);

ALTER TABLE loop_revisions OWNER TO open_loops_owner;
ALTER TABLE loop_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE loop_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON loop_revisions
  USING (tenant_id = open_loops_current_tenant_id())
  WITH CHECK (tenant_id = open_loops_current_tenant_id());
-- Append-only at the PRIVILEGE level, not only by convention: the runtime role
-- gets INSERT and SELECT and is granted no UPDATE and no DELETE on this table,
-- so a rollback can only ever append a new revision. Rows leave exclusively
-- through the loop's own ON DELETE CASCADE.
GRANT SELECT, INSERT ON loop_revisions TO open_loops_runtime;

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM open_loops_owner;
GRANT USAGE ON SCHEMA public TO open_loops_owner;
