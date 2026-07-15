# Loops Postgres Cutover Runbook

Status: **self-hosted control-plane backend landed; local daemon cutover is not
complete.** Do not flip scheduled production execution away from local SQLite
until the runner and migration follow-ups below are green.

Deployment vocabulary: `self_hosted` is the Hasna-owned AWS/RDS control-plane
deployment. `cloud` is the future hosted SaaS contract for outside users. The
vendored `@hasna/contracts` storage kit still calls direct Postgres storage
mode `cloud`; treat that as a storage-kit implementation term, not the
OpenLoops deployment mode.

## What Shipped

- `loops-serve` HTTP control plane: RDS-direct Postgres, `GET /health`,
  `/ready`, `/version`, `/openapi.json`, storage-backed `/v1` loop CRUD and run
  listing, and runner claim/lease heartbeat/finalize protocol routes. Durable
  runner registration remains a cutover gate and is not advertised as a route.
- `@hasna/contracts` API-key auth on non-local `loops-serve` binds, backed by
  the shared `api_keys` table and a signing secret.
- Full `PostgresLoopStorage` behind `LoopStorageContract`, plus
  `PgPoolExecutor`, runner claim/lease helpers, and Postgres concurrency tests.
- `loops-serve migrate`, which applies the ledger-tracked Postgres migrations
  and ensures the `api_keys` table.
- `@hasna/loops/sdk/http`, generated from `openapi/loops.json`.
- ARM64/Bun `Dockerfile`, local `docker-compose.yml`, `hasna.contract.json`,
  and a generated `migrations/` mirror for review.

## Local Postgres Smoke For loops-serve

Run the local development stack for the self-hosted service:

```bash
docker compose run --rm loops-migrate
docker compose up --build loops-serve
curl -fsS http://127.0.0.1:8787/health
curl -fsS http://127.0.0.1:8787/ready
curl -fsS http://127.0.0.1:8787/openapi.json
```

`loops-serve` always requires `HASNA_LOOPS_API_SIGNING_KEY`. There is no
loopback authentication bypass.

## AWS Self-Hosted Gates

1. Provision separate database logins. Tenant enforcement must run through a
   provider-level bootstrap administrator against a dedicated OpenLoops
   database owned by that bootstrap login (or use a true superuser). Do not run enforcement in a database shared with another
   application: migration `0010` normalizes ACLs across every non-system
   schema, table, sequence, and function in the current database. `CREATEROLE`, control of the
   `public` schema, and the ability to `SET ROLE` to `open_loops_owner` and
   `open_loops_migrator` are minimum requirements; PostgreSQL 16 may require
   stronger provider authority for exact role normalization and service-login
   grant cleanup. The command transactionally exercises and rolls back those
   exact operations before migration `0010`; static role flags are not accepted
   as proof. The runtime and
   authenticator service logins must be members only of their matching roles.
   Never reuse the bootstrap DSN in `loops-serve`.
2. Prepare the tenant schema with the ECS one-shot task or an operator command:
   `HASNA_LOOPS_MIGRATOR_DATABASE_URL=... loops-serve migrate --dry-run`, then
   `HASNA_LOOPS_MIGRATOR_DATABASE_URL=... loops-serve migrate`.
3. Load the reviewed explicit ownership bundle with
   `HASNA_LOOPS_MIGRATOR_DATABASE_URL=... loops-serve tenant-backfill --input <bundle>`.
4. Enforce tenant keys, composite foreign keys, and forced RLS with
   `HASNA_LOOPS_MIGRATOR_DATABASE_URL=... loops-serve migrate --enforce-tenancy`.
5. Start `loops-serve` with `HASNA_LOOPS_STORAGE_MODE=self_hosted`, separate
   `HASNA_LOOPS_DATABASE_URL` and `HASNA_LOOPS_AUTH_DATABASE_URL` logins, and the API signing secret from the approved
   vault item. The signing key must be at least 16 bytes. Do not log or copy the
   secret value into task evidence.
6. Verify `/health`, `/ready`, `/version`, and `/openapi.json`.
7. Verify an authenticated `/v1` read/write smoke against a throwaway loop and
   a claim/finalize smoke if a runner API URL is configured.
8. Record package version, git SHA, image tag, database migration plan/result,
   evidence that the target database is dedicated to OpenLoops, redacted API
   URL, health/readiness responses, and rollback handle.

## Still Pending Before Daemon Cutover

- Long-running `loops-runner` daemon mode with backoff, fleet observability, and
  durable machine registration records.
- Id-preserving self-hosted import endpoints for workflow specs, loop
  definitions, run history, workflow history, work items, goals, and audit rows.
- A no-loss migration path from local SQLite into the self-hosted control plane.
  Current `loops export`/`loops import` are local-store tools, and
  `loops self-hosted migrate|push|pull` remain previews.
- Hosted SaaS integration outside this public package.

## Rollback

For the self-hosted service, roll back by moving traffic to the previous image
or stopping the new `loops-serve` task. Local scheduled execution remains on
SQLite unless operators explicitly configure a runner/control-plane cutover, so
removing `HASNA_LOOPS_API_URL` and `HASNA_LOOPS_DATABASE_URL` returns the standalone CLI/daemon perspective to
`local`.
