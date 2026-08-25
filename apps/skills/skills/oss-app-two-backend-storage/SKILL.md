---
name: oss-app-two-backend-storage
description: "Recipe for the Hasna two-backend storage contract: client transport + HTTP store, server PG/SQLite backend, pg-migrations + apply script, fail-closed URL-without-key, bun bins, contract manifest, Dockerfile. Use when building or extending an app whose client connects to an on-box store or a server HTTP API and whose server runs SQLite or PostgreSQL behind HASNA_<APP>_DATABASE_URL."
kind: instruction
version: 0.1.0
source: custom
visibility: public
category: Development Tools
tags:
  - custom
  - oss-app-two-backend-storage
  - storage
  - backend
  - postgresql
  - sqlite
  - two-backend
---

# oss-app-two-backend-storage — the Hasna two-backend storage contract

A Hasna app whose server has a SQLite-or-PostgreSQL backend ships the SAME
shape every time. Two full implementations exist and are the reference: the
knowledge app and the notes app. This skill is the recipe the second
implementation produced. Build the next one by copying the pattern, never by
re-inventing a storage layer.

## The contract in one paragraph

A client has exactly two connections: its on-box store (SQLite/JSON/markdown)
or the server HTTP API. The canonical `HASNA_<APP>_API_URL` selects HTTP;
without it the client stays on-box. An API URL **without** its
`HASNA_<APP>_API_KEY` FAILS CLOSED — it throws, it never drifts to the local
store. The server reads `HASNA_<APP>_DATABASE_URL` and runs SQLite by default
or PostgreSQL; the client never opens PostgreSQL directly. There are NO mode
enums (deployment modes are retired);
the only switch is the server's data backend, selected by the DATABASE_URL.

## Reference files (read before writing anything)

- `apps/knowledge/src/client-transport.ts`, `apps/knowledge/src/http-store.ts`
- `apps/knowledge/src/db/pg-migrations.ts`,
  `apps/knowledge/scripts/apply-postgres-migrations.mjs`
- `apps/notes/client/transport.mjs`, `apps/notes/client/http-store.mjs`
- `apps/notes/server/pg-adapter.mjs`, `apps/notes/server/pg-migrations.ts`,
  `apps/notes/scripts/apply-postgres-migrations.mjs`
- `apps/notes/hasna.contract.json`, `apps/notes/Dockerfile`
- The vendored storage kit (below) at `apps/<name>/src/generated/storage-kit/`

## Step 1 — client transport resolver (`client-transport.ts` / `transport.mjs`)

One resolver serves the CLI, the MCP server, and the app. Its shape:

- Export `<APP>_API_URL_ENV`, `<APP>_API_KEY_ENV`, `<APP>_DATABASE_URL_ENV`.
  The DATABASE_URL is a SERVER-side concern; client code must not read it and
  the transport report must never carry it.
- `isPresent` (own-property + non-blank) and `firstDefined` helpers.
- A `RETIRED_SELECTOR_ENV_KEYS` list naming every retired selector
  (`<APP>_STORAGE_MODE`, `<APP>_MODE`, and legacy unprefixed variants), and an
  `assertNoRetired<App>StorageSelector(env)` that THROWS
  `Retired<App>StorageSelectorError` when any is present — even blank. This
  is a fail-loud ratchet so a stale environment fragment cannot silently bind.
  The error message states the current selection rule in full.
- `resolve<App>ClientTransport(env)`: URL present + key absent -> throw (fail
  closed, message names both variables and the local alternative); URL present
  -> `http`; else local. The report carries booleans, never values.

## Step 2 — HTTP store (`http-store.ts` / `http-store.mjs`)

- Knowledge builds it on the shared SDK:
  `createHasnaStorageClient` from `@hasna/contracts/client/storage` +
  `createHasnaHttpTransport` from `@hasna/contracts/client`, with the request
  guard installed as `fetchImpl` and `retry: false` while the guard is armed
  (a refusal is not a transient network error). Notes, which vendors no
  client SDK, hand-rolls a small `request(method, path, {body})` wrapper over
  fetch with `Authorization: Bearer <key>`.
- The API key never leaves the transport: not logged, not returned, not
  embedded in errors or in the store object.
- Bounded queries: clamp `limit`/`offset` to integer ranges and prove server
  capability for filtered list/search (knowledge's
  `KnowledgeBoundedQueryCapabilityError`) so an older server cannot silently
  answer an unfiltered result.
- Optimistic concurrency (knowledge): `update` sends the caller's
  `expectedVersion` as `If-Match`; a server 409 with
  `error: version_conflict` surfaces as a typed `VersionConflictError`
  carrying BOTH version numbers — never a blind retry.
- 404 vs absent: version-history reads return `null` for a missing ENTRY, so
  "never edited" and "does not exist" stay distinguishable.
- A client never opens PostgreSQL. If a sub-resource must write through HTTP
  with no local fallback, resolve the guarded transport with an env that
  strips HOME / credential-profile / credential-override keys so ambient
  credentials cannot authenticate as another tenant.

## Step 3 — server backend (`pg-adapter` over the storage kit)

- The server stores via a storage-neutral surface: `db.query(sql)` returning
  `{get, run, all}`, plus `exec`, `transaction`, `backend`, `close`. SQLite
  (`bun:sqlite`) already provides this shape; PostgreSQL gets an adapter.
- The adapter wraps the vendored kit's query client
  (`createPgPool` + `createQueryClient` from
  `src/generated/storage-kit/`) and translates `?` placeholders to `$1..$n`,
  skipping single-quoted literals (with `''` escapes), double-quoted
  identifiers, and `--` line comments so a `?` inside a literal is never
  mistaken for a parameter.
- `backend: 'postgresql'` on the wrapper; `transaction` throws on PG when the
  only transaction user is a sync endpoint the PG schema deliberately drops.
- The connection string is never logged, printed, or included in errors.

## Step 4 — schema migrations (`pg-migrations.ts`)

- A list of `CREATE TABLE IF NOT EXISTS ...` statements translated from the
  SQLite schema. Deliberate dialect rules, each stated in the file header so
  nobody re-introduces the old shape:
  - Timestamp columns are TEXT exactly like SQLite so ISO-string comparisons
    behave identically on both backends.
  - Flag/counter columns stay INTEGER so values round-trip as numbers.
  - JSON-shaped payload columns stay TEXT (the server serializes/parses
    itself); only the contracts `api_keys.scopes` is JSONB.
  - Tables a removed feature owns (e.g. `sync_batches` when multi-machine
    sync is being retired) are DROPPED from the PG schema.
- The assembly: extensions first
  (`defineMigration('<app>_pg_000_extensions', 'CREATE EXTENSION IF NOT EXISTS pgcrypto')`),
  then the schema array numbered `<app>_pg_001...`, then the contracts
  api-key migrations LAST (`apiKeyMigrations()` from `@hasna/contracts/auth`,
  ids namespaced so they never clash with `<app>_pg_*`). The api_keys ledger
  backs the serve API-key auth middleware.
- Apply through the vendored storage kit's `MigrationLedger` (sha256 checksum
  ledger, drift and downgrade guards) — never a hand-rolled migration runner.

## Step 5 — the apply script (`scripts/apply-postgres-migrations.mjs`)

- First line `#!/usr/bin/env bun` (see Step 7), `--dry-run` and `--json`
  flags, and the summary builder EXPORTED behind `import.meta.main` so
  regression tests exercise the exact derivation.
- Requires `HASNA_<APP>_DATABASE_URL`; the value is never printed or captured
  — inject it through the runtime's credential consumer. Migrations run DDL,
  so prefer the owner-scoped DSN `HASNA_<APP>_DATABASE_URL_OWNER`, falling
  back to the app DSN for local/dev runs, and write the resolved value back
  to the app variable so the database client picks it up.
- node-postgres >= 8.22 changed sslmode handling: when the DSN carries
  `sslmode=require` or `sslmode=prefer` without `uselibpqcompat`, append
  `&uselibpqcompat=true` to restore kit-intended semantics (both in the
  apply script and in the serve-side `normalizePostgresDatabaseUrl`).
- P1 LESSON — the summary derives from the FRESH APPLIED SET:
  `buildMigrationSummary` must count `result.applied` (the ledger re-reads
  the applied set AFTER the apply loop) — never `result.plan`, which is
  computed BEFORE it and is stale on any run that applies something. The
  plan-derived form reported `alreadyApplied: 0` and `pending: [all]` on a
  first apply that had applied every migration.
- `ledger.migrate({ dryRun })`, print
  `total=... already=... pending=...`, and `close()` the client in `finally`.

## Step 6 — TLS and the RDS CA bundle

The vendored kit owns TLS — `resolveTlsConfig` (tls.ts) turns the DSN's TLS
parameters into an explicit `ssl` option, and `pool.ts` hands `pg` the DSN
with those parameters STRIPPED (`connectionStringWithoutTlsParameters`): pg
re-parses the connection string after merging pool options and the parse
wins, so a surviving `sslmode`/`sslrootcert` would discard the resolved
object — CA bundle included. Facts to rely on:

- `require`/`prefer` -> `{rejectUnauthorized: true, ca?}` — encrypt AND
  verify; `verify-ca`/`verify-full` -> bundle is MANDATORY (throws without).
- Explicit off resolves to `false`; a DSN with no ssl parameter resolves to
  `undefined` (pg's `PGSSLMODE` fallback applies); a PRESENT-but-empty
  `?sslmode=` throws — empty is a value, not an absence.
- Amazon RDS's root is NOT in Node's trust store, so a managed RDS with
  `sslmode=require` fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` unless the
  Amazon RDS global bundle is reachable: download it at image build time
  (`https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem` into
  the image, e.g. `/etc/ssl/certs/rds-global-bundle.pem`), or set
  `sslrootcert` / `PGSSLROOTCERT` / `NODE_EXTRA_CA_CERTS`.
- A supplied bundle REPLACES the default trust store (Node's `ca` option) —
  tighter, not looser.

## Step 7 — bins are bun-shebanged

Every shipped bin (`<name>`, `<name>-mcp`, `<name>-serve`) starts with
`#!/usr/bin/env bun` (plus `// @bun` where the build marks it). P1 LESSON:
when the module graph vendors `.ts`-only modules (e.g. `pg-migrations.ts`,
the generated kit's `.ts` files), a plain `node` shebang breaks at runtime —
the runner must be bun to load the graph.

## Step 8 — the contract manifest (`hasna.contract.json`)

`schema: hasna.service_contract.v1`, `class: cli-with-store`, `kitVersion`
matching the vendored kit, and:

- `storage`: `backend: sqlite` (the zero-config default), `engines:
  ["sqlite", "postgresql"]`, `envPrefix: HASNA_<APP>_`, `sqlitePath`,
  `pgTestGate` (`envVar: <APP>_TEST_DATABASE_URL`).
- `serviceSurfaces`: the `-serve` API (api-key auth, `/health` + `/ready` +
  `/version` public, `/openapi.json`), the `./sdk` client, the MCP bin
  (local-only), the CLI (local-only).
- `metadata`: service port/health/readiness/version/openapi paths, auth
  `api-key`, `signingSecretEnvVar: HASNA_<APP>_API_SIGNING_KEY`,
  `migrationCommand: ["bun", "scripts/apply-postgres-migrations.mjs"]`,
  client `apiUrlEnv`/`apiKeyEnv`.

## Step 9 — Dockerfile

- arm64 `oven/bun:1-alpine`; copy `package.json` plus member manifests and
  `bun install --ignore-scripts` in a base stage; runtime stage with
  `NODE_ENV=production`, the service port, and the server host set to
  `0.0.0.0` (a container is reached through its published port).
- Copy app code + `src/generated`; `wget` the RDS global bundle into
  `/etc/ssl/certs/` (Step 6); drop privileges (`USER bun`); `HEALTHCHECK`
  against the public `/health`; `CMD ["bun", "bin/<name>-serve.mjs"]`.
- Migrations run as a ONE-SHOT TASK with the DB-owner role
  (`bun scripts/apply-postgres-migrations.mjs`); the service itself connects
  with the DML-only app role and must NOT attempt CREATE TABLE — the api_keys
  schema is a deploy prerequisite.

## Scope — what this skill deliberately does NOT cover

- Data pumping / bulk sync between backends: `sqlite-to-rds-parity-migrate`
  owns that.
- Mode enums or deployment modes in any form: do NOT resurrect them
  (deployment modes are retired). If a stale config or prompt still carries a
  mode selector, retire it via the fail-loud ratchet in Step 1.

## Verification checklist

1. Transport: URL-without-key throws; no URL -> local; retired selector
   present (even blank) throws. Unit-tested (`client-transport.test.ts`,
   `transport.test.mjs`).
2. HTTP store: key never appears in logs/errors/objects; bounded query
   validation; 409 maps to the typed conflict with both versions.
3. Adapter: `?` placeholder translation skips literals, quoted identifiers
   and comments; PG transaction throws where the dialect drops it.
4. Migrations: ledger applies idempotently; `--dry-run` plans; summary
   derives from the fresh applied set (regression-tested).
5. Bins: every bin bun-shebanged; `bun run check` passes in the monorepo
   (names + secrets + manifests + publish-guard + scope + deps + identities).
6. Manifest validates against the contracts schema (kit version matches);
   Dockerfile builds and the image healthcheck passes.
