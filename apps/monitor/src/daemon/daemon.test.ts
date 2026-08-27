/**
 * MON-V2-04 gate — fake-clock tests for the scheduler, worker pool,
 * recovery, and lifecycle.
 *
 * Every timestamp comes from the injected Clock; no wall-clock reads happen
 * in the daemon path, so all transitions are deterministic.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { FakeClock } from "./clock.js";
import { ensureV2Schema } from "./schema.js";
import {
  registerSlug,
  setSlugDesiredState,
  admitRun,
  cancelSlugRuns,
  countRunsForSlug,
  getRunsForSlug,
  countReceiptsForRun,
  getAttemptsForRun,
  getActiveLeases,
  countNonTerminalRuns,
  countTerminalRuns,
  getDaemonState,
  getSlug,
} from "./core.js";
import { Daemon } from "./daemon.js";
import { type CheckExecutor, type ExecResult } from "./worker.js";
import { Reconciler } from "./reconciler.js";
import { parseCadence, nextDueAt } from "./cadence.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const MINUTE = 60_000;

function intervalDefinition(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    name: "pulse",
    cadence: { type: "interval", seconds: 300 },
    execution: { maxAttempts: 1 },
    checks: [
      { id: "c1", command: { executable: "echo", args: ["ok"], timeoutSeconds: 30 }, expect: { exit: 0 } },
    ],
    checksAggregate: { mode: "all" },
    ...overrides,
  };
}

function cronDefinition(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    name: "pulse",
    cadence: { type: "cron", expression: "*/5 * * * *", timezone: "UTC" },
    execution: { maxAttempts: 1 },
    checks: [
      { id: "c1", command: { executable: "echo", args: ["ok"], timeoutSeconds: 30 }, expect: { exit: 0 } },
    ],
    checksAggregate: { mode: "all" },
    ...overrides,
  };
}

/** Executor that returns the next scripted result per execution. */
function scriptedExecutor(results: Array<ExecResult | "manual">) {
  const manualResolvers: Array<(r: ExecResult) => void> = [];
  let idx = 0;
  const executor = {
    manualResolvers,
    resolveAll() {
      const rs = manualResolvers.splice(0);
      for (const resolve of rs) resolve({ exitCode: 0, stdout: "ok" });
    },
    execute: (): ExecResult | Promise<ExecResult> => {
      const spec = results[Math.min(idx, results.length - 1)];
      idx += 1;
      if (spec === "manual") {
        return new Promise<ExecResult>((resolve) => {
          manualResolvers.push(resolve);
        });
      }
      // Results array is never empty and the last entry repeats forever.
      return spec as ExecResult;
    },
  } as CheckExecutor & {
    manualResolvers: typeof manualResolvers;
    resolveAll: () => void;
  };
  return executor;
}

const okResult: ExecResult = { exitCode: 0, stdout: "ok" };
const failResult: ExecResult = { exitCode: 1, stderr: "boom" };

let db: Database;
let clock: FakeClock;

beforeEach(() => {
  db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  ensureV2Schema(db);
  clock = new FakeClock(1_000_000);
});

afterEach(() => {
  db.close();
});

function makeDaemon(opts: Record<string, unknown> = {}) {
  return new Daemon(db, clock, {
    daemonId: "test-daemon",
    workerCapacity: 2,
    leaseTtlMs: 10_000,
    heartbeatMs: 5_000,
    sweepIntervalMs: 60_000,
    stopBoundMs: 30_000,
    executor: scriptedExecutor([okResult]),
    ...opts,
  });
}

/** Register a slug and start it (control plane) so the daemon executes it. */
function registerRunningSlug(definition: Record<string, unknown>) {
  const slug = registerSlug(db, clock, { name: "pulse", definition });
  setSlugDesiredState(db, clock, slug.slug.id, "running");
  return slug;
}

// ── Cadence parsing / due computation ─────────────────────────────────────────

describe("cadence", () => {
  it("parses interval cadences and computes the next due time", () => {
    const c = parseCadence({ type: "interval", seconds: 300 });
    expect(c).not.toBeNull();
    if (!c) return;
    expect(c.type).toBe("interval");
    if (c.type === "interval") expect(c.everyMs).toBe(5 * MINUTE);
    expect(nextDueAt(c, 1_000_000, 1_000_000)).toBe(1_000_000 + 5 * MINUTE);
    expect(nextDueAt(c, 1_000_000 + 5 * MINUTE, 1_000_000 + 5 * MINUTE)).toBe(
      1_000_000 + 10 * MINUTE
    );
  });

  it("rejects malformed interval shapes", () => {
    expect(parseCadence({ type: "interval", seconds: 0 })).toBeNull();
    expect(parseCadence({ type: "interval", seconds: -5 })).toBeNull();
    expect(parseCadence({ type: "interval", every: "5m" })).toBeNull();
    expect(parseCadence({ type: "cron", expression: "not a cron" })).toBeNull();
  });

  it("computes the next cron occurrence after a reference time", () => {
    const c = parseCadence({ type: "cron", expression: "*/5 * * * *" });
    expect(c).not.toBeNull();
    if (!c) return;
    // 2026-08-18T00:00:00Z — next strict occurrence is 00:05:00Z
    const t0 = Date.UTC(2026, 7, 18, 0, 0, 0);
    expect(nextDueAt(c, t0, t0)).toBe(t0 + 5 * MINUTE);
    // from 00:07:00Z the next occurrence is 00:10:00Z
    const t1 = Date.UTC(2026, 7, 18, 0, 7, 0);
    expect(nextDueAt(c, t1, t1)).toBe(t0 + 10 * MINUTE);
  });
});

// ── Interval admission ────────────────────────────────────────────────────────

describe("interval admission", () => {
  it("admits the first occurrence at the next cadence, and only once per tick", async () => {
    const daemon = makeDaemon({ workerCapacity: 1 });
    registerRunningSlug(intervalDefinition());
    await daemon.start();

    await daemon.tick();
    expect(countRunsForSlug(db, "pulse")).toBe(0);

    clock.advance(5 * MINUTE);
    await daemon.tick();
    expect(countRunsForSlug(db, "pulse")).toBe(1);

    // Repeating the tick at the same time must not admit a duplicate.
    await daemon.tick();
    expect(countRunsForSlug(db, "pulse")).toBe(1);
  });

  it("admits each subsequent occurrence with a distinct admission key", async () => {
    const daemon = makeDaemon({ workerCapacity: 1 });
    registerRunningSlug(intervalDefinition());
    await daemon.start();

    for (let i = 0; i < 3; i++) {
      clock.advance(5 * MINUTE);
      await daemon.tick();
    }
    expect(countRunsForSlug(db, "pulse")).toBe(3);
    const keys = new Set(getRunsForSlug(db, "pulse").map((r) => r.admission_key));
    expect(keys.size).toBe(3);
  });

  it("admits no new occurrences while draining or stopped", async () => {
    const daemon = makeDaemon({ workerCapacity: 1 });
    registerRunningSlug(intervalDefinition());
    await daemon.start();

    clock.advance(5 * MINUTE);
    await daemon.drain();
    await daemon.tick();
    expect(countRunsForSlug(db, "pulse")).toBe(0);

    await daemon.stop();
    await daemon.tick();
    expect(countRunsForSlug(db, "pulse")).toBe(0);

    // Restart: admission works again in a fresh leader epoch.
    await daemon.start();
    clock.advance(5 * MINUTE);
    await daemon.tick();
    expect(countRunsForSlug(db, "pulse")).toBe(1);
  });

  it("marks an overlapping occurrence skipped_overlap while a run is active", async () => {
    const executor = scriptedExecutor(["manual"]);
    const daemon = makeDaemon({ workerCapacity: 1, leaseTtlMs: 30 * MINUTE, executor });
    registerRunningSlug(intervalDefinition());
    await daemon.start();

    clock.advance(5 * MINUTE);
    await daemon.tick(); // admit + claim (hangs)
    expect(countRunsForSlug(db, "pulse")).toBe(1);

    clock.advance(5 * MINUTE);
    await daemon.tick(); // second occurrence due while first is active
    const runs = getRunsForSlug(db, "pulse");
    expect(runs).toHaveLength(2);
    const skipped = runs.find((r) => r.outcome === "skipped_overlap");
    expect(skipped).toBeDefined();
    expect(countReceiptsForRun(db, skipped!.id)).toBe(1);
    // The run that owns the lease is untouched.
    expect(runs.filter((r) => r.state !== "terminal")).toHaveLength(1);
  });
});

// ── Cron admission ────────────────────────────────────────────────────────────

describe("cron admission", () => {
  it("admits at the next cron occurrence", async () => {
    clock = new FakeClock(Date.UTC(2026, 7, 18, 0, 0, 0));
    const daemon = makeDaemon({ workerCapacity: 1 });
    registerRunningSlug(cronDefinition());
    await daemon.start();

    await daemon.tick();
    expect(countRunsForSlug(db, "pulse")).toBe(0);

    clock.advance(5 * MINUTE);
    await daemon.tick();
    const runs = getRunsForSlug(db, "pulse");
    expect(runs).toHaveLength(1);
    expect(runs[0]!.scheduled_at).toBe(Date.UTC(2026, 7, 18, 0, 5, 0));
  });
});

// ── Bounded retries ───────────────────────────────────────────────────────────

describe("bounded retries", () => {
  it("retries up to maxRetries with distinguishable attempts and one run identity", async () => {
    const executor = scriptedExecutor([failResult, failResult, okResult]);
    const daemon = makeDaemon({ workerCapacity: 1, executor });
    registerRunningSlug(
      intervalDefinition({ execution: { maxAttempts: 3, retryBackoffSeconds: [1] } })
    );
    await daemon.start();

    clock.advance(5 * MINUTE);
    await daemon.tick();
    let runs = getRunsForSlug(db, "pulse");
    expect(runs).toHaveLength(1);
    const runId = runs[0]!.id;
    expect(runs[0]!.state).toBe("retry_wait");

    clock.advance(1_000);
    await daemon.tick();
    runs = getRunsForSlug(db, "pulse");
    expect(runs[0]!.state).toBe("retry_wait"); // attempt 2 failed too

    clock.advance(1_000);
    await daemon.tick();
    runs = getRunsForSlug(db, "pulse");
    expect(runs[0]!.state).toBe("terminal");
    expect(runs[0]!.outcome).toBe("succeeded");

    // Same run identity, three distinguishable attempts.
    const attempts = getAttemptsForRun(db, runId);
    expect(attempts.map((a) => a.attempt_number)).toEqual([1, 2, 3]);
    expect(countReceiptsForRun(db, runId)).toBe(1);
  });

  it("exhausted retries produce a terminal retry_exhausted receipt", async () => {
    const executor = scriptedExecutor([failResult, failResult, failResult]);
    const daemon = makeDaemon({ workerCapacity: 1, executor });
    registerRunningSlug(
      intervalDefinition({ execution: { maxAttempts: 3, retryBackoffSeconds: [0] } })
    );
    await daemon.start();

    clock.advance(5 * MINUTE);
    for (let i = 0; i < 3; i++) await daemon.tick();

    const runs = getRunsForSlug(db, "pulse");
    expect(runs[0]!.state).toBe("terminal");
    expect(runs[0]!.outcome).toBe("retry_exhausted");
    expect(runs[0]!.attempt_count).toBe(3);
    expect(countReceiptsForRun(db, runs[0]!.id)).toBe(1);
  });

  it("maxRetries 0 fails immediately with a failed receipt", async () => {
    const executor = scriptedExecutor([failResult]);
    const daemon = makeDaemon({ workerCapacity: 1, executor });
    registerRunningSlug(intervalDefinition());
    await daemon.start();

    clock.advance(5 * MINUTE);
    await daemon.tick();
    const runs = getRunsForSlug(db, "pulse");
    expect(runs[0]!.outcome).toBe("failed");
    expect(runs[0]!.attempt_count).toBe(1);
    expect(countReceiptsForRun(db, runs[0]!.id)).toBe(1);
  });
});

// ── Capacity backfill ─────────────────────────────────────────────────────────

describe("capacity backfill", () => {
  it("claims up to capacity and backfills immediately after a terminal receipt", async () => {
    const executor = scriptedExecutor([okResult, "manual", okResult]);
    const daemon = makeDaemon({ workerCapacity: 1, executor });
    registerRunningSlug(intervalDefinition());
    await daemon.start();

    clock.advance(15 * MINUTE);
    await daemon.tick();
    expect(countRunsForSlug(db, "pulse")).toBe(3);

    // run1 executes and completes; run2 is claimed (hang); run3 stays admitted.
    const runs = getRunsForSlug(db, "pulse");
    expect(runs.filter((r) => r.state === "terminal")).toHaveLength(1);
    expect(runs.filter((r) => r.state === "leased")).toHaveLength(1);
    expect(runs.filter((r) => r.state === "admitted")).toHaveLength(1);
    expect(getActiveLeases(db).length).toBe(1);

    // Resolving run2 must trigger an immediate backfill of run3 — no sweep.
    executor.resolveAll();
    await daemon.tick();
    const after = getRunsForSlug(db, "pulse");
    expect(after.filter((r) => r.state === "terminal")).toHaveLength(3);
    expect(after.filter((r) => r.state === "leased")).toHaveLength(0);
    expect(getActiveLeases(db).length).toBe(0);
    expect(countNonTerminalRuns(db, "pulse")).toBe(0);
  });
});

// ── Lease expiry and stale-worker rejection ───────────────────────────────────

describe("lease expiry and stale-worker rejection", () => {
  it("an expired lease requeues bounded work and the old worker is fenced", async () => {
    const executor = scriptedExecutor(["manual", "manual"]);
    const daemon = makeDaemon({
      workerCapacity: 1,
      leaseTtlMs: 10_000,
      heartbeatMs: 5_000,
      executor,
    });
    registerRunningSlug(
      intervalDefinition({ execution: { maxAttempts: 2, retryBackoffSeconds: [0] } })
    );
    await daemon.start();

    clock.advance(5 * MINUTE);
    await daemon.tick(); // claim attempt 1, hangs
    const runId = getRunsForSlug(db, "pulse")[0]!.id;
    const attemptsBefore = getAttemptsForRun(db, runId);
    const oldLease = getActiveLeases(db)[0]!;
    expect(attemptsBefore).toHaveLength(1);

    // Worker stops heartbeating; lease expires. The reconciler requeues.
    clock.advance(11_000);
    const reconciler = new Reconciler(db, clock);
    const sweep = reconciler.safetySweep(clock.now());
    expect(sweep.expiredLeases).toBe(1);
    expect(getActiveLeases(db).length).toBe(0);
    expect(getRunsForSlug(db, "pulse")[0]!.state).toBe("retry_wait");

    // New claim creates attempt 2 with a fresh lease generation.
    clock.advance(1_000);
    await daemon.tick();
    const attemptsAfter = getAttemptsForRun(db, runId);
    expect(attemptsAfter).toHaveLength(2);
    const newLease = getActiveLeases(db)[0]!;
    expect(newLease!.generation).toBe(oldLease!.generation + 1);
    expect(newLease!.id).not.toBe(oldLease!.id);

    // The old worker's completion is rejected — stale fence.
    const { completeAttempt } = await import("./core.js");
    const stale = completeAttempt(db, clock, {
      runId,
      attemptId: attemptsBefore[0]!.id,
      leaseId: oldLease!.id,
      generation: oldLease!.generation,
      workerId: "old-worker",
      token: "old-token",
      outcome: "succeeded",
      exitCode: 0,
      resultDigest: "x",
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error).toBe("stale_fence");

    // The new worker's completion lands.
    executor.resolveAll();
    await daemon.tick();
    const after = getRunsForSlug(db, "pulse")[0]!;
    expect(after.state).toBe("terminal");
    expect(after.outcome).toBe("succeeded");
    expect(countReceiptsForRun(db, runId)).toBe(1);
  });

  it("renewal with a stale token or expired lease is rejected", async () => {
    const executor = scriptedExecutor(["manual"]);
    const daemon = makeDaemon({ workerCapacity: 1, executor });
    registerRunningSlug(intervalDefinition());
    await daemon.start();

    clock.advance(5 * MINUTE);
    await daemon.tick();
    const lease = getActiveLeases(db)[0]!;

    // Wrong token -> stale_fence.
    const { renewLease, revokeLease } = await import("./core.js");
    const bad = renewLease(db, clock, {
      leaseId: lease!.id,
      workerId: lease!.worker_id,
      token: "wrong",
      ttlMs: 10_000,
    });
    expect(bad.ok).toBe(false);

    // Expired lease -> rejected even with the right token.
    clock.advance(11_000);
    const expired = renewLease(db, clock, {
      leaseId: lease!.id,
      workerId: lease!.worker_id,
      token: "right",
      ttlMs: 10_000,
    });
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.error).toBe("expired");

    // Revoked lease -> rejected.
    revokeLease(db, clock, lease!.id);
    const revoked = renewLease(db, clock, {
      leaseId: lease!.id,
      workerId: lease!.worker_id,
      token: "right",
      ttlMs: 10_000,
    });
    expect(revoked.ok).toBe(false);
  });

  it("a healthy worker renews its lease under the same generation", async () => {
    const executor = scriptedExecutor(["manual"]);
    const daemon = makeDaemon({ workerCapacity: 1, executor });
    registerRunningSlug(intervalDefinition());
    await daemon.start();

    clock.advance(5 * MINUTE);
    await daemon.tick();
    const lease1 = getActiveLeases(db)[0]!;

    // Heartbeats at 6s keep the lease alive past its 10s TTL.
    clock.advance(6_000);
    await daemon.tick();
    const lease2 = getActiveLeases(db)[0]!;
    expect(lease2!.id).toBe(lease1!.id);
    expect(lease2!.generation).toBe(lease1!.generation);
    expect(lease2!.expires_at).toBeGreaterThan(lease1!.expires_at);
  });
});

// ── Recovery ──────────────────────────────────────────────────────────────────

describe("recovery", () => {
  it("reconciles unknown attempts with no live lease to a terminal receipt", async () => {
    const executor = scriptedExecutor(["manual"]);
    const daemon = makeDaemon({ workerCapacity: 1, leaseTtlMs: 10_000, executor });
    registerRunningSlug(intervalDefinition());
    await daemon.start();

    clock.advance(5 * MINUTE);
    await daemon.tick();
    const run = getRunsForSlug(db, "pulse")[0]!;
    const attempts = getAttemptsForRun(db, run.id);

    // Simulate an ambiguous outcome: attempt stuck in reconciling, lease expired.
    db.run("UPDATE slug_attempts SET state = 'reconciling' WHERE id = ?", [attempts[0]!.id]);
    db.run("UPDATE slug_runs SET state = 'reconciling' WHERE id = ?", [run.id]);
    clock.advance(11_000);

    const reconciler = new Reconciler(db, clock);
    const sweep = reconciler.safetySweep(clock.now());
    expect(sweep.terminatedRuns).toBe(1);
    const after = getRunsForSlug(db, "pulse")[0]!;
    expect(after.state).toBe("terminal");
    expect(after.outcome).toBe("unknown_reconciled");
    expect(countReceiptsForRun(db, run.id)).toBe(1);
  });

  it("creates the missing terminal receipt for a terminal run without one", async () => {
    const executor = scriptedExecutor([failResult]);
    const daemon = makeDaemon({ workerCapacity: 1, executor });
    registerRunningSlug(intervalDefinition());
    await daemon.start();

    clock.advance(5 * MINUTE);
    await daemon.tick();
    const run = getRunsForSlug(db, "pulse")[0]!;
    expect(run.state).toBe("terminal");
    expect(countReceiptsForRun(db, run.id)).toBe(1);

    // Simulate a crash between the outcome write and the receipt write.
    db.run("DELETE FROM receipts WHERE run_id = ?", [run.id]);
    expect(countReceiptsForRun(db, run.id)).toBe(0);

    const reconciler = new Reconciler(db, clock);
    const sweep = reconciler.safetySweep(clock.now());
    expect(sweep.createdReceipts).toBe(1);
    expect(countReceiptsForRun(db, run.id)).toBe(1);
    // Recovery never creates a second receipt.
    reconciler.safetySweep(clock.now());
    expect(countReceiptsForRun(db, run.id)).toBe(1);
  });

  it("cancels stale admitted runs from a superseded execution epoch", async () => {
    const daemon = makeDaemon({ workerCapacity: 0 });
    const slug = registerSlug(db, clock, {
      name: "pulse",
      definition: intervalDefinition(),
    });
    await daemon.start();
    // Start the slug (epoch 1) and admit a run in that epoch.
    setSlugDesiredState(db, clock, slug.slug.id, "running");
    const slug1 = getSlug(db, slug.slug.id)!;
    const run = admitRun(db, clock, {
      slug: slug1,
      revision: slug.activeRevision,
      scheduledAt: clock.now() + 5 * MINUTE,
      epoch: slug1.execution_epoch,
      source: "interval",
    });
    expect(run.ok).toBe(true);
    // Stop and restart — the slug now runs in epoch 2.
    setSlugDesiredState(db, clock, slug.slug.id, "stopped");
    setSlugDesiredState(db, clock, slug.slug.id, "running");
    const slugNow = db
      .query<{ execution_epoch: number }, [string]>(
        "SELECT execution_epoch FROM slugs WHERE id = ?"
      )
      .get(slug.slug.id)!;
    expect(slugNow.execution_epoch).toBe(slug1.execution_epoch + 1);

    const reconciler = new Reconciler(db, clock);
    const sweep = reconciler.safetySweep(clock.now());
    expect(sweep.cancelledStaleAdmissions).toBe(1);
    const runs = getRunsForSlug(db, "pulse");
    expect(runs[0]!.outcome).toBe("cancelled");
    expect(countReceiptsForRun(db, runs[0]!.id)).toBe(1);
  });

  it("recover on a cleanly stopped daemon restores STOPPED so restart works", async () => {
    const daemon = makeDaemon({ workerCapacity: 1 });
    registerRunningSlug(intervalDefinition());
    await daemon.start();
    await daemon.stop();
    await daemon.tick();
    expect(getDaemonState(db, "test-daemon")!.state).toBe("STOPPED");

    // The supported `monitor-daemon recover` path must not wedge the daemon
    // in RECOVERING: a cleanly stopped daemon comes back to STOPPED.
    const result = daemon.recover();
    expect(result.ok).toBe(true);
    expect(getDaemonState(db, "test-daemon")!.state).toBe("STOPPED");

    // Restart from the recovered STOPPED state must succeed (previously the
    // daemon stayed RECOVERING and start() refused with recovering_retry).
    const started = await daemon.start();
    expect(started.ok).toBe(true);
    expect(getDaemonState(db, "test-daemon")!.state).toBe("RUNNING");
  });
});

// ── Pause / resume ────────────────────────────────────────────────────────────

describe("pause/resume", () => {
  it("pause stops new claims while active leases continue; resume validates and claims again", async () => {
    const executor = scriptedExecutor(["manual", okResult]);
    const daemon = makeDaemon({ workerCapacity: 1, leaseTtlMs: 30 * MINUTE, executor });
    registerRunningSlug(intervalDefinition());
    await daemon.start();

    clock.advance(5 * MINUTE);
    await daemon.tick(); // claim attempt 1 (hangs)

    await daemon.pause();
    expect(getDaemonState(db, "test-daemon")!.state).toBe("PAUSED");

    // New due work is admitted but never claimed while paused.
    clock.advance(5 * MINUTE);
    await daemon.tick();
    const runs = getRunsForSlug(db, "pulse");
    expect(runs).toHaveLength(2);
    expect(runs.filter((r) => r.state === "admitted")).toHaveLength(1);
    expect(getActiveLeases(db).length).toBe(1);

    // The active lease still completes while paused.
    executor.resolveAll();
    await daemon.tick();
    expect(countTerminalRuns(db, "pulse")).toBe(1);
    expect(countNonTerminalRuns(db, "pulse")).toBe(1); // the admitted one

    // Resume claims again.
    await daemon.resume();
    expect(getDaemonState(db, "test-daemon")!.state).toBe("RUNNING");
    await daemon.tick();
    expect(countNonTerminalRuns(db, "pulse")).toBe(0);
    expect(countTerminalRuns(db, "pulse")).toBe(2);
  });

  it("resume is refused when the daemon is not paused or capacity is zero", async () => {
    const daemon = makeDaemon({ workerCapacity: 1 });
    await daemon.start();
    expect(daemon.resume().ok).toBe(false); // already running

    expect(daemon.pause().ok).toBe(true);
    const daemon2 = makeDaemon({ workerCapacity: 0 });
    expect(daemon2.resume().ok).toBe(false);
  });
});

// ── Drain ─────────────────────────────────────────────────────────────────────

describe("drain", () => {
  it("drain admits nothing new, lets current work finish, and stops when empty", async () => {
    const executor = scriptedExecutor(["manual", okResult]);
    const daemon = makeDaemon({ workerCapacity: 1, leaseTtlMs: 30 * MINUTE, executor });
    registerRunningSlug(intervalDefinition());
    await daemon.start();

    clock.advance(5 * MINUTE);
    await daemon.tick(); // claim attempt 1 (hangs)

    await daemon.drain();
    expect(getDaemonState(db, "test-daemon")!.state).toBe("DRAINING");

    // A due occurrence is NOT admitted while draining.
    clock.advance(5 * MINUTE);
    await daemon.tick();
    expect(countRunsForSlug(db, "pulse")).toBe(1);

    // Current work completes, then the daemon stops on its own.
    executor.resolveAll();
    await daemon.tick();
    expect(getDaemonState(db, "test-daemon")!.state).toBe("STOPPED");
    expect(countNonTerminalRuns(db, "pulse")).toBe(0);
  });
});

// ── Stop ──────────────────────────────────────────────────────────────────────

describe("stop", () => {
  it("stop drains bounded, then stops with unresolved work durable", async () => {
    const executor = scriptedExecutor(["manual", okResult]);
    const daemon = makeDaemon({
      workerCapacity: 1,
      stopBoundMs: 30_000,
      sweepIntervalMs: 3_600_000,
      executor,
    });
    registerRunningSlug(intervalDefinition());
    await daemon.start();

    clock.advance(5 * MINUTE);
    await daemon.tick(); // claim attempt 1 (hangs)

    // Pause lets a second occurrence queue instead of being skipped.
    await daemon.pause();
    clock.advance(5 * MINUTE);
    await daemon.tick();
    expect(countRunsForSlug(db, "pulse")).toBe(2);

    await daemon.stop();
    expect(getDaemonState(db, "test-daemon")!.state).toBe("STOPPING");

    // The queued run drains; the hung run stays durable past the bound.
    clock.advance(31_000);
    await daemon.tick();
    expect(getDaemonState(db, "test-daemon")!.state).toBe("STOPPED");
    const runs = getRunsForSlug(db, "pulse");
    expect(runs.filter((r) => r.state === "terminal").length).toBeGreaterThanOrEqual(1);
    // Unresolved work remains durable (non-terminal).
    expect(countNonTerminalRuns(db, "pulse")).toBeGreaterThanOrEqual(1);
  });

  it("stop with an empty queue terminates immediately", async () => {
    const daemon = makeDaemon({ workerCapacity: 1 });
    registerRunningSlug(intervalDefinition());
    await daemon.start();
    await daemon.stop();
    await daemon.tick();
    expect(getDaemonState(db, "test-daemon")!.state).toBe("STOPPED");
  });

  it("cancelSlugRuns cancels queued runs with receipts, revokes leases, and fences the old worker", async () => {
    const executor = scriptedExecutor(["manual", okResult]);
    const daemon = makeDaemon({ workerCapacity: 1, leaseTtlMs: 30 * MINUTE, executor });
    const slug = registerSlug(db, clock, {
      name: "pulse",
      definition: intervalDefinition(),
    });
    setSlugDesiredState(db, clock, slug.slug.id, "running");
    await daemon.start();

    clock.advance(5 * MINUTE);
    await daemon.tick(); // claim attempt 1 (hangs)
    // Pause lets a second occurrence queue instead of being skipped.
    await daemon.pause();
    clock.advance(5 * MINUTE);
    await daemon.tick(); // second occurrence admitted
    const runs = getRunsForSlug(db, "pulse");
    expect(runs).toHaveLength(2);
    const [activeRun, queuedRun] = runs;
    expect(activeRun!.state).not.toBe("terminal");
    expect(queuedRun!.state).toBe("admitted");
    const lease = getActiveLeases(db)[0]!;

    const result = cancelSlugRuns(db, clock, slug.slug.id);
    expect(result.cancelledQueued).toBe(1);
    expect(result.revokedLeases).toBe(1);

    const after = getRunsForSlug(db, "pulse");
    const queuedAfter = after.find((r) => r.id === queuedRun!.id)!;
    expect(queuedAfter.state).toBe("terminal");
    expect(queuedAfter.outcome).toBe("cancelled");
    expect(countReceiptsForRun(db, queuedRun!.id)).toBe(1);

    // The old worker is fenced: its completion is rejected.
    const attempts = getAttemptsForRun(db, activeRun!.id);
    const { completeAttempt } = await import("./core.js");
    const stale = completeAttempt(db, clock, {
      runId: activeRun!.id,
      attemptId: attempts[0]!.id,
      leaseId: lease!.id,
      generation: lease!.generation,
      workerId: lease!.worker_id,
      token: "right",
      outcome: "succeeded",
      exitCode: 0,
      resultDigest: "x",
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error).toBe("stale_fence");
    // And the run itself was not overwritten.
    const activeAfter = getRunsForSlug(db, "pulse").find((r) => r.id === activeRun!.id)!;
    expect(activeAfter.state).not.toBe("terminal");
  });
});

// ── Replacement ───────────────────────────────────────────────────────────────

describe("replacement", () => {
  it("replace bumps the leader epoch, fences previous leases, and claims fresh work", async () => {
    const executor = scriptedExecutor(["manual", okResult]);
    const daemon = makeDaemon({
      workerCapacity: 1,
      leaseTtlMs: 10_000,
      heartbeatMs: 5_000,
      executor,
    });
    registerRunningSlug(
      intervalDefinition({ execution: { maxAttempts: 2, retryBackoffSeconds: [0] } })
    );
    await daemon.start();
    const epochBefore = getDaemonState(db, "test-daemon")!.leader_epoch;

    clock.advance(5 * MINUTE);
    await daemon.tick(); // claim attempt 1 (hangs)
    const runId = getRunsForSlug(db, "pulse")[0]!.id;
    const oldLease = getActiveLeases(db)[0]!;

    await daemon.replace();
    const epochAfter = getDaemonState(db, "test-daemon")!.leader_epoch;
    expect(epochAfter).toBe(epochBefore + 1);
    // Previous leases are fenced (revoked).
    expect(getActiveLeases(db).length).toBe(0);

    // Old worker writes are rejected.
    const attempts = getAttemptsForRun(db, runId);
    const { completeAttempt } = await import("./core.js");
    const stale = completeAttempt(db, clock, {
      runId,
      attemptId: attempts[0]!.id,
      leaseId: oldLease!.id,
      generation: oldLease!.generation,
      workerId: "old-worker",
      token: "old-token",
      outcome: "succeeded",
      exitCode: 0,
      resultDigest: "x",
    });
    expect(stale.ok).toBe(false);

    // The reconciler requeues the fenced attempt (bounded), and the new
    // generation claims and completes it.
    const reconciler = new Reconciler(db, clock);
    reconciler.safetySweep(clock.now());
    expect(getRunsForSlug(db, "pulse")[0]!.state).toBe("retry_wait");

    clock.advance(1_000);
    await daemon.tick();
    const after = getRunsForSlug(db, "pulse")[0]!;
    expect(after.state).toBe("terminal");
    expect(after.outcome).toBe("succeeded");
    const attemptsAfter = getAttemptsForRun(db, runId);
    expect(attemptsAfter).toHaveLength(2);
    expect(attemptsAfter[1]!.state).toBe("succeeded");
    expect(countReceiptsForRun(db, runId)).toBe(1);
  });
});

// ── Observation plane ─────────────────────────────────────────────────────────

describe("observation plane", () => {
  it("status reports control and execution state independently", async () => {
    const executor = scriptedExecutor(["manual"]);
    const daemon = makeDaemon({ workerCapacity: 1, executor });
    registerRunningSlug(intervalDefinition());
    await daemon.start();

    clock.advance(5 * MINUTE);
    await daemon.tick();
    const status = daemon.status();
    expect(status.state).toBe("RUNNING");
    expect(status.leaderEpoch).toBe(1);
    expect(status.queueDepth).toBe(0); // the only run is already claimed
    expect(status.leasedCount).toBe(1);
    expect(status.runningCount).toBe(1);
  });
});
