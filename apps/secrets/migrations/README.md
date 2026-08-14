# secrets — cloud migrations

These `.sql` files mirror the canonical, checksummed migration set defined in
`src/server/cloud-migrations.ts` (`SECRETS_MIGRATIONS`). The runner of record is
the vendored storage kit's `MigrationLedger`, driven by `secrets-serve db migrate`
(PURE REMOTE, Amendment A1 — all reads/writes hit the shared cloud Postgres).

- Numbered app migrations mirror `SECRETS_APP_MIGRATIONS`.
- The `api_keys` table + indexes come from `@hasna/contracts/auth`
  (`apiKeyMigrations()`), applied by the same ledger.

Never edit an already-applied migration; the ledger enforces this with a
per-migration sha256 checksum (drift + downgrade guards).

Apply against the cloud DB:

```
DATABASE_URL=postgres://... secrets-serve db migrate     # or: secrets-serve db status
```
