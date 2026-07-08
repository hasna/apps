import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runDbIntegrityCheck, runOpsStateSnapshot } from "./ops-loop.js";

let testDir: string | undefined;
const originalHome = process.env["HOME"];
const originalSnapshotRoot = process.env["HASNA_FILES_OPS_SNAPSHOT_ROOT"];

afterEach(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
  if (originalHome) process.env["HOME"] = originalHome;
  else delete process.env["HOME"];
  if (originalSnapshotRoot) process.env["HASNA_FILES_OPS_SNAPSHOT_ROOT"] = originalSnapshotRoot;
  else delete process.env["HASNA_FILES_OPS_SNAPSHOT_ROOT"];
});

function makeTempDir(): string {
  testDir = join(tmpdir(), `open-files-ops-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  return testDir;
}

function createDb(path: string): void {
  const db = new Database(path);
  db.exec("CREATE TABLE items (id TEXT PRIMARY KEY, value TEXT); INSERT INTO items VALUES ('a', 'b');");
  db.close();
}

describe("ops loop checks", () => {
  test("checks SQLite integrity and reports corrupt DBs without leaking content", () => {
    const dir = makeTempDir();
    const goodDb = join(dir, "good.db");
    const badDb = join(dir, "bad.db");
    createDb(goodDb);
    writeFileSync(badDb, "not sqlite");

    const result = runDbIntegrityCheck({ roots: [dir], maxDbs: 10 });

    expect(result.summary.discovered).toBe(2);
    expect(result.summary.ok).toBe(1);
    expect(result.summary.failed).toBe(1);
    expect(result.databases.find((entry) => entry.path === goodDb)?.status).toBe("ok");
    expect(result.databases.find((entry) => entry.path === badDb)?.status).toBe("failed");
    expect(result.summary.timed_out).toBe(false);
    expect(JSON.stringify(result)).not.toContain("not sqlite");
  });

  test("honours the wall-clock budget instead of stalling on a big DB tree", () => {
    const dir = makeTempDir();
    for (let i = 0; i < 5; i += 1) createDb(join(dir, `db-${i}.db`));

    // A 0-ms budget forces every discovered DB to be skipped as timed out,
    // proving the check always returns instead of blocking on the tree.
    const result = runDbIntegrityCheck({ roots: [dir], maxDbs: 10, timeoutMs: 0 });

    expect(result.summary.discovered).toBe(5);
    expect(result.summary.timed_out).toBe(true);
    expect(result.summary.checked).toBe(0);
    expect(result.summary.skipped).toBe(5);
    expect(result.databases.every((entry) => entry.detail === "time budget exceeded")).toBe(true);
  });

  test("creates bounded operational DB snapshots and supports dry runs", () => {
    const dir = makeTempDir();
    process.env["HASNA_FILES_OPS_SNAPSHOT_ROOT"] = join(dir, ".hasna", "files", "snapshots", "ops-state");
    const dbPath = join(dir, "state.db");
    const snapshotDir = join(dir, ".hasna", "files", "snapshots", "ops-state", "test");
    createDb(dbPath);

    const dryRun = runOpsStateSnapshot({ roots: [dir], snapshotDir, dryRun: true });
    expect(dryRun.summary.copied).toBe(0);
    expect(dryRun.summary.skipped).toBe(1);
    expect(existsSync(snapshotDir)).toBe(false);

    const result = runOpsStateSnapshot({ roots: [dir], snapshotDir });
    expect(result.summary.copied).toBe(1);
    expect(result.summary.failed).toBe(0);
    expect(result.snapshots[0]?.destination).toBeTruthy();
    expect(existsSync(result.snapshots[0]!.destination!)).toBe(true);
    expect((statSync(result.snapshots[0]!.destination!).mode & 0o777).toString(8)).toBe("600");
  });

  test("refuses to prune snapshot directories outside the managed root", () => {
    const dir = makeTempDir();
    const dbPath = join(dir, "state.db");
    createDb(dbPath);

    expect(() => runOpsStateSnapshot({ roots: [dir], snapshotDir: dir })).toThrow("Refusing snapshot-dir outside managed root");
  });

  test("skips secret-bearing databases during snapshots", () => {
    const dir = makeTempDir();
    process.env["HASNA_FILES_OPS_SNAPSHOT_ROOT"] = join(dir, ".hasna", "files", "snapshots", "ops-state");
    const secretsDir = join(dir, ".hasna", "secrets");
    const filesDir = join(dir, ".hasna", "files");
    mkdirSync(secretsDir, { recursive: true });
    mkdirSync(filesDir, { recursive: true });
    createDb(join(secretsDir, "vault.db"));
    createDb(join(filesDir, "files.db"));

    const result = runOpsStateSnapshot({ roots: [join(dir, ".hasna")], snapshotDir: undefined, dryRun: true });

    expect(result.summary.discovered).toBe(1);
    expect(result.snapshots[0]!.source).toContain(`${sepForPlatform()}files${sepForPlatform()}files.db`);
  });
});

function sepForPlatform(): string {
  return process.platform === "win32" ? "\\" : "/";
}
