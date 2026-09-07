# Loops Postgres Cutover Runbook

Status: **self-hosted control-plane backend landed; local daemon cutover is not
complete.** Do not flip scheduled production execution away from local SQLite
until the runner and migration follow-ups below are green.

Deployment vocabulary: there are no deployment modes. `loops-serve` is the
control-plane server in this package; it selects PostgreSQL from
`HASNA_LOOPS_DATABASE_URL`. Hasna's own AWS deployment is customer-zero of the
user-hosted story, not a separate mode.

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

Before step 1, satisfy and preserve evidence for these hard gates:

- For the shared `apps` to dedicated `loops` database transfer lane, use only
  the selective logical transfer in `docs/SHARED-DATABASE-TRANSFER.md`. Do not
  snapshot-restore the shared cluster or shared database into the dedicated
  Loops target. The protected workflow may start only the fixed
  `bun dist/serve/index.js shared-to-dedicated-transfer` ECS command, with DSNs
  supplied by ECS task secrets.
- Use a dedicated Loops PostgreSQL cluster, not only a dedicated database.
  PostgreSQL roles are cluster-global: inventory every database, role
  membership, database owner, and `pg_shdepend` row for the four reserved
  `open_loops_*` roles. The enforcement preflight fails if a reserved role owns
  another database or has a cross-database dependency. No reserved role may be
  `LOGIN`; the command fails closed instead of silently detaching a credential.
- Prove recovery before mutation. Confirm PITR is inside its retention window,
  identify the exact pre-cutover recovery point, and complete an isolated
  restore rehearsal from that point. Record the recovery point, restored
  database identifier, verification command/results, elapsed restore time, and
  cleanup result. Backup configuration without a successful restore is not
  sufficient evidence.
- Enter a maintenance window before the first non-dry-run migration. Stop new
  API writes, drain in-flight work, stop every service/runner that can write the
  database, and verify no non-operator sessions or open write transactions
  remain. Run exactly one migrator. The binary also takes a transaction-scoped
  advisory lock and recomputes the ledger plan after acquiring it, but the lock
  does not replace application quiescence.

1. Provision the four NOLOGIN database roles and the separate enforcement
   login. Tenant enforcement must run through a
   provider-level bootstrap administrator against a dedicated Loops
   database owned by that bootstrap login (or use a true superuser). Do not run enforcement in a database shared with another
   application: migration `0010` normalizes ACLs across every non-system
   schema, table, sequence, and function in the current database. `CREATEROLE`, control of the
   `public` schema, and the ability to `SET ROLE` to `open_loops_owner` and
   `open_loops_migrator` are minimum requirements. With PostgreSQL 16's default
   `createrole_self_grant=''`, a non-superuser must use four pre-provisioned,
   already-normalized Loops roles and must have only direct owner/migrator
   memberships with `ADMIN FALSE`, `INHERIT TRUE`, and `SET TRUE`. It must not
   be a member of the runtime or authenticator roles. No LOGIN role may inherit
   runtime or authenticator yet; attach service credentials only after `0010`
   succeeds. Creating the roles as the
   non-superuser is not sufficient: PostgreSQL adds an implicit `ADMIN TRUE`,
   `INHERIT FALSE`, `SET FALSE` creator row that only a superuser can revoke.
   The command transactionally exercises and rolls back the exact membership,
   `SET ROLE`, migration-ledger ownership/write, ACL, and service-login cleanup
   operations before migration `0010`; static role flags are not accepted as
   proof. Provider/bootstrap identities are never passed to `DROP OWNED`, and
   unsafe LOGIN memberships fail closed instead of being silently detached.
   After enforcement, the runtime and authenticator service logins must be
   members only of their matching roles, granted with `ADMIN FALSE`, `INHERIT
   TRUE`, and `SET TRUE`.
   Never reuse the bootstrap DSN in `loops-serve`.
2. Prepare the tenant schema with the ECS one-shot task or an operator command:
   `HASNA_LOOPS_MIGRATOR_DATABASE_URL=... loops-serve migrate --dry-run`, then
   `HASNA_LOOPS_MIGRATOR_DATABASE_URL=... loops-serve migrate`.
3. In ECS, load the reviewed explicit ownership bundle with the fixed,
   no-argument command
   `HASNA_LOOPS_MIGRATOR_DATABASE_URL=... HASNA_LOOPS_BACKFILL_BUCKET=... AWS_REGION=... loops-serve tenant-backfill-s3`.
   The task role must expose only a valid
   `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`. The bucket must contain exactly one
   object under `approved/`, named `approved/sha256-<64 lowercase hex>.json`,
   and no more than 10 MiB. The command verifies the raw-byte digest before
   parsing, loads transactionally, deletes the selected object on success or
   failure, and treats deletion failure as fatal. Record its bounded digest and
   counts log only. For a local operator rehearsal, the compatible file command
   remains `HASNA_LOOPS_MIGRATOR_DATABASE_URL=... loops-serve tenant-backfill --input <bundle>`.
   Before delivery, require named operator approval of tenant, principal,
   membership, API-key, and row-owner counts; compute and record the bundle's
   SHA-256; and transfer it only through the approved encrypted artifact path.
   For local file delivery only, verify the hash and restrictive file
   permissions before use, then remove the staged artifact after the
   transaction and evidence capture complete. Record only the hash, counts,
   approver, and bounded command result—never bundle contents or credentials.
4. Enforce tenant keys, composite foreign keys, and forced RLS with
   `HASNA_LOOPS_MIGRATOR_DATABASE_URL=... loops-serve migrate --enforce-tenancy`.
   After this succeeds, have provider automation attach the runtime and
   authenticator logins to their matching roles; do not reuse the enforcement
   login for either service.
   Keep the write plane quiesced while validating migration-ledger ownership,
   exact role memberships, forced RLS, runtime/authenticator connection safety,
   and `/ready`. If any gate fails, keep the service stopped and use the
   rehearsed recovery procedure; do not continue from a partially understood
   state.
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
8. When provider-managed RDS credentials are used, run
   `loops-serve db-credentials reconcile` from the in-cluster task role before
   starting the service. Required inputs are secret ARNs and expected RDS
   metadata only, not secret values. The command reads the RDS-managed master
   secret through AWS Secrets Manager, writes app DSNs through `AWSPENDING`,
   changes each login password transactionally, verifies a fresh
   `sslmode=verify-full` connection, and promotes `AWSCURRENT` only after the
   fresh connection succeeds. It logs only bounded status metadata. Before
   migration `0010_tenant_enforce`, runtime/authenticator logins remain detached;
   after `0010`, they attach only to their matching NOLOGIN roles.
9. Wire minimum alarms before cutover: ALB unhealthy hosts, ALB 5xx, ALB target
   latency, ECS running count below desired count, ECS task exits, RDS CPU,
   RDS connections, RDS free storage, and log error-rate/auth-anomaly signals.
10. Start `loops-serve` with separate `HASNA_LOOPS_DATABASE_URL` and
   `HASNA_LOOPS_AUTH_DATABASE_URL` logins and the API signing secret from the approved
   vault item. There is no mode variable: the server selects PostgreSQL from
   the configured DSN. The signing key must be at least 16 bytes. Do not log or copy the
   secret value into task evidence.
11. Verify `/health`, `/ready`, `/version`, and `/openapi.json`.
12. Verify an authenticated `/v1` read/write smoke against a throwaway loop and
   a claim/finalize smoke if a runner API URL is configured.
13. Record package version, git SHA, image tag and digest, database migration
   plan/result, evidence that the target database is dedicated to Loops,
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
  `loops push --apply` cover workflow specs and loop definitions
  with safe paused/archived defaults; they intentionally block unsupported live
  history.
- Hosted SaaS integration outside this public package.

## Rollback

Before migration `0010_tenant_enforce` is applied, an image-only rollback may
redeploy the previous digest or shift the ALB target group to the previous
service revision, provided its migration checksum contract still matches the
database. After `0010` succeeds, do not point a previous image at the enforced
database: the `c506685e` base carries the superseded `0010` checksum and the
published `0.4.28` image has no `0008`-`0010`, so neither can pass readiness
against this schema.

Post-`0010`, either roll forward with a schema-compatible image, or restore the
rehearsed pre-cutover PITR point to a separate database target. For the restore
path, repoint the previous service revision's runtime/auth credentials and
endpoint to that separate target, verify the restored migration ledger and
expected row counts, then prove the previous image's `/ready`, authenticated
loop CRUD, runner claim/finalize, and
`loops push --dry-run --no-runs`. Never attempt an in-place reverse
migration or overwrite the enforced database during rollback.
Local scheduled execution remains on SQLite unless operators explicitly
configure a runner/control-plane cutover, so removing the machine's loops
credential (unset `HASNA_LOOPS_API_KEY`, delete the Keychain item
`hasna.credentials.loops.api-key` / the credential file
`~/.hasna/loops/config/credentials`) returns the standalone CLI/daemon to
fail-closed mode; the local file connection is the explicit
`HASNA_LOOPS_CONNECTION=file` opt-in.
