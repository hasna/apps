// Live integration tests for the Postgres LoopStorageContract implementation.
//
// Runs only when LOOPS_TEST_DATABASE_URL points at a DISPOSABLE Postgres (a
// dockerized instance or a throwaway local database) — NEVER the shared RDS.
// When unset the suite is skipped so `bun test` stays hermetic offline.
//
// Covers the priority-1/priority-2 paths the daemon + CLI + runner exercise:
// loop CRUD, run lifecycle (claim/heartbeat/finalize/recover), daemon lease,
// counts, route representation, prune, and the two-connection claim race.
// Remaining TIER-2 unported methods are asserted to throw NotImplementedError
// rather than silently no-op.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import pg from "pg";
import { PgPoolExecutor } from "./pg-executor.js";
import { PostgresStorage } from "./postgres.js";
import { PostgresLoopStorage, NotImplementedError } from "./postgres-loop-storage.js";
import type { CreateLoopInput, Loop, LoopRun, WorkflowSpec } from "../../types.js";

const DATABASE_URL = process.env.LOOPS_TEST_DATABASE_URL;
const RUN_LIVE = typeof DATABASE_URL === "string" && DATABASE_URL.length > 0;
const suite = RUN_LIVE ? describe : describe.skip;

// Isolate in a dedicated throwaway database so this file never interferes with
// the sibling `postgres-concurrency.test.ts` (its claim path drains ALL queued
// / lease-expired runs table-wide; running both files in one `bun test` against
// a shared database would let each see the other's rows).
const ISO_DB = `loops_pgstore_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
function isolatedUrl(): string {
  const u = new URL(DATABASE_URL!);
  u.pathname = `/${ISO_DB}`;
  return u.toString();
}
async function admin(sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

function loopInput(name: string, over: Partial<CreateLoopInput> = {}): CreateLoopInput {
  return {
    name,
    schedule: { type: "interval", everyMs: 60_000 },
    target: { type: "command", command: "true" },
    ...over,
  } as CreateLoopInput;
}

suite("PostgresLoopStorage (live)", () => {
  let executor: PgPoolExecutor;
  let storage: PostgresLoopStorage;

  beforeAll(async () => {
    await admin(`CREATE DATABASE ${ISO_DB}`);
    executor = PgPoolExecutor.fromConnectionString({ connectionString: isolatedUrl(), applicationName: "loops-pgstore-test" });
    await new PostgresStorage(executor).migrate();
    storage = new PostgresLoopStorage(executor.queryClient);
  });

  afterAll(async () => {
    await executor.close();
    await admin(`DROP DATABASE IF EXISTS ${ISO_DB} WITH (FORCE)`);
  });

  beforeEach(async () => {
    // Disposable DB: wipe between tests. CASCADE clears child rows.
    await executor.queryClient.execute(
      "TRUNCATE loops, loop_runs, workflow_specs, workflow_runs, workflow_step_runs, workflow_events, workflow_invocations, workflow_work_items, goals, goal_plan_nodes, goal_runs, daemon_lease, runner_machines, runner_leases, audit_events RESTART IDENTITY CASCADE",
    );
  });

  test("createLoop round-trips json/timestamps and reads resolve", async () => {
    const loop = await storage.createLoop(loopInput("alpha"));
    expect(loop.id).toBeTruthy();
    expect(loop.status).toBe("active");
    expect(loop.schedule).toEqual({ type: "interval", everyMs: 60_000 });
    expect(loop.target.type).toBe("command");
    expect(loop.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);

    const byId = await storage.getLoop(loop.id);
    expect(byId?.id).toBe(loop.id);
    const byName = await storage.findLoopByName("alpha");
    expect(byName?.id).toBe(loop.id);
    const required = await storage.requireLoop("alpha");
    expect(required.id).toBe(loop.id);
    await expect(storage.requireLoop("nope")).rejects.toThrow();
  });

  test("listLoops / dueLoops / countLoops", async () => {
    const a = await storage.createLoop(loopInput("a"));
    await storage.createLoop(loopInput("b"));
    expect((await storage.listLoops()).length).toBe(2);
    expect(await storage.countLoops()).toBe(2);
    expect(await storage.countLoops("active")).toBe(2);

    // a is due (next_run set in the past); make it due explicitly.
    await storage.updateLoop(a.id, { nextRunAt: "2000-01-01T00:00:00.000Z" });
    const due = await storage.dueLoops(new Date());
    expect(due.map((l) => l.id)).toContain(a.id);
  });

  test("updateLoop enforces archive freeze + rename/archive/unarchive/delete", async () => {
    const loop = await storage.createLoop(loopInput("mut"));
    const paused = await storage.updateLoop(loop.id, { status: "paused" });
    expect(paused.status).toBe("paused");

    const renamed = await storage.renameLoop(loop.id, "mut2");
    expect(renamed.name).toBe("mut2");

    const archived = await storage.archiveLoop(loop.id);
    expect(archived.archivedAt).toBeTruthy();
    await expect(storage.updateLoop(loop.id, { status: "active" })).rejects.toThrow();

    const un = await storage.unarchiveLoop(loop.id);
    expect(un.archivedAt).toBeUndefined();

    expect(await storage.deleteLoop(loop.id)).toBe(true);
    expect(await storage.getLoop(loop.id)).toBeUndefined();
  });

  test("run lifecycle: claim -> record -> heartbeat -> finalize", async () => {
    const loop = await storage.createLoop(loopInput("runner", { leaseMs: 60_000 }));
    const slot = "2026-07-06T10:00:00.000Z";
    const claim = await storage.claimRun(loop, slot, "runner-1");
    expect(claim).toBeTruthy();
    expect(claim!.run.status).toBe("running");
    const token = claim!.claimToken!;

    // A second claim on the same live-leased slot must fail.
    const second = await storage.claimRun(loop, slot, "runner-2");
    expect(second).toBeUndefined();

    const rec = await storage.recordRunProcess(claim!.run.id, { pid: 4242 });
    expect(rec?.pid).toBe(4242);

    const hb = await storage.heartbeatRunLease(claim!.run.id, "runner-1", 60_000, new Date(), { claimToken: token });
    expect(hb?.status).toBe("running");

    const fin = await storage.finalizeRun(
      claim!.run.id,
      { status: "succeeded", finishedAt: new Date().toISOString(), durationMs: 5, stdout: "ok", stderr: "" },
      { claimedBy: "runner-1", claimToken: token },
    );
    expect(fin.status).toBe("succeeded");
    expect(fin.stdout).toBe("ok");

    expect(await storage.countRuns("succeeded")).toBe(1);
    const runs = await storage.listRuns({ loopId: loop.id });
    expect(runs.length).toBe(1);
    expect((await storage.getRunBySlot(loop.id, slot))?.id).toBe(claim!.run.id);
  });

  test("createSkippedRun is idempotent per slot", async () => {
    const loop = await storage.createLoop(loopInput("skip"));
    const slot = "2026-07-06T11:00:00.000Z";
    const a = await storage.createSkippedRun(loop, slot, "overlap");
    const b = await storage.createSkippedRun(loop, slot, "overlap again");
    expect(a.id).toBe(b.id);
    expect(a.status).toBe("skipped");
  });

  test("recoverExpiredRunLeases abandons expired running runs", async () => {
    const loop = await storage.createLoop(loopInput("recover", { leaseMs: 1 }));
    const slot = "2026-07-06T12:00:00.000Z";
    const past = new Date(Date.now() - 60_000);
    const claim = await storage.claimRun(loop, slot, "runner-x", past);
    expect(claim).toBeTruthy();
    const result = await storage.recoverExpiredRunLeasesDetailed(new Date());
    expect(result.abandoned.length).toBe(1);
    expect(result.abandoned[0]!.status).toBe("abandoned");
    expect(result.deferred.length).toBe(0);
  });

  test("daemon lease acquire/heartbeat/release/get", async () => {
    const acq = await storage.acquireDaemonLease({ id: "d1", pid: 1, hostname: "h", ttlMs: 60_000 });
    expect(acq?.id).toBe("d1");
    // A different daemon cannot steal a live lease.
    const stolen = await storage.acquireDaemonLease({ id: "d2", pid: 2, hostname: "h2", ttlMs: 60_000 });
    expect(stolen).toBeUndefined();
    const hb = await storage.heartbeatDaemonLease("d1", 60_000);
    expect(hb?.id).toBe("d1");
    expect((await storage.getDaemonLease())?.id).toBe("d1");
    await storage.releaseDaemonLease("d1");
    expect(await storage.getDaemonLease()).toBeUndefined();
  });

  test("pruneHistory deletes old terminal runs", async () => {
    const loop = await storage.createLoop(loopInput("prune"));
    // Insert an old terminal run directly.
    await executor.queryClient.execute(
      `INSERT INTO loop_runs (id, loop_id, loop_name, scheduled_for, attempt, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,1,'succeeded',$5,$5)`,
      ["oldrun", loop.id, "prune", "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z"],
    );
    const summary = await storage.pruneHistory({ maxAgeDays: 30 });
    expect(summary.loopRuns).toBe(1);
    expect(await storage.getRun("oldrun")).toBeUndefined();
  });

  test("upsertMigrationLoop/Run/Workflow preserve id+status, are idempotent, and honor replace", async () => {
    const loop: Loop = {
      id: "mig-loop-1",
      name: "migrated",
      description: "backfill",
      status: "stopped",
      archivedAt: "2026-01-02T00:00:00.000Z",
      archivedFromStatus: "paused",
      schedule: { type: "interval", everyMs: 60_000 },
      target: { type: "command", command: "true" },
      catchUp: "latest",
      catchUpLimit: 50,
      overlap: "skip",
      maxAttempts: 1,
      retryDelayMs: 60_000,
      leaseMs: 1_800_000,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };
    const first = await storage.upsertMigrationLoop(loop);
    expect(first.id).toBe("mig-loop-1");
    // status preserved exactly (not forced to "active"), archived state kept.
    expect(first.status).toBe("stopped");
    expect(first.archivedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(first.createdAt).toBe("2026-01-01T00:00:00.000Z");

    // Idempotent: re-upsert without replace keeps a single row and does not
    // overwrite even if the incoming row differs.
    await storage.upsertMigrationLoop({ ...loop, name: "changed" });
    expect((await storage.getLoop("mig-loop-1"))?.name).toBe("migrated");
    expect(await storage.countLoops(undefined, { includeArchived: true })).toBe(1);

    // replace=true updates in place (still one row).
    await storage.upsertMigrationLoop({ ...loop, name: "changed" }, { replace: true });
    expect((await storage.getLoop("mig-loop-1"))?.name).toBe("changed");
    expect(await storage.countLoops(undefined, { includeArchived: true })).toBe(1);

    const run: LoopRun = {
      id: "mig-run-1",
      loopId: "mig-loop-1",
      loopName: "migrated",
      scheduledFor: "2026-01-01T00:00:00.000Z",
      attempt: 1,
      status: "succeeded",
      finishedAt: "2026-01-01T00:00:05.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:05.000Z",
    };
    const importedRun = await storage.upsertMigrationRun(run);
    expect(importedRun.id).toBe("mig-run-1");
    expect(importedRun.status).toBe("succeeded");
    await storage.upsertMigrationRun(run); // idempotent
    expect(await storage.countRuns()).toBe(1);
    // Running runs are rejected (volatile lease/process ownership).
    await expect(storage.upsertMigrationRun({ ...run, id: "mig-run-2", status: "running" })).rejects.toThrow();

    const workflow: WorkflowSpec = {
      id: "mig-wf-1",
      name: "wf",
      version: 1,
      status: "active",
      steps: [{ id: "s1", target: { type: "command", command: "true" } }],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const importedWf = await storage.upsertMigrationWorkflow(workflow);
    expect(importedWf.id).toBe("mig-wf-1");
    await storage.upsertMigrationWorkflow(workflow); // idempotent
    expect(await storage.countWorkflows()).toBe(1);
  });

  test("fleet-union import tolerates secondary-unique collisions (skips, never aborts)", async () => {
    // Baseline: one loop, one run occupying a schedule slot, one active workflow.
    await storage.upsertMigrationLoop({
      id: "u-loop-1", name: "u-migrated", status: "active",
      schedule: { type: "interval", everyMs: 60_000, anchor: "fixed_rate" },
      target: { type: "command", command: "echo", shell: true },
      catchUp: "latest", catchUpLimit: 50, overlap: "skip", maxAttempts: 1,
      retryDelayMs: 1000, leaseMs: 1000,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    } as Loop);
    const baseRun: LoopRun = {
      id: "u-run-1", loopId: "u-loop-1", loopName: "u-migrated",
      scheduledFor: "2026-02-02T00:00:00.000Z", attempt: 1, status: "succeeded",
      finishedAt: "2026-02-02T00:00:05.000Z",
      createdAt: "2026-02-02T00:00:00.000Z", updatedAt: "2026-02-02T00:00:05.000Z",
    };
    await storage.upsertMigrationRun(baseRun);
    const runsBefore = await storage.countRuns();

    // Another machine's run: NEW id, SAME (loop_id, scheduled_for). The
    // (loop_id, scheduled_for) unique constraint can't be caught by ON
    // CONFLICT(id); the import must skip it and return the existing occupant.
    const collidingRun = await storage.upsertMigrationRun({ ...baseRun, id: "u-run-2-different-id" });
    expect(collidingRun.id).toBe("u-run-1");
    expect(await storage.countRuns()).toBe(runsBefore); // no new row, no throw

    // Another machine's workflow: NEW id, SAME active name. The partial unique
    // on (name) WHERE status='active' must be tolerated and the existing owner
    // returned rather than aborting the batch.
    await storage.upsertMigrationWorkflow({
      id: "u-wf-1", name: "u-wf", version: 1, status: "active",
      steps: [{ id: "s1", target: { type: "command", command: "true" } }],
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    } as WorkflowSpec);
    const wfBefore = await storage.countWorkflows();
    const collidingWf = await storage.upsertMigrationWorkflow({
      id: "u-wf-2-different-id", name: "u-wf", version: 2, status: "active",
      steps: [{ id: "s1", target: { type: "command", command: "true" } }],
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    } as WorkflowSpec);
    expect(collidingWf.id).toBe("u-wf-1");
    expect(await storage.countWorkflows()).toBe(wfBefore); // no new row, no throw
  });

  test("createWorkflow persists a spec and archiveWorkflow flips its status", async () => {
    const created = await storage.createWorkflow({
      name: "pg-created-wf",
      steps: [{ id: "s1", target: { type: "command", command: "true" } }],
    });
    expect(created.id).toBeTruthy();
    expect(created.status).toBe("active");

    const fetched = await storage.getWorkflow(created.id);
    expect(fetched?.name).toBe("pg-created-wf");
    expect(fetched?.steps).toHaveLength(1);

    const listed = await storage.listWorkflows({ status: "active" });
    expect(listed.some((wf) => wf.id === created.id)).toBe(true);

    const archived = await storage.archiveWorkflow(created.id);
    expect(archived.status).toBe("archived");
    expect((await storage.getWorkflow(created.id))?.status).toBe("archived");
  });

  test("route invocation and work-item upserts preserve caller ids", async () => {
    const invocation = await storage.createWorkflowInvocation({
      id: "pg-inv-1",
      sourceRef: { kind: "task", id: "task-1", dedupeKey: "task-1" },
      subjectRef: { kind: "repo", path: "/repo" },
      intent: "route",
    });
    expect(invocation.id).toBe("pg-inv-1");
    const deduped = await storage.createWorkflowInvocation({
      id: "pg-inv-2",
      sourceRef: { kind: "task", id: "task-1", dedupeKey: "task-1" },
      subjectRef: { kind: "repo", path: "/repo" },
      intent: "route",
    });
    expect(deduped.id).toBe("pg-inv-1");

    const item = await storage.upsertWorkflowWorkItem({
      id: "pg-wi-1",
      routeKey: "todos-task",
      idempotencyKey: "task-1",
      invocationId: "pg-inv-1",
      sourceType: "task",
      sourceRef: "task:task-1",
      subjectRef: "repo:/repo",
      priority: 10,
      status: "queued",
    });
    expect(item.id).toBe("pg-wi-1");
    expect(item.routeKey).toBe("todos-task");
    const replay = await storage.upsertWorkflowWorkItem({
      id: "pg-wi-2",
      routeKey: "todos-task",
      idempotencyKey: "task-1",
      invocationId: "pg-inv-1",
      sourceType: "task",
      sourceRef: "task:task-1",
      subjectRef: "repo:/repo",
      priority: 20,
      status: "deferred",
    });
    expect(replay.id).toBe("pg-wi-1");
    expect(replay.priority).toBe(20);
    expect(replay.status).toBe("deferred");
  });

  test("TIER-2 unported methods throw NotImplementedError (never silently no-op)", () => {
    expect(() => storage.createGoal()).toThrow(NotImplementedError);
    expect(() => storage.finalizeWorkflowRun()).toThrow(/not implemented/i);
  });

  test("two connections never double-claim the same slot (contract claimRun)", async () => {
    const execB = PgPoolExecutor.fromConnectionString({ connectionString: isolatedUrl(), applicationName: "loops-pgstore-test-b" });
    const storageB = new PostgresLoopStorage(execB.queryClient);
    try {
      const loop = await storage.createLoop(loopInput("race", { leaseMs: 60_000 }));
      const slot = "2026-07-06T13:00:00.000Z";
      const [a, b] = await Promise.all([
        storage.claimRun(loop, slot, "runner-a"),
        storageB.claimRun(loop, slot, "runner-b"),
      ]);
      const winners = [a, b].filter(Boolean);
      expect(winners.length).toBe(1);
      const running = await executor.queryClient.get<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM loop_runs WHERE loop_id=$1 AND status='running'",
        [loop.id],
      );
      expect(running?.count).toBe(1);
    } finally {
      await execB.close();
    }
  });
});
