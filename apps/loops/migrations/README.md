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

The `--enforce-tenancy` login must be a provider-level bootstrap administrator.
At minimum it must control the `public` schema, have `CREATEROLE`, and be able
to `SET ROLE` to `open_loops_owner` and `open_loops_migrator`, but PostgreSQL 16
can require stronger provider authority to normalize all role attributes and
clean direct service-login grants. Before applying migration `0010`, every
supported runner transactionally exercises and rolls back the exact `ALTER
ROLE`, schema grant, and `DROP OWNED` operations. A role-attribute approximation
is not accepted as proof.

Out-of-band (operator, owner role through an SSM tunnel):

```
TUNNEL_DATABASE_URL=... bun run scripts/db-migrate-tunnel.ts
TUNNEL_DATABASE_URL=... bun run scripts/db-migrate-tunnel.ts --enforce-tenancy
```

Both standalone runners stop after migration 0008 by default. The enforcement
flag is required after the reviewed tenant backfill bundle has been loaded.

The tenant-bound `api_keys` table is owned by migrations 0008-0010; no second
schema bootstrap path exists.
