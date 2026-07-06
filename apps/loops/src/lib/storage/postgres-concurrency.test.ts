// Two-connection concurrency test for the Postgres run-claim path.
//
// Runs only when LOOPS_TEST_DATABASE_URL points at a DISPOSABLE Postgres (a
// dockerized instance in CI, or a throwaway local database). It must never be
// pointed at the shared RDS. When unset the suite is skipped so the default
// `bun test` run stays hermetic and offline.
//
// The test proves that under two independent pooled connections racing to claim
// the same queued runs, every run is claimed by exactly one runner — the
// guarantee `FOR UPDATE SKIP LOCKED` provides and a naive SELECT+UPDATE does
// not.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PgPoolExecutor } from "./pg-executor.js";
import { PostgresStorage } from "./postgres.js";
import { claimNextRun, type ClaimedRunRow } from "./pg-runner-claim.js";
import type { PoolQueryClient } from "../../generated/storage-kit/query.js";

const DATABASE_URL = process.env.LOOPS_TEST_DATABASE_URL;
const RUN_LIVE = typeof DATABASE_URL === "string" && DATABASE_URL.length > 0;

const suite = RUN_LIVE ? describe : describe.skip;

suite("Postgres run-claim concurrency (live)", () => {
  let executorA: PgPoolExecutor;
  let clientA: PoolQueryClient;
  let clientB: PoolQueryClient;

  beforeAll(async () => {
    executorA = PgPoolExecutor.fromConnectionString({ connectionString: DATABASE_URL!, applicationName: "loops-test-a" });
    clientA = executorA.queryClient;
    const executorB = PgPoolExecutor.fromConnectionString({ connectionString: DATABASE_URL!, applicationName: "loops-test-b" });
    clientB = executorB.queryClient;
    (globalThis as Record<string, unknown>).__loopsExecutorB = executorB;

    const storage = new PostgresStorage(executorA);
    await storage.migrate();
  });

  afterAll(async () => {
    await clientA.close();
    const executorB = (globalThis as Record<string, unknown>).__loopsExecutorB as PgPoolExecutor | undefined;
    await executorB?.close();
  });

  test("two connections never double-claim the same run (FOR UPDATE SKIP LOCKED)", async () => {
    const loopId = `loop_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await clientA.execute(
      `INSERT INTO loops (id, name, status, schedule_json, target_json, catch_up, catch_up_limit,
         overlap, max_attempts, retry_delay_ms, lease_ms, created_at, updated_at)
       VALUES ($1, $2, 'active', '{}'::jsonb, '{}'::jsonb, 'skip', 0, 'skip', 3, 1000, 60000, $3, $3)`,
      [loopId, `concurrency-${loopId}`, now],
    );

    const RUN_COUNT = 40;
    for (let i = 0; i < RUN_COUNT; i++) {
      const scheduledFor = new Date(Date.now() + i * 1000).toISOString();
      await clientA.execute(
        `INSERT INTO loop_runs (id, loop_id, loop_name, scheduled_for, attempt, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 0, 'queued', $5, $5)`,
        [`run_${loopId}_${i}`, loopId, `concurrency-${loopId}`, scheduledFor, now],
      );
    }

    const claimFrom = async (client: PoolQueryClient, runnerId: string): Promise<ClaimedRunRow[]> => {
      const claimed: ClaimedRunRow[] = [];
      for (;;) {
        const row = await claimNextRun(client, {
          runnerId,
          leaseMs: 60000,
          claimToken: `${runnerId}_${crypto.randomUUID()}`,
        });
        if (!row) break;
        claimed.push(row);
      }
      return claimed;
    };

    // Race two runners on two independent pooled connections.
    const [claimedA, claimedB] = await Promise.all([
      claimFrom(clientA, "runner-a"),
      claimFrom(clientB, "runner-b"),
    ]);

    const allIds = [...claimedA, ...claimedB].map((r) => r.id);
    const uniqueIds = new Set(allIds);

    // Every queued run claimed exactly once, no duplicates across the two runners.
    expect(allIds.length).toBe(RUN_COUNT);
    expect(uniqueIds.size).toBe(RUN_COUNT);

    // Both runners did real work (not a degenerate single-runner drain).
    expect(claimedA.length).toBeGreaterThan(0);
    expect(claimedB.length).toBeGreaterThan(0);

    const remaining = await clientA.get<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM loop_runs WHERE loop_id = $1 AND status = 'queued'`,
      [loopId],
    );
    expect(remaining?.count).toBe("0");

    // Cleanup this test's rows (does not touch other databases/schemas).
    await clientA.execute(`DELETE FROM loops WHERE id = $1`, [loopId]);
  });
});
