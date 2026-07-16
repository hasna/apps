# loops Postgres migrations

**Source of truth:** `src/lib/storage/postgres-schema.ts` (`POSTGRES_STORAGE_MIGRATIONS`).

**Runner:** `loops-serve migrate` (also `bun dist/serve/index.js migrate`). It applies
every pending migration inside a checksum-guarded ledger
(`open_loops_schema_migrations`): each migration's SQL is hashed and recorded, so
an already-applied migration is skipped and a drifted/edited migration fails
closed with a checksum mismatch rather than silently reapplying.

The `*.sql` files here are a **generated mirror** for review only — regenerate
with `bun run scripts/gen-migrations.ts`. Do not hand-edit them; edit the TS
source and regenerate.

## Applying

Self-hosted AWS control-plane host (direct RDS/Postgres, verify-full TLS via the
baked RDS CA bundle when applicable). Local development can use a disposable
Postgres DSN with `sslmode=disable`:

```
HASNA_LOOPS_MIGRATOR_DATABASE_URL=... loops-serve migrate   # prepare through 0008
HASNA_LOOPS_MIGRATOR_DATABASE_URL=... loops-serve tenant-backfill --input ./tenant-backfill.json
HASNA_LOOPS_MIGRATOR_DATABASE_URL=... loops-serve migrate --enforce-tenancy
```

The target must be a dedicated OpenLoops database owned by the bootstrap login
(or administered by a true superuser), not a database shared with
another application. Migration `0010` removes unexpected privileges from any
explicit grantee across every non-system schema, table, sequence, and function
in the current database, including default `PUBLIC` function execute privileges,
before granting the exact runtime/auth ACLs.
The `--enforce-tenancy` login must be a provider-level bootstrap administrator.
The four `open_loops_*` roles are cluster-global reserved names. Before
enforcement, inventory their memberships, database ownership, and
`pg_shdepend` records across the whole PostgreSQL cluster. They must be NOLOGIN,
must not own another database, and must have no cross-database dependencies.
Use a dedicated OpenLoops cluster; a dedicated database alone is insufficient.
At minimum it must own the database, control the `public` schema, have
`CREATEROLE`, and be able to `SET ROLE` to `open_loops_owner` and
`open_loops_migrator`. PostgreSQL 16's default `createrole_self_grant=''`
creates an implicit creator membership with `ADMIN TRUE`, `INHERIT FALSE`, and
`SET FALSE`; only a superuser can revoke that row because its grantor is the
PostgreSQL bootstrap superuser. Therefore a non-superuser enforcement login
must receive provider-provisioned, preexisting roles plus exactly these direct
memberships before migration:

- `open_loops_owner` and `open_loops_migrator`: `ADMIN FALSE`, `INHERIT TRUE`,
  `SET TRUE`;
- no direct or inherited membership in `open_loops_runtime` or
  `open_loops_authenticator`;
- no LOGIN role may yet inherit `open_loops_runtime` or
  `open_loops_authenticator`. Run enforcement before the provider attaches
  runtime/authenticator service credentials.

A true superuser may create and normalize the roles in the migration. Before
applying migration `0010`, every supported runner transactionally exercises and
rolls back the exact role/membership checks, `SET ROLE`, migration-ledger
ownership and writes, schema/database grants, function/table/sequence/schema
revokes, and service-login cleanup. Provider/bootstrap identities are never
passed to `DROP OWNED`; intended service logins that own database objects still
fail closed until those objects are reassigned or removed, and unsafe LOGIN
memberships fail closed instead of being silently detached. After `0010`
succeeds, provider automation may attach the runtime and authenticator logins to
only their matching roles with `ADMIN FALSE`, `INHERIT TRUE`, and `SET TRUE`.
A role-attribute approximation is not accepted as proof.
The migrator serializes non-dry-run plans with a transaction-scoped advisory
lock and rereads the ledger after acquiring it. Operators must still quiesce all
writers and run one migrator. Before mutation, capture a PITR recovery point and
prove it with an isolated restore rehearsal as described in
`docs/CUTOVER-RUNBOOK.md`.
The tenant backfill bundle is a separately approved cutover artifact. Record
its SHA-256, expected entity/row counts, approver, encrypted delivery path, and
post-use deletion evidence. Never place bundle contents, API-key material, or
database credentials in task comments, command output, or repository files.

Out-of-band (operator, owner role through an SSM tunnel):

```
TUNNEL_DATABASE_URL=... bun run scripts/db-migrate-tunnel.ts
TUNNEL_DATABASE_URL=... bun run scripts/db-migrate-tunnel.ts --enforce-tenancy
```

Both standalone runners stop after migration 0008 by default. The enforcement
flag is required after the reviewed tenant backfill bundle has been loaded.

The tenant-bound `api_keys` table is owned by migrations 0008-0010; no second
schema bootstrap path exists.
