-- Grant the guarded-mutation receipt privileges required by the existing
-- project runtime role(s). The production migrator owns schema objects while
-- projects-serve connects through a separate DML-only role.
--
-- Derive the runtime grantee from the existing workspaces ACL instead of
-- hard-coding a deployment-specific role name. Only roles already trusted
-- with full workspace DML receive the receipt table's narrower SELECT/INSERT
-- privileges. Single-role user-hosted databases need no explicit grant.

DO $projects_guarded_runtime_grants$
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
      'GRANT SELECT, INSERT ON TABLE %I.%I TO %I',
      current_schema(),
      'guarded_project_mutation_receipts',
      runtime_role
    );
  END LOOP;
END
$projects_guarded_runtime_grants$;
