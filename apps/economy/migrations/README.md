# economy migrations

Cloud (PURE REMOTE, Amendment A1) Postgres schema for the self-hosted service.

- **Runner:** `economy-serve migrate` — applies the `PG_MIGRATIONS` array from
  `src/db/pg-migrations.ts` via `@hasna/cloud`'s `applyPgMigrations`
  (forward-only, tracked in the `_pg_migrations` ledger), then ensures the
  `@hasna/contracts` `api_keys` table with `ApiKeyStore.ensureSchema()`.
- **`0001_core_schema.sql`** is a generated mirror of that schema for direct
  `psql` application / review. Regenerate after schema changes.
- Every statement is idempotent (`CREATE ... IF NOT EXISTS`,
  `ADD COLUMN IF NOT EXISTS`) — safe to run against an existing DB without
  clobbering data.
