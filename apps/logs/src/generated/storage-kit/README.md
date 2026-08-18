# Vendored Hasna storage kit

**Generated — do not edit.** This directory is stamped into the repo by
[`@hasna/contracts`](https://github.com/hasna/contracts) and verified in CI.

- Regenerate: `bunx @hasna/contracts vendor-kit`
- Verify (CI): `bunx @hasna/contracts vendor-kit --check` — fails on stale or hand-edited files.

> MODES-REMOVAL 2026-08-18: the storage-mode module (`mode.ts`) was removed
> from this kit; the kit selects the backend from the environment
> (HASNA_<NAME>_DATABASE_URL present -> PostgreSQL, else no Postgres pool).
> Regenerate from an updated `@hasna/contracts` generator once it ships the
> same env-selection contract.

## What it is

A canonical Postgres storage kit shared across the Hasna fleet:

| File            | Purpose                                                              |
| --------------- | ------------------------------------------------------------------- |
| `tls.ts`        | The one correct TLS approach (libpq `sslmode` semantics + RDS CA)    |
| `pool.ts`       | `pg.Pool` factory with fleet-standard TLS; DATABASE_URL env selection |
| `query.ts`      | Typed query wrapper (`query` / `many` / `get` / `one` / `execute`)   |
| `migrations.ts` | `schema_migrations` ledger with sha256 checksums                     |
| `health.ts`     | `checkHealth` (SELECT 1) and `checkReady` (migrated?) probes         |

## Backend selection

The kit selects the backend from the environment, not from a mode enum: a
PostgreSQL pool is built only when `HASNA_<NAME>_DATABASE_URL` (or the alias
`<NAME>_DATABASE_URL`) is present. Without a database URL there is no Postgres
pool at all; the app's local SQLite store is authoritative. The kit contains
**no sync engine and no merge logic**.

## TLS

`tls.ts` follows libpq `sslmode` semantics exactly:

- `require` — encrypt, do not verify (RDS default without a bundle)
- `verify-ca` / `verify-full` — encrypt **and** verify against a CA bundle
  (mandatory; throws if none is available)

Point `PGSSLROOTCERT` at the Amazon RDS global bundle to verify:
<https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem>

## Peer dependency

Requires `pg` (and `@types/pg` for TypeScript) in the host repo.
