import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { Store } from "./store.js";
import { claimDueRuns } from "./scheduler.js";
import { buildDuplicateOverlapReport, buildNameHygieneReport, buildScriptInventoryReport, buildStuckRunReport } from "./hygiene.js";

describe("hygiene", () => {
  test("name hygiene canonicalizes provider-prefixed machine loop names", () => {
    const store = new Store(":memory:");
    try {
      store.createLoop({
        name: "Claude: Check Disk",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      const report = buildNameHygieneReport(store);
      expect(report.applied).toBe(false);
      expect(report.checked).toBe(1);
      expect(report.changed).toBe(1);
      expect(report.changes[0]?.scope).toBe("machine");
      expect(report.changes[0]?.newName).toBe("machine-check-disk");
      expect(report.ok).toBe(false);
      // Dry run must not rename anything.
      expect(store.findLoopByName("Claude: Check Disk")).toBeDefined();
    } finally {
      store.close();
    }
  });

  test("name hygiene scopes repo loops by cwd and strips cadence suffixes", () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-hygiene-repo-"));
    const repo = join(root, "acme-app");
    mkdirSync(repo, { recursive: true });
    try {
      store.createLoop({
        name: "codewith:acme-app:lint:hourly",
        schedule: { type: "interval", everyMs: 3_600_000 },
        target: { type: "command", command: "true", cwd: repo },
      });
      const report = buildNameHygieneReport(store, { apply: true });
      expect(report.applied).toBe(true);
      expect(report.changed).toBe(1);
      expect(report.changes[0]?.scope).toBe("repo");
      expect(report.changes[0]?.scopeSlug).toBe("acme-app");
      expect(report.changes[0]?.newName).toBe("repo-acme-app-lint");
      expect(store.findLoopByName("repo-acme-app-lint")).toBeDefined();
      expect(store.findLoopByName("codewith:acme-app:lint:hourly")).toBeUndefined();
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("name hygiene keeps already-canonical names and reports ok", () => {
    const store = new Store(":memory:");
    try {
      store.createLoop({
        name: "machine-check-disk",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      const report = buildNameHygieneReport(store);
      expect(report.ok).toBe(true);
      expect(report.changed).toBe(0);
      expect(report.changes[0]?.changed).toBe(false);
    } finally {
      store.close();
    }
  });

  test("name hygiene disambiguates colliding canonical names with id suffixes", () => {
    const store = new Store(":memory:");
    try {
      const first = store.createLoop({
        name: "Claude: lint",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      const second = store.createLoop({
        name: "codewith: lint",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      const report = buildNameHygieneReport(store, { apply: true });
      expect(report.changed).toBe(2);
      const names = report.changes.map((change) => change.newName).sort();
      expect(names).toContain("machine-lint");
      const suffixed = names.find((name) => name !== "machine-lint")!;
      expect(suffixed).toStartWith("machine-lint-");
      expect([first.id.slice(0, 8), second.id.slice(0, 8)]).toContain(suffixed.slice("machine-lint-".length));
      expect(new Set(names).size).toBe(2);
    } finally {
      store.close();
    }
  });

  test("duplicate overlap groups loops sharing base name, cwd, and schedule", () => {
    const store = new Store(":memory:");
    try {
      store.createLoop({
        name: "job-a",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      store.createLoop({
        name: "job-a-15m",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      store.createLoop({
        name: "job-b",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      const report = buildDuplicateOverlapReport(store);
      expect(report.ok).toBe(false);
      expect(report.checked).toBe(3);
      expect(report.groups).toHaveLength(1);
      expect(report.groups[0]?.baseName).toBe("job-a");
      expect(report.groups[0]?.schedule).toBe("interval:60000");
      expect(report.groups[0]?.loops.map((loop) => loop.name).sort()).toEqual(["job-a", "job-a-15m"]);
    } finally {
      store.close();
    }
  });

  test("duplicate overlap treats different schedules as distinct", () => {
    const store = new Store(":memory:");
    try {
      store.createLoop({
        name: "job-c",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      store.createLoop({
        name: "job-c-15m",
        schedule: { type: "interval", everyMs: 120_000 },
        target: { type: "command", command: "true" },
      });
      const report = buildDuplicateOverlapReport(store);
      expect(report.ok).toBe(true);
      expect(report.groups).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  test("script inventory flags loops that call scripts from the loops data dir", () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-hygiene-scripts-"));
    const scriptsDir = join(root, "scripts");
    try {
      store.createLoop({
        name: "script-backed",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: `bash ${scriptsDir}/check.sh`, shell: true },
      });
      store.createLoop({
        name: "home-script-backed",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "bash " + join("$HOME", ".hasna", "loops", "scripts", "audit.sh"), shell: true },
      });
      store.createLoop({
        name: "inline-clean",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "printf ok", shell: true },
      });
      const report = buildScriptInventoryReport(store, { scriptsDir });
      expect(report.ok).toBe(false);
      expect(report.checked).toBe(3);
      expect(report.scriptBacked).toBe(2);
      expect(report.loops.map((loop) => loop.name).sort()).toEqual(["home-script-backed", "script-backed"]);
      const flagged = report.loops.find((loop) => loop.name === "script-backed")!;
      expect(flagged.scriptMatches.some((match) => match.startsWith(scriptsDir))).toBe(true);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("script inventory reports ok when no loops reference managed scripts", () => {
    const store = new Store(":memory:");
    try {
      store.createLoop({
        name: "inline-only",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "printf ok", shell: true },
      });
      const report = buildScriptInventoryReport(store);
      expect(report.ok).toBe(true);
      expect(report.scriptBacked).toBe(0);
      expect(report.loops).toEqual([]);
    } finally {
      store.close();
    }
  });

  describe("stuck run hygiene (7cf8d8c1)", () => {
    // Real wall-clock past, safely older than any lease used below, so a run
    // claimed "at" this time is already expired by the time buildStuckRunReport
    // reads the real Date.now() inside it.
    const wellInThePast = new Date(Date.now() - 60 * 60_000);

    test("dry run detects a lease-expired, process-dead run without mutating it", () => {
      const store = new Store(":memory:");
      try {
        const loop = store.createLoop(
          { name: "zombie", schedule: { type: "interval", everyMs: 600_000 }, target: { type: "command", command: "true" }, overlap: "skip", leaseMs: 10 },
          wellInThePast,
        );
        const claim = store.claimRun(loop, loop.nextRunAt!, "daemon:1234", wellInThePast);
        expect(claim).toBeDefined();
        // No recordRunProcess call: pid stays NULL, which is never "alive".

        const report = buildStuckRunReport(store, { apply: false });

        expect(report.applied).toBe(false);
        expect(report.ok).toBe(false);
        expect(report.stuck).toBe(1);
        expect(report.liveDeferred).toBe(0);
        expect(report.entries).toHaveLength(1);
        expect(report.entries[0]?.runId).toBe(claim!.run.id);
        expect(report.entries[0]?.reclaimed).toBe(false);
        expect(report.advancedLoopIds).toEqual([]);

        // Dry run must not touch the run or the loop.
        expect(store.getRun(claim!.run.id)?.status).toBe("running");
        expect(store.hasRunningRun(loop.id)).toBe(true);
      } finally {
        store.close();
      }
    });

    test("--apply reclaims the run, advances nextRunAt immediately, and the cadence claims again", () => {
      const store = new Store(":memory:");
      try {
        const loop = store.createLoop(
          { name: "zombie-apply", schedule: { type: "interval", everyMs: 600_000 }, target: { type: "command", command: "true" }, overlap: "skip", leaseMs: 10 },
          wellInThePast,
        );
        const originalNextRunAt = loop.nextRunAt!;
        const claim = store.claimRun(loop, originalNextRunAt, "daemon:1234", wellInThePast);
        expect(claim).toBeDefined();

        const report = buildStuckRunReport(store, { apply: true });

        expect(report.applied).toBe(true);
        expect(report.stuck).toBe(1);
        expect(report.entries).toHaveLength(1);
        expect(report.entries[0]?.runId).toBe(claim!.run.id);
        expect(report.entries[0]?.reclaimed).toBe(true);
        expect(report.advancedLoopIds).toEqual([loop.id]);

        // The row actually changed state...
        expect(store.getRun(claim!.run.id)?.status).toBe("abandoned");
        // ...which is what unblocks overlap:skip for this loop.
        expect(store.hasRunningRun(loop.id)).toBe(false);
        // ...and nextRunAt moved off the wedged slot in the SAME call, not on
        // some later daemon tick that may never come.
        const advancedLoop = store.getLoop(loop.id)!;
        expect(advancedLoop.nextRunAt).toBeDefined();
        expect(advancedLoop.nextRunAt).not.toBe(originalNextRunAt);

        // Prove the cadence actually resumes: a scheduler tick once the newly
        // advanced slot is due claims a fresh run for the loop, rather than
        // being refused forever by a phantom "running" row. (The advanced
        // nextRunAt is normally still minutes away on a 10-minute cadence —
        // ticking at its own due time, not at real "now", is what isolates
        // "did unblocking work" from "has 10 minutes of wall-clock passed".)
        const dueAt = new Date(new Date(advancedLoop.nextRunAt!).getTime() + 1);
        const tickResult = claimDueRuns({ store, runnerId: "daemon:5678", now: () => dueAt });
        expect(tickResult.claims.some((c) => c.loop.id === loop.id)).toBe(true);
        const newRun = tickResult.claims.find((c) => c.loop.id === loop.id)!.run;
        expect(newRun.id).not.toBe(claim!.run.id);
        expect(store.getRun(newRun.id)?.status).toBe("running");
      } finally {
        store.close();
      }
    });

    test("never reclaims a run whose recorded process is still alive, even long after its lease expired", () => {
      const store = new Store(":memory:");
      try {
        const loop = store.createLoop(
          { name: "healthy-long-runner", schedule: { type: "interval", everyMs: 600_000 }, target: { type: "command", command: "true" }, overlap: "skip", leaseMs: 10 },
          wellInThePast,
        );
        const claim = store.claimRun(loop, loop.nextRunAt!, "daemon:1234", wellInThePast);
        expect(claim).toBeDefined();
        // Record THIS test process as the run's owner: genuinely alive, and its
        // lease (10ms, claimed an hour ago) is expired many times over — the
        // long-running-but-healthy case the reclaim command must refuse.
        store.recordRunProcess(claim!.run.id, { pid: process.pid, pgid: process.pid }, { claimToken: claim!.claimToken });

        const dryRun = buildStuckRunReport(store, { apply: false });
        expect(dryRun.stuck).toBe(0);
        expect(dryRun.liveDeferred).toBe(1);
        expect(dryRun.entries[0]?.deferredReason).toBe("live_process");
        expect(dryRun.entries[0]?.reclaimed).toBe(false);

        const applied = buildStuckRunReport(store, { apply: true });
        expect(applied.stuck).toBe(0);
        expect(applied.liveDeferred).toBe(1);
        expect(applied.entries.every((entry) => !entry.reclaimed)).toBe(true);
        expect(applied.advancedLoopIds).toEqual([]);

        // The run is untouched and still blocks new claims for this loop —
        // exactly the property that distinguishes "stuck" from "alive".
        expect(store.getRun(claim!.run.id)?.status).toBe("running");
        expect(store.hasRunningRun(loop.id)).toBe(true);
      } finally {
        store.close();
      }
    });

    // REPLACES a same-named test from PR #182's superseded fix
    // ("never reclaims an exhausted-grace live run when a dead run triggers
    // the apply batch"), which asserted the OPPOSITE of the coordinator's
    // acceptance criterion: it claimed "hygiene has a stricter contract: it
    // must never touch a live process, regardless of that daemon-specific
    // recovery ceiling" and encoded that as `reclaimed: false` even once
    // defer_count reached the ceiling. That contract is exactly what made a
    // live-looking wedged run permanently unreclaimable (the P1 this PR
    // fixes) — so the test asserting it is corrected here, not merely
    // rewired to pass. What's still worth keeping from it is the batching
    // question it actually raised: does a live run's fate depend on whether
    // some unrelated dead run happens to be reclaimed in the same --apply
    // call? The two tests below answer that directly, in both directions.
    test("in a batch with a dead trigger run, a live run still under the grace ceiling is preserved", () => {
      const store = new Store(":memory:");
      try {
        const liveLoop = store.createLoop(
          { name: "live-under-ceiling", schedule: { type: "interval", everyMs: 600_000 }, target: { type: "command", command: "true" }, overlap: "skip", leaseMs: 10 },
          wellInThePast,
        );
        const liveClaim = store.claimRun(liveLoop, liveLoop.nextRunAt!, "daemon:live", wellInThePast);
        store.recordRunProcess(liveClaim!.run.id, { pid: process.pid, pgid: process.pid }, { claimToken: liveClaim!.claimToken });
        // 9 deferrals: one short of MAX_LIVE_EXPIRED_RUN_DEFERRALS (10).
        for (let attempt = 1; attempt <= 9; attempt += 1) {
          const at = new Date(wellInThePast.getTime() + (attempt + 1) * 60_000);
          const result = store.recoverExpiredRunLeasesDetailed(at, { runId: liveClaim!.run.id, limit: 1, scanLimit: 1 });
          expect(result.deferred.map((run) => run.id)).toEqual([liveClaim!.run.id]);
          expect(result.abandoned).toEqual([]);
        }

        const deadLoop = store.createLoop(
          { name: "dead-batch-trigger", schedule: { type: "interval", everyMs: 600_000 }, target: { type: "command", command: "true" }, overlap: "skip", leaseMs: 10 },
          wellInThePast,
        );
        const deadClaim = store.claimRun(deadLoop, deadLoop.nextRunAt!, "daemon:dead", wellInThePast);

        const applied = buildStuckRunReport(store, { apply: true });
        expect(applied.entries.find((entry) => entry.runId === deadClaim!.run.id)).toMatchObject({ reclaimed: true });
        expect(applied.entries.find((entry) => entry.runId === liveClaim!.run.id)).toMatchObject({
          reclaimed: false,
          deferredReason: "live_process",
        });
        expect(store.getRun(deadClaim!.run.id)?.status).toBe("abandoned");
        expect(store.getRun(liveClaim!.run.id)?.status).toBe("running");
      } finally {
        store.close();
      }
    });

    test("in a batch with a dead trigger run, a live run that has exhausted the grace ceiling IS reclaimed", () => {
      const store = new Store(":memory:");
      try {
        const liveLoop = store.createLoop(
          { name: "live-exhausted", schedule: { type: "interval", everyMs: 600_000 }, target: { type: "command", command: "true" }, overlap: "skip", leaseMs: 10 },
          wellInThePast,
        );
        const liveClaim = store.claimRun(liveLoop, liveLoop.nextRunAt!, "daemon:live", wellInThePast);
        store.recordRunProcess(liveClaim!.run.id, { pid: process.pid, pgid: process.pid }, { claimToken: liveClaim!.claimToken });
        // Exactly MAX_LIVE_EXPIRED_RUN_DEFERRALS (10) deferrals: the next
        // observation is past the ceiling, so this run must be reclaimed
        // despite still looking alive — batching with an unrelated dead run
        // must not change that outcome either way.
        for (let attempt = 1; attempt <= 10; attempt += 1) {
          const at = new Date(wellInThePast.getTime() + (attempt + 1) * 60_000);
          const result = store.recoverExpiredRunLeasesDetailed(at, { runId: liveClaim!.run.id, limit: 1, scanLimit: 1 });
          expect(result.deferred.map((run) => run.id)).toEqual([liveClaim!.run.id]);
          expect(result.abandoned).toEqual([]);
        }

        const deadLoop = store.createLoop(
          { name: "dead-batch-trigger-2", schedule: { type: "interval", everyMs: 600_000 }, target: { type: "command", command: "true" }, overlap: "skip", leaseMs: 10 },
          wellInThePast,
        );
        const deadClaim = store.claimRun(deadLoop, deadLoop.nextRunAt!, "daemon:dead", wellInThePast);

        const preview = buildStuckRunReport(store, { apply: false });
        // Both are reclaimable now: the dead run outright, and the live run
        // because it is past the grace ceiling.
        expect(preview.stuck).toBe(2);
        expect(preview.liveDeferred).toBe(0);

        const applied = buildStuckRunReport(store, { apply: true });
        expect(applied.entries.find((entry) => entry.runId === deadClaim!.run.id)).toMatchObject({ reclaimed: true });
        expect(applied.entries.find((entry) => entry.runId === liveClaim!.run.id)).toMatchObject({ reclaimed: true });
        expect(store.getRun(deadClaim!.run.id)?.status).toBe("abandoned");
        const exhaustedLive = store.getRun(liveClaim!.run.id);
        expect(exhaustedLive?.status).toBe("abandoned");
        expect(exhaustedLive?.error).toContain("deferral ceiling");
      } finally {
        store.close();
      }
    });

    // Regression for the P1 fixed in this PR: buildStuckRunReport's --apply
    // path used to call the real mutating store method
    // (recoverExpiredRunLeasesDetailed — the ONLY place a run's defer_count is
    // ever incremented) only when `preview.reclaimable.length > 0`. A
    // live-looking run under the grace ceiling is always classified as
    // liveDeferred, never reclaimable, by construction — so that gate stayed
    // closed forever for exactly this run, its defer_count never moved off 0,
    // and --apply could be invoked any number of times without ever crossing
    // the ceiling. Reproduced exactly as the reviewer did: repeated --apply
    // calls, defer_count observably stuck. Timestamps mirror the existing
    // store-level ceiling test ("lease recovery abandons a still-live run
    // once the deferral ceiling is exhausted", src/lib/store.test.ts) so the
    // arithmetic is proven correct independently of this test.
    test("--apply reclaims a live-looking run once it exceeds the grace ceiling, never before (both directions)", () => {
      const store = new Store(":memory:");
      try {
        const loop = store.createLoop(
          { name: "ceiling-wedged", schedule: { type: "interval", everyMs: 60_000 }, target: { type: "command", command: "true" }, overlap: "skip", leaseMs: 10 },
          new Date("2025-12-31T00:00:00Z"),
        );
        const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "daemon:1234", new Date("2026-01-01T00:00:00Z"));
        // Genuinely alive fingerprint (this test process). The ONLY thing that
        // ever ends this run is the grace ceiling — never plain lease expiry.
        store.recordRunProcess(claim!.run.id, { pid: process.pid, pgid: process.pid }, { claimToken: claim!.claimToken });

        // ARM 1 — the direction that must NOT regress: a genuinely live run
        // stays refused across repeated --apply calls, well under the ceiling.
        // Before the fix this direction already "passed" (nothing was ever
        // reclaimed) — for the wrong reason: --apply never even ran the real
        // recovery pass, so this arm alone cannot tell the fixed code from the
        // broken one. ARM 2 is the discriminating one.
        for (let attempt = 1; attempt <= 10; attempt += 1) {
          const at = new Date(Date.parse("2026-01-01T00:02:00Z") + attempt * 60_000);
          const report = buildStuckRunReport(store, { apply: true, now: at });
          expect(report.stuck).toBe(0);
          expect(report.liveDeferred).toBe(1);
          expect(report.entries.every((entry) => !entry.reclaimed)).toBe(true);
          expect(store.getRun(claim!.run.id)?.status).toBe("running");
        }

        // ARM 2 (discriminating) — the 11th pass is past the ceiling: --apply
        // must now reclaim it despite it still looking alive. On the pre-fix
        // code this never happens no matter how many times --apply is called,
        // because defer_count was frozen at 0 by ARM 1's gate never opening.
        const past = buildStuckRunReport(store, { apply: true, now: new Date("2026-01-01T00:14:00Z") });
        expect(past.stuck).toBe(1);
        expect(past.liveDeferred).toBe(0);
        expect(past.entries[0]?.reclaimed).toBe(true);
        expect(past.advancedLoopIds).toEqual([loop.id]);
        const abandoned = store.getRun(claim!.run.id);
        expect(abandoned?.status).toBe("abandoned");
        // Distinguishes an exhausted grace ceiling from a plainly dead run.
        expect(abandoned?.error).toContain("deferral ceiling");
        expect(store.hasRunningRun(loop.id)).toBe(false);
      } finally {
        store.close();
      }
    });

    test("dead recorded pid with a mismatched start-time fingerprint (recycled pid) is still reclaimed", () => {
      const store = new Store(":memory:");
      try {
        const loop = store.createLoop(
          { name: "recycled-pid-loop", schedule: { type: "interval", everyMs: 600_000 }, target: { type: "command", command: "true" }, overlap: "skip", leaseMs: 10 },
          wellInThePast,
        );
        const claim = store.claimRun(loop, loop.nextRunAt!, "daemon:1234", wellInThePast);
        // A live pid (this test process) but a start-time fingerprint from a
        // day before it actually started: a recycled pid impersonating a live
        // owner. isRecordedProcessAlive treats this as dead, and so must this
        // command's reclaim.
        store.recordRunProcess(
          claim!.run.id,
          { pid: process.pid, pgid: process.pid, processStartedAt: new Date(Date.now() - 24 * 60 * 60_000).toISOString() },
          { claimToken: claim!.claimToken },
        );

        const report = buildStuckRunReport(store, { apply: true });
        expect(report.stuck).toBe(1);
        expect(report.entries[0]?.reclaimed).toBe(true);
        expect(store.getRun(claim!.run.id)?.status).toBe("abandoned");
      } finally {
        store.close();
      }
    });

    test("reclaims a stuck run under a PAUSED loop without resuming it or moving its frozen nextRunAt", () => {
      // Relayed finding (loop-zombie-sweeper, incident #incidents 639449): a
      // confirmed fleet zombie is a PAUSED loop with nextRunAt frozen months
      // ago under overlap:skip. Reclaiming the run must not silently resume
      // the loop — planLoopAdvancement is a no-op for a non-active loop
      // (reason: "inactive"), so nextRunAt must stay exactly where an
      // operator left it and status must stay "paused". The run itself still
      // gets abandoned: that half is unconditional and independent of loop
      // status, because a run row lying about being "running" is wrong
      // regardless of whether its loop is paused.
      const store = new Store(":memory:");
      try {
        const loop = store.createLoop(
          { name: "paused-zombie", schedule: { type: "interval", everyMs: 600_000 }, target: { type: "command", command: "true" }, overlap: "skip", leaseMs: 10 },
          wellInThePast,
        );
        const claim = store.claimRun(loop, loop.nextRunAt!, "daemon:1234", wellInThePast);
        store.updateLoop(loop.id, { status: "paused" });
        const frozenNextRunAt = store.getLoop(loop.id)!.nextRunAt;

        const report = buildStuckRunReport(store, { apply: true });

        expect(report.entries[0]?.reclaimed).toBe(true);
        expect(store.getRun(claim!.run.id)?.status).toBe("abandoned");
        // Not resumed, and no nextRunAt movement was even attempted for it.
        expect(report.advancedLoopIds).not.toContain(loop.id);
        const afterLoop = store.getLoop(loop.id)!;
        expect(afterLoop.status).toBe("paused");
        expect(afterLoop.nextRunAt).toBe(frozenNextRunAt);
      } finally {
        store.close();
      }
    });

    test("a running run with NO recorded pid at all is reclaimable, not silently skipped", () => {
      // Relayed finding (loop-zombie-sweeper): running runs may carry no pid
      // (e.g. the daemon died between claiming the run and ever spawning a
      // process, so onSpawn/onSpawnProcess never fired). isRecordedProcessAlive
      // treats a null/falsy pid as "not alive" — the safe default for this
      // check, not a blind spot: a run this command needs to judge is never
      // skipped for lack of a pid to look up.
      const store = new Store(":memory:");
      try {
        const loop = store.createLoop(
          { name: "never-spawned", schedule: { type: "interval", everyMs: 600_000 }, target: { type: "command", command: "true" }, overlap: "skip", leaseMs: 10 },
          wellInThePast,
        );
        const claim = store.claimRun(loop, loop.nextRunAt!, "daemon:1234", wellInThePast);
        expect(claim!.run.pid).toBeUndefined();
        expect(store.getRun(claim!.run.id)?.pid).toBeUndefined();

        const report = buildStuckRunReport(store, { apply: true });
        expect(report.stuck).toBe(1);
        expect(report.liveDeferred).toBe(0);
        expect(report.entries[0]?.reclaimed).toBe(true);
        expect(store.getRun(claim!.run.id)?.status).toBe("abandoned");
      } finally {
        store.close();
      }
    });

    test("reports ok with nothing to reclaim when no run's lease has expired", () => {
      const store = new Store(":memory:");
      try {
        store.createLoop({
          name: "fresh",
          schedule: { type: "interval", everyMs: 600_000 },
          target: { type: "command", command: "true" },
          leaseMs: 30 * 60_000,
        });
        const report = buildStuckRunReport(store);
        expect(report.ok).toBe(true);
        expect(report.stuck).toBe(0);
        expect(report.liveDeferred).toBe(0);
        expect(report.entries).toEqual([]);
      } finally {
        store.close();
      }
    });
  });
});
