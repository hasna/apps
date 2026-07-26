import { describe, test, expect } from "bun:test";
import { SqliteAdapter as Database } from "./sqlite-adapter.js";
import {
  createJob, getJob, getJobByName, listJobs, listEnabledJobs,
  updateJob, deleteJob, touchJobLastRun,
  createJobRun, finishJobRun, getLatestRun, listJobRuns,
} from "./jobs.js";

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

describe("createJob", () => {
  test("creates a job with defaults", () => {
    const db = makeDb();
    const job = createJob({ name: "test-job", connector: "stripe", command: "products list", cron: "0 9 * * *" }, db);
    expect(job.name).toBe("test-job");
    expect(job.connector).toBe("stripe");
    expect(job.command).toBe("products list");
    expect(job.cron).toBe("0 9 * * *");
    expect(job.enabled).toBe(true);
    expect(job.strip).toBe(false);
    expect(job.args).toEqual([]);
    expect(job.id).toHaveLength(8);
  });

  test("creates a job with args and strip", () => {
    const db = makeDb();
    const job = createJob({ name: "j2", connector: "github", command: "issues list", args: ["--limit", "10"], cron: "*/5 * * * *", strip: true }, db);
    expect(job.args).toEqual(["--limit", "10"]);
    expect(job.strip).toBe(true);
  });
});

describe("getJob / getJobByName", () => {
  test("returns null for unknown id", () => {
    expect(getJob("nope1234", makeDb())).toBeNull();
  });
  test("finds by name", () => {
    const db = makeDb();
    createJob({ name: "myjob", connector: "stripe", command: "list", cron: "* * * * *" }, db);
    expect(getJobByName("myjob", db)?.name).toBe("myjob");
  });
  test("returns null for unknown name", () => {
    expect(getJobByName("nobody", makeDb())).toBeNull();
  });
});

describe("listJobs / listEnabledJobs", () => {
  test("lists all jobs ordered by name", () => {
    const db = makeDb();
    createJob({ name: "zebra", connector: "a", command: "x", cron: "* * * * *" }, db);
    createJob({ name: "apple", connector: "b", command: "y", cron: "* * * * *" }, db);
    const names = listJobs(db).map(j => j.name);
    expect(names).toEqual(["apple", "zebra"]);
  });

  test("listEnabledJobs returns only enabled", () => {
    const db = makeDb();
    const j1 = createJob({ name: "enabled-job", connector: "a", command: "x", cron: "* * * * *" }, db);
    const j2 = createJob({ name: "disabled-job", connector: "b", command: "y", cron: "* * * * *" }, db);
    updateJob(j2.id, { enabled: false }, db);
    const enabled = listEnabledJobs(db);
    expect(enabled.map(j => j.name)).toContain("enabled-job");
    expect(enabled.map(j => j.name)).not.toContain("disabled-job");
  });
});

describe("updateJob", () => {
  test("disables a job", () => {
    const db = makeDb();
    const job = createJob({ name: "j", connector: "a", command: "x", cron: "* * * * *" }, db);
    updateJob(job.id, { enabled: false }, db);
    expect(getJob(job.id, db)?.enabled).toBe(false);
  });

  test("enables strip", () => {
    const db = makeDb();
    const job = createJob({ name: "j2", connector: "a", command: "x", cron: "* * * * *" }, db);
    updateJob(job.id, { strip: true }, db);
    expect(getJob(job.id, db)?.strip).toBe(true);
  });

  test("no-op update returns job unchanged", () => {
    const db = makeDb();
    const job = createJob({ name: "j3", connector: "a", command: "x", cron: "* * * * *" }, db);
    const result = updateJob(job.id, {}, db);
    expect(result.name).toBe("j3");
  });
});

describe("deleteJob", () => {
  test("deletes existing job", () => {
    const db = makeDb();
    const job = createJob({ name: "todel", connector: "a", command: "x", cron: "* * * * *" }, db);
    expect(deleteJob(job.id, db)).toBe(true);
    expect(getJob(job.id, db)).toBeNull();
  });
  test("returns false for non-existent", () => {
    expect(deleteJob("nope1234", makeDb())).toBe(false);
  });
});

describe("touchJobLastRun", () => {
  test("updates last_run_at", () => {
    const db = makeDb();
    const job = createJob({ name: "touch-test", connector: "a", command: "x", cron: "* * * * *" }, db);
    expect(job.last_run_at).toBeNull();
    touchJobLastRun(job.id, db);
    expect(getJob(job.id, db)?.last_run_at).toBeTruthy();
  });
});

describe("job runs", () => {
  test("createJobRun + finishJobRun + getLatestRun", () => {
    const db = makeDb();
    const job = createJob({ name: "run-test", connector: "a", command: "x", cron: "* * * * *" }, db);
    const run = createJobRun(job.id, db);
    expect(run.exit_code).toBeNull();
    finishJobRun(run.id, { exit_code: 0, raw_output: '{"data":[]}', stripped_output: '{"data":[]}' }, db);
    const latest = getLatestRun(job.id, db);
    expect(latest?.exit_code).toBe(0);
    expect(latest?.raw_output).toBe('{"data":[]}');
  });

  test("listJobRuns returns in reverse chronological order", async () => {
    const db = makeDb();
    const job = createJob({ name: "list-runs", connector: "a", command: "x", cron: "* * * * *" }, db);
    const r1 = createJobRun(job.id, db);
    await new Promise(r => setTimeout(r, 5));
    const r2 = createJobRun(job.id, db);
    finishJobRun(r1.id, { exit_code: 0, raw_output: "first" }, db);
    finishJobRun(r2.id, { exit_code: 0, raw_output: "second" }, db);
    const runs = listJobRuns(job.id, 10, db);
    expect(runs[0].id).toBe(r2.id); // most recent first
    expect(runs.length).toBe(2);
  });

  test("getLatestRun returns null when no runs", () => {
    const db = makeDb();
    const job = createJob({ name: "norun-job", connector: "a", command: "x", cron: "* * * * *" }, db);
    expect(getLatestRun(job.id, db)).toBeNull();
  });
});
