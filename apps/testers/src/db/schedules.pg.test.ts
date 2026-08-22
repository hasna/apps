/**
 * Live-PostgreSQL regression for the release-review P1 on the hosted
 * schedule INSERT: `created_at` and `updated_at` were bound to the same
 * placeholder as `next_run_at` ($11,$11,$11 with ts at $12/$13 unused), so a
 * valid schedule received its future next_run_at as creation/update
 * timestamps, and a schedule whose cron has no next occurrence (next_run_at
 * NULL) violated the non-null constraint on both timestamp columns.
 *
 * Convention mirrors src/server/personas-pagination.pg.test.ts: runs only
 * when TESTERS_PG_TEST_URL is set (skipped loudly otherwise).
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Pool } from "pg";
import { createQueryClient } from "../generated/storage-kit/query.js";
import { runPgMigrations } from "./pg-migrate.js";
import { createSchedule } from "./pg-store.js";

const TESTERS_PG_TEST_URL = process.env.TESTERS_PG_TEST_URL;

describe.skipIf(!TESTERS_PG_TEST_URL)("pg-store createSchedule timestamp binding (live Postgres)", () => {
  let pool: Pool;
  let db: ReturnType<typeof createQueryClient>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TESTERS_PG_TEST_URL });
    db = createQueryClient(pool);
    await runPgMigrations(db);
  });

  afterAll(async () => {
    await pool?.end();
  });

  test("valid cron: created_at/updated_at are the insert time, not next_run_at", async () => {
    const s = await createSchedule(db, {
      name: "regression-valid-cron",
      cronExpression: "0 2 * * *",
      url: "http://localhost:3000",
    });
    expect(s.id).toBeTruthy();
    expect(s.nextRunAt).toBeTruthy();
    expect(s.createdAt).toBeTruthy();
    expect(s.updatedAt).toBeTruthy();
    // The regression bound created_at/updated_at to the next_run_at
    // placeholder, so a freshly created schedule had createdAt === nextRunAt.
    expect(s.createdAt).not.toBe(s.nextRunAt);
  });

  test("invalid cron: insert succeeds with non-null timestamps", async () => {
    const s = await createSchedule(db, {
      name: "regression-invalid-cron",
      cronExpression: "not a cron",
      url: "http://localhost:3000",
    });
    expect(s.id).toBeTruthy();
    expect(s.nextRunAt).toBeNull();
    expect(s.createdAt).toBeTruthy();
    expect(s.updatedAt).toBeTruthy();
  });
});
