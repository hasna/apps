-- Let the hosted Projects runtime validate canonical-machine assignments.
--
-- The production migrator owns schema objects while projects-serve connects
-- through a separate DML-only role. Derive that runtime role from the existing
-- workspaces ACL and grant only the machines read required by
-- ProjectsPgStore.updateWorkspace. Single-role user-hosted databases need no
-- explicit grant.

DO $projects_machine_ownership_runtime_grants$
DECLARE
  runtime_role TEXT;
BEGIN
  FOR runtime_role IN
    SELECT role.rolname
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) AS privilege
    JOIN pg_catalog.pg_roles AS role
      ON role.oid = privilege.grantee
    WHERE namespace.nspname = current_schema()
      AND relation.relname = 'workspaces'
      AND relation.relkind IN ('r', 'p')
      AND role.rolname <> current_user
      AND privilege.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    GROUP BY role.rolname
    HAVING COUNT(DISTINCT privilege.privilege_type) = 4
  LOOP
    EXECUTE format(
      'GRANT SELECT ON TABLE %I.%I TO %I',
      current_schema(),
      'machines',
      runtime_role
    );
  END LOOP;
END
$projects_machine_ownership_runtime_grants$;
