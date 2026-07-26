import { afterEach, describe, test, expect } from "bun:test";
import { SqliteAdapter as Database } from "../db/sqlite-adapter.js";
import { cronMatches, startScheduler, stopScheduler, triggerJob } from "./scheduler.js";

function makeDb(): Database {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE IF NOT EXISTS connector_jobs (
    id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, connector TEXT NOT NULL,
    command TEXT NOT NULL, args TEXT NOT NULL DEFAULT '[]', cron TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1, strip INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, last_run_at TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS connector_job_runs (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL, started_at TEXT NOT NULL,
    finished_at TEXT, exit_code INTEGER, raw_output TEXT, stripped_output TEXT
  )`);
  return db;
}

describe("cronMatches", () => {
  test("wildcard * matches any value", () => {
    const d = new Date("2025-01-15T10:30:00");
    expect(cronMatches("* * * * *", d)).toBe(true);
  });

  test("exact minute match", () => {
    const d = new Date("2025-01-15T10:30:00");
    expect(cronMatches("30 10 * * *", d)).toBe(true);
    expect(cronMatches("31 10 * * *", d)).toBe(false);
  });

  test("step pattern */5 for minutes", () => {
    const d15 = new Date("2025-01-15T10:15:00");
    const d14 = new Date("2025-01-15T10:14:00");
    expect(cronMatches("*/5 * * * *", d15)).toBe(true);
    expect(cronMatches("*/5 * * * *", d14)).toBe(false);
  });

  test("step pattern */2 for hours", () => {
    const d0 = new Date("2025-01-15T00:00:00");
    const d2 = new Date("2025-01-15T02:00:00");
    const d1 = new Date("2025-01-15T01:00:00");
    expect(cronMatches("0 */2 * * *", d0)).toBe(true);
    expect(cronMatches("0 */2 * * *", d2)).toBe(true);
    expect(cronMatches("0 */2 * * *", d1)).toBe(false);
  });

  test("range pattern 1-5 for day of week (Mon-Fri)", () => {
    // 2025-01-13 is Monday (day 1), 2025-01-11 is Saturday (day 6)
    const monday = new Date("2025-01-13T09:00:00");
    const saturday = new Date("2025-01-11T09:00:00");
    expect(cronMatches("0 9 * * 1-5", monday)).toBe(true);
    expect(cronMatches("0 9 * * 1-5", saturday)).toBe(false);
  });

  test("list pattern 0,15,30,45 for minutes", () => {
    const d0 = new Date("2025-01-15T10:00:00");
    const d15 = new Date("2025-01-15T10:15:00");
    const d30 = new Date("2025-01-15T10:30:00");
    const d45 = new Date("2025-01-15T10:45:00");
    const d7 = new Date("2025-01-15T10:07:00");
    expect(cronMatches("0,15,30,45 * * * *", d0)).toBe(true);
    expect(cronMatches("0,15,30,45 * * * *", d15)).toBe(true);
    expect(cronMatches("0,15,30,45 * * * *", d30)).toBe(true);
    expect(cronMatches("0,15,30,45 * * * *", d45)).toBe(true);
    expect(cronMatches("0,15,30,45 * * * *", d7)).toBe(false);
  });

  test("invalid cron (wrong field count) returns false", () => {
    const d = new Date();
    expect(cronMatches("* * * *", d)).toBe(false); // only 4 fields
    expect(cronMatches("* * * * * *", d)).toBe(false); // 6 fields
    expect(cronMatches("", d)).toBe(false);
  });

  test("specific date match", () => {
    // Jan 15 at 09:30
    const d = new Date("2025-01-15T09:30:00");
    expect(cronMatches("30 9 15 1 *", d)).toBe(true);
    expect(cronMatches("30 9 16 1 *", d)).toBe(false); // wrong day
    expect(cronMatches("30 9 15 2 *", d)).toBe(false); // wrong month
  });

  test("day-of-week 0 = Sunday", () => {
    // 2025-01-12 is Sunday
    const sunday = new Date("2025-01-12T00:00:00");
    expect(cronMatches("* * * * 0", sunday)).toBe(true);
    expect(cronMatches("* * * * 1", sunday)).toBe(false);
  });
});

describe("startScheduler / stopScheduler", () => {
  afterEach(() => {
    stopScheduler();
  });

  test("stopScheduler is idempotent when not started", () => {
    expect(() => stopScheduler()).not.toThrow();
    expect(() => stopScheduler()).not.toThrow();
  });

  test("startScheduler starts and stopScheduler stops cleanly", () => {
    const db = makeDb();
    startScheduler(db);
    expect(() => stopScheduler()).not.toThrow();
  });

  test("startScheduler is idempotent (double-start safe)", () => {
    const db = makeDb();
    startScheduler(db);
    startScheduler(db); // second call no-op
    stopScheduler();
  });

  test("scheduler tick ignores a closed database during teardown", async () => {
    const db = makeDb();
    const originalSetInterval = globalThis.setInterval;
    let tick: (() => void) | null = null;

    globalThis.setInterval = ((handler: TimerHandler) => {
      tick = typeof handler === "function" ? handler as () => void : null;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval;

    try {
      startScheduler(db);
      db.close();
      expect(tick).not.toBeNull();
      expect(() => tick?.()).not.toThrow();
      await Promise.resolve();
    } finally {
      globalThis.setInterval = originalSetInterval;
    }
  });
});

describe("triggerJob", () => {
  test("creates a run record and returns result", async () => {
    const { createJob, listJobRuns } = await import("../db/jobs.js");
    const db = makeDb();
    const job = createJob(
      { name: "trig-test", connector: "stripe", command: "--help", args: [], cron: "* * * * *", strip: false },
      db
    );
    const result = await triggerJob(job, db);
    expect(result).toHaveProperty("run_id");
    expect(result).toHaveProperty("exit_code");
    expect(result).toHaveProperty("output");
    const runs = listJobRuns(job.id, 10, db);
    expect(runs.length).toBeGreaterThanOrEqual(1);
  }, 15000);

  test("handles job with strip=true (stripped_output stored)", async () => {
    const { createJob } = await import("../db/jobs.js");
    const db = makeDb();
    const job = createJob(
      { name: "strip-test", connector: "stripe", command: "--help", args: [], cron: "* * * * *", strip: true },
      db
    );
    const result = await triggerJob(job, db);
    // strip=true: output field returns stripped_output ?? raw_output
    expect(typeof result.output).toBe("string");
  }, 15000);
});
