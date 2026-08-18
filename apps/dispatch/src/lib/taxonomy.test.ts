import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { tick } from "./scheduler.js";
import { Store } from "./store.js";
import { daemonStatus } from "../daemon/control.js";
import {
  dispatchRecordSchema,
  scheduledDispatchSchema,
  daemonStatusSchema,
} from "./api-schemas.js";
import type { DispatchOptions, DispatchRecord } from "../types.js";

/**
 * Taxonomy conformance — the queue/daemon status vocabulary matches the
 * fleet daemon-worker taxonomy (admitted / leased / running / terminal;
 * lease generation + fencing; attempt identity; terminal receipts). See the
 * global daemon-worker-taxonomy rule.
 *
 * These tests assert the taxonomy names on every public surface. The legacy
 * names (pending/sending/delivered/scheduled/fired) are rejected — no compat
 * aliases are permitted.
 */

function fakeRecord(id: string, status: DispatchRecord["status"] = "succeeded"): DispatchRecord {
  return {
    id,
    target: "s:w",
    machine: "local",
    prompt: "x",
    status,
    createdAt: "x",
    updatedAt: "x",
  };
}

function counter() {
  const calls: DispatchOptions[] = [];
  let n = 0;
  const dispatch = async (options: DispatchOptions): Promise<DispatchRecord> => {
    calls.push(options);
    return fakeRecord(`rec${++n}`);
  };
  return { calls, dispatch };
}

describe("taxonomy — public status enums", () => {
  test("dispatch status accepts the taxonomy vocabulary", () => {
    for (const status of ["admitted", "running", "succeeded", "failed", "cancelled", "skipped"]) {
      expect(dispatchRecordSchema.parse({
        id: "x",
        target: "s:w",
        machine: "local",
        prompt: "p",
        status,
        createdAt: "t",
        updatedAt: "t",
      }).status).toBe(status);
    }
  });

  test("dispatch status rejects the legacy vocabulary", () => {
    for (const status of ["pending", "sending", "delivered", "scheduled"]) {
      expect(() => dispatchRecordSchema.parse({
        id: "x",
        target: "s:w",
        machine: "local",
        prompt: "p",
        status,
        createdAt: "t",
        updatedAt: "t",
      })).toThrow();
    }
  });

  test("schedule status accepts the taxonomy vocabulary", () => {
    for (const status of ["admitted", "paused", "succeeded", "cancelled", "failed"]) {
      expect(scheduledDispatchSchema.parse({
        id: "x",
        options: { target: "s:w", prompt: "p" },
        nextRun: "t",
        status,
        createdAt: "t",
        updatedAt: "t",
      }).status).toBe(status);
    }
  });

  test("schedule status rejects the legacy vocabulary", () => {
    for (const status of ["scheduled", "fired"]) {
      expect(() => scheduledDispatchSchema.parse({
        id: "x",
        options: { target: "s:w", prompt: "p" },
        nextRun: "t",
        status,
        createdAt: "t",
        updatedAt: "t",
      })).toThrow();
    }
  });

  test("daemon status schema exposes taxonomy queue-depth keys", () => {
    const parsed = daemonStatusSchema.parse({
      running: false,
      stale: false,
      health: "dead",
      admitted: 0,
      paused: 0,
      succeeded: 0,
      cancelled: 0,
      failed: 0,
      recentDispatches: 0,
      heartbeatStaleMs: 30000,
      recentFailures: [],
      logPath: "l",
      pidPath: "p",
      statePath: "s",
    });
    expect(parsed.admitted).toBe(0);
    expect(parsed.succeeded).toBe(0);
  });
});

describe("taxonomy — store defaults and persistence", () => {
  test("a dispatch record is admitted on creation", () => {
    const s = new Store(":memory:");
    const rec = s.createDispatch({ target: "s:w", prompt: "hi" });
    expect(rec.status).toBe("admitted");
    s.close();
  });

  test("a schedule entry is admitted on creation", () => {
    const s = new Store(":memory:");
    const sched = s.createSchedule({
      options: { target: "s:w", prompt: "go" },
      at: "2000-01-01T00:00:00.000Z",
      nextRun: "2000-01-01T00:00:00.000Z",
    });
    expect(sched.status).toBe("admitted");
    s.close();
  });

  test("legacy status rows are migrated to the taxonomy on open (data preserved)", () => {
    const file = join(tmpdir(), `dispatch_taxonomy_migrate_${process.pid}_${Math.floor(Math.random() * 1e6)}.db`);
    try {
      // Hand-build a legacy store: old column names and old status values.
      const legacy = new Database(file);
      legacy.exec(`
        CREATE TABLE dispatches (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'prompt', backend TEXT NOT NULL DEFAULT 'tmux',
          target TEXT NOT NULL, machine TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL,
          detail TEXT, confirm_json TEXT, submit_delay_ms INTEGER, command_hash TEXT, filter_json TEXT,
          target_kind TEXT, dry_run INTEGER, exec_plan_json TEXT, target_state TEXT, detection_json TEXT,
          capture_before_json TEXT, receipt_json TEXT, created_at TEXT NOT NULL, delivered_at TEXT, updated_at TEXT NOT NULL
        );
        CREATE TABLE schedules (
          id TEXT PRIMARY KEY, options_json TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'schedule',
          name TEXT, at TEXT, cron TEXT, every TEXT, interval_ms INTEGER, next_run TEXT NOT NULL,
          status TEXT NOT NULL, last_dispatch_id TEXT, last_fired_at TEXT, last_failure_at TEXT,
          last_failure_reason TEXT, failure_count INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        INSERT INTO dispatches (id, kind, backend, target, machine, prompt, status, created_at, delivered_at, updated_at) VALUES
          ('d-pending', 'prompt', 'tmux', 's:w', 'local', 'a', 'pending', 't', NULL, 't'),
          ('d-sending', 'prompt', 'tmux', 's:w', 'local', 'b', 'sending', 't', NULL, 't'),
          ('d-delivered', 'prompt', 'tmux', 's:w', 'local', 'c', 'delivered', 't', 't', 't'),
          ('d-scheduled', 'prompt', 'tmux', 's:w', 'local', 'd', 'scheduled', 't', NULL, 't');
        INSERT INTO schedules (id, options_json, kind, name, at, cron, next_run, status, last_dispatch_id, last_fired_at, created_at, updated_at) VALUES
          ('s-scheduled', '{}', 'schedule', NULL, '2000-01-01T00:00:00.000Z', NULL, '2000-01-01T00:00:00.000Z', 'scheduled', 'd-delivered', '2026-01-01T00:00:00.000Z', 't', 't'),
          ('s-fired', '{}', 'schedule', NULL, '2000-01-01T00:00:00.000Z', NULL, '2000-01-01T00:00:00.000Z', 'fired', NULL, NULL, 't', 't');
      `);
      legacy.close();

      const s = new Store(file);
      expect(s.getDispatch("d-pending")!.status).toBe("admitted");
      expect(s.getDispatch("d-sending")!.status).toBe("running");
      expect(s.getDispatch("d-delivered")!.status).toBe("succeeded");
      expect(s.getDispatch("d-scheduled")!.status).toBe("admitted");
      expect(s.getDispatch("d-delivered")!.succeededAt).toBe("t");

      const admitted = s.getSchedule("s-scheduled")!;
      expect(admitted.status).toBe("admitted");
      expect(admitted.lastAttemptId).toBe("d-delivered");
      expect(admitted.lastAttemptAt).toBe("2026-01-01T00:00:00.000Z");
      expect(s.getSchedule("s-fired")!.status).toBe("succeeded");

      // Legacy column names are gone from the persisted schema.
      const cols = (s as unknown as {
        db: { query: (sql: string) => { all: () => { name: string }[] } };
      }).db.query("PRAGMA table_info(schedules)").all().map((c) => c.name);
      expect(cols).toContain("last_attempt_id");
      expect(cols).not.toContain("last_dispatch_id");
      expect(cols).toContain("last_attempt_at");
      expect(cols).not.toContain("last_fired_at");
      const dcols = (s as unknown as {
        db: { query: (sql: string) => { all: () => { name: string }[] } };
      }).db.query("PRAGMA table_info(dispatches)").all().map((c) => c.name);
      expect(dcols).toContain("succeeded_at");
      expect(dcols).not.toContain("delivered_at");
      s.close();
    } finally {
      rmSync(file, { force: true });
    }
  });
});

describe("taxonomy — attempt identity, fencing, and terminal receipts", () => {
  test("a successful one-shot fires once, becomes succeeded, and records the attempt receipt", async () => {
    const store = new Store(":memory:");
    const sched = store.createSchedule({
      options: { target: "s:w", prompt: "go" },
      at: "2000-01-01T00:00:00.000Z",
      nextRun: "2000-01-01T00:00:00.000Z",
    });
    const { calls, dispatch } = counter();

    const res = await tick({ store, dispatch });
    expect(calls).toHaveLength(1);
    expect(res.succeeded).toHaveLength(1);
    expect(res.succeeded[0]!.id).toBe(sched.id);
    const after = store.getSchedule(sched.id)!;
    expect(after.status).toBe("succeeded");
    expect(after.lastAttemptId).toBe("rec1");
    expect(after.lastAttemptAt).toBeDefined();

    // Subsequent ticks do not re-fire a terminal entry.
    const res2 = await tick({ store, dispatch });
    expect(res2.succeeded).toHaveLength(0);
    expect(calls).toHaveLength(1);
    store.close();
  });

  test("a failed one-shot stays admitted on retry and records failure receipt fields", async () => {
    const store = new Store(":memory:");
    const sched = store.createSchedule({
      options: { target: "s:w", prompt: "go" },
      at: "2000-01-01T00:00:00.000Z",
      nextRun: "2000-01-01T00:00:00.000Z",
    });
    const dispatch = async (): Promise<DispatchRecord> =>
      fakeRecord("rec-fail", "failed");

    const res = await tick({ store, dispatch, retryDelayMs: 60_000 });
    expect(res.succeeded).toHaveLength(0);
    expect(res.failed).toHaveLength(1);
    const after = store.getSchedule(sched.id)!;
    expect(after.status).toBe("admitted");
    expect(after.failureCount).toBe(1);
    expect(after.lastFailureAt).toBeDefined();
    expect(after.lastFailureReason).toBeDefined();
    expect(after.lastAttemptAt).toBeDefined();
    store.close();
  });

  test("the CAS claim fence refuses a stale claim on an already-moved entry", () => {
    const store = new Store(":memory:");
    const sched = store.createSchedule({
      options: { target: "s:w", prompt: "go" },
      at: "2000-01-01T00:00:00.000Z",
      nextRun: "2000-01-01T00:00:00.000Z",
    });
    store.updateSchedule(sched.id, { status: "cancelled" });
    // A stale tick holding "admitted" must not resurrect the cancelled entry.
    const refused = store.updateScheduleIfStatus(sched.id, "admitted", { status: "succeeded" });
    expect(refused).toBeUndefined();
    expect(store.getSchedule(sched.id)!.status).toBe("cancelled");
    store.close();
  });
});

describe("taxonomy — daemon observation surfaces", () => {
  test("daemonStatus reports queue depth with taxonomy keys and per-entry lease health", () => {
    const store = new Store(":memory:");
    store.createSchedule({
      options: { target: "s:w", prompt: "due" },
      at: "2000-01-01T00:00:00.000Z",
      nextRun: "2000-01-01T00:00:00.000Z",
    });
    const pidPath = join(tmpdir(), `dispatch_taxonomy_pid_${process.pid}_${Math.floor(Math.random() * 1e6)}.pid`);
    const statePath = join(tmpdir(), `dispatch_taxonomy_state_${process.pid}_${Math.floor(Math.random() * 1e6)}.json`);
    try {
      const st = daemonStatus(store, pidPath, statePath, new Date("2026-06-17T10:00:00.000Z"));
      expect(st.admitted).toBe(1);
      expect(st.succeeded).toBe(0);
      expect(st.paused).toBe(0);
      expect(st.nextDue?.status).toBe("admitted");
    } finally {
      rmSync(pidPath, { force: true });
      rmSync(statePath, { force: true });
      store.close();
    }
  });

  test("stale running dispatch records are failed by the daemon-side sweep", () => {
    const s = new Store(":memory:");
    const rec = s.createDispatch({ target: "s:w", prompt: "hi", status: "running" });
    const raw = s as unknown as {
      db: { query: (sql: string) => { run: (updatedAt: string, id: string) => void } };
    };
    raw.db.query("UPDATE dispatches SET updated_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", rec.id);
    expect(s.failStaleRunningDispatches(60_000)).toBe(1);
    expect(s.getDispatch(rec.id)!.status).toBe("failed");
    s.close();
  });
});
