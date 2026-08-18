# Vendored Hasna storage kit

**Generated — do not edit.** This directory is stamped into the repo by
[`@hasna/contracts`](https://github.com/hasna/contracts) and verified in CI.

- Regenerate: `bunx @hasna/contracts vendor-kit`
- Verify (CI): `bunx @hasna/contracts vendor-kit --check` — fails on stale or hand-edited files.

> **NOTE (modes-removal lane):** the `mode.ts` module was removed from this
> vendored kit. The server backend is selected by environment — a configured
> `HASNA_<NAME>_DATABASE_URL` selects PostgreSQL; otherwise the on-box SQLite
> file is authoritative. Regenerating with a contracts version that still
> emits `mode.ts` will resurrect it; the `@hasna/contracts` generator must
> ship the backend-selection kit first (transitional requirement, recorded on
> the modes-removal task).

## What it is

A canonical PostgreSQL storage kit shared across the Hasna fleet:

| File            | Purpose                                                              |
| --------------- | ------------------------------------------------------------------- |
| `tls.ts`        | The one correct TLS approach (libpq `sslmode` semantics + RDS CA)    |
| `pool.ts`       | `pg.Pool` factory with fleet-standard TLS; selected by DATABASE_URL presence |
| `query.ts`      | Typed query wrapper (`query` / `many` / `get` / `one` / `execute`)   |
| `migrations.ts` | `schema_migrations` ledger with sha256 checksums                     |
| `health.ts`     | `checkHealth` (SELECT 1) and `checkReady` (migrated?) probes         |

## Backend selection

The server has exactly one technical switch: `sqlite | postgresql`. A
configured `HASNA_<NAME>_DATABASE_URL` (or the short alias) selects PostgreSQL;
otherwise the on-box SQLite file is authoritative. This kit contains no sync
engine and no merge logic.

## TLS

`tls.ts` follows libpq `sslmode` semantics exactly:

- `require` — encrypt, do not verify (RDS default without a bundle)
- `verify-ca` / `verify-full` — encrypt **and** verify against a CA bundle
  (mandatory; throws if none is available)

Point `PGSSLROOTCERT` at the Amazon RDS global bundle to verify:
<https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem>

## Peer dependency

Requires `pg` (and `@types/pg` for TypeScript) in the host repo.
