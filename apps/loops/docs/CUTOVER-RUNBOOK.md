# Loops Postgres Cutover Runbook

Status: **backend foundation landed; daemon still runs on local sqlite.** Do NOT
flip the running daemon to Postgres until every step below is green.

PURE REMOTE (Amendment A1): in cloud mode, reads AND writes hit cloud Postgres
directly. There is no hybrid/sync/cache mode. After a verified migration the
local sqlite file is renamed to `<name>.db.pre-cloud-2026-07-06.bak`.

## What shipped in this PR

- Vendored `@hasna/contracts` storage kit → `src/generated/storage-kit/`
  (pool/query/tls/mode/migrations/health). Regenerate: `bunx @hasna/contracts vendor-kit`.
- `src/lib/storage/pg-executor.ts` — `PgPoolExecutor` adapting the vendored
  `pg.Pool` client to `PostgresQueryExecutor` (drives `PostgresStorage.migrate`).
- `src/lib/storage/pg-runner-claim.ts` — `claimNextRun` / `heartbeatRunLease`
  using `SELECT ... FOR UPDATE SKIP LOCKED` for concurrent runners.
- `src/lib/storage/postgres-concurrency.test.ts` — two-connection race test
  (skips unless `LOOPS_TEST_DATABASE_URL` is set; verified green against a
  throwaway local Postgres 16).
- `pg` promoted to a direct dependency; `@types/pg` added as devDependency.

## Remaining before daemon cutover (tracked, NOT done here)

1. **Full `PostgresLoopStorage` implementing `LoopStorageContract`** (60+ methods
   in `src/lib/storage/contract.ts`). Only the migration ledger + claim/lease
   primitives exist today. The claim primitive here is the correctness core to
   build the rest on.
2. **Async consumer wiring.** All call sites construct `new Store()` synchronously
   (`src/cli`, `src/daemon`, `src/sdk`, `src/mcp`, `src/lib/route`). PURE REMOTE
   requires routing them through the async `LoopStorageContract` when
   `LOOPS_DATABASE_URL` is set (mode resolved by `src/lib/mode.ts`, which stays
   authoritative). `SqliteLoopStorage` already wraps the sync store for the
   local path.
3. **`loops migrate-local` command** (data migration TOOLING only): copy
   definitions + schedules + last 30 days of runs from local sqlite into cloud
   Postgres, then rename the sqlite file to the `.pre-cloud-2026-07-06.bak`
   backup. Does NOT enable cloud mode.
4. **Apply schema to shared RDS** via SSM tunnel on local port 15438 using the
   `hasna/oss/loops/database-url-owner` secret, then run
   `PostgresStorage(new PgPoolExecutor(...)).migrate()` (dry-run first). Kill the
   tunnel and remove temp files afterward. Never run the test suite against RDS.

## Enable steps (run only after 1–4 are green)

1. Confirm `PostgresStorage.migrate({ dryRun: true })` reports all four
   migrations already applied on the loops RDS database.
2. Stop the loops daemon: `loops daemon stop`.
3. `loops migrate-local --database-url "$LOOPS_DATABASE_URL"` (moves defs +
   schedules + 30d of runs; verify counts; sqlite renamed to backup).
4. Export `LOOPS_DATABASE_URL` (from `hasna/oss/loops/database-url`) and the
   cloud storage-mode env for the daemon unit; restart the daemon.
5. Verify `loops status` reports `deploymentMode: cloud`, `sourceOfTruth:
   cloud_control_plane`, and that a test loop run claims + finalizes against
   Postgres.

## Rollback

Cloud mode is off until `LOOPS_DATABASE_URL` is present in the daemon env.
To roll back: unset it, restore the sqlite backup
(`mv <name>.db.pre-cloud-2026-07-06.bak <name>.db`), restart the daemon.
