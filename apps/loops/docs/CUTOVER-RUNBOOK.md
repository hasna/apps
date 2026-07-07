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
  listing, and runner registration/claim/heartbeat/finalize protocol routes.
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

`loops-serve` may bind to loopback without an API signing secret for local
development. A non-local bind must set `HASNA_LOOPS_API_SIGNING_KEY`,
`HASNA_API_SIGNING_KEY`, or `API_KEY_SIGNING_SECRET`; otherwise the service
fails closed before exposing `/v1`.

## AWS Self-Hosted Gates

1. Apply migrations with the ECS one-shot task or an operator command:
   `HASNA_LOOPS_DATABASE_URL=... loops-serve migrate --dry-run`, then
   `HASNA_LOOPS_DATABASE_URL=... loops-serve migrate`.
2. Start `loops-serve` with `HASNA_LOOPS_MODE=self_hosted`,
   `HASNA_LOOPS_DATABASE_URL`, and the API signing secret from the approved
   vault item. Do not log or copy the secret value into task evidence.
3. Verify `/health`, `/ready`, `/version`, and `/openapi.json`.
4. Verify an authenticated `/v1` read/write smoke against a throwaway loop and
   a runner registration/claim/finalize smoke if a runner API URL is configured.
5. Record package version, git SHA, image tag, database migration plan/result,
   redacted API URL, health/readiness responses, and rollback handle.

## Still Pending Before Daemon Cutover

- Long-running `loops-runner` daemon mode with backoff, fleet observability, and
  durable machine registration records.
- Workflow target execution over the runner protocol.
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
removing `LOOPS_API_URL`, `HASNA_LOOPS_API_URL`, `LOOPS_DATABASE_URL`, or
`HASNA_LOOPS_DATABASE_URL` returns the standalone CLI/daemon perspective to
`local`.
