-- Closed typed one-to-many project resource links.

CREATE TABLE IF NOT EXISTS project_resource_links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  authority TEXT NOT NULL CHECK(authority IN ('todos', 'conversations', 'knowledge', 'mementos')),
  service_instance TEXT NOT NULL,
  source_package TEXT NOT NULL CHECK(source_package IN ('@hasna/todos', '@hasna/conversations', '@hasna/knowledge', '@hasna/mementos')),
  target_kind TEXT NOT NULL CHECK(target_kind IN ('project', 'task_list', 'plan', 'channel', 'collection', 'item')),
  locator_kind TEXT NOT NULL CHECK(locator_kind IN ('external_uuid', 'canonical_uri')),
  locator_value TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('resource', 'collection')),
  labels_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT NOW()::text,
  updated_at TEXT NOT NULL DEFAULT NOW()::text,
  UNIQUE(project_id, authority, service_instance, source_package, target_kind, locator_kind, locator_value)
);

CREATE INDEX IF NOT EXISTS idx_project_resource_links_project
  ON project_resource_links(project_id, authority, target_kind, id);

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
    OR NEW.scope IS DISTINCT FROM OLD.scope
  THEN
    RAISE EXCEPTION 'project resource link identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_resource_links_identity_immutable ON project_resource_links;
CREATE TRIGGER project_resource_links_identity_immutable
BEFORE UPDATE ON project_resource_links
FOR EACH ROW EXECUTE FUNCTION reject_project_resource_link_identity_mutation();

DO $projects_resource_link_runtime_grants$
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
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO %I',
      current_schema(),
      'project_resource_links',
      runtime_role
    );
  END LOOP;
END
$projects_resource_link_runtime_grants$;
