# Vendored Hasna storage kit

**Generated with Loops strict-mode policy.** This directory is stamped into
the repo by [`@hasna/contracts`](https://github.com/hasna/contracts), then kept
under the Loops rule that deprecated storage-mode aliases are not accepted.

- Regenerate: `bunx @hasna/contracts vendor-kit`
- Verify (CI): `bun run check:contracts` — verifies manifest hashes, kit
  version, and the no-alias storage-mode policy.

## What it is

A canonical Postgres storage kit shared across the Hasna fleet:

| File            | Purpose                                                              |
| --------------- | ------------------------------------------------------------------- |
| `mode.ts`       | Storage-mode + env resolution (`local` \| `cloud`), per the contract |
| `tls.ts`        | The one correct TLS approach (libpq `sslmode` semantics + RDS CA)    |
| `pool.ts`       | `pg.Pool` factory with fleet-standard TLS                            |
| `query.ts`      | Typed query wrapper (`query` / `many` / `get` / `one` / `execute`)   |
| `migrations.ts` | `schema_migrations` ledger with sha256 checksums                     |
| `health.ts`     | `checkHealth` (SELECT 1) and `checkReady` (migrated?) probes         |

## PURE REMOTE (Amendment A1)

Cloud mode = reads **and** writes go directly to cloud Postgres. This kit
contains **no sync engine, no cache-as-mode, and no merge logic**. In `local`
mode there is no Postgres pool at all; SQLite is authoritative.

## TLS

`tls.ts` is intentionally stricter than libpq `sslmode=require` because
Loops cloud Postgres is production infrastructure:

- `require` — encrypt **and** verify against a CA bundle
- `verify-ca` / `verify-full` — encrypt **and** verify against a CA bundle
  (mandatory; throws if none is available)

Point `PGSSLROOTCERT` at the Amazon RDS global bundle to verify:
<https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem>

## Peer dependency

Requires `pg` (and `@types/pg` for TypeScript) in the host repo.
