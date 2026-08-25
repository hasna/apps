import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AmbiguousNameError,
  DuplicateWorkflowEventError,
  LegacyWorkflowRunProvenanceError,
  LoopArchivedError,
  LoopNotFoundError,
  RunFinalizationConflictError,
  ValidationError,
  WorkflowRunDefinitionConflictError,
} from "./errors.js";
import { Store } from "./store.js";
import { workflowDefinitionHash } from "./workflow-provenance.js";

// Credential fixtures assembled at runtime so the literal token shapes never
// appear contiguously in source (avoids tripping source secret scanners such as
// GitHub push protection); the scrubber still sees the full string at runtime.
const j = (...parts: string[]): string => parts.join("");
const ANT_KEY = j("sk-", "ant-api03-abcDEF123456789_-suffix");
const AWS_KEY = j("AKIA", "IOSFODNN7EXAMPLE");
const GH_PAT = j("ghp", "_AbCdEf0123456789AbCdEf0123456789");
const SLACK_TOKEN = j("xoxb", "-1234567890-abcdefghijklmn");
const OPENAI_KEY = j("sk-", "proj-AbCd1234EfGh5678IjKl9012");
// Redaction fixtures name credential-shaped keys through concatenation so the
// source never holds a contiguous `KEY="…"` assignment (the same sentinel
// convention as the constants above) — the staged secrets scan would otherwise
// flag the fixture input itself, not the credential it models.
const FIXTURE_API_KEY = j("MY_API_", "KEY");
const FIXTURE_DB_PASSWORD = j("DB_PASS", "WORD");

const DEAD_PID = 0x3fffffff;

describe("Store", () => {
  test("persists normalized loop labels and applies AND filters to loops and current-label runs", () => {
    const store = new Store(":memory:");
    try {
      const browser = store.createLoop(
        {
          name: "browser-loop",
          labels: ["BrowserPlan", "nightly", "nightly"],
          schedule: { type: "once", at: "2026-08-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2026-07-31T00:00:00Z"),
      );
      const maintenance = store.createLoop(
        {
          name: "maintenance-loop",
          labels: ["maintenance"],
          schedule: { type: "once", at: "2026-08-01T00:01:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2026-07-31T00:00:00Z"),
      );
      store.claimRun(browser, "2026-08-01T00:00:00.000Z", "test");
      store.claimRun(maintenance, "2026-08-01T00:01:00.000Z", "test");

      expect(store.getLoop(browser.id)?.labels).toEqual(["browserplan", "nightly"]);
      expect(store.listLoops({ labels: ["browserplan", "nightly"] }).map((loop) => loop.name)).toEqual(["browser-loop"]);
      expect(store.listLoops({ labels: ["browserplan", "missing"] })).toEqual([]);
      expect(store.listRuns({ labels: ["browserplan"] }).map((run) => run.loopName)).toEqual(["browser-loop"]);

      store.updateLoop(browser.id, { labels: ["maintenance"] });
      expect(store.listRuns({ labels: ["browserplan"] })).toEqual([]);
      expect(store.listRuns({ labels: ["maintenance"] }).map((run) => run.loopName).sort()).toEqual([
        "browser-loop",
        "maintenance-loop",
      ]);
    } finally {
      store.close();
    }
  });

  test("updateLoop changes maxAttempts in place, keeping the loop's id, schedule and run history", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "retry-budget",
          schedule: { type: "once", at: "2027-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2026-01-01T00:00:00Z"),
      );
      // The default is 1: one transient failure retires the loop with no retry.
      expect(loop.maxAttempts).toBe(1);
      store.claimRun(loop, "2027-01-01T00:00:00.000Z", "test");
      const runsBefore = store.listRuns({ loopId: loop.id }).length;
      expect(runsBefore).toBe(1);

      const updated = store.updateLoop(loop.id, { maxAttempts: 3 });

      expect(updated.maxAttempts).toBe(3);
      expect(store.getLoop(loop.id)?.maxAttempts).toBe(3);
      // In place: nothing that a delete-and-recreate would have destroyed moved.
      expect(updated.id).toBe(loop.id);
      expect(updated.name).toBe(loop.name);
      expect(updated.schedule).toEqual(loop.schedule);
      expect(updated.nextRunAt).toBe(loop.nextRunAt);
      expect(updated.createdAt).toBe(loop.createdAt);
      expect(store.listRuns({ loopId: loop.id }).length).toBe(runsBefore);
    } finally {
      store.close();
    }
  });

  test("updateLoop leaves maxAttempts untouched when the patch omits it", () => {
    // Regression: updateLoop writes max_attempts unconditionally from the merged
    // row, so an omitted key must fall through to the current value rather than
    // resetting the retry budget. This is the same class of bug that once wiped
    // omitted schedule fields on the /v1 PATCH path.
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "retry-budget-preserved",
          maxAttempts: 5,
          schedule: { type: "once", at: "2027-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2026-01-01T00:00:00Z"),
      );
      expect(loop.maxAttempts).toBe(5);

      store.updateLoop(loop.id, { labels: ["unrelated"] });
      expect(store.getLoop(loop.id)?.maxAttempts).toBe(5);

      store.updateLoop(loop.id, { status: "paused" });
      expect(store.getLoop(loop.id)?.maxAttempts).toBe(5);
    } finally {
      store.close();
    }
  });

  test("updateLoop rejects a maxAttempts that is not an integer >= 1, atomically", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "retry-budget-invalid",
          maxAttempts: 4,
          schedule: { type: "once", at: "2027-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2026-01-01T00:00:00Z"),
      );
      const before = store.getLoop(loop.id);
      // 0 and negatives would make `attempt < maxAttempts` false forever, so a
      // run could never be admitted or retried.
      for (const maxAttempts of [0, -1, 1.5, "2", null, {}, Number.NaN]) {
        expect(() =>
          store.updateLoop(loop.id, {
            maxAttempts,
            labels: ["mutated"],
          } as unknown as Parameters<Store["updateLoop"]>[1])
        ).toThrow(ValidationError);
        expect(store.getLoop(loop.id)).toEqual(before);
      }

      expect(store.updateLoop(loop.id, { maxAttempts: 1 }).maxAttempts).toBe(1);
      expect(store.updateLoop(loop.id, { maxAttempts: 10 }).maxAttempts).toBe(10);
    } finally {
      store.close();
    }
  });

  test("updateLoop changes leaseMs in place, keeping the loop's id, schedule and run history", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "lease-widening",
          leaseMs: 30 * 60_000,
          schedule: { type: "once", at: "2027-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2026-01-01T00:00:00Z"),
      );
      // The default is 30 minutes; a long-running agentic sweep needs wider.
      expect(loop.leaseMs).toBe(30 * 60_000);
      store.claimRun(loop, "2027-01-01T00:00:00.000Z", "test");
      const runsBefore = store.listRuns({ loopId: loop.id }).length;
      expect(runsBefore).toBe(1);

      const updated = store.updateLoop(loop.id, { leaseMs: 2 * 60 * 60_000 });

      expect(updated.leaseMs).toBe(2 * 60 * 60_000);
      expect(store.getLoop(loop.id)?.leaseMs).toBe(2 * 60 * 60_000);
      // In place: nothing that a delete-and-recreate would have destroyed moved.
      expect(updated.id).toBe(loop.id);
      expect(updated.name).toBe(loop.name);
      expect(updated.schedule).toEqual(loop.schedule);
      expect(updated.nextRunAt).toBe(loop.nextRunAt);
      expect(updated.createdAt).toBe(loop.createdAt);
      expect(store.listRuns({ loopId: loop.id }).length).toBe(runsBefore);
    } finally {
      store.close();
    }
  });

  test("updateLoop leaves leaseMs untouched when the patch omits it", () => {
    // Regression (O15-00695): updateLoop writes lease_ms unconditionally from
    // the merged row, so an omitted key must fall through to the current value
    // rather than resetting the lease to the create default. This is the same
    // class of bug that once wiped omitted schedule fields on the /v1 PATCH path.
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "lease-preserved",
          leaseMs: 90 * 60_000,
          schedule: { type: "once", at: "2027-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2026-01-01T00:00:00Z"),
      );
      expect(loop.leaseMs).toBe(90 * 60_000);

      store.updateLoop(loop.id, { labels: ["unrelated"] });
      expect(store.getLoop(loop.id)?.leaseMs).toBe(90 * 60_000);

      store.updateLoop(loop.id, { status: "paused" });
      expect(store.getLoop(loop.id)?.leaseMs).toBe(90 * 60_000);

      store.updateLoop(loop.id, { maxAttempts: 2 });
      expect(store.getLoop(loop.id)?.leaseMs).toBe(90 * 60_000);
    } finally {
      store.close();
    }
  });

  test("updateLoop rejects a leaseMs that is not a positive integer, atomically", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "lease-invalid",
          leaseMs: 30 * 60_000,
          schedule: { type: "once", at: "2027-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2026-01-01T00:00:00Z"),
      );
      const before = store.getLoop(loop.id);
      // 0 and negatives would make every run claim immediately wedged, so a
      // lease must be a positive integer of milliseconds.
      for (const leaseMs of [0, -1, 1.5, "2", null, {}, Number.NaN]) {
        expect(() =>
          store.updateLoop(loop.id, {
            leaseMs,
            labels: ["mutated"],
          } as unknown as Parameters<Store["updateLoop"]>[1])
        ).toThrow(ValidationError);
        expect(store.getLoop(loop.id)).toEqual(before);
      }

      expect(store.updateLoop(loop.id, { leaseMs: 1_000 }).leaseMs).toBe(1_000);
      expect(store.updateLoop(loop.id, { leaseMs: 4 * 60 * 60_000 }).leaseMs).toBe(4 * 60 * 60_000);
    } finally {
      store.close();
    }
  });

  test("updateLoop rejects erased invalid statuses atomically and accepts every canonical status", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "status-boundary",
          labels: ["original"],
          schedule: { type: "once", at: "2027-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2026-01-01T00:00:00Z"),
      );
      const before = store.getLoop(loop.id);
      for (const status of ["poisoned", null, 7, {}, ""]) {
        expect(() =>
          store.updateLoop(loop.id, {
            status,
            labels: ["mutated"],
            nextRunAt: "2099-01-01T00:00:00.000Z",
          } as unknown as Parameters<Store["updateLoop"]>[1])
        ).toThrow(ValidationError);
        expect(store.getLoop(loop.id)).toEqual(before);
      }

      for (const status of ["active", "paused", "stopped", "expired"] as const) {
        expect(store.updateLoop(loop.id, { status }).status).toBe(status);
      }
    } finally {
      store.close();
    }
  });

  test("migrates unlabeled SQLite loops to empty labels without raising the compatibility floor", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-label-migration-"));
    const dbFile = join(root, "loops.db");
    const old = new Database(dbFile);
    try {
      old.exec(`
        CREATE TABLE loops (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL,
          schedule_json TEXT NOT NULL,
          target_json TEXT NOT NULL,
          goal_json TEXT,
          machine_json TEXT,
          next_run_at TEXT,
          retry_scheduled_for TEXT,
          catch_up TEXT NOT NULL,
          catch_up_limit INTEGER NOT NULL,
          overlap TEXT NOT NULL,
          max_attempts INTEGER NOT NULL,
          retry_delay_ms INTEGER NOT NULL,
          lease_ms INTEGER NOT NULL,
          expires_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO loops (
          id, name, description, status, schedule_json, target_json, goal_json, machine_json, next_run_at,
          retry_scheduled_for, catch_up, catch_up_limit, overlap, max_attempts, retry_delay_ms, lease_ms,
          expires_at, created_at, updated_at
        ) VALUES (
          'old-loop', 'old-loop', NULL, 'active', '{"type":"once","at":"2026-08-01T00:00:00Z"}',
          '{"type":"command","command":"true"}', NULL, NULL, '2026-08-01T00:00:00.000Z',
          NULL, 'latest', 50, 'skip', 1, 60000, 1800000, NULL,
          '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'
        );
        PRAGMA user_version = 8;
      `);
    } finally {
      old.close();
    }

    const store = new Store(dbFile);
    try {
      expect(store.requireLoop("old-loop").labels).toEqual([]);
      expect(store.listLoops({ labels: ["missing"] })).toEqual([]);
      const version = store["db"].query("PRAGMA user_version").get() as { user_version: number };
      expect(version.user_version).toBe(8);
    } finally {
      store.close();
    }
  });

  test("hardens existing store directory and sqlite files to owner-only permissions", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-store-permissions-"));
    const dbFile = join(root, "loops.db");
    const legacy = new Database(dbFile);
    try {
      legacy.exec("CREATE TABLE legacy_probe (id TEXT PRIMARY KEY);");
    } finally {
      legacy.close();
    }
    chmodSync(root, 0o755);
    chmodSync(dbFile, 0o644);

    const store = new Store(dbFile);
    try {
      expect(statSync(root).mode & 0o777).toBe(0o700);
      expect(statSync(dbFile).mode & 0o777).toBe(0o600);
      for (const sqliteSidecar of [`${dbFile}-wal`, `${dbFile}-shm`]) {
        if (existsSync(sqliteSidecar)) expect(statSync(sqliteSidecar).mode & 0o777).toBe(0o600);
      }
    } finally {
      store.close();
    }
  });

  test("creates loops and claims one run per scheduled slot", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "once",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const first = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "test");
      const second = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "test");
      expect(first?.run.status).toBe("running");
      expect(second).toBeUndefined();
      expect(store.listRuns({ loopId: loop.id })).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("overlap skip blocks a second running slot for the same loop", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "skip-overlap-catchup",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          catchUp: "latest",
          catchUpLimit: 50,
          overlap: "skip",
          leaseMs: 30 * 60_000,
        },
        new Date("2026-06-25T11:12:00Z"),
      );

      const stale = store.claimRun(
        loop,
        "2026-06-25T11:12:00.000Z",
        "runner-a",
        new Date("2026-07-02T07:39:15.144Z"),
      );
      const current = store.claimRun(
        loop,
        "2026-07-02T07:12:00.000Z",
        "runner-b",
        new Date("2026-07-02T07:39:16.000Z"),
      );

      expect(stale?.run.status).toBe("running");
      expect(current).toBeUndefined();
      expect(store.listRuns({ loopId: loop.id, status: "running" })).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("overlap allow still permits running different slots for the same loop", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "allow-overlap-catchup",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          catchUp: "all",
          overlap: "allow",
          leaseMs: 30 * 60_000,
        },
        new Date("2026-01-01T00:00:00Z"),
      );

      const first = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner-a", new Date("2026-01-01T00:00:00Z"));
      const second = store.claimRun(loop, "2026-01-01T00:01:00.000Z", "runner-b", new Date("2026-01-01T00:01:00Z"));

      expect(first?.run.status).toBe("running");
      expect(second?.run.status).toBe("running");
      expect(store.listRuns({ loopId: loop.id, status: "running" })).toHaveLength(2);
    } finally {
      store.close();
    }
  });

  test("overlap skip does not block a later slot on an expired dead lease", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "skip-overlap-expired-dead",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          overlap: "skip",
          leaseMs: 10,
        },
        new Date("2026-01-01T00:00:00Z"),
      );

      const expired = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner-a", new Date("2026-01-01T00:00:00Z"));
      expect(expired?.run.status).toBe("running");

      const later = store.claimRun(loop, "2026-01-01T00:01:00.000Z", "runner-b", new Date("2026-01-01T00:01:00Z"));
      expect(later?.run.status).toBe("running");
    } finally {
      store.close();
    }
  });

  test("hydrates latest run summaries when listing loops without merging duplicate names", () => {
    const store = new Store(":memory:");
    try {
      const paused = store.createLoop(
        {
          name: "duplicate-router",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      store.updateLoop(paused.id, { status: "paused" });
      const active = store.createLoop(
        {
          name: "duplicate-router",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:01Z"),
      );
      const claim = store.claimRun(active, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      const run = store.finalizeRun(claim!.run.id, {
        status: "succeeded",
        finishedAt: "2026-01-01T00:00:05.000Z",
        durationMs: 5_000,
        stdout: "",
        stderr: "",
      });

      const loops = store.listLoops({ includeArchived: true });
      const activeListed = loops.find((loop) => loop.id === active.id);
      const pausedListed = loops.find((loop) => loop.id === paused.id);
      expect(activeListed).toMatchObject({
        latestRunId: run.id,
        latestRunStatus: "succeeded",
        lastRunAt: "2026-01-01T00:00:05.000Z",
      });
      expect(pausedListed?.latestRunId).toBeUndefined();
      expect(pausedListed?.name).toBe(activeListed?.name);
    } finally {
      store.close();
    }
  });

  test("clamps oversized run stdout/stderr but keeps small output verbatim (loops.db growth guard)", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "stdout-retention",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );

      const bigClaim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      expect(bigClaim).toBeDefined();
      const huge = "x".repeat(500_000);
      const finishedBig = store.finalizeRun(
        bigClaim!.run.id,
        { status: "succeeded", finishedAt: "2026-01-01T00:00:01.000Z", durationMs: 1_000, stdout: huge, stderr: huge },
        { claimedBy: "runner", claimToken: bigClaim!.claimToken, now: new Date("2026-01-01T00:00:00.500Z") },
      );
      const storedBig = store.getRun(finishedBig.id)!;
      expect(storedBig.stdout!.length).toBeLessThan(huge.length);
      expect(storedBig.stdout!.length).toBeLessThanOrEqual(64 * 1024 + 128);
      expect(storedBig.stdout).toContain("truncated by loops run-output retention");
      expect(storedBig.stderr).toContain("truncated by loops run-output retention");

      const smallLoop = store.createLoop(
        {
          name: "stdout-retention-small",
          schedule: { type: "once", at: "2026-01-02T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2026-01-01T00:00:00Z"),
      );
      const smallClaim = store.claimRun(smallLoop, "2026-01-02T00:00:00.000Z", "runner", new Date("2026-01-02T00:00:00Z"));
      expect(smallClaim).toBeDefined();
      const finishedSmall = store.finalizeRun(
        smallClaim!.run.id,
        { status: "succeeded", finishedAt: "2026-01-02T00:00:01.000Z", durationMs: 1_000, stdout: "all good", stderr: "" },
        { claimedBy: "runner", claimToken: smallClaim!.claimToken, now: new Date("2026-01-02T00:00:00.500Z") },
      );
      const storedSmall = store.getRun(finishedSmall.id)!;
      expect(storedSmall.stdout).toBe("all good");
    } finally {
      store.close();
    }
  });

  test("finalizeRun bounds runner timestamps and derives omitted duration from the server clock", () => {
    const store = new Store(":memory:");
    try {
      const serverNow = new Date("2026-01-01T00:00:10.000Z");
      const startedAt = new Date("2026-01-01T00:00:05.000Z");
      for (const [name, requestedFinishedAt, expectedFinishedAt] of [
        ["future", "2099-01-01T00:00:00.000Z", serverNow.toISOString()],
        ["past", "2000-01-01T00:00:00.000Z", startedAt.toISOString()],
        ["omitted", undefined, serverNow.toISOString()],
      ] as const) {
        const loop = store.createLoop(
          {
            name: `completion-${name}`,
            schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
            target: { type: "command", command: "true" },
          },
          new Date("2025-12-31T00:00:00Z"),
        );
        const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", startedAt);
        expect(claim).toBeDefined();
        const finalized = store.finalizeRun(
          claim!.run.id,
          {
            status: "succeeded",
            ...(requestedFinishedAt === undefined ? {} : { finishedAt: requestedFinishedAt }),
            stdout: "",
            stderr: "",
          } as unknown as Parameters<Store["finalizeRun"]>[1],
          { claimedBy: "runner", claimToken: claim!.claimToken, now: serverNow },
        );
        expect(finalized).toMatchObject({
          status: "succeeded",
          finishedAt: expectedFinishedAt,
          durationMs: 5_000,
          updatedAt: serverNow.toISOString(),
        });
      }

      const invalidLoop = store.createLoop(
        {
          name: "completion-invalid",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const invalidClaim = store.claimRun(invalidLoop, "2026-01-01T00:00:00.000Z", "runner", startedAt);
      for (const invalidPatch of [
        { finishedAt: "not-a-date" },
        { finishedAt: 123 },
        { durationMs: -1 },
      ]) {
        expect(() =>
          store.finalizeRun(
            invalidClaim!.run.id,
            { status: "succeeded", ...invalidPatch, stdout: "", stderr: "" } as unknown as Parameters<Store["finalizeRun"]>[1],
            { claimedBy: "runner", claimToken: invalidClaim!.claimToken, now: serverNow },
          )
        ).toThrow(ValidationError);
      }
      expect(store.getRun(invalidClaim!.run.id)?.status).toBe("running");
    } finally {
      store.close();
    }
  });

  test("writes idempotent scheduler-neutral run receipts with bounded summaries", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "receipt-loop",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true", cwd: "/workspace/open-loops" },
          machine: { id: "spark01" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      const run = store.finalizeRun(claim!.run.id, {
        status: "succeeded",
        finishedAt: "2026-01-01T00:00:03.000Z",
        durationMs: 3_000,
        stdout: "stored",
        stderr: "",
      });

      const first = store.writeRunReceipt(
        {
          run_id: run.id,
          task_ids: ["task-1", "task-1"],
          knowledge_ids: ["knowledge-1"],
          summary: "worker finished",
          evidence_paths: ["/tmp/evidence.json"],
          stdout: `validated ${OPENAI_KEY}`,
          stderr: "warn",
        },
        { now: new Date("2026-01-01T00:00:04Z") },
      );

      expect(first).toMatchObject({
        loop_id: loop.id,
        run_id: run.id,
        repo: "/workspace/open-loops",
        task_ids: ["task-1"],
        knowledge_ids: ["knowledge-1"],
        status: "succeeded",
        exit_code: null,
        started_at: "2026-01-01T00:00:00.000Z",
        finished_at: "2026-01-01T00:00:03.000Z",
      });
      expect(first.digest_id).toMatch(/^sha256:/);
      expect(first.summary.text).toBe("worker finished");
      expect(first.summary.stdout_bytes).toBeGreaterThan(OPENAI_KEY.length);
      expect(first.summary.stdout_excerpt).toContain("[SCRUBBED]");
      expect(first.summary.stdout_excerpt).not.toContain(OPENAI_KEY);

      const updated = store.writeRunReceipt(
        {
          run_id: run.id,
          loop_id: loop.id,
          repo: "/workspace/open-loops",
          task_ids: ["task-2"],
          status: "failed",
          exit_code: 12,
          summary: { text: "updated receipt", stdout_bytes: 0, stderr_bytes: 0 },
        },
        { now: new Date("2026-01-01T00:00:05Z") },
      );
      expect(updated.created_at).toBe(first.created_at);
      expect(updated.updated_at).toBe("2026-01-01T00:00:05.000Z");
      expect(updated.status).toBe("failed");
      expect(updated.exit_code).toBe(12);
      expect(store.getRunReceipt(run.id)?.task_ids).toEqual(["task-2"]);
      expect(store.listRunReceipts({ taskId: "task-2" }).map((receipt) => receipt.run_id)).toEqual([run.id]);
      expect(store.listRunReceipts({ knowledgeId: "knowledge-1" })).toEqual([]);
      expect(store.listRunReceipts({ repo: "/workspace/open-loops", status: "failed" })).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("rejects malformed receipt writes through receipt validation", () => {
    const store = new Store(":memory:");
    try {
      expect(() =>
        store.writeRunReceipt({
          loop_id: "loop-id",
          status: "succeeded",
        } as any),
      ).toThrow("run_id must be non-empty");
    } finally {
      store.close();
    }
  });

  test("persists loop machine assignments", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "machine-loop",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
          machine: {
            id: "spark01",
            route: "tailscale",
            local: false,
            workspacePath: "/home/hasna/workspace",
            resolvedAt: "2026-01-01T00:00:00.000Z",
          },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      expect(store.getLoop(loop.id)?.machine).toEqual(loop.machine);
      expect(store.listLoops()[0]?.machine?.id).toBe("spark01");
    } finally {
      store.close();
    }
  });

  test("tracks workflow invocations, admission work items, manifests, and terminal status", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-workflow-invocation-"));
    const store = new Store(join(root, "loops.db"));
    try {
      const invocation = store.createWorkflowInvocation({
        templateId: "todos-task-worker-verifier",
        sourceRef: { kind: "event", id: "evt-1", dedupeKey: "todos-task:task-1:task.created" },
        subjectRef: { kind: "task", id: "task-1", path: "/tmp/open-loops" },
        intent: "route",
        scope: { projectPath: "/tmp/open-loops", worktreePolicy: "required" },
        outputPolicy: { report: "always", createTask: "on_failure" },
      });
      const workItem = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:task-1:task.created",
        invocationId: invocation.id,
        sourceType: "task.created",
        sourceRef: "evt-1",
        subjectRef: "task-1",
        projectKey: "/tmp/open-loops",
        machineId: "spark-test",
      });
      expect(workItem.status).toBe("queued");
      expect(workItem.machineId).toBe("spark-test");
      expect(store.countActiveWorkflowWorkItems({ projectKey: "/tmp/open-loops" })).toEqual({ global: 0, project: 0 });

      const workflow = store.createWorkflow({
        name: "route-task-1",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop({
        name: "route-task-1-run",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: {
          type: "workflow",
          workflowId: workflow.id,
          input: {
            workflowInvocationId: invocation.id,
            workflowWorkItemId: workItem.id,
          },
        },
      });
      const admitted = store.admitWorkflowWorkItem(workItem.id, { workflowId: workflow.id, loopId: loop.id });
      expect(admitted.status).toBe("admitted");
      expect(store.countActiveWorkflowWorkItems({ projectKey: "/tmp/open-loops" })).toEqual({ global: 1, project: 1 });

      const run = store.createWorkflowRun({ workflow, loop, scheduledFor: "2026-01-01T00:00:00.000Z" });
      expect(run.invocationId).toBe(invocation.id);
      expect(run.workItemId).toBe(workItem.id);
      expect(run.manifestPath).toBeDefined();
      expect(run.manifestPath).toContain("/runs/open-loops/task-task-1-");
      expect(existsSync(run.manifestPath!)).toBe(true);
      const manifest = JSON.parse(readFileSync(run.manifestPath!, "utf8"));
      expect(manifest.workflowInvocation.id).toBe(invocation.id);
      expect(manifest.workflowWorkItem.id).toBe(workItem.id);
      expect(store.getWorkflowWorkItem(workItem.id)?.status).toBe("running");

      store.finalizeWorkflowRun(run.id, "succeeded");
      expect(store.getWorkflowWorkItem(workItem.id)?.status).toBe("succeeded");
      expect(store.getWorkflowWorkItem(workItem.id)?.machineId).toBe("spark-test");
      expect(store.countActiveWorkflowWorkItems({ projectKey: "/tmp/open-loops" })).toEqual({ global: 0, project: 0 });
      expect(store.getWorkflow(workflow.id)?.status).toBe("archived");
      expect(store.listWorkflowRuns({ workflowId: workflow.id })).toHaveLength(1);
      expect(store.listWorkflowEvents(run.id).map((event) => event.eventType)).toContain("workflow_archived");
    } finally {
      store.close();
    }
  });

  test("syncs successful task-lifecycle todos workflow pointers after requeued cancellation", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-task-lifecycle-pointers-"));
    const fakeBin = join(root, "bin");
    const todosLog = join(root, "todos-args.log");
    mkdirSync(fakeBin);
    writeFileSync(
      join(fakeBin, "todos"),
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TODOS_POINTER_LOG"
exit 0
`,
      { mode: 0o700 },
    );
    const previousPath = process.env.PATH;
    const previousLog = process.env.TODOS_POINTER_LOG;
    process.env.PATH = `${fakeBin}:${previousPath ?? ""}`;
    process.env.TODOS_POINTER_LOG = todosLog;
    const store = new Store(join(root, "loops.db"));
    try {
      const invocation = store.createWorkflowInvocation({
        templateId: "task-lifecycle",
        sourceRef: { kind: "event", id: "evt-task-1", dedupeKey: "todos-task:task-1:task.created" },
        subjectRef: { kind: "task", id: "task-1", path: "/tmp/open-loops" },
        intent: "route",
        scope: {
          projectPath: "/tmp/open-loops",
          todosProjectPath: "/tmp/todos-source",
          worktreePolicy: "required",
        },
      });
      const workItem = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:task-1:task.created",
        invocationId: invocation.id,
        sourceType: "task.created",
        sourceRef: "evt-task-1",
        subjectRef: "task-1",
        projectKey: "/tmp/open-loops",
      });
      const cancelledWorkflow = store.createWorkflow({
        name: "route-task-1-cancelled",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const cancelledLoop = store.createLoop({
        name: "route-task-1-cancelled-run",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: {
          type: "workflow",
          workflowId: cancelledWorkflow.id,
          input: {
            workflowInvocationId: invocation.id,
            workflowWorkItemId: workItem.id,
          },
        },
      });
      store.admitWorkflowWorkItem(workItem.id, { workflowId: cancelledWorkflow.id, loopId: cancelledLoop.id });
      const cancelledRun = store.createWorkflowRun({ workflow: cancelledWorkflow, loop: cancelledLoop, scheduledFor: "2026-01-01T00:00:00.000Z" });
      store.cancelWorkflowRun(cancelledRun.id);
      expect(existsSync(todosLog)).toBe(false);

      store.requeueWorkflowWorkItem(workItem.id, { reason: "task still actionable after cancelled lifecycle run" });
      const successWorkflow = store.createWorkflow({
        name: "route-task-1-success",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const successLoop = store.createLoop({
        name: "route-task-1-success-run",
        schedule: { type: "once", at: "2026-01-01T00:01:00Z" },
        target: {
          type: "workflow",
          workflowId: successWorkflow.id,
          input: {
            workflowInvocationId: invocation.id,
            workflowWorkItemId: workItem.id,
          },
        },
      });
      store.admitWorkflowWorkItem(workItem.id, { workflowId: successWorkflow.id, loopId: successLoop.id });
      const successRun = store.createWorkflowRun({ workflow: successWorkflow, loop: successLoop, scheduledFor: "2026-01-01T00:01:00.000Z" });

      store.finalizeWorkflowRun(successRun.id, "succeeded");

      const args = readFileSync(todosLog, "utf8").trim();
      expect(args).toContain("--project /tmp/todos-source task workflow-pointers task-1 --clear");
      expect(args).not.toContain("--project /tmp/open-loops");
      expect(args).toContain(`--invocation ${invocation.id}`);
      expect(args).toContain(`--run ${successRun.id}`);
      expect(args).toContain(`--manifest ${successRun.manifestPath}`);
      expect(args).toContain("--state succeeded");
      expect(args).toContain("--actor openloops:task-lifecycle");
      expect(args).not.toContain(cancelledRun.id);
      expect(store.listWorkflowEvents(successRun.id).map((event) => event.eventType)).toContain("todos_workflow_pointers_synced");

      for (const scenario of [
        {
          taskId: "task-env-default",
          todosProjectPath: "/tmp/todos-env-default",
          expectedPrefix: "--project /tmp/todos-env-default task workflow-pointers task-env-default --clear",
        },
        {
          taskId: "task-unscoped",
          todosProjectPath: undefined,
          expectedPrefix: "task workflow-pointers task-unscoped --clear",
        },
      ]) {
        writeFileSync(todosLog, "");
        const scenarioInvocation = store.createWorkflowInvocation({
          templateId: "task-lifecycle",
          sourceRef: {
            kind: "event",
            id: `evt-${scenario.taskId}`,
            dedupeKey: `todos-task:${scenario.taskId}:task.created`,
          },
          subjectRef: { kind: "task", id: scenario.taskId, path: "/tmp/open-loops" },
          intent: "route",
          scope: {
            projectPath: "/tmp/open-loops",
            todosProjectPath: scenario.todosProjectPath,
            worktreePolicy: "required",
          },
        });
        const scenarioItem = store.upsertWorkflowWorkItem({
          routeKey: "todos-task",
          idempotencyKey: `todos-task:${scenario.taskId}:task.created`,
          invocationId: scenarioInvocation.id,
          sourceType: "task.created",
          sourceRef: `evt-${scenario.taskId}`,
          subjectRef: scenario.taskId,
          projectKey: "/tmp/open-loops",
        });
        const scenarioWorkflow = store.createWorkflow({
          name: `route-${scenario.taskId}`,
          steps: [{ id: "worker", target: { type: "command", command: "true" } }],
        });
        const scenarioLoop = store.createLoop({
          name: `route-${scenario.taskId}-run`,
          schedule: { type: "once", at: "2026-01-01T00:02:00Z" },
          target: {
            type: "workflow",
            workflowId: scenarioWorkflow.id,
            input: {
              workflowInvocationId: scenarioInvocation.id,
              workflowWorkItemId: scenarioItem.id,
            },
          },
        });
        store.admitWorkflowWorkItem(scenarioItem.id, {
          workflowId: scenarioWorkflow.id,
          loopId: scenarioLoop.id,
        });
        const scenarioRun = store.createWorkflowRun({
          workflow: scenarioWorkflow,
          loop: scenarioLoop,
          scheduledFor: "2026-01-01T00:02:00.000Z",
        });
        store.finalizeWorkflowRun(scenarioRun.id, "succeeded");

        const scenarioArgs = readFileSync(todosLog, "utf8").trim();
        expect(scenarioArgs).toContain(scenario.expectedPrefix);
        expect(scenarioArgs).not.toContain("--project /tmp/open-loops");
        if (!scenario.todosProjectPath) expect(scenarioArgs).not.toContain("--project");
      }
    } finally {
      store.close();
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousLog === undefined) delete process.env.TODOS_POINTER_LOG;
      else process.env.TODOS_POINTER_LOG = previousLog;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("does not archive route-shaped workflows without generated route template metadata", () => {
    const store = new Store(":memory:");
    try {
      const invocation = store.createWorkflowInvocation({
        sourceRef: { kind: "event", id: "evt-reusable-route", dedupeKey: "todos-task:reusable-route" },
        subjectRef: { kind: "task", id: "reusable-route", path: "/tmp/open-loops" },
        intent: "route",
        scope: { projectPath: "/tmp/open-loops" },
      });
      const workItem = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:reusable-route",
        invocationId: invocation.id,
        sourceType: "task.created",
        sourceRef: "evt-reusable-route",
        subjectRef: "reusable-route",
        projectKey: "/tmp/open-loops",
      });
      const workflow = store.createWorkflow({
        name: "reusable-route-shaped-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop({
        name: "reusable-route-shaped-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: {
          type: "workflow",
          workflowId: workflow.id,
          input: {
            workflowInvocationId: invocation.id,
            workflowWorkItemId: workItem.id,
          },
        },
      });
      store.admitWorkflowWorkItem(workItem.id, { workflowId: workflow.id, loopId: loop.id });
      const run = store.createWorkflowRun({ workflow, loop, scheduledFor: "2026-01-01T00:00:00.000Z" });

      store.finalizeWorkflowRun(run.id, "succeeded");

      expect(store.getWorkflow(workflow.id)?.status).toBe("active");
      expect(store.listWorkflowEvents(run.id).map((event) => event.eventType)).not.toContain("workflow_archived");
    } finally {
      store.close();
    }
  });

  test("enforces workflow foreign keys for workflow runs", () => {
    const store = new Store(":memory:");
    try {
      expect(() =>
        store.createWorkflowRun({
          workflow: {
            id: "missing-workflow",
            name: "missing-workflow",
            version: 1,
            status: "active",
            steps: [{ id: "worker", target: { type: "command", command: "true" } }],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      ).toThrow();
    } finally {
      store.close();
    }
  });

  test("archives generated task-lifecycle route workflows after terminal runs", () => {
    const store = new Store(":memory:");
    try {
      const invocation = store.createWorkflowInvocation({
        templateId: "task-lifecycle",
        sourceRef: { kind: "event", id: "evt-task-lifecycle-route", dedupeKey: "todos-task:task-lifecycle-route" },
        subjectRef: { kind: "task", id: "task-lifecycle-route", path: "/tmp/open-loops" },
        intent: "route",
        scope: { projectPath: "/tmp/open-loops" },
      });
      const workItem = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:task-lifecycle-route",
        invocationId: invocation.id,
        sourceType: "task.created",
        sourceRef: "evt-task-lifecycle-route",
        subjectRef: "task-lifecycle-route",
        projectKey: "/tmp/open-loops",
      });
      const workflow = store.createWorkflow({
        name: "task-lifecycle-route-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop({
        name: "task-lifecycle-route-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: {
          type: "workflow",
          workflowId: workflow.id,
          input: {
            workflowInvocationId: invocation.id,
            workflowWorkItemId: workItem.id,
          },
        },
      });
      store.admitWorkflowWorkItem(workItem.id, { workflowId: workflow.id, loopId: loop.id });
      const run = store.createWorkflowRun({ workflow, loop, scheduledFor: "2026-01-01T00:00:00.000Z" });

      store.finalizeWorkflowRun(run.id, "succeeded");

      expect(store.getWorkflow(workflow.id)?.status).toBe("archived");
      expect(store.listWorkflowEvents(run.id).map((event) => event.eventType)).toContain("workflow_archived");
    } finally {
      store.close();
    }
  });

  test("matches generated-route retry and preflight archival semantics across SQLite finalizers", async () => {
    const store = new Store(":memory:");
    const scheduledFor = "2026-01-01T00:00:00.000Z";
    try {
      const makeRoute = (
        suffix: string,
        maxAttempts: number,
        templateId = "task-lifecycle",
      ) => {
        const invocation = store.createWorkflowInvocation({
          templateId,
          sourceRef: {
            kind: "event",
            id: `sqlite-parent-${suffix}`,
            dedupeKey: `todos-task:sqlite-parent-${suffix}`,
          },
          subjectRef: { kind: "task", id: `sqlite-parent-${suffix}`, path: "/tmp/loops" },
          intent: "route",
          scope: { projectPath: "/tmp/loops" },
        });
        const workItem = store.upsertWorkflowWorkItem({
          routeKey: "todos-task",
          idempotencyKey: `todos-task:sqlite-parent-${suffix}`,
          invocationId: invocation.id,
          sourceType: "task.created",
          sourceRef: `sqlite-parent-${suffix}`,
          subjectRef: `sqlite-parent-${suffix}`,
        });
        const workflow = store.createWorkflow({
          name: `sqlite-parent-generated-${suffix}`,
          steps: [{ id: "worker", target: { type: "command", command: "false" } }],
        });
        const loop = store.createLoop({
          name: `sqlite-parent-generated-loop-${suffix}`,
          schedule: { type: "once", at: scheduledFor },
          target: {
            type: "workflow",
            workflowId: workflow.id,
            input: {
              workflowInvocationId: invocation.id,
              workflowWorkItemId: workItem.id,
            },
          },
          maxAttempts,
          leaseMs: 60_000,
        }, new Date("2025-12-31T23:59:00.000Z"));
        store.admitWorkflowWorkItem(workItem.id, { workflowId: workflow.id, loopId: loop.id });
        const claim = store.claimRun(
          loop,
          scheduledFor,
          `runner-parent-${suffix}`,
          new Date(scheduledFor),
        );
        expect(claim).toBeDefined();
        return { invocation, workItem, workflow, loop, claim: claim! };
      };
      const finalizeParent = (
        fixture: ReturnType<typeof makeRoute>,
        finishedAt = "2026-01-01T00:00:01.000Z",
      ) => store.finalizeRun(
        fixture.claim.run.id,
        {
          status: "failed",
          finishedAt,
          durationMs: 1_000,
          stdout: "",
          stderr: "",
          error: "parent failed",
        },
        {
          claimedBy: fixture.claim.run.claimedBy,
          claimToken: fixture.claim.claimToken,
          now: new Date(finishedAt),
        },
      );

      const retryable = makeRoute("retryable-attempt-one-of-two", 2);
      const retryableFirstRun = store.createWorkflowRun({
        workflow: retryable.workflow,
        loop: retryable.loop,
        loopRun: retryable.claim.run,
      });
      store.finalizeWorkflowRun(retryableFirstRun.id, "failed", {
        finishedAt: "2026-01-01T00:00:00.500Z",
        error: "attempt one failed",
      });
      expect(store.getWorkflowWorkItem(retryable.workItem.id)).toMatchObject({
        status: "admitted",
        lastReason: "attempt failed; retry pending: attempt one failed",
      });
      expect(store.getWorkflow(retryable.workflow.id)?.status).toBe("active");
      expect(store.listWorkflowEvents(retryableFirstRun.id)
        .filter((event) => event.eventType === "workflow_archived")).toHaveLength(0);
      finalizeParent(retryable);
      const secondClaim = store.claimRun(
        retryable.loop,
        scheduledFor,
        "runner-parent-retryable-attempt-one-of-two-2",
        new Date("2026-01-01T00:00:02.000Z"),
      );
      expect(secondClaim?.run.attempt).toBe(2);
      const retryableSecondRun = store.createWorkflowRun({
        workflow: retryable.workflow,
        loop: retryable.loop,
        loopRun: secondClaim!.run,
      });
      store.finalizeWorkflowRun(retryableSecondRun.id, "timed_out", {
        finishedAt: "2026-01-01T00:00:02.500Z",
        error: "attempt two timed out",
      });
      expect(store.getWorkflowWorkItem(retryable.workItem.id)).toMatchObject({
        status: "failed",
        lastReason: "attempt two timed out",
      });
      expect(store.getWorkflow(retryable.workflow.id)?.status).toBe("archived");
      expect(store.listWorkflowEvents(retryableSecondRun.id)
        .filter((event) => event.eventType === "workflow_archived")).toHaveLength(1);

      const lateAttempt = makeRoute("late-attempt-one", 2);
      const lateAttemptFirstRun = store.createWorkflowRun({
        workflow: lateAttempt.workflow,
        loop: lateAttempt.loop,
        loopRun: lateAttempt.claim.run,
      });
      finalizeParent(lateAttempt);
      const lateAttemptSecondClaim = store.claimRun(
        lateAttempt.loop,
        scheduledFor,
        "runner-parent-late-attempt-one-2",
        new Date("2026-01-01T00:00:02.000Z"),
      );
      expect(lateAttemptSecondClaim?.run).toMatchObject({ attempt: 2, status: "running" });
      expect(store.getWorkflowWorkItem(lateAttempt.workItem.id)).toMatchObject({
        status: "admitted",
        workflowRunId: lateAttemptFirstRun.id,
      });
      store.finalizeWorkflowRun(lateAttemptFirstRun.id, "failed", {
        finishedAt: "2026-01-01T00:00:02.100Z",
        error: "late attempt one failure",
      });
      expect(store.getWorkflowRun(lateAttemptFirstRun.id)?.status).toBe("failed");
      expect(store.getWorkflowWorkItem(lateAttempt.workItem.id)).toMatchObject({
        status: "admitted",
        workflowRunId: lateAttemptFirstRun.id,
        lastReason: "attempt failed; retry pending: parent failed",
      });
      expect(store.getWorkflow(lateAttempt.workflow.id)?.status).toBe("active");
      expect(store.listWorkflowEvents(lateAttemptFirstRun.id)
        .filter((event) => event.eventType === "workflow_archived")).toHaveLength(0);
      const lateAttemptSecondRun = store.createWorkflowRun({
        workflow: lateAttempt.workflow,
        loop: lateAttempt.loop,
        loopRun: lateAttemptSecondClaim!.run,
      });
      store.finalizeWorkflowRun(lateAttemptSecondRun.id, "failed", {
        finishedAt: "2026-01-01T00:00:02.500Z",
        error: "attempt two failed",
      });
      expect(store.getWorkflowWorkItem(lateAttempt.workItem.id)?.status).toBe("failed");
      expect(store.getWorkflow(lateAttempt.workflow.id)?.status).toBe("archived");
      expect(store.listWorkflowEvents(lateAttemptSecondRun.id)
        .filter((event) => event.eventType === "workflow_archived")).toHaveLength(1);

      const exhausted = makeRoute("exhausted", 1);
      const exhaustedRun = store.createWorkflowRun({
        workflow: exhausted.workflow,
        loop: exhausted.loop,
        loopRun: exhausted.claim.run,
      });
      store.finalizeWorkflowRun(exhaustedRun.id, "failed", {
        finishedAt: "2026-01-01T00:00:00.500Z",
        error: "final attempt failed",
      });
      expect(store.getWorkflowWorkItem(exhausted.workItem.id)?.status).toBe("failed");
      expect(store.getWorkflow(exhausted.workflow.id)?.status).toBe("archived");
      expect(store.listWorkflowEvents(exhaustedRun.id)
        .filter((event) => event.eventType === "workflow_archived")).toHaveLength(1);
      store.finalizeWorkflowRun(exhaustedRun.id, "failed", {
        finishedAt: "2026-01-01T00:00:00.500Z",
        error: "final attempt failed",
      });
      expect(store.listWorkflowEvents(exhaustedRun.id)
        .filter((event) => event.eventType === "workflow_archived")).toHaveLength(1);

      const parentExisting = makeRoute("parent-existing-run", 1);
      const parentExistingRun = store.createWorkflowRun({
        workflow: parentExisting.workflow,
        loop: parentExisting.loop,
        loopRun: parentExisting.claim.run,
      });
      store["db"]
        .query("UPDATE workflow_runs SET status='failed', finished_at=?, updated_at=? WHERE id=?")
        .run("2026-01-01T00:00:00.500Z", "2026-01-01T00:00:00.500Z", parentExistingRun.id);
      finalizeParent(parentExisting);
      expect(store.getWorkflowWorkItem(parentExisting.workItem.id)?.status).toBe("failed");
      expect(store.getWorkflow(parentExisting.workflow.id)?.status).toBe("archived");
      expect(store.listWorkflowEvents(parentExistingRun.id)
        .filter((event) => event.eventType === "workflow_archived")).toHaveLength(1);

      const nearMiss = makeRoute("near-miss", 1, "manual-workflow");
      finalizeParent(nearMiss);
      expect(store.getWorkflow(nearMiss.workflow.id)?.status).toBe("active");
      expect(store.getWorkflowWorkItem(nearMiss.workItem.id)?.workflowRunId).toBeUndefined();
      expect(store.getWorkflowRun(`preflight-archive:${nearMiss.claim.run.id}`)).toBeUndefined();

      const preflight = makeRoute("preflight", 1);
      const preflightResults = await Promise.allSettled([
        Promise.resolve().then(() => finalizeParent(preflight)),
        Promise.resolve().then(() => finalizeParent(preflight)),
      ]);
      expect(preflightResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(preflightResults.filter((result) => result.status === "rejected")).toHaveLength(1);
      expect(store.getWorkflowWorkItem(preflight.workItem.id)?.status).toBe("failed");
      expect(store.getWorkflow(preflight.workflow.id)?.status).toBe("archived");
      const ownerId = `preflight-archive:${preflight.claim.run.id}`;
      const owner = store.getWorkflowRun(ownerId);
      expect(owner).toMatchObject({
        id: ownerId,
        workflowId: preflight.workflow.id,
        workflowName: preflight.workflow.name,
        loopId: preflight.loop.id,
        loopRunId: preflight.claim.run.id,
        invocationId: preflight.invocation.id,
        workItemId: preflight.workItem.id,
        scheduledFor,
        status: "failed",
        finishedAt: "2026-01-01T00:00:01.000Z",
        error: "workflow preflight failed before workflow execution; synthetic archival event owner",
        createdAt: "2026-01-01T00:00:01.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
      });
      expect(owner?.startedAt).toBeUndefined();
      expect(owner?.durationMs).toBeUndefined();
      expect(owner?.manifestPath).toBeUndefined();
      expect(owner?.idempotencyKey).toBeUndefined();
      expect(store.listWorkflowStepRuns(ownerId)).toHaveLength(0);
      expect(store.getWorkflowWorkItem(preflight.workItem.id)?.workflowRunId).toBe(ownerId);
      const ownerRow = store["db"]
        .query<{ workflow_definition_hash: string | null }, [string]>(
          "SELECT workflow_definition_hash FROM workflow_runs WHERE id = ?",
        )
        .get(ownerId);
      expect(ownerRow?.workflow_definition_hash).toBe(workflowDefinitionHash(preflight.workflow));
      expect(store.listWorkflowEvents(ownerId).map((event) => event.eventType)).toEqual(["workflow_archived"]);
    } finally {
      store.close();
    }
  });

  test("does not archive reusable workflows after ordinary terminal runs", () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "manual-reusable-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const run = store.createWorkflowRun({ workflow, scheduledFor: "2026-01-01T00:00:00.000Z" });

      store.finalizeWorkflowRun(run.id, "succeeded");

      expect(store.getWorkflow(workflow.id)?.status).toBe("active");
      expect(store.listWorkflowEvents(run.id).map((event) => event.eventType)).not.toContain("workflow_archived");
    } finally {
      store.close();
    }
  });

  test("rejects new workflow loops that define nested top-level goals", () => {
    const store = new Store(":memory:");
    try {
      const workflowWithGoal = store.createWorkflow({
        name: "workflow-with-goal",
        goal: { objective: "Complete the workflow" },
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });

      expect(() =>
        store.createLoop({
          name: "nested-goal-loop",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "workflow", workflowId: workflowWithGoal.id },
          goal: { objective: "Complete the loop" },
        }),
      ).toThrow("remove one goal wrapper");

      const workflowWithoutGoal = store.createWorkflow({
        name: "workflow-without-goal",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop({
        name: "loop-goal-only",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "workflow", workflowId: workflowWithoutGoal.id },
        goal: { objective: "Complete the loop" },
      });

      expect(() => store.retargetWorkflowLoop(loop.id, workflowWithGoal.id)).toThrow("both define top-level goals");
      expect(() =>
        store.createAndRetargetWorkflowLoop(loop.id, {
          name: "replacement-with-goal",
          goal: { objective: "Complete the replacement workflow" },
          steps: [{ id: "worker", target: { type: "command", command: "true" } }],
        }),
      ).toThrow("also defines a top-level goal");
    } finally {
      store.close();
    }
  });

  test("clears active admission work items when a workflow loop fails before a workflow run exists", () => {
    const store = new Store(":memory:");
    try {
      const invocation = store.createWorkflowInvocation({
        templateId: "todos-task-worker-verifier",
        sourceRef: { kind: "event", id: "evt-preflight-fail", dedupeKey: "todos-task:preflight-fail:task.created" },
        subjectRef: { kind: "task", id: "preflight-fail", path: "/tmp/open-loops" },
        intent: "route",
        scope: { projectPath: "/tmp/open-loops" },
      });
      const workItem = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:preflight-fail:task.created",
        invocationId: invocation.id,
        sourceType: "task.created",
        sourceRef: "evt-preflight-fail",
        subjectRef: "preflight-fail",
        projectKey: "/tmp/open-loops",
      });
      const workflow = store.createWorkflow({
        name: "preflight-fail-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop({
        name: "preflight-fail-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: {
          type: "workflow",
          workflowId: workflow.id,
          input: {
            workflowInvocationId: invocation.id,
            workflowWorkItemId: workItem.id,
          },
        },
        maxAttempts: 1,
      });
      store.admitWorkflowWorkItem(workItem.id, { workflowId: workflow.id, loopId: loop.id });
      expect(store.countActiveWorkflowWorkItems({ projectKey: "/tmp/open-loops" }).project).toBe(1);

      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.finalizeRun(
        claim!.run.id,
        {
          status: "failed",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: "",
          stderr: "",
          error: "runtime preflight failed before workflow run creation",
        },
        { claimedBy: "runner", claimToken: claim!.claimToken, now: new Date("2026-01-01T00:00:00.500Z") },
      );

      expect(store.getWorkflowWorkItem(workItem.id)?.status).toBe("failed");
      expect(store.countActiveWorkflowWorkItems({ projectKey: "/tmp/open-loops" }).project).toBe(0);
      expect(store.getWorkflow(workflow.id)?.status).toBe("archived");
    } finally {
      store.close();
    }
  });

  test("terminal admission work items require explicit requeue before replaying stale loop links", () => {
    const store = new Store(":memory:");
    try {
      const firstInvocation = store.createWorkflowInvocation({
        sourceRef: { kind: "event", id: "evt-terminal-a", dedupeKey: "todos-task:terminal:task.created" },
        subjectRef: { kind: "task", id: "terminal", path: "/tmp/open-loops" },
        intent: "route",
        scope: { projectPath: "/tmp/open-loops" },
      });
      const workItem = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:terminal:task.created",
        invocationId: firstInvocation.id,
        sourceType: "task.created",
        sourceRef: "evt-terminal-a",
        subjectRef: "terminal",
        projectKey: "/tmp/open-loops",
      });
      const workflow = store.createWorkflow({
        name: "terminal-replay-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop({
        name: "terminal-replay-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "workflow", workflowId: workflow.id },
      });
      const admitted = store.admitWorkflowWorkItem(workItem.id, { workflowId: workflow.id, loopId: loop.id });
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"))!;
      store.finalizeRun(
        claim.run.id,
        {
          status: "failed",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: "",
          stderr: "",
          error: "first attempt failed",
        },
        { claimedBy: "runner", claimToken: claim.claimToken, now: new Date("2026-01-01T00:00:00.500Z") },
      );
      expect(store.getWorkflowWorkItem(admitted.id)?.status).toBe("failed");

      const secondInvocation = store.createWorkflowInvocation({
        sourceRef: { kind: "event", id: "evt-terminal-b", dedupeKey: "todos-task:terminal:task.created" },
        subjectRef: { kind: "task", id: "terminal", path: "/tmp/open-loops" },
        intent: "route",
        scope: { projectPath: "/tmp/open-loops" },
      });
      const directReplay = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:terminal:task.created",
        invocationId: secondInvocation.id,
        sourceType: "task.created",
        sourceRef: "evt-terminal-b",
        subjectRef: "terminal",
        projectKey: "/tmp/open-loops",
      });

      expect(directReplay.id).toBe(workItem.id);
      expect(directReplay.status).toBe("failed");
      expect(directReplay.loopId).toBe(loop.id);
      expect(() => store.refreshWorkflowInvocationForWorkItem(directReplay.id, {
        sourceRef: { kind: "event", id: "evt-terminal-b", dedupeKey: "todos-task:terminal:task.created" },
        subjectRef: { kind: "task", id: "terminal", path: "/tmp/open-loops" },
        intent: "route",
        scope: { projectPath: "/tmp/open-loops" },
      })).toThrow("not refreshable");

      const requeued = store.requeueWorkflowWorkItem(workItem.id, { reason: "fixed failing route" });
      expect(requeued.status).toBe("queued");
      expect(requeued.loopId).toBeUndefined();
      expect(requeued.lastReason).toBe("fixed failing route");

      const replayed = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:terminal:task.created",
        invocationId: secondInvocation.id,
        sourceType: "task.created",
        sourceRef: "evt-terminal-b",
        subjectRef: "terminal",
        projectKey: "/tmp/open-loops",
      });

      expect(replayed.id).toBe(workItem.id);
      expect(replayed.status).toBe("queued");
      expect(replayed.loopId).toBeUndefined();
      expect(replayed.workflowId).toBeUndefined();
      expect(replayed.workflowRunId).toBeUndefined();
      store.refreshWorkflowInvocationForWorkItem(replayed.id, {
        sourceRef: { kind: "event", id: "evt-terminal-b", dedupeKey: "todos-task:terminal:task.created" },
        subjectRef: { kind: "task", id: "terminal", path: "/tmp/open-loops" },
        intent: "route",
        scope: { projectPath: "/tmp/open-loops" },
      });
      const nextLoop = store.createLoop({
        name: "terminal-replay-loop-b",
        schedule: { type: "once", at: "2026-01-01T00:01:00Z" },
        target: { type: "workflow", workflowId: workflow.id },
      });
      const readmitted = store.admitWorkflowWorkItem(replayed.id, {
        workflowId: workflow.id,
        loopId: nextLoop.id,
        reason: "admitted by terminal replay",
      });
      expect(readmitted.status).toBe("admitted");
      expect(readmitted.attempts).toBe(2);
      expect(readmitted.lastReason).toBe("fixed failing route; admitted by terminal replay");
    } finally {
      store.close();
    }
  });

  test("deduped workflow invocations refresh routing metadata only through replayable work items", () => {
    const store = new Store(":memory:");
    try {
      const first = store.createWorkflowInvocation({
        templateId: "todos-task-worker-verifier",
        sourceRef: { kind: "event", id: "evt-route-old", dedupeKey: "todos-task:reroute" },
        subjectRef: { kind: "task", id: "reroute", path: "/tmp/open-codewith" },
        intent: "route",
        scope: { projectPath: "/tmp/open-codewith", accountPolicy: "single" },
        outputPolicy: { report: "always", createTask: "on_failure" },
      });
      const workItem = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:reroute",
        invocationId: first.id,
        sourceType: "task.created",
        sourceRef: "evt-route-old",
        subjectRef: "reroute",
        projectKey: "/tmp/open-codewith",
      });

      const second = store.createWorkflowInvocation({
        templateId: "task-lifecycle",
        sourceRef: { kind: "event", id: "evt-route-new", dedupeKey: "todos-task:reroute" },
        subjectRef: { kind: "task", id: "reroute", path: "/tmp/open-codewith", raw: { title: "Updated title" } },
        intent: "route",
        scope: { projectPath: "/tmp/open-codewith", accountPolicy: "pool", worktreePolicy: "required" },
        outputPolicy: { report: "always", createTask: "on_actionable" },
      });

      expect(second.id).toBe(first.id);
      expect(second.templateId).toBe("todos-task-worker-verifier");
      expect(second.sourceRef.id).toBe("evt-route-old");

      const refreshed = store.refreshWorkflowInvocationForWorkItem(workItem.id, {
        templateId: "task-lifecycle",
        sourceRef: { kind: "event", id: "evt-route-new", dedupeKey: "todos-task:reroute" },
        subjectRef: { kind: "task", id: "reroute", path: "/tmp/open-codewith", raw: { title: "Updated title" } },
        intent: "route",
        scope: { projectPath: "/tmp/open-codewith", accountPolicy: "pool", worktreePolicy: "required" },
        outputPolicy: { report: "always", createTask: "on_actionable" },
      });

      expect(refreshed.id).toBe(first.id);
      expect(refreshed.templateId).toBe("task-lifecycle");
      expect(refreshed.sourceRef.id).toBe("evt-route-new");
      expect(refreshed.subjectRef.raw).toEqual({ title: "Updated title" });
      expect(refreshed.scope).toMatchObject({ accountPolicy: "pool", worktreePolicy: "required" });
      expect(refreshed.outputPolicy?.createTask).toBe("on_actionable");
      expect(new Date(refreshed.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(first.updatedAt).getTime());
    } finally {
      store.close();
    }
  });

  test("workflow invocation refresh rejects active and terminal work item history", () => {
    const store = new Store(":memory:");
    try {
      const refreshInput = {
        templateId: "task-lifecycle",
        sourceRef: { kind: "event" as const, id: "evt-route-new", dedupeKey: "todos-task:stable" },
        subjectRef: { kind: "task" as const, id: "stable", path: "/tmp/open-codewith", raw: { title: "Updated title" } },
        intent: "route" as const,
        scope: { projectPath: "/tmp/open-codewith", accountPolicy: "pool" },
        outputPolicy: { report: "always" as const, createTask: "on_actionable" as const },
      };
      const invocation = store.createWorkflowInvocation({
        templateId: "todos-task-worker-verifier",
        sourceRef: { kind: "event", id: "evt-route-old", dedupeKey: "todos-task:stable" },
        subjectRef: { kind: "task", id: "stable", path: "/tmp/open-codewith" },
        intent: "route",
        scope: { projectPath: "/tmp/open-codewith", accountPolicy: "single" },
        outputPolicy: { report: "always", createTask: "on_failure" },
      });
      const workItem = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:stable",
        invocationId: invocation.id,
        sourceType: "task.created",
        sourceRef: "evt-route-old",
        subjectRef: "stable",
        projectKey: "/tmp/open-codewith",
      });
      const workflow = store.createWorkflow({
        name: "stable-history-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop({
        name: "stable-history-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: {
          type: "workflow",
          workflowId: workflow.id,
          input: {
            workflowInvocationId: invocation.id,
            workflowWorkItemId: workItem.id,
          },
        },
      });
      store.admitWorkflowWorkItem(workItem.id, { workflowId: workflow.id, loopId: loop.id });

      expect(() => store.refreshWorkflowInvocationForWorkItem(workItem.id, refreshInput)).toThrow("not refreshable");
      expect(store.getWorkflowInvocation(invocation.id)?.templateId).toBe("todos-task-worker-verifier");

      const run = store.createWorkflowRun({ workflow, loop, scheduledFor: "2026-01-01T00:00:00.000Z" });
      store.finalizeWorkflowRun(run.id, "succeeded");
      expect(() => store.refreshWorkflowInvocationForWorkItem(workItem.id, refreshInput)).toThrow("not refreshable");
      expect(store.getWorkflowInvocation(invocation.id)?.templateId).toBe("todos-task-worker-verifier");
    } finally {
      store.close();
    }
  });

  test("archives loops without deleting run history and hides them from default lists", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "archive-me",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
        },
        new Date("2026-01-01T00:00:00Z"),
      );
      const dueSlot = loop.nextRunAt!;
      const claim = store.claimRun(loop, dueSlot, "seed", new Date(dueSlot));
      expect(claim).toBeDefined();
      store.finalizeRun(
        claim!.run.id,
        {
          status: "succeeded",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: "seed",
          stderr: "",
        },
        { claimedBy: "seed", claimToken: claim!.claimToken, now: new Date("2026-01-01T00:00:01Z") },
      );

      const archived = store.archiveLoop(loop.id);
      expect(archived.status).toBe("paused");
      expect(archived.archivedAt).toBeDefined();
      expect(archived.archivedFromStatus).toBe("active");
      expect(archived.nextRunAt).toBe(dueSlot);
      expect(store.listLoops()).toHaveLength(0);
      expect(store.listLoops({ archived: true }).map((entry) => entry.id)).toEqual([loop.id]);
      expect(store.listLoops({ includeArchived: true }).map((entry) => entry.id)).toEqual([loop.id]);
      expect(store.countLoops()).toBe(0);
      expect(store.countLoops(undefined, { archived: true })).toBe(1);
      expect(store.listRuns({ loopId: loop.id })).toHaveLength(1);
      expect(store.claimRun(archived, "2026-01-01T00:02:00.000Z", "manual", new Date("2026-01-01T00:02:00Z"))).toBeUndefined();

      const unarchived = store.unarchiveLoop(loop.id);
      expect(unarchived.status).toBe("active");
      expect(unarchived.archivedAt).toBeUndefined();
      expect(unarchived.archivedFromStatus).toBeUndefined();
      expect(store.listLoops().map((entry) => entry.id)).toEqual([loop.id]);
    } finally {
      store.close();
    }
  });

  test("recovers expired run leases as abandoned", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "lease",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
          leaseMs: 10,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "test", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      const recovered = store.recoverExpiredRunLeases(new Date("2026-01-01T00:00:01Z"));
      expect(recovered).toHaveLength(1);
      expect(recovered[0]?.status).toBe("abandoned");
    } finally {
      store.close();
    }
  });

  test("archives generated route workflows when expired lease recovery fails their workflow run", () => {
    const store = new Store(":memory:");
    try {
      const invocation = store.createWorkflowInvocation({
        templateId: "todos-task-worker-verifier",
        sourceRef: { kind: "event", id: "evt-lease-route", dedupeKey: "todos-task:lease-route" },
        subjectRef: { kind: "task", id: "lease-route", path: "/tmp/open-loops" },
        intent: "route",
        scope: { projectPath: "/tmp/open-loops" },
      });
      const workItem = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:lease-route",
        invocationId: invocation.id,
        sourceType: "task.created",
        sourceRef: "evt-lease-route",
        subjectRef: "lease-route",
        projectKey: "/tmp/open-loops",
      });
      const workflow = store.createWorkflow({
        name: "lease-route-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop(
        {
          name: "lease-route-loop",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: {
            type: "workflow",
            workflowId: workflow.id,
            input: {
              workflowInvocationId: invocation.id,
              workflowWorkItemId: workItem.id,
            },
          },
          leaseMs: 10,
          maxAttempts: 1,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      store.admitWorkflowWorkItem(workItem.id, { workflowId: workflow.id, loopId: loop.id });
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      const workflowRun = store.createWorkflowRun({ workflow, loop, loopRun: claim!.run });

      const recovered = store.recoverExpiredRunLeases(new Date("2026-01-01T00:00:01Z"));

      expect(recovered).toHaveLength(1);
      expect(store.getWorkflowRun(workflowRun.id)?.status).toBe("failed");
      expect(store.getWorkflowWorkItem(workItem.id)?.status).toBe("failed");
      expect(store.getWorkflow(workflow.id)?.status).toBe("archived");
      expect(store.listWorkflowEvents(workflowRun.id).map((event) => event.eventType)).toContain("workflow_archived");
    } finally {
      store.close();
    }
  });

  test("keeps generated route workflows active when expired lease recovery is retryable", () => {
    const store = new Store(":memory:");
    try {
      const invocation = store.createWorkflowInvocation({
        templateId: "todos-task-worker-verifier",
        sourceRef: { kind: "event", id: "evt-lease-route-retry", dedupeKey: "todos-task:lease-route-retry" },
        subjectRef: { kind: "task", id: "lease-route-retry", path: "/tmp/open-loops" },
        intent: "route",
        scope: { projectPath: "/tmp/open-loops" },
      });
      const workItem = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:lease-route-retry",
        invocationId: invocation.id,
        sourceType: "task.created",
        sourceRef: "evt-lease-route-retry",
        subjectRef: "lease-route-retry",
        projectKey: "/tmp/open-loops",
      });
      const workflow = store.createWorkflow({
        name: "lease-route-retry-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop(
        {
          name: "lease-route-retry-loop",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: {
            type: "workflow",
            workflowId: workflow.id,
            input: {
              workflowInvocationId: invocation.id,
              workflowWorkItemId: workItem.id,
            },
          },
          leaseMs: 10,
          maxAttempts: 2,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      store.admitWorkflowWorkItem(workItem.id, { workflowId: workflow.id, loopId: loop.id });
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      const workflowRun = store.createWorkflowRun({ workflow, loop, loopRun: claim!.run });

      const recovered = store.recoverExpiredRunLeases(new Date("2026-01-01T00:00:01Z"));

      expect(recovered).toHaveLength(1);
      expect(store.getWorkflowRun(workflowRun.id)?.status).toBe("failed");
      expect(store.getWorkflowWorkItem(workItem.id)?.status).toBe("admitted");
      expect(store.getWorkflow(workflow.id)?.status).toBe("active");
      expect(store.listWorkflowEvents(workflowRun.id).map((event) => event.eventType))
        .not.toContain("workflow_archived");
    } finally {
      store.close();
    }
  });

  test("recovers expired run leases in bounded batches", () => {
    const store = new Store(":memory:");
    try {
      const loops = [0, 1, 2].map((index) =>
        store.createLoop(
          {
            name: `expired-batch-${index}`,
            schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
            target: { type: "command", command: "true" },
            leaseMs: 10,
          },
          new Date("2025-12-31T00:00:00Z"),
        ),
      );
      for (const loop of loops) {
        expect(store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"))).toBeDefined();
      }

      const recovered = store.recoverExpiredRunLeases(new Date("2026-01-01T00:00:01Z"), { limit: 2 });
      expect(recovered).toHaveLength(2);
      expect(store.listRuns({ status: "abandoned" })).toHaveLength(2);
      expect(store.listRuns({ status: "running" })).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("expired run recovery does not starve behind live expired rows", () => {
    const store = new Store(":memory:");
    try {
      const loops = [0, 1, 2].map((index) =>
        store.createLoop(
          {
            name: `expired-live-scan-${index}`,
            schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
            target: { type: "command", command: "true" },
            leaseMs: 10,
          },
          new Date("2025-12-31T00:00:00Z"),
        ),
      );
      const claims = loops.map((loop) =>
        store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"))!,
      );
      store.markRunPid(claims[0]!.run.id, process.pid, "runner", { claimToken: claims[0]!.claimToken });
      store.markRunPid(claims[1]!.run.id, process.pid, "runner", { claimToken: claims[1]!.claimToken });

      const recovered = store.recoverExpiredRunLeases(new Date("2026-01-01T00:00:01Z"), { limit: 1, scanLimit: 3 });
      expect(recovered).toHaveLength(1);
      expect(recovered[0]?.id).toBe(claims[2]!.run.id);
      expect(store.getRun(claims[0]!.run.id)?.leaseExpiresAt).toBe("2026-01-01T00:01:01.000Z");
      expect(store.getRun(claims[1]!.run.id)?.leaseExpiresAt).toBe("2026-01-01T00:01:01.000Z");
    } finally {
      store.close();
    }
  });

  test("only one connection can claim a scheduled slot", () => {
    const path = `${process.env.TMPDIR ?? "/tmp"}/loops-claim-${Date.now()}-${Math.random()}.db`;
    const first = new Store(path);
    const second = new Store(path);
    try {
      const loop = first.createLoop(
        {
          name: "race",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const slot = "2026-01-01T00:00:00.000Z";
      const claimA = first.claimRun(loop, slot, "a");
      const claimB = second.claimRun(loop, slot, "b");
      expect([claimA, claimB].filter(Boolean)).toHaveLength(1);
      expect(first.listRuns({ loopId: loop.id })).toHaveLength(1);
    } finally {
      first.close();
      second.close();
    }
  });

  test("daemon heartbeat returns undefined after lease takeover", () => {
    const store = new Store(":memory:");
    try {
      const first = store.acquireDaemonLease({
        id: "first",
        pid: 1,
        hostname: "host",
        ttlMs: 100,
        now: new Date("2026-01-01T00:00:00Z"),
      });
      expect(first?.id).toBe("first");
      const second = store.acquireDaemonLease({
        id: "second",
        pid: 2,
        hostname: "host",
        ttlMs: 1_000,
        now: new Date("2026-01-01T00:00:01Z"),
      });
      expect(second?.id).toBe("second");
      expect(store.heartbeatDaemonLease("first", 1_000, new Date("2026-01-01T00:00:02Z"))).toBeUndefined();
    } finally {
      store.close();
    }
  });

  test("daemon heartbeat cannot revive an expired lease", () => {
    const store = new Store(":memory:");
    try {
      expect(
        store.acquireDaemonLease({
          id: "expired",
          pid: 1,
          hostname: "host",
          ttlMs: 10,
          now: new Date("2026-01-01T00:00:00Z"),
        })?.id,
      ).toBe("expired");
      expect(store.heartbeatDaemonLease("expired", 1_000, new Date("2026-01-01T00:00:01Z"))).toBeUndefined();
      expect(
        store.acquireDaemonLease({
          id: "new-owner",
          pid: 2,
          hostname: "host",
          ttlMs: 1_000,
          now: new Date("2026-01-01T00:00:01Z"),
        })?.id,
      ).toBe("new-owner");
    } finally {
      store.close();
    }
  });

  test("run heartbeat cannot revive an expired run lease", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "run-heartbeat",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
          leaseMs: 10,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      expect(store.heartbeatRunLease(claim!.run.id, "runner", 1_000, new Date("2026-01-01T00:00:01Z"))).toBeUndefined();
      expect(() => store.finalizeRun(
        claim!.run.id,
        {
          status: "succeeded",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: "late",
          stderr: "",
        },
        { claimedBy: "runner", now: new Date("2026-01-01T00:00:01Z") },
      )).toThrow(RunFinalizationConflictError);
      expect(store.getRun(claim!.run.id)).toMatchObject({
        status: "running",
        stdout: undefined,
      });
    } finally {
      store.close();
    }
  });

  test("fenced run heartbeat cannot extend after daemon lease loss", () => {
    const store = new Store(":memory:");
    try {
      expect(
        store.acquireDaemonLease({
          id: "daemon",
          pid: 1,
          hostname: "host",
          ttlMs: 60_000,
          now: new Date("2026-01-01T00:00:00Z"),
        })?.id,
      ).toBe("daemon");
      const loop = store.createLoop(
        {
          name: "daemon-heartbeat",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
          leaseMs: 60_000,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(
        loop,
        "2026-01-01T00:00:00.000Z",
        "runner",
        new Date("2026-01-01T00:00:00Z"),
        { daemonLeaseId: "daemon" },
      );
      expect(claim).toBeDefined();

      store.releaseDaemonLease("daemon");
      expect(
        store.heartbeatRunLease(claim!.run.id, "runner", 60_000, new Date("2026-01-01T00:00:10Z"), {
          daemonLeaseId: "daemon",
        }),
      ).toBeUndefined();
      expect(store.getRun(claim!.run.id)?.leaseExpiresAt).toBe("2026-01-01T00:01:00.000Z");
    } finally {
      store.close();
    }
  });

  test("fenced run finalization cannot write after daemon lease loss", () => {
    const store = new Store(":memory:");
    try {
      expect(
        store.acquireDaemonLease({
          id: "daemon",
          pid: 1,
          hostname: "host",
          ttlMs: 60_000,
        })?.id,
      ).toBe("daemon");
      const loop = store.createLoop(
        {
          name: "daemon-fenced-run",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
          leaseMs: 60_000,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();

      store.releaseDaemonLease("daemon");
      expect(() => store.finalizeRun(
        claim!.run.id,
        {
          status: "succeeded",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: "late",
          stderr: "",
        },
        { claimedBy: "runner", daemonLeaseId: "daemon", now: new Date("2026-01-01T00:00:01Z") },
      )).toThrow(RunFinalizationConflictError);
      expect(store.getRun(claim!.run.id)).toMatchObject({
        status: "running",
        stdout: undefined,
        finishedAt: undefined,
      });
    } finally {
      store.close();
    }
  });

  test("fenced loop updates cannot mutate workflow work items after daemon lease loss", () => {
    const store = new Store(":memory:");
    try {
      expect(
        store.acquireDaemonLease({
          id: "daemon",
          pid: 1,
          hostname: "host",
          ttlMs: 60_000,
        })?.id,
      ).toBe("daemon");
      const invocation = store.createWorkflowInvocation({
        sourceRef: { kind: "event", id: "evt-loop-fence", dedupeKey: "todos-task:loop-fence" },
        subjectRef: { kind: "task", id: "loop-fence", path: "/tmp/open-loops" },
        intent: "route",
        scope: { projectPath: "/tmp/open-loops" },
      });
      const workItem = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:loop-fence",
        invocationId: invocation.id,
        sourceType: "task.created",
        sourceRef: "evt-loop-fence",
        subjectRef: "loop-fence",
        projectKey: "/tmp/open-loops",
      });
      const workflow = store.createWorkflow({
        name: "loop-fence-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop({
        name: "loop-fence-run",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: {
          type: "workflow",
          workflowId: workflow.id,
          input: {
            workflowInvocationId: invocation.id,
            workflowWorkItemId: workItem.id,
          },
        },
      });
      store.admitWorkflowWorkItem(workItem.id, { workflowId: workflow.id, loopId: loop.id });

      store.releaseDaemonLease("daemon");
      expect(() => store.updateLoop(loop.id, { status: "paused" }, { daemonLeaseId: "daemon" })).toThrow("daemon lease lost");
      expect(store.getLoop(loop.id)?.status).toBe("active");
      expect(store.getWorkflowWorkItem(workItem.id)?.status).toBe("admitted");
    } finally {
      store.close();
    }
  });

  test("fenced workflow finalization cannot write after daemon lease loss", () => {
    const store = new Store(":memory:");
    try {
      expect(
        store.acquireDaemonLease({
          id: "daemon",
          pid: 1,
          hostname: "host",
          ttlMs: 60_000,
        })?.id,
      ).toBe("daemon");
      const workflow = store.createWorkflow({
        name: "daemon-fenced-workflow",
        steps: [
          {
            id: "step-one",
            target: { type: "command", command: "true" },
          },
        ],
      });
      const run = store.createWorkflowRun({ workflow, daemonLeaseId: "daemon" });
      const startedStep = store.startWorkflowStepRun(run.id, "step-one", {
        daemonLeaseId: "daemon",
      });
      expect(startedStep.status).toBe("running");

      store.releaseDaemonLease("daemon");
      const finalStep = store.finalizeWorkflowStepRun(
        run.id,
        "step-one",
        {
          status: "succeeded",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: "late",
          stderr: "",
          exitCode: 0,
        },
        { daemonLeaseId: "daemon" },
      );
      const finalRun = store.finalizeWorkflowRun(
        run.id,
        "succeeded",
        {
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
        },
        { daemonLeaseId: "daemon" },
      );

      expect(finalStep.status).toBe("running");
      expect(finalStep.stdout).toBeUndefined();
      expect(finalStep.finishedAt).toBeUndefined();
      expect(finalRun.status).toBe("running");
      expect(finalRun.finishedAt).toBeUndefined();
      expect(store.listWorkflowEvents(run.id).map((event) => event.eventType)).not.toContain("step_succeeded");
      expect(store.listWorkflowEvents(run.id).map((event) => event.eventType)).not.toContain("succeeded");
    } finally {
      store.close();
    }
  });

  test("fenced finalization cannot overwrite an abandoned expired run", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "fenced",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
          leaseMs: 10,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.recoverExpiredRunLeases(new Date("2026-01-01T00:00:01Z"));
      expect(() => store.finalizeRun(
        claim!.run.id,
        {
          status: "succeeded",
          finishedAt: "2026-01-01T00:00:02.000Z",
          durationMs: 2_000,
          stdout: "late",
          stderr: "",
        },
        { claimedBy: "runner", now: new Date("2026-01-01T00:00:02Z") },
      )).toThrow(RunFinalizationConflictError);
      expect(store.getRun(claim!.run.id)).toMatchObject({
        status: "abandoned",
        stdout: undefined,
      });
    } finally {
      store.close();
    }
  });

  test("persists goal state and fences goal mutators with the daemon lease", () => {
    const store = new Store(":memory:");
    try {
      expect(
        store.acquireDaemonLease({
          id: "daemon",
          pid: 1,
          hostname: "host",
          ttlMs: 60_000,
        })?.id,
      ).toBe("daemon");

      const goal = store.createGoal(
        {
          objective: "ship goal support",
          tokenBudget: 100,
          autoExecute: "readyOnly",
          maxTokens: 100,
        },
        { daemonLeaseId: "daemon" },
      );
      store.createGoalPlanNodes(
        goal.goalId,
        [
          { key: "plan", objective: "write a plan" },
          { key: "verify", objective: "verify the plan", dependsOn: ["plan"], priority: 10 },
        ],
        { daemonLeaseId: "daemon" },
      );
      store.recordGoalEvent(
        {
          goalId: goal.goalId,
          phase: "plan",
          status: "active",
          tokensUsed: 10,
          evidence: { planned: true },
        },
        { daemonLeaseId: "daemon" },
      );

      expect(store.getGoal(goal.goalId)?.objective).toBe("ship goal support");
      expect(store.listGoalPlanNodes(goal.goalId).map((node) => node.key)).toEqual(["plan", "verify"]);
      expect(store.listGoalRuns({ goalId: goal.goalId })[0]?.phase).toBe("plan");

      store.releaseDaemonLease("daemon");
      expect(() =>
        store.recordGoalEvent(
          {
            goalId: goal.goalId,
            phase: "validate",
            status: "complete",
          },
          { daemonLeaseId: "daemon" },
        ),
      ).toThrow("daemon lease lost");
    } finally {
      store.close();
    }
  });

  test("migrate is idempotent — re-running issues no ALTER TABLE ADD COLUMN once columns exist", () => {
    const store = new Store(":memory:");
    try {
      // The constructor already ran migrate() once, so every additive column
      // now exists. Re-running migrate() must NOT issue an `ALTER TABLE ... ADD
      // COLUMN` for an existing column — doing so makes SQLite log a
      // "duplicate column name" error (libsqlite3 logs it before JS can catch
      // it), which is the noise this regression guards against.
      const internal = store as unknown as {
        db: { query: (sql: string) => { run: (...a: unknown[]) => unknown; all: () => unknown } };
        migrate: () => void;
      };
      const issued: string[] = [];
      const originalQuery = internal.db.query.bind(internal.db);
      internal.db.query = ((sql: string) => {
        issued.push(sql);
        return originalQuery(sql);
      }) as typeof internal.db.query;
      try {
        internal.migrate();
      } finally {
        internal.db.query = originalQuery as typeof internal.db.query;
      }
      const offending = issued.filter((sql) => /ALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN/i.test(sql));
      expect(offending).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("migrates legacy workflow_runs before creating invocation indexes", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-legacy-workflow-runs-"));
    const dbFile = join(root, "loops.db");
    const legacy = new Database(dbFile);
    try {
      legacy.exec(`
        CREATE TABLE workflow_runs (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL,
          workflow_name TEXT NOT NULL,
          loop_id TEXT,
          loop_run_id TEXT,
          scheduled_for TEXT,
          idempotency_key TEXT,
          status TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          duration_ms INTEGER,
          error TEXT,
          goal_run_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    } finally {
      legacy.close();
    }

    const store = new Store(dbFile);
    try {
      const columns = store["db"].query("PRAGMA table_info(workflow_runs)").all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toContain("invocation_id");
      expect(columns.map((column) => column.name)).toContain("work_item_id");
      expect(columns.map((column) => column.name)).toContain("manifest_path");
      const indexes = store["db"].query("PRAGMA index_list(workflow_runs)").all() as Array<{ name: string }>;
      expect(indexes.map((index) => index.name)).toContain("idx_workflow_runs_invocation");
      expect(indexes.map((index) => index.name)).toContain("idx_workflow_runs_work_item");
    } finally {
      store.close();
    }
  });

  test("throws coded errors for missing and ambiguous loops", () => {
    const store = new Store(":memory:");
    try {
      expect(() => store.requireLoop("missing-loop")).toThrow(LoopNotFoundError);
      expect(() => store.requireUniqueLoop("missing-loop")).toThrow(LoopNotFoundError);
      const input = {
        name: "same-name",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" } as const,
        target: { type: "command", command: "true" } as const,
      };
      const first = store.createLoop(input, new Date("2025-12-31T00:00:00Z"));
      store.createLoop(input, new Date("2025-12-31T00:00:01Z"));
      expect(() => store.requireUniqueLoop("same-name")).toThrow(AmbiguousNameError);
      try {
        store.requireUniqueLoop("same-name");
      } catch (error) {
        expect((error as AmbiguousNameError).code).toBe("AMBIGUOUS_NAME");
      }
      // An archived same-named loop must not count toward ambiguity: archiving
      // one of the two duplicates leaves a single active loop that resolves.
      store.archiveLoop(first.id);
      expect(store.requireUniqueLoop("same-name").id).not.toBe(first.id);
      // Even a single active loop plus an archived namesake resolves cleanly.
      const solo = store.createLoop(
        { ...input, name: "solo-name" },
        new Date("2025-12-31T00:00:02Z"),
      );
      const archivedNamesake = store.createLoop(
        { ...input, name: "solo-name" },
        new Date("2025-12-31T00:00:03Z"),
      );
      store.archiveLoop(archivedNamesake.id);
      expect(store.requireUniqueLoop("solo-name").id).toBe(solo.id);
      // A uniquely-named loop still resolves after it is archived (so the caller
      // can report "loop is archived" rather than "loop not found").
      const lone = store.createLoop({ ...input, name: "lone-name" }, new Date("2025-12-31T00:00:04Z"));
      store.archiveLoop(lone.id);
      expect(store.requireUniqueLoop("lone-name").id).toBe(lone.id);
      try {
        store.requireLoop("missing-loop");
      } catch (error) {
        expect((error as LoopNotFoundError).code).toBe("LOOP_NOT_FOUND");
      }
    } finally {
      store.close();
    }
  });

  test("archive and unarchive fail closed on ambiguous names while ids stay exact", () => {
    const store = new Store(":memory:");
    try {
      const input = {
        name: "archive-ambiguous",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" } as const,
        target: { type: "command", command: "true" } as const,
      };
      const first = store.createLoop(input, new Date("2025-12-31T00:00:00Z"));
      const second = store.createLoop(input, new Date("2025-12-31T00:00:01Z"));

      expect(() => store.archiveLoop(input.name)).toThrow(AmbiguousNameError);
      expect(store.getLoop(first.id)?.archivedAt).toBeUndefined();
      expect(store.getLoop(second.id)?.archivedAt).toBeUndefined();

      expect(store.archiveLoop(first.id).id).toBe(first.id);
      expect(store.archiveLoop(input.name).id).toBe(second.id);
      expect(store.getLoop(first.id)?.archivedAt).toBeString();
      expect(store.getLoop(second.id)?.archivedAt).toBeString();

      expect(() => store.unarchiveLoop(input.name)).toThrow(AmbiguousNameError);
      expect(store.getLoop(first.id)?.archivedAt).toBeString();
      expect(store.getLoop(second.id)?.archivedAt).toBeString();

      expect(store.unarchiveLoop(first.id).id).toBe(first.id);
      expect(store.getLoop(first.id)?.archivedAt).toBeUndefined();
      expect(store.getLoop(second.id)?.archivedAt).toBeString();
      // Reviewer reproduction: the active namesake must not mask the sole
      // archived candidate during operation-specific unarchive resolution.
      expect(store.unarchiveLoop(input.name).id).toBe(second.id);
      expect(store.getLoop(first.id)?.archivedAt).toBeUndefined();
      expect(store.getLoop(second.id)?.archivedAt).toBeUndefined();

      // Exact ids remain idempotent even when same-named rows exist.
      expect(store.unarchiveLoop(first.id).id).toBe(first.id);
      expect(store.archiveLoop(second.id).id).toBe(second.id);
      const archivedAt = store.getLoop(second.id)?.archivedAt;
      expect(store.archiveLoop(second.id).archivedAt).toBe(archivedAt);
    } finally {
      store.close();
    }
  });

  test("rejects mutations of archived loops until they are unarchived", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "archive-guard",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      store.archiveLoop(loop.id);
      expect(() => store.updateLoop(loop.id, { status: "active" })).toThrow(LoopArchivedError);
      try {
        store.updateLoop(loop.id, { status: "active" });
      } catch (error) {
        expect((error as LoopArchivedError).code).toBe("LOOP_ARCHIVED");
      }
      store.unarchiveLoop(loop.id);
      expect(store.updateLoop(loop.id, { status: "paused" }).status).toBe("paused");
    } finally {
      store.close();
    }
  });

  test("stamps gated migrations once and records the schema user_version", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-migration-ledger-"));
    const dbFile = join(root, "loops.db");
    const store = new Store(dbFile);
    let ids: string[];
    try {
      ids = (store["db"].query("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: string }>).map(
        (row) => row.id,
      );
      expect(ids).toEqual([
        "0001_initial_and_workflows",
        "0002_loop_machines",
        "0003_goals",
        "0004_loop_archive_metadata",
        "0005_workflow_invocations_and_admission",
        "0006_run_process_tracking",
        "0007_run_claim_tokens",
        "0008_work_item_route_scope",
        "0009_run_receipts",
        "0010_work_item_machine_id",
        "0011_work_item_gate_deaths",
        "0012_workflow_run_provenance",
        "0013_loop_labels",
        "0014_run_defer_ceiling_and_step_process_fingerprint",
        "0015_loop_mutation_contract",
        "0016_loop_expires_after_runs",
      ]);
      const version = store["db"].query("PRAGMA user_version").get() as { user_version: number };
      // 0011/0012/0014 are additive and deliberately do NOT bump
      // the schema user_version — older v8 binaries keep opening this database.
      // 0014 adds two nullable/defaulted columns an older binary simply ignores,
      // so it must not lock the fleet's CLIs out mid-rollout.
      expect(version.user_version).toBe(8);
    } finally {
      store.close();
    }
    const reopened = new Store(dbFile);
    try {
      const again = (reopened["db"].query("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: string }>).map(
        (row) => row.id,
      );
      expect(again).toEqual(ids);
    } finally {
      reopened.close();
    }
  });

  test("refuses to open newer databases only on a known-breaking delta", () => {
    // The schema-compat contract (post-2026-07-07 lockout): a database carries
    // its compatibility floor; a newer user_version alone no longer refuses —
    // full soft-open matrix in schema-compat.test.ts. Refusal remains for a
    // floor above this binary (breaking delta)…
    const root = mkdtempSync(join(tmpdir(), "loops-newer-schema-"));
    const dbFile = join(root, "loops.db");
    new Store(dbFile).close();
    const raw = new Database(dbFile);
    try {
      raw.exec("PRAGMA user_version = 99");
      raw.query("UPDATE schema_compat SET min_compatible_user_version = 99 WHERE id = 1").run();
    } finally {
      raw.close();
    }
    expect(() => new Store(dbFile)).toThrow(/requires a binary with schema support >= 99/);

    // …and for a newer database with no floor at all (pre-contract/unblessed).
    const bare = join(root, "loops-bare.db");
    new Store(bare).close();
    const rawBare = new Database(bare);
    try {
      rawBare.exec("PRAGMA user_version = 99");
      rawBare.exec("DROP TABLE schema_compat");
    } finally {
      rawBare.close();
    }
    expect(() => new Store(bare)).toThrow(/newer than this binary supports/);
  });

  test("upgrades version 6 stores before creating claim-token indexes", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-v6-claim-token-"));
    const dbFile = join(root, "loops.db");
    const raw = new Database(dbFile);
    try {
      raw.exec(`
        CREATE TABLE schema_migrations (
          id TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
        CREATE TABLE loop_runs (
          id TEXT PRIMARY KEY,
          loop_id TEXT NOT NULL,
          loop_name TEXT NOT NULL,
          scheduled_for TEXT NOT NULL,
          attempt INTEGER NOT NULL,
          status TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          claimed_by TEXT,
          lease_expires_at TEXT,
          pid INTEGER,
          exit_code INTEGER,
          duration_ms INTEGER,
          stdout TEXT,
          stderr TEXT,
          error TEXT,
          goal_run_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          pgid INTEGER,
          process_started_at TEXT,
          UNIQUE(loop_id, scheduled_for)
        );
        INSERT INTO schema_migrations (id, applied_at) VALUES
          ('0001_initial_and_workflows', '2026-01-01T00:00:00.000Z'),
          ('0002_loop_machines', '2026-01-01T00:00:00.000Z'),
          ('0003_goals', '2026-01-01T00:00:00.000Z'),
          ('0004_loop_archive_metadata', '2026-01-01T00:00:00.000Z'),
          ('0005_workflow_invocations_and_admission', '2026-01-01T00:00:00.000Z'),
          ('0006_run_process_tracking', '2026-01-01T00:00:00.000Z');
        PRAGMA user_version = 6;
      `);
    } finally {
      raw.close();
    }

    const store = new Store(dbFile);
    try {
      const columns = (store["db"].query("PRAGMA table_info(loop_runs)").all() as Array<{ name: string }>).map(
        (column) => column.name,
      );
      expect(columns).toContain("claim_token");
      const indexes = (store["db"].query("PRAGMA index_list(loop_runs)").all() as Array<{ name: string }>).map(
        (index) => index.name,
      );
      expect(indexes).toContain("idx_runs_claim_token");
      const version = store["db"].query("PRAGMA user_version").get() as { user_version: number };
      expect(version.user_version).toBe(8);
      const ids = (store["db"].query("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: string }>).map(
        (row) => row.id,
      );
      expect(ids).toContain("0007_run_claim_tokens");
      expect(ids).toContain("0009_run_receipts");
      expect(store.listRuns()).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("reconciles the live fork with a second 0004_* row and orphan columns", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-fork-reconcile-"));
    const dbFile = join(root, "loops.db");
    new Store(dbFile).close();
    const raw = new Database(dbFile);
    try {
      raw.exec("ALTER TABLE loops ADD COLUMN metadata_json TEXT");
      raw.exec("ALTER TABLE loop_runs ADD COLUMN source TEXT");
      raw
        .query("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)")
        .run("0004_loop_metadata", new Date().toISOString());
    } finally {
      raw.close();
    }
    const store = new Store(dbFile);
    try {
      const ids = (store["db"].query("SELECT id FROM schema_migrations WHERE id LIKE '0004%' ORDER BY id").all() as Array<{
        id: string;
      }>).map((row) => row.id);
      expect(ids).toEqual(["0004_loop_archive_metadata", "0004_loop_metadata"]);
      // Orphan columns are tolerated and never dropped; the store stays usable.
      const columns = (store["db"].query("PRAGMA table_info(loops)").all() as Array<{ name: string }>).map(
        (column) => column.name,
      );
      expect(columns).toContain("metadata_json");
      const loop = store.createLoop(
        {
          name: "fork-survivor",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      expect(store.claimRun(loop, "2026-01-01T00:00:00.000Z", "test")?.run.status).toBe("running");
    } finally {
      store.close();
    }
  });

  test("scrubs credentials from loop run output on finalize", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "scrub-run",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "test");
      const final = store.finalizeRun(claim!.run.id, {
        status: "failed",
        finishedAt: "2026-01-01T00:00:01.000Z",
        durationMs: 1_000,
        stdout: `api key ${ANT_KEY} used`,
        stderr: `export ${FIXTURE_API_KEY}="q7Rt2xVz9LpW4mKe8s"`,
        error: `auth failed with ${GH_PAT}`,
      });
      expect(final.stdout).toBe("api key [SCRUBBED] used");
      expect(final.stderr).toBe(`export ${FIXTURE_API_KEY}="[SCRUBBED]"`);
      expect(final.error).toBe("auth failed with [SCRUBBED]");
      expect(store.getRun(claim!.run.id)?.stdout).not.toContain("sk" + "-ant-");
    } finally {
      store.close();
    }
  });

  test("scrubs credentials from workflow step output and goal evidence", () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "scrub-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const run = store.createWorkflowRun({ workflow });
      store.startWorkflowStepRun(run.id, "worker");
      const step = store.finalizeWorkflowStepRun(run.id, "worker", {
        status: "failed",
        finishedAt: "2026-01-01T00:00:01.000Z",
        durationMs: 1_000,
        stdout: `using ${AWS_KEY} for aws`,
        stderr: `slack ${SLACK_TOKEN} rejected`,
        error: `token ${OPENAI_KEY} expired`,
      });
      expect(step.stdout).toBe("using [SCRUBBED] for aws");
      expect(step.stderr).toBe("slack [SCRUBBED] rejected");
      expect(step.error).toBe("token [SCRUBBED] expired");

      const goal = store.createGoal({ objective: "scrub evidence" });
      store.recordGoalEvent({
        goalId: goal.goalId,
        phase: "execute",
        status: "active",
        evidence: { note: `found ${ANT_KEY} in logs` },
        rawResponse: { text: `use ${GH_PAT}` },
      });
      const event = store.listGoalRuns({ goalId: goal.goalId })[0]!;
      expect(JSON.stringify(event.evidence)).not.toContain("sk" + "-ant-");
      expect(JSON.stringify(event.evidence)).toContain("[SCRUBBED]");
      expect(JSON.stringify(event.rawResponse)).not.toContain("ghp" + "_");

      // Quoted secrets inside evidence strings must be scrubbed BEFORE
      // JSON.stringify escapes the quotes and hides them from the patterns.
      const quoted = store.createGoal({ objective: "scrub quoted evidence" });
      store.recordGoalEvent({
        goalId: quoted.goalId,
        phase: "execute",
        status: "active",
        evidence: { note: `saw export ${FIXTURE_DB_PASSWORD}="x9Kd2mQz7Lp4Rv8t" in output` },
        rawResponse: { result: `export ${FIXTURE_DB_PASSWORD}="x9Kd2mQz7Lp4Rv8t"` },
      });
      const quotedEvent = store.listGoalRuns({ goalId: quoted.goalId })[0]!;
      expect(JSON.stringify(quotedEvent.evidence)).not.toContain("x9Kd2mQz7Lp4Rv8t");
      expect((quotedEvent.evidence as { note: string }).note).toBe(`saw export ${FIXTURE_DB_PASSWORD}="[SCRUBBED]" in output`);
      expect(JSON.stringify(quotedEvent.rawResponse)).not.toContain("x9Kd2mQz7Lp4Rv8t");
    } finally {
      store.close();
    }
  });

  test("scrubs SQLite workflow reasons and errors across recover, skip, finalize, cancel, and skipped runs", () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "scrub-workflow-reasons",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const reason = `operation failed with ${GH_PAT}`;

      const recoveredRun = store.createWorkflowRun({ workflow });
      store.startWorkflowStepRun(recoveredRun.id, "worker");
      const recovered = store.recoverWorkflowRun(recoveredRun.id, reason);
      expect(recovered.recoveredSteps[0]?.error).toBe("operation failed with [SCRUBBED]");
      expect(JSON.stringify(store.listWorkflowEvents(recoveredRun.id))).not.toContain("ghp" + "_");

      const skippedRun = store.createWorkflowRun({ workflow });
      const skipped = store.skipWorkflowStepRun(skippedRun.id, "worker", reason);
      expect(skipped.error).toBe("operation failed with [SCRUBBED]");
      expect(JSON.stringify(store.listWorkflowEvents(skippedRun.id))).not.toContain("ghp" + "_");

      const finalizedRun = store.createWorkflowRun({ workflow });
      const finalized = store.finalizeWorkflowRun(finalizedRun.id, "failed", { error: reason });
      expect(finalized.error).toBe("operation failed with [SCRUBBED]");
      expect(JSON.stringify(store.listWorkflowEvents(finalizedRun.id))).not.toContain("ghp" + "_");

      const cancelledRun = store.createWorkflowRun({ workflow });
      const cancelled = store.cancelWorkflowRun(cancelledRun.id, reason);
      expect(cancelled.error).toBe("operation failed with [SCRUBBED]");
      expect(store.listWorkflowStepRuns(cancelledRun.id)[0]?.error).toBe("operation failed with [SCRUBBED]");
      expect(JSON.stringify(store.listWorkflowEvents(cancelledRun.id))).not.toContain("ghp" + "_");

      const loop = store.createLoop({
        name: "scrub-skipped-reason",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: "true" },
      });
      const skippedLoopRun = store.createSkippedRun(loop, "2026-01-01T00:00:00.000Z", reason);
      expect(skippedLoopRun.error).toBe("operation failed with [SCRUBBED]");
    } finally {
      store.close();
    }
  });

  test("records process identity and reports abandoned vs deferred lease recovery", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "process-tracking",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          leaseMs: 10,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const dead = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      const recordedDead = store.recordRunProcess(dead!.run.id, {
        pid: DEAD_PID,
        pgid: DEAD_PID,
        processStartedAt: "2026-01-01T00:00:00.000Z",
      }, { claimToken: dead!.claimToken });
      expect(recordedDead?.pid).toBe(DEAD_PID);
      expect(recordedDead?.pgid).toBe(DEAD_PID);
      expect(recordedDead?.processStartedAt).toBe("2026-01-01T00:00:00.000Z");

      const alive = store.claimRun(loop, "2026-01-01T00:01:00.000Z", "runner", new Date("2026-01-01T00:01:00Z"));
      store.recordRunProcess(alive!.run.id, { pid: process.pid, pgid: process.pid }, { claimToken: alive!.claimToken });

      const result = store.recoverExpiredRunLeasesDetailed(new Date("2026-01-01T00:02:00Z"));
      expect(result.abandoned.map((run) => run.id)).toEqual([dead!.run.id]);
      expect(result.abandoned[0]?.pgid).toBe(DEAD_PID);
      expect(result.deferred.map((run) => run.id)).toEqual([alive!.run.id]);
      expect(result.deferred[0]?.pgid).toBe(process.pid);
      expect(store.getRun(dead!.run.id)?.status).toBe("abandoned");
      expect(store.getRun(alive!.run.id)?.status).toBe("running");
      // recoverExpiredRunLeases keeps returning the abandoned entries only.
      expect(store.recoverExpiredRunLeases(new Date("2026-01-01T00:02:00Z"))).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("lease recovery honours protectClaimedByInLoops and scopes it to the claiming runner", () => {
    const store = new Store(":memory:");
    try {
      const protectedLoop = store.createLoop(
        {
          name: "protect-kept",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          overlap: "allow",
          leaseMs: 10,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const otherLoop = store.createLoop(
        {
          name: "protect-reaped",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          leaseMs: 10,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const at = new Date("2026-01-01T00:00:00Z");
      const kept = store.claimRun(protectedLoop, "2026-01-01T00:00:00.000Z", "runner-x", at);
      // Same protected loop, different runner: the protection is per-runner, so
      // this one must still be reaped.
      const otherRunnerSameLoop = store.claimRun(protectedLoop, "2026-01-01T00:01:00.000Z", "runner-y", at);
      const reaped = store.claimRun(otherLoop, "2026-01-01T00:00:00.000Z", "runner-x", at);
      expect(kept).toBeTruthy();
      expect(otherRunnerSameLoop).toBeTruthy();
      expect(reaped).toBeTruthy();

      const result = store.recoverExpiredRunLeasesDetailed(new Date("2026-01-01T00:02:00Z"), {
        protectClaimedByInLoops: { claimedBy: "runner-x", loopIds: [protectedLoop.id] },
      });

      expect(result.abandoned.map((run) => run.id).sort()).toEqual(
        [otherRunnerSameLoop!.run.id, reaped!.run.id].sort(),
      );
      expect(store.getRun(kept!.run.id)?.status).toBe("running");
    } finally {
      store.close();
    }
  });

  test("protected runs do not consume the lease-recovery scan window", () => {
    // Regression for select-then-filter ordering: protected rows discarded in
    // application code after the scan `LIMIT` crowd the window and starve an
    // unrelated reapable run. The caller rebuilds the same protected set every
    // poll, so the starvation is permanent rather than transient. `scanLimit`
    // is pinned small so three rows cross the window instead of five hundred.
    const store = new Store(":memory:");
    try {
      const protectedLoop = store.createLoop(
        {
          name: "scanwindow-protected",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          overlap: "allow",
          leaseMs: 10,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const reapableLoop = store.createLoop(
        {
          name: "scanwindow-reapable",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          leaseMs: 10,
        },
        new Date("2025-12-31T00:00:00Z"),
      );

      const protectedIds: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const claim = store.claimRun(
          protectedLoop,
          `2026-01-01T00:0${i}:00.000Z`,
          "runner-x",
          new Date("2026-01-01T00:00:00Z"),
        );
        expect(claim).toBeTruthy();
        protectedIds.push(claim!.run.id);
      }
      // Claimed later, so its lease expires last and it sorts behind every
      // protected row under `ORDER BY lease_expires_at ASC`.
      const reapable = store.claimRun(
        reapableLoop,
        "2026-01-01T00:10:00.000Z",
        "runner-y",
        new Date("2026-01-01T00:10:00Z"),
      );
      expect(reapable).toBeTruthy();

      const result = store.recoverExpiredRunLeasesDetailed(new Date("2026-01-01T01:00:00Z"), {
        limit: 1,
        scanLimit: 3,
        protectClaimedByInLoops: { claimedBy: "runner-x", loopIds: [protectedLoop.id] },
      });

      expect(result.abandoned.map((run) => run.id)).toEqual([reapable!.run.id]);
      for (const id of protectedIds) expect(store.getRun(id)?.status).toBe("running");
    } finally {
      store.close();
    }
  });

  test("lease recovery abandons runs whose live pid fails the start-time fingerprint", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "recycled-pid",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          leaseMs: 10,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      // The recorded pid is alive (it is this test process) but the recorded
      // start-time fingerprint is a day off: a recycled pid. Recovery must
      // abandon the run instead of deferring it forever.
      const recycled = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      store.recordRunProcess(recycled!.run.id, {
        pid: process.pid,
        pgid: process.pid,
        processStartedAt: new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString(),
      }, { claimToken: recycled!.claimToken });
      const result = store.recoverExpiredRunLeasesDetailed(new Date("2026-01-01T00:02:00Z"));
      expect(result.abandoned.map((run) => run.id)).toEqual([recycled!.run.id]);
      expect(result.deferred).toEqual([]);
      expect(store.getRun(recycled!.run.id)?.status).toBe("abandoned");

      // Same guard on the claim path: an expired lease whose pid fingerprint
      // mismatches must not block a takeover of the slot.
      const stale = store.claimRun(loop, "2026-01-01T00:10:00.000Z", "runner-a", new Date("2026-01-01T00:10:00Z"));
      store.recordRunProcess(stale!.run.id, {
        pid: process.pid,
        pgid: process.pid,
        processStartedAt: new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString(),
      }, { claimToken: stale!.claimToken });
      const takeover = store.claimRun(loop, "2026-01-01T00:10:00.000Z", "runner-b", new Date("2026-01-01T00:11:00Z"));
      expect(takeover).toBeDefined();
      expect(takeover?.run.claimedBy).toBe("runner-b");

      // A matching fingerprint keeps blocking the takeover while deferring.
      const genuine = store.claimRun(loop, "2026-01-01T00:20:00.000Z", "runner-c", new Date("2026-01-01T00:20:00Z"));
      store.recordRunProcess(genuine!.run.id, { pid: process.pid, pgid: process.pid }, { claimToken: genuine!.claimToken });
      expect(store.claimRun(loop, "2026-01-01T00:20:00.000Z", "runner-d", new Date("2026-01-01T00:21:00Z"))).toBeUndefined();
      const deferredResult = store.recoverExpiredRunLeasesDetailed(new Date("2026-01-01T00:22:00Z"));
      expect(deferredResult.deferred.map((run) => run.id)).toEqual([genuine!.run.id]);
    } finally {
      store.close();
    }
  });

  // Regression (da94588c, OWNER-BLOCKING 2026-07-31): expired-lease recovery
  // re-deferred a "live" run every LIVE_EXPIRED_RUN_GRACE_MS forever. Nothing
  // counted the deferrals and nothing ever gave up, so the run was never
  // abandoned, never advanced, and blocked everything queued behind it — a
  // wall of codewith "Loop run deferred" toasts once a minute.
  test("lease recovery abandons a still-live run once the deferral ceiling is exhausted", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "defer-ceiling",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          leaseMs: 10,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      // This test process: genuinely alive, fingerprint genuinely matching.
      // The ONLY thing that ends this run is the ceiling.
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      store.recordRunProcess(claim!.run.id, { pid: process.pid, pgid: process.pid }, { claimToken: claim!.claimToken });

      // ARM 3 (the discriminating one): a genuinely live run must STILL be
      // deferred inside the grace window. A fix that simply abandoned
      // everything would pass the two arms below and break the feature.
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        const at = new Date(Date.parse("2026-01-01T00:02:00Z") + attempt * 60_000);
        const result = store.recoverExpiredRunLeasesDetailed(at);
        expect(result.deferred.map((run) => run.id)).toEqual([claim!.run.id]);
        expect(result.abandoned).toEqual([]);
        expect(store.getRun(claim!.run.id)?.status).toBe("running");
      }

      // The 11th pass is past the ceiling: abandoned despite still looking alive.
      const past = store.recoverExpiredRunLeasesDetailed(new Date("2026-01-01T00:14:00Z"));
      expect(past.abandoned.map((run) => run.id)).toEqual([claim!.run.id]);
      expect(past.deferred).toEqual([]);
      const abandoned = store.getRun(claim!.run.id);
      expect(abandoned?.status).toBe("abandoned");
      // The error distinguishes an exhausted grace from a plainly dead run, so
      // an operator can tell "wedged runner" from "process gone".
      expect(abandoned?.error).toContain("deferral ceiling");
    } finally {
      store.close();
    }
  });

  // NOTE ON WHAT THIS TEST IS AND IS NOT: unlike the four around it, this one
  // also PASSES on pre-fix bytes — before the ceiling existed, "ten more
  // deferrals are available" was trivially true. So it is not a regression
  // control for the reported defect; it is a behaviour lock on the reset,
  // and it does guard that: deleting `defer_count=0` from heartbeatRunLease
  // fails it. Recorded here so nobody later cites it as evidence the ceiling
  // works — the other four tests carry that.
  test("a successful lease heartbeat resets the deferral ceiling", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "defer-ceiling-reset",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          leaseMs: 10,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      store.recordRunProcess(claim!.run.id, { pid: process.pid, pgid: process.pid }, { claimToken: claim!.claimToken });

      // Burn most of the ceiling.
      for (let attempt = 1; attempt <= 9; attempt += 1) {
        const at = new Date(Date.parse("2026-01-01T00:02:00Z") + attempt * 60_000);
        expect(store.recoverExpiredRunLeasesDetailed(at).deferred).toHaveLength(1);
      }
      // A renewal proves the runner is alive and holding its lease: the count
      // is CONSECUTIVE failures to renew, so a recovered run starts over.
      const renewed = store.heartbeatRunLease(claim!.run.id, "runner", 60_000, new Date("2026-01-01T00:11:30Z"), {
        claimToken: claim!.claimToken,
      });
      expect(renewed).toBeDefined();

      // Ten more deferrals must now be available rather than one.
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        const at = new Date(Date.parse("2026-01-01T00:13:00Z") + attempt * 60_000);
        expect(store.recoverExpiredRunLeasesDetailed(at).deferred).toHaveLength(1);
      }
      expect(store.getRun(claim!.run.id)?.status).toBe("running");
    } finally {
      store.close();
    }
  });

  test("lease recovery abandons a run whose workflow step pid was recycled", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "recycled-step-pid",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          leaseMs: 10,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      // The run's own process is plainly dead, so the ONLY thing that could
      // hold this run open is the step-level probe.
      store.recordRunProcess(claim!.run.id, { pid: DEAD_PID, pgid: DEAD_PID }, { claimToken: claim!.claimToken });

      const workflow = store.createWorkflow({
        name: "recycled-step",
        steps: [{ id: "work", target: { type: "command", command: "true" } }],
      });
      const workflowRun = store.createWorkflowRun({ workflow, loop, loopRun: claim!.run });
      store.startWorkflowStepRun(workflowRun.id, "work");
      store.markWorkflowStepPid(workflowRun.id, "work", process.pid);

      // Recycled pid: the number is alive (it is this test process) but it is
      // not the process the step spawned. Overwrite the fingerprint with one a
      // day off — the OS handed this pid to something else.
      const internal = store as unknown as { db: Database };
      internal.db
        .query("UPDATE workflow_step_runs SET process_started_at = ? WHERE workflow_run_id = ? AND step_id = ?")
        .run(new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString(), workflowRun.id, "work");

      // Abandoned on the FIRST pass — identity is decidable here, so this
      // must not consume the ceiling at all.
      const result = store.recoverExpiredRunLeasesDetailed(new Date("2026-01-01T00:02:00Z"));
      expect(result.abandoned.map((run) => run.id)).toEqual([claim!.run.id]);
      expect(result.deferred).toEqual([]);
      expect(store.getRun(claim!.run.id)?.status).toBe("abandoned");
    } finally {
      store.close();
    }
  });

  test("a workflow step with an unparseable start hits the ceiling instead of deferring forever", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "unparseable-step-start",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          leaseMs: 10,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      store.recordRunProcess(claim!.run.id, { pid: DEAD_PID, pgid: DEAD_PID }, { claimToken: claim!.claimToken });

      const workflow = store.createWorkflow({
        name: "unparseable-step",
        steps: [{ id: "work", target: { type: "command", command: "true" } }],
      });
      const workflowRun = store.createWorkflowRun({ workflow, loop, loopRun: claim!.run });
      store.startWorkflowStepRun(workflowRun.id, "work");

      // A legacy-shaped row: the pid is written WITHOUT going through
      // markWorkflowStepPid, so it carries no fingerprint (exactly a row
      // written before migration 0014), and its started_at is unparseable.
      // The probe cannot decide either way and stays lenient — which is
      // precisely the state that used to wedge the runner forever.
      //
      // Deliberately schema-agnostic: this UPDATE names no column added by
      // this fix, so the test runs unchanged against the pre-fix binary and
      // fails there on BEHAVIOUR (deferred forever, never abandoned) rather
      // than on a missing column.
      const internal = store as unknown as { db: Database };
      internal.db
        .query("UPDATE workflow_step_runs SET pid = ?, started_at = 'not-a-timestamp' WHERE workflow_run_id = ? AND step_id = ?")
        .run(process.pid, workflowRun.id, "work");

      for (let attempt = 1; attempt <= 10; attempt += 1) {
        const at = new Date(Date.parse("2026-01-01T00:02:00Z") + attempt * 60_000);
        expect(store.recoverExpiredRunLeasesDetailed(at).deferred).toHaveLength(1);
      }
      const past = store.recoverExpiredRunLeasesDetailed(new Date("2026-01-01T00:14:00Z"));
      expect(past.abandoned.map((run) => run.id)).toEqual([claim!.run.id]);
      expect(store.getRun(claim!.run.id)?.status).toBe("abandoned");
    } finally {
      store.close();
    }
  });

  test("markWorkflowStepPid records the step pid start-time fingerprint", () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "step-fingerprint",
        steps: [{ id: "work", target: { type: "command", command: "true" } }],
      });
      const workflowRun = store.createWorkflowRun({ workflow });
      store.startWorkflowStepRun(workflowRun.id, "work");
      const marked = store.markWorkflowStepPid(workflowRun.id, "work", process.pid);
      expect(marked.pid).toBe(process.pid);
      // Without this, a recycled step pid is undetectable and the step probe
      // is a one-sided guess.
      expect(marked.processStartedAt).toBeDefined();
    } finally {
      store.close();
    }
  });

  test("markRunPid records the pid start-time fingerprint", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "mark-pid-fingerprint",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      const marked = store.markRunPid(claim!.run.id, process.pid, "runner", { claimToken: claim!.claimToken });
      expect(marked?.pid).toBe(process.pid);
      // The fingerprint is required so recovery and the daemon reaper can
      // verify pid identity later (fail-closed against pid recycling).
      expect(marked?.processStartedAt).toBeDefined();
    } finally {
      store.close();
    }
  });

  test("prunes terminal run history by age with a per-loop retention floor", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "prune-history",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
        },
        new Date("2025-01-01T00:00:00Z"),
      );
      const slots = [
        "2025-01-01T00:00:00.000Z",
        "2025-01-02T00:00:00.000Z",
        "2025-01-03T00:00:00.000Z",
        "2025-06-01T00:00:00.000Z",
        "2025-06-02T00:00:00.000Z",
      ];
      for (const slot of slots) {
        const claim = store.claimRun(loop, slot, "runner", new Date(slot));
        store.finalizeRun(claim!.run.id, {
          status: "succeeded",
          finishedAt: slot,
          durationMs: 1_000,
          stdout: "",
          stderr: "",
        });
      }
      const now = new Date("2025-06-10T00:00:00Z");

      const dry = store.pruneHistory({ maxAgeDays: 30, dryRun: true, now });
      expect(dry.dryRun).toBe(true);
      expect(dry.loopRuns).toBe(3);
      expect(store.countRuns()).toBe(5);

      const floored = store.pruneHistory({ maxAgeDays: 30, keepPerLoop: 4, now });
      expect(floored.loopRuns).toBe(1);
      expect(store.countRuns()).toBe(4);

      const pruned = store.pruneHistory({ maxAgeDays: 30, now });
      expect(pruned.loopRuns).toBe(2);
      expect(store.countRuns()).toBe(2);

      const keepOnly = store.pruneHistory({ keepPerLoop: 1, now });
      expect(keepOnly.loopRuns).toBe(1);
      expect(store.countRuns()).toBe(1);
      expect(store.listRuns({ loopId: loop.id })[0]?.scheduledFor).toBe("2025-06-02T00:00:00.000Z");
    } finally {
      store.close();
    }
  });

  test("countRuns applies the SAME loopId/labels/status filters as listRuns (LOO3-00143 P1)", () => {
    const store = new Store(":memory:");
    try {
      const alpha = store.createLoop(
        {
          name: "alpha-loop",
          labels: ["shared"],
          overlap: "allow",
          schedule: { type: "once", at: "2026-08-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2026-07-31T00:00:00Z"),
      );
      const beta = store.createLoop(
        {
          name: "beta-loop",
          labels: ["shared"],
          overlap: "allow",
          schedule: { type: "once", at: "2026-08-01T00:01:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2026-07-31T00:00:00Z"),
      );
      // alpha: 2 running runs; beta: 1 running + 2 succeeded (global 5).
      for (let i = 0; i < 2; i += 1) store.claimRun(alpha, `2026-08-01T00:00:0${i}.000Z`, "runner");
      for (let i = 0; i < 3; i += 1) {
        const claim = store.claimRun(beta, `2026-08-01T00:01:0${i}.000Z`, "runner");
        if (i > 0) {
          store.finalizeRun(claim!.run.id, {
            status: "succeeded",
            finishedAt: `2026-08-01T00:01:0${i}.500Z`,
            durationMs: 1_000,
            stdout: "",
            stderr: "",
          });
        }
      }

      expect(store.countRuns()).toBe(5);
      expect(store.countRuns({ loopId: alpha.id })).toBe(2);
      expect(store.countRuns({ loopId: beta.id })).toBe(3);
      // loopId AND status combine exactly like listRuns.
      expect(store.countRuns({ loopId: alpha.id, status: "running" })).toBe(2);
      expect(store.countRuns({ loopId: beta.id, status: "succeeded" })).toBe(2);
      expect(store.countRuns({ status: "running" })).toBe(3);
      expect(store.countRuns({ status: "succeeded" })).toBe(2);
      // labels counts runs of the loops carrying the label.
      expect(store.countRuns({ labels: ["shared"] })).toBe(5);
      expect(store.countRuns({ loopId: beta.id, labels: ["shared"] })).toBe(3);
    } finally {
      store.close();
    }
  });

  test("pruneHistory skips candidates reclaimed to running before the delete batch commits", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "prune-reclaim-race",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          maxAttempts: 3,
        },
        new Date("2025-01-01T00:00:00Z"),
      );
      const slot = "2025-01-01T00:00:00.000Z";
      const claim = store.claimRun(loop, slot, "runner", new Date(slot));
      store.finalizeRun(claim!.run.id, {
        status: "failed",
        finishedAt: slot,
        durationMs: 1_000,
        stdout: "",
        stderr: "",
        error: "boom",
      });

      // Simulate a daemon retry reclaiming the run in the window between
      // candidate selection and the batched delete transaction.
      const internals = store as unknown as { transact<T>(fn: () => T): T };
      const originalTransact = internals.transact.bind(store);
      let reclaimed = false;
      internals.transact = <T,>(fn: () => T): T => {
        if (!reclaimed) {
          reclaimed = true;
          expect(store.claimRun(loop, slot, "retry-runner", new Date("2025-06-10T00:00:00Z"))).toBeDefined();
        }
        return originalTransact(fn);
      };

      const summary = store.pruneHistory({ maxAgeDays: 0, now: new Date("2025-06-10T00:00:00Z") });
      expect(reclaimed).toBe(true);
      expect(summary.loopRuns).toBe(0);
      const survivor = store.getRun(claim!.run.id);
      expect(survivor?.status).toBe("running");
      expect(survivor?.attempt).toBe(2);
    } finally {
      store.close();
    }
  });

  test("writes manifests for plain loop workflow runs via tmp-then-rename", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-plain-manifest-"));
    const store = new Store(join(root, "loops.db"));
    try {
      const workflow = store.createWorkflow({
        name: "plain-manifest-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop({
        name: "plain-manifest-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "workflow", workflowId: workflow.id },
      });
      const run = store.createWorkflowRun({ workflow, loop, scheduledFor: "2026-01-01T00:00:00.000Z" });
      expect(run.manifestPath).toBeDefined();
      expect(existsSync(run.manifestPath!)).toBe(true);
      expect(existsSync(`${run.manifestPath!}.tmp`)).toBe(false);
      const manifest = JSON.parse(readFileSync(run.manifestPath!, "utf8"));
      expect(manifest.workflowRunId).toBe(run.id);
      expect(manifest.loopId).toBe(loop.id);
    } finally {
      store.close();
    }
  });

  test("appends workflow events with contiguous sequences outside transactions", () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "event-sequence-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const run = store.createWorkflowRun({ workflow });
      const second = store.appendWorkflowEvent(run.id, "custom_one");
      const third = store.appendWorkflowEvent(run.id, "custom_two");
      expect(second.sequence).toBe(3);
      expect(third.sequence).toBe(4);
      expect(store.listWorkflowEvents(run.id).map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    } finally {
      store.close();
    }
  });

  test("binds idempotent workflow runs to immutable definitions and creates contracts atomically", () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "immutable-idempotent-workflow",
        steps: ["worker-one", "worker-two"].map((id) => ({
          id,
          target: {
            type: "agent" as const,
            provider: "codewith" as const,
            prompt: `perform scoped work for ${id}`,
            allowlist: { commands: ["git"], safetyReason: "scoped workflow test" },
          },
        })),
      });
      const first = store.createWorkflowRun({ workflow, idempotencyKey: "same-definition" });
      const retry = store.createWorkflowRun({ workflow, idempotencyKey: "same-definition" });
      expect(retry.id).toBe(first.id);
      expect(store.listWorkflowEvents(first.id).filter((event) =>
        event.eventType === "agent_session_contract"
      )).toHaveLength(2);

      const changed = {
        ...workflow,
        steps: [{
          ...workflow.steps[0]!,
          target: { ...workflow.steps[0]!.target, prompt: "changed after creation" },
        }],
      };
      expect(() => store.createWorkflowRun({
        workflow: changed,
        idempotencyKey: "same-definition",
      })).toThrow(WorkflowRunDefinitionConflictError);

      const internal = store as unknown as { db: Database };
      const atomicCounts = () => internal.db.query<{
        run_count: number;
        step_count: number;
        event_count: number;
      }, []>(`
        SELECT
          (SELECT COUNT(*) FROM workflow_runs) AS run_count,
          (SELECT COUNT(*) FROM workflow_step_runs) AS step_count,
          (SELECT COUNT(*) FROM workflow_events) AS event_count
      `).get();
      const beforeFailedCreate = atomicCounts();
      expect(() => store.createWorkflowRun({
        workflow,
        idempotencyKey: "rolls-back",
        beforeInitialWorkflowEventPersist: (event) => {
          if (event.stepId === "worker-two") throw new Error("injected second contract append failure");
        },
      })).toThrow("injected second contract append failure");
      expect(atomicCounts()).toEqual(beforeFailedCreate);
      expect(store.listWorkflowRuns({ workflowId: workflow.id }).some((run) =>
        run.idempotencyKey === "rolls-back"
      )).toBe(false);

      internal.db.query("UPDATE workflow_runs SET workflow_definition_hash = NULL WHERE id = ?").run(first.id);
      expect(() => store.createWorkflowRun({
        workflow,
        idempotencyKey: "same-definition",
      })).toThrow(LegacyWorkflowRunProvenanceError);
    } finally {
      store.close();
    }
  });

  test("atomically rejects duplicate agent session contracts for one workflow step", () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "unique-agent-contract-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const run = store.createWorkflowRun({ workflow });
      store.appendWorkflowEvent(run.id, "agent_session_contract", "worker", { version: 1 });
      expect(() => store.appendWorkflowEvent(
        run.id,
        "agent_session_contract",
        "worker",
        { version: 1 },
      )).toThrow(DuplicateWorkflowEventError);
      expect(store.listWorkflowEvents(run.id).filter((event) =>
        event.eventType === "agent_session_contract" && event.stepId === "worker"
      )).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("scrubs workflow step progress event payloads before persistence", () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "progress-redaction-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const run = store.createWorkflowRun({ workflow });
      store.startWorkflowStepRun(run.id, "worker");

      const randomSecret = j("q7Rt2x", "Vz9LpW4", "mKe8sYw");
      store.recordWorkflowStepProgress(run.id, "worker", {
        payload: {
          status: "streaming",
          apiKey: randomSecret,
          nested: { token: OPENAI_KEY },
          safe: "visible",
        },
      });

      const internal = store as unknown as { db: Database };
      const row = internal.db
        .query<{ payload_json: string | null }, []>(
          "SELECT payload_json FROM workflow_events WHERE event_type = 'step_progress'",
        )
        .get();
      expect(row?.payload_json).toContain("[SCRUBBED]");
      expect(row?.payload_json).not.toContain(randomSecret);
      expect(row?.payload_json).not.toContain(OPENAI_KEY);

      const progressEvent = store.listWorkflowEvents(run.id).find((event) => event.eventType === "step_progress");
      expect(progressEvent?.payload).toEqual({
        status: "streaming",
        apiKey: "[SCRUBBED]",
        nested: { token: "[SCRUBBED]" },
        safe: "visible",
      });
    } finally {
      store.close();
    }
  });

  test("bounds oversized workflow step progress event payloads before persistence", () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "progress-bounds-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const run = store.createWorkflowRun({ workflow });
      store.startWorkflowStepRun(run.id, "worker");

      const secret = j("x9Kd2", "mQz7Lp", "4Rv8t");
      const envSecretKey = `${"DB"}_${"PASSWORD"}`;
      const hugePayload = `${"a".repeat(140_000)} ${envSecretKey}="${secret}" ${"z".repeat(140_000)}`;
      store.recordWorkflowStepProgress(run.id, "worker", {
        payload: {
          status: "streaming",
          hugePayload,
        },
      });

      const internal = store as unknown as { db: Database };
      const row = internal.db
        .query<{ payload_json: string | null }, []>(
          "SELECT payload_json FROM workflow_events WHERE event_type = 'step_progress'",
        )
        .get();
      expect(row?.payload_json).toBeDefined();
      expect(row!.payload_json!.length).toBeLessThanOrEqual(64 * 1024);
      expect(row?.payload_json).not.toContain(secret);

      const progressEvent = store.listWorkflowEvents(run.id).find((event) => event.eventType === "step_progress");
      expect(progressEvent?.payload?.truncated).toBe(true);
      expect(progressEvent?.payload?.maxChars).toBe(64 * 1024);
      expect(progressEvent?.payload?.preview).toContain("truncated by loops workflow-event payload retention");
    } finally {
      store.close();
    }
  });

  test("re-planning goal nodes keeps existing keys and adds new ones", () => {
    const store = new Store(":memory:");
    try {
      const goal = store.createGoal({ objective: "replan" });
      store.createGoalPlanNodes(goal.goalId, [
        { key: "plan", objective: "write a plan" },
        { key: "verify", objective: "verify", dependsOn: ["plan"] },
      ]);
      const replanned = store.createGoalPlanNodes(goal.goalId, [
        { key: "plan", objective: "changed objective is ignored" },
        { key: "ship", objective: "ship it", dependsOn: ["verify"] },
      ]);
      expect(replanned.map((node) => node.key).sort()).toEqual(["plan", "ship", "verify"]);
      expect(replanned.find((node) => node.key === "plan")?.objective).toBe("write a plan");
    } finally {
      store.close();
    }
  });

  // Regression (MEDIUM 6): sqlite loop_runs has no FK to loops (postgres declares
  // ON DELETE CASCADE), so deleteLoop must delete run history itself — otherwise
  // running rows orphan and keep inflating daemonStatus.runs.running forever.
  test("deleteLoop removes child run history so orphaned running rows do not linger", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "delete-with-runs",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      expect(store.countRuns({ status: "running" })).toBe(1);
      expect(store.listRuns({ loopId: loop.id })).toHaveLength(1);

      expect(store.deleteLoop(loop.id)).toBe(true);

      expect(store.listRuns({ loopId: loop.id })).toHaveLength(0);
      expect(store.countRuns()).toBe(0);
      expect(store.countRuns({ status: "running" })).toBe(0);
    } finally {
      store.close();
    }
  });

  // Regression (MEDIUM 7): a manual goal rerun after a terminal outcome must not
  // reuse the terminal goal (which throws in assertGoalTransition) — the context
  // lookup skips terminal manual goals so runGoal creates a fresh one.
  test("findGoalByContext skips terminal manual goals so a rerun starts fresh", () => {
    const store = new Store(":memory:");
    try {
      const goal = store.createGoal({ objective: "tidy inbox", sourceType: "manual", sourceId: "tidy inbox" });
      // A non-terminal manual goal is resumed in place.
      expect(store.findGoalByContext({ sourceType: "manual", sourceId: "tidy inbox" })?.goalId).toBe(goal.goalId);
      // Once terminal it is skipped, so the caller creates a new goal instead of
      // reusing one that cannot transition.
      store.updateGoalStatus(goal.goalId, "cancelled");
      expect(store.findGoalByContext({ sourceType: "manual", sourceId: "tidy inbox" })).toBeUndefined();
    } finally {
      store.close();
    }
  });

  // Regression (LOW 9): a claimedBy-less finalize is unfenced; it must still not
  // resurrect or clobber a run that is no longer running.
  test("finalizeRun without claimedBy cannot clobber a terminal run", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "no-clobber",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.finalizeRun(
        claim!.run.id,
        { status: "succeeded", finishedAt: "2026-01-01T00:00:01.000Z", durationMs: 1_000, stdout: "real", stderr: "" },
        { claimedBy: "runner", claimToken: claim!.claimToken, now: new Date("2026-01-01T00:00:01Z") },
      );
      expect(store.getRun(claim!.run.id)?.status).toBe("succeeded");

      const after = store.finalizeRun(claim!.run.id, {
        status: "failed",
        finishedAt: "2026-01-01T00:00:02.000Z",
        durationMs: 2_000,
        stdout: "clobber",
        stderr: "",
      });

      expect(after.status).toBe("succeeded");
      expect(after.stdout).toBe("real");
    } finally {
      store.close();
    }
  });

  test("fenced finalizeRun exposes a lost transition instead of returning a terminal row", () => {
    const store = new Store(":memory:");
    try {
      const now = new Date("2026-01-01T00:00:01.000Z");
      const loop = store.createLoop(
        {
          name: "fenced-finalize-conflict",
          schedule: { type: "interval", everyMs: 60_000, anchor: "fixed_delay" },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      const patch = {
        status: "succeeded" as const,
        finishedAt: now.toISOString(),
        durationMs: 1_000,
        stdout: "",
        stderr: "",
      };
      store.finalizeRun(claim!.run.id, patch, {
        claimedBy: "runner",
        claimToken: claim!.claimToken,
        now,
      });

      expect(() => store.finalizeRun(claim!.run.id, patch, {
        claimedBy: "runner",
        claimToken: claim!.claimToken,
        now,
      })).toThrow(RunFinalizationConflictError);
      try {
        store.finalizeRun(claim!.run.id, patch, {
          claimedBy: "runner",
          claimToken: claim!.claimToken,
          now,
        });
      } catch (error) {
        expect(error).toMatchObject({ reason: "run_not_running" });
      }
    } finally {
      store.close();
    }
  });

  // Regression (LOW 10): a :memory: store still mkdtempSync's a scratch root for
  // manifests; close() must remove it so short-lived instances don't leak temp dirs.
  test("closing a :memory: store removes its scratch temp dir", () => {
    const store = new Store(":memory:");
    const workflow = store.createWorkflow({
      name: "mem-temp-cleanup",
      steps: [{ id: "only", target: { type: "command", command: "true" } }],
    });
    const run = store.createWorkflowRun({ workflow });
    const manifestPath = run.manifestPath!;
    expect(manifestPath).toContain("open-loops-store-");
    // Derive the mkdtemp root (…/open-loops-store-XXXXXX) from the manifest path.
    const marker = manifestPath.indexOf("open-loops-store-");
    const tempRoot = manifestPath.slice(0, manifestPath.indexOf("/", marker));
    expect(existsSync(tempRoot)).toBe(true);

    store.close();

    expect(existsSync(tempRoot)).toBe(false);
  });
});

describe("countActiveWorkflowWorkItems route scope", () => {
  function admitItem(store: Store, idempotencyKey: string, routeScope: string, projectKey = "/tmp/scope-repo"): void {
    const invocation = store.createWorkflowInvocation({
      sourceRef: { kind: "event", id: `evt-${idempotencyKey}`, dedupeKey: idempotencyKey },
      subjectRef: { kind: "task", id: idempotencyKey, path: projectKey },
      intent: "route",
      scope: { projectPath: projectKey },
    });
    const workItem = store.upsertWorkflowWorkItem({
      routeKey: "todos-task",
      idempotencyKey,
      invocationId: invocation.id,
      sourceType: "task.created",
      sourceRef: `evt-${idempotencyKey}`,
      subjectRef: idempotencyKey,
      projectKey,
      routeScope,
    });
    const workflow = store.createWorkflow({ name: `wf-${idempotencyKey}`, steps: [{ id: "s", target: { type: "command", command: "true" } }] });
    const loop = store.createLoop({
      name: `loop-${idempotencyKey}`,
      schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
      target: { type: "workflow", workflowId: workflow.id, input: {} },
    });
    store.admitWorkflowWorkItem(workItem.id, { workflowId: workflow.id, loopId: loop.id });
  }

  test("scopes the global --max-active count to the route that set it", () => {
    const store = new Store(":memory:");
    try {
      admitItem(store, "a1", "loopA");
      admitItem(store, "a2", "loopA");
      admitItem(store, "b1", "loopB");
      // Each route's --max-active now counts only its own active items.
      // Neutralization: the pre-fix store-wide global count ignored routeScope
      // and returned 3 for every route, so these per-scope assertions fail.
      expect(store.countActiveWorkflowWorkItems({ routeScope: "loopA" }).global).toBe(2);
      expect(store.countActiveWorkflowWorkItems({ routeScope: "loopB" }).global).toBe(1);
      expect(store.countActiveWorkflowWorkItems({ routeScope: "loopC" }).global).toBe(0);
      // No scope -> store-wide count, unchanged for back-compat.
      expect(store.countActiveWorkflowWorkItems().global).toBe(3);
      // Per-project counting stays unscoped (cross-route anti-hog cap).
      expect(store.countActiveWorkflowWorkItems({ projectKey: "/tmp/scope-repo", routeScope: "loopA" }).project).toBe(3);
    } finally {
      store.close();
    }
  });
});

describe("pre-0008 database upgrade (real 0.4.11 schema fixture)", () => {
  // The DDL below is copied verbatim from 0.4.11 (git e69f2bc, createBaseSchema)
  // — workflow_work_items WITHOUT route_scope. A fresh createBaseSchema database
  // is NOT a valid stand-in here: it already contains the new column, which is
  // exactly the blind spot that let a crash-on-open ship. Baseline migration
  // 0001 re-runs on every open, so any base-schema statement referencing a
  // column that only migration 0008 adds crashes the open of every existing
  // database ("no such column: route_scope") before 0008 can run.
  const V0411_FIXTURE_SQL = `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workflow_invocations (
        id TEXT PRIMARY KEY,
        workflow_id TEXT,
        template_id TEXT,
        source_kind TEXT NOT NULL,
        source_id TEXT,
        source_dedupe_key TEXT,
        source_json TEXT NOT NULL,
        subject_kind TEXT NOT NULL,
        subject_id TEXT,
        subject_path TEXT,
        subject_url TEXT,
        subject_json TEXT NOT NULL,
        intent TEXT NOT NULL,
        scope_json TEXT,
        output_policy_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workflow_work_items (
        id TEXT PRIMARY KEY,
        route_key TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        invocation_id TEXT NOT NULL REFERENCES workflow_invocations(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        subject_ref TEXT NOT NULL,
        project_key TEXT,
        project_group TEXT,
        priority INTEGER NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        next_attempt_at TEXT,
        lease_expires_at TEXT,
        workflow_id TEXT REFERENCES workflow_specs(id) ON DELETE SET NULL,
        loop_id TEXT REFERENCES loops(id) ON DELETE SET NULL,
        workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
        last_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(route_key, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_work_items_status_next ON workflow_work_items(status, next_attempt_at, priority DESC, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_workflow_work_items_project ON workflow_work_items(project_key, status);
      CREATE INDEX IF NOT EXISTS idx_workflow_work_items_group ON workflow_work_items(project_group, status);
      CREATE INDEX IF NOT EXISTS idx_workflow_work_items_invocation ON workflow_work_items(invocation_id);
  `;
  const V0411_MIGRATION_IDS = [
    "0001_initial_and_workflows",
    "0002_loop_machines",
    "0003_goals",
    "0004_loop_archive_metadata",
    "0005_workflow_invocations_and_admission",
    "0006_run_process_tracking",
    "0007_run_claim_tokens",
  ];

  function buildV0411Fixture(dbFile: string): void {
    const raw = new Database(dbFile);
    try {
      raw.exec(V0411_FIXTURE_SQL);
      for (const id of V0411_MIGRATION_IDS) {
        raw.query("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(id, "2026-07-05T00:00:00.000Z");
      }
      raw.exec("PRAGMA user_version = 7");
      raw
        .query(
          `INSERT INTO workflow_invocations (id, source_kind, source_json, subject_kind, subject_json, intent, created_at, updated_at)
           VALUES ('inv-legacy-1', 'event', '{}', 'task', '{}', 'route', '2026-07-05T00:00:00.000Z', '2026-07-05T00:00:00.000Z')`,
        )
        .run();
      raw
        .query(
          `INSERT INTO workflow_work_items (id, route_key, idempotency_key, invocation_id, source_type, source_ref,
            subject_ref, project_key, priority, status, attempts, created_at, updated_at)
           VALUES ('wi-legacy-1', 'todos-task', 'todos-task:legacy-1', 'inv-legacy-1', 'task.created', 'evt-legacy-1',
            'legacy-1', '/tmp/legacy-repo', 0, 'running', 1, '2026-07-05T00:00:00.000Z', '2026-07-05T00:00:00.000Z')`,
        )
        .run();
    } finally {
      raw.close();
    }
  }

  test("opens a pre-0008 database cleanly, adds route_scope + index, keeps data intact", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-upgrade-0008-"));
    const dbFile = join(root, "loops.db");
    buildV0411Fixture(dbFile);

    // The regression assertion: this open crashed on every existing database
    // when the base schema carried the route_scope index (baseline 0001 re-ran
    // it before migration 0008 added the column).
    const store = new Store(dbFile);
    try {
      const columns = (store["db"].query("PRAGMA table_info(workflow_work_items)").all() as Array<{ name: string }>).map(
        (row) => row.name,
      );
      expect(columns).toContain("route_scope");
      const indexes = (
        store["db"]
          .query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'workflow_work_items'")
          .all() as Array<{ name: string }>
      ).map((row) => row.name);
      expect(indexes).toContain("idx_workflow_work_items_scope");
      const ledger = (store["db"].query("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: string }>).map(
        (row) => row.id,
      );
      expect(ledger).toContain("0008_work_item_route_scope");

      // Pre-existing data intact; legacy rows have no route scope.
      const legacy = store.getWorkflowWorkItem("wi-legacy-1");
      expect(legacy?.status).toBe("running");
      expect(legacy?.idempotencyKey).toBe("todos-task:legacy-1");
      expect(legacy?.routeScope).toBeUndefined();

      // Counting works post-upgrade: unscoped still sees the legacy active row;
      // a scoped count excludes NULL-scope legacy rows (admission bias, never a
      // wedge).
      expect(store.countActiveWorkflowWorkItems().global).toBe(1);
      expect(store.countActiveWorkflowWorkItems({ routeScope: "any-loop" }).global).toBe(0);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reopening an upgraded database stays clean (0008 skip-guarded, baseline re-run safe)", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-upgrade-0008-reopen-"));
    const dbFile = join(root, "loops.db");
    buildV0411Fixture(dbFile);
    const first = new Store(dbFile);
    first.close();
    // Second open re-runs the baseline schema against the upgraded database;
    // 0008 must be skipped (already stamped) and nothing may throw.
    const second = new Store(dbFile);
    try {
      expect(second.getWorkflowWorkItem("wi-legacy-1")?.status).toBe("running");
    } finally {
      second.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("workflow step account profile attribution", () => {
  test("persists the codewith authProfile as account_profile and counts running steps per profile", () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "codewith-attribution-wf",
        steps: [
          { id: "worker", target: { type: "agent", provider: "codewith", prompt: "do the work", sandbox: "workspace-write", authProfile: "account007" } },
          { id: "verifier", target: { type: "agent", provider: "codewith", prompt: "review it", sandbox: "workspace-write", authProfile: "account009" } },
        ],
      });
      const run = store.createWorkflowRun({ workflow });
      const steps = store.listWorkflowStepRuns(run.id);
      // Fix: codewith steps carry the account in `authProfile`, not an AccountRef;
      // it must land in account_profile. Neutralization: the pre-fix INSERT used
      // `account?.profile ?? null`, leaving both NULL for codewith steps.
      expect(steps.find((step) => step.stepId === "worker")?.accountProfile).toBe("account007");
      expect(steps.find((step) => step.stepId === "verifier")?.accountProfile).toBe("account009");

      // countRunningWorkflowStepsByAuthProfile only counts running steps.
      expect(store.countRunningWorkflowStepsByAuthProfile()).toEqual({});
      store.startWorkflowStepRun(run.id, "worker");
      expect(store.countRunningWorkflowStepsByAuthProfile()).toEqual({ account007: 1 });
      store.startWorkflowStepRun(run.id, "verifier");
      expect(store.countRunningWorkflowStepsByAuthProfile()).toEqual({ account007: 1, account009: 1 });
    } finally {
      store.close();
    }
  });
});
