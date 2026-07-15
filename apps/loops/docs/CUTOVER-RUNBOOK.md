# Loops Postgres Cutover Runbook

Status: **self-hosted control-plane backend landed; local daemon cutover is not
complete.** Do not flip scheduled production execution away from local SQLite
until the runner and migration follow-ups below are green.

Deployment vocabulary: `self_hosted` is the Hasna-owned AWS/RDS control-plane
deployment. `cloud` is the future hosted SaaS contract for outside users.

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
  generated storage kit, and a generated `migrations/` mirror for review.

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
5. Build and deploy an image from this repository's pinned Bun base-image
   digest. The runner image must pass the CI high/critical vulnerability scan
   and must not replace the locked `@hasna/contracts` package with a vendored
   overlay.
6. Configure the ECS service before traffic is shifted:
   - desired count at least `2`;
   - tasks spread across at least two private subnets/AZs;
   - capacity provider strategy with an on-demand Fargate base of at least one
     task before any Spot capacity;
   - deployment circuit breaker with rollback enabled;
   - ALB target group health check path `/ready`;
   - CloudWatch log retention at least 30 days with KMS encryption;
   - alarm actions wired to the approved incident notification target.
7. Store runtime values in Secrets Manager or the approved vault surface:
   `HASNA_LOOPS_DATABASE_URL`, `HASNA_LOOPS_AUTH_DATABASE_URL`,
   `HASNA_LOOPS_MIGRATOR_DATABASE_URL`, and
   `HASNA_LOOPS_API_SIGNING_KEY`. Enable rotation for the signing secret and
   database credentials where the provider supports it. Do not put secret values
   in task definitions, task comments, logs, or rollout evidence.
8. Wire minimum alarms before cutover: ALB unhealthy hosts, ALB 5xx, ALB target
   latency, ECS running count below desired count, ECS task exits, RDS CPU,
   RDS connections, RDS free storage, and log error-rate/auth-anomaly signals.
9. Start `loops-serve` with `HASNA_LOOPS_STORAGE_MODE=self_hosted`, separate
   `HASNA_LOOPS_DATABASE_URL` and `HASNA_LOOPS_AUTH_DATABASE_URL` logins, and the API signing secret from the approved
   vault item. The signing key must be at least 16 bytes. Do not log or copy the
   secret value into task evidence.
10. Verify `/health`, `/ready`, `/version`, and `/openapi.json`.
11. Verify an authenticated `/v1` read/write smoke against a throwaway loop and
   a claim/finalize smoke if a runner API URL is configured.
12. Record package version, git SHA, image tag and digest, database migration
   plan/result, evidence that the target database is dedicated to OpenLoops,
   redacted API URL, health/readiness responses, capacity-provider strategy,
   desired/running task counts, alarm action ARNs/names, log retention/KMS
   identifiers, rotation status, and rollback handle.

## Still Pending Before Daemon Cutover

- Long-running `loops-runner` daemon mode with backoff, fleet observability, and
  durable machine registration records.
- Id-preserving self-hosted import coverage for run history, workflow history,
  work items, goals, and audit rows.
- A full-history no-loss migration path from local SQLite into the self-hosted
  control plane. Current `loops export`/`loops import` and
  `loops self-hosted push --apply` cover workflow specs and loop definitions
  with safe paused/archived defaults; they intentionally block unsupported live
  history.
- Hosted SaaS integration outside this public package.

## Rollback

For the self-hosted service, roll back by redeploying the previous image digest
or shifting the ALB target group back to the previous service revision. After
rollback, prove `/ready`, authenticated loop CRUD, runner claim/finalize, and
`loops self-hosted push --dry-run --no-runs` against the redacted API URL.
Local scheduled execution remains on SQLite unless operators explicitly
configure a runner/control-plane cutover, so removing `HASNA_LOOPS_API_URL` and
`HASNA_LOOPS_DATABASE_URL` returns the standalone CLI/daemon perspective to
`local`.
