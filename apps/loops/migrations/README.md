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

Cloud (in-cluster, direct RDS, verify-full TLS via the baked RDS CA bundle):

```
DATABASE_URL=... loops-serve migrate          # or the ECS one-shot migration task
```

Out-of-band (operator, owner role through an SSM tunnel):

```
TUNNEL_DATABASE_URL=... bun run scripts/db-migrate-tunnel.ts
```

The `api_keys` table (@hasna/contracts auth) is ensured by the same `migrate`
command after the storage migrations.
