import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runDbIntegrityCheck, runOpsStateSnapshot } from "./ops-loop.js";

let testDir: string | undefined;

afterEach(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
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
    expect(JSON.stringify(result)).not.toContain("not sqlite");
  });

  test("creates bounded operational DB snapshots and supports dry runs", () => {
    const dir = makeTempDir();
    const dbPath = join(dir, "state.db");
    const snapshotDir = join(dir, "snapshots");
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
  });
});
