import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDataDir, getDatabase, resetDatabase } from "./schema.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "browser-test-"));
  process.env["BROWSER_DB_PATH"] = join(tmpDir, "test.db");
  process.env["BROWSER_DATA_DIR"] = tmpDir;
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  delete process.env["BROWSER_DB_PATH"];
  delete process.env["BROWSER_DATA_DIR"];
});

describe("DB schema", () => {
  it("creates database and all tables", () => {
    const db = getDatabase();
    expect(db).toBeDefined();
    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    expect(tables).toContain("sessions");
    expect(tables).toContain("snapshots");
    expect(tables).toContain("network_log");
    expect(tables).toContain("console_log");
    expect(tables).toContain("recordings");
    expect(tables).toContain("video_recordings");
    expect(tables).toContain("crawl_results");
    expect(tables).toContain("agents");
    expect(tables).toContain("projects");
    expect(tables).toContain("heartbeats");
    expect(tables).not.toContain("scripts");
    expect(tables).not.toContain("script_steps");
    expect(tables).not.toContain("script_runs");
    expect(tables).not.toContain("watch_jobs");
    expect(tables).not.toContain("watch_events");
    expect(tables).not.toContain("cron_jobs");
    expect(tables).not.toContain("cron_events");
  });

  it("WAL mode is enabled", () => {
    const db = getDatabase();
    const row = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get();
    expect(row?.journal_mode).toBe("wal");
  });

  it("waits briefly for concurrent writers", () => {
    const db = getDatabase();
    const row = db.query<{ timeout: number }, []>("PRAGMA busy_timeout").get();
    expect(row?.timeout).toBe(5000);
  });

  it("drops removed workflow-like storage tables on upgraded installs", () => {
    const dbPath = join(tmpDir, "test.db");
    const oldDb = new Database(dbPath);
    oldDb.exec(`
      CREATE TABLE workflows (id TEXT PRIMARY KEY);
      CREATE TABLE scripts (id TEXT PRIMARY KEY);
      CREATE TABLE script_steps (id TEXT PRIMARY KEY);
      CREATE TABLE script_runs (id TEXT PRIMARY KEY);
      CREATE TABLE watch_jobs (id TEXT PRIMARY KEY);
      CREATE TABLE watch_events (id TEXT PRIMARY KEY);
      CREATE TABLE cron_jobs (id TEXT PRIMARY KEY);
      CREATE TABLE cron_events (id TEXT PRIMARY KEY);
    `);
    oldDb.close();

    const db = getDatabase();
    for (const table of ["workflows", "scripts", "script_steps", "script_runs", "watch_jobs", "watch_events", "cron_jobs", "cron_events"]) {
      const row = db
        .query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table);
      expect(row).toBeNull();
    }
  });

  it("returns same instance on repeated calls", () => {
    const db1 = getDatabase();
    const db2 = getDatabase();
    expect(db1).toBe(db2);
  });

  it("resetDatabase clears the singleton", () => {
    const db1 = getDatabase();
    resetDatabase();
    const db2 = getDatabase();
    expect(db1).not.toBe(db2);
  });

  it("migrates legacy ~/.browser files into ~/.hasna/browser", () => {
    const originalHome = process.env["HOME"];
    const originalUserProfile = process.env["USERPROFILE"];
    const kindOverrides = ["HASNA_DATA_HOME", "HASNA_CONFIG_HOME", "HASNA_STATE_HOME", "HASNA_CACHE_HOME"];
    const savedKindOverrides = Object.fromEntries(kindOverrides.map((k) => [k, process.env[k]]));
    const oldDir = join(tmpDir, ".browser");
    const newDir = join(tmpDir, ".hasna", "browser");

    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, "browser.db"), "legacy-db");

    delete process.env["BROWSER_DB_PATH"];
    delete process.env["BROWSER_DATA_DIR"];
    for (const k of kindOverrides) delete process.env[k];
    process.env["HOME"] = tmpDir;
    delete process.env["USERPROFILE"];
    resetDatabase();

    try {
      expect(getDataDir()).toBe(newDir);
      expect(existsSync(newDir)).toBe(true);
      expect(readFileSync(join(newDir, "browser.db"), "utf8")).toBe("legacy-db");
    } finally {
      if (originalHome === undefined) {
        delete process.env["HOME"];
      } else {
        process.env["HOME"] = originalHome;
      }
      if (originalUserProfile === undefined) {
        delete process.env["USERPROFILE"];
      } else {
        process.env["USERPROFILE"] = originalUserProfile;
      }
      for (const k of kindOverrides) {
        if (savedKindOverrides[k] === undefined) delete process.env[k];
        else process.env[k] = savedKindOverrides[k];
      }
    }
  });
});
