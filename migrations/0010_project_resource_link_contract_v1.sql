-- Resource-link contract v1: scope is mutable metadata and migrations are a
-- durable, tenant-partitioned saga owned by Projects.

CREATE OR REPLACE FUNCTION reject_project_resource_link_identity_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.authority IS DISTINCT FROM OLD.authority
    OR NEW.service_instance IS DISTINCT FROM OLD.service_instance
    OR NEW.source_package IS DISTINCT FROM OLD.source_package
    OR NEW.target_kind IS DISTINCT FROM OLD.target_kind
    OR NEW.locator_kind IS DISTINCT FROM OLD.locator_kind
    OR NEW.locator_value IS DISTINCT FROM OLD.locator_value
  THEN
    RAISE EXCEPTION 'project resource link identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS project_resource_link_migration_manifests (
  manifest_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN (
    'planned', 'producer_applied', 'projects_applied', 'verified',
    'rollback_in_progress', 'rolled_back', 'retained_target', 'failed_reconcilable'
  )),
  expected_project_revision TEXT NOT NULL,
  desired_collection_digest TEXT NOT NULL,
  links_json TEXT NOT NULL,
  projects_forward_receipt_id TEXT,
  projects_inverse_receipt_id TEXT,
  projects_reference_proof_json TEXT,
  last_verified_projects_revision TEXT,
  last_verified_projects_digest TEXT,
  transition_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT NOW()::text,
  updated_at TEXT NOT NULL DEFAULT NOW()::text,
  UNIQUE(project_id, operation_id, step_id)
);

CREATE TABLE IF NOT EXISTS project_resource_link_migration_events (
  event_id TEXT PRIMARY KEY,
  manifest_id TEXT NOT NULL REFERENCES project_resource_link_migration_manifests(manifest_id) ON DELETE CASCADE,
  transition_version INTEGER NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  precondition_digest TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT NOW()::text,
  UNIQUE(manifest_id, transition_version)
);

CREATE INDEX IF NOT EXISTS idx_project_resource_link_migrations_project
  ON project_resource_link_migration_manifests(project_id, state, updated_at);
CREATE INDEX IF NOT EXISTS idx_project_resource_link_migration_events_manifest
  ON project_resource_link_migration_events(manifest_id, transition_version);

CREATE OR REPLACE FUNCTION reject_project_resource_link_migration_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'project resource link migration events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS project_resource_link_migration_events_no_update
  ON project_resource_link_migration_events;
CREATE TRIGGER project_resource_link_migration_events_no_update
BEFORE UPDATE ON project_resource_link_migration_events
FOR EACH ROW EXECUTE FUNCTION reject_project_resource_link_migration_event_mutation();

DROP TRIGGER IF EXISTS project_resource_link_migration_events_no_delete
  ON project_resource_link_migration_events;
CREATE TRIGGER project_resource_link_migration_events_no_delete
BEFORE DELETE ON project_resource_link_migration_events
FOR EACH ROW EXECUTE FUNCTION reject_project_resource_link_migration_event_mutation();

DO $projects_resource_link_migration_runtime_grants$
DECLARE
  runtime_role TEXT;
BEGIN
  FOR runtime_role IN
    SELECT role.rolname
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
    ) AS privilege
    JOIN pg_catalog.pg_roles AS role ON role.oid = privilege.grantee
    WHERE namespace.nspname = current_schema()
      AND relation.relname = 'workspaces'
      AND relation.relkind IN ('r', 'p')
      AND role.rolname <> current_user
      AND privilege.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    GROUP BY role.rolname
    HAVING COUNT(DISTINCT privilege.privilege_type) = 4
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I, %I.%I TO %I',
      current_schema(), 'project_resource_link_migration_manifests',
      current_schema(), 'project_resource_link_migration_events',
      runtime_role
    );
  END LOOP;
END
$projects_resource_link_migration_runtime_grants$;
