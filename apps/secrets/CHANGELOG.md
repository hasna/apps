# Changelog

## 0.2.16 — 2026-08-08

- Reconcile production tenant-migration lineage through schema verification
  and an idempotent backfill while keeping unknown checksum drift fatal.
- Bind cloud writes to persisted tenant assignments and reject unassigned
  credentials before mutation, including concurrent and post-backfill writes.

## 0.2.15 — 2026-08-08

- Preserve schema-proven compatibility for the legacy checksum of
  `secrets_0010_tenant_columns` when all expected tenant columns and Postgres
  types are present; unknown checksum drift remains fatal.

## 0.2.14 — 2026-08-08

- Restored the production migration lineage for `secrets_0008_tenants`, so
  deployments recognize the already-applied tenants migration.
