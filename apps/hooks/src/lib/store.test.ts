import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/migrations/index.js";
import {
  getHookRecord,
  listHookRecords,
  upsertHookRecord,
  removeHookRecord,
  readLock,
  writeLock,
  setPinnedHook,
  getPinnedHook,
  removePinnedHook,
  verifyScriptHash,
  retrustHook,
  sha256Of,
} from "./store.js";
import { writeCustomHook } from "./manifest.js";
import { closeDb } from "../db/index.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "hooks-store-test-"));

beforeAll(() => {
  process.env.HASNA_HOOKS_DATA_DIR = TEST_DIR;
  process.env.HASNA_HOOKS_DB_PATH = ":memory:";
});

afterAll(() => {
  delete process.env.HASNA_HOOKS_DATA_DIR;
  delete process.env.HASNA_HOOKS_DB_PATH;
  closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("hooks table migration", () => {
  test("004 creates the hooks table and keeps existing tables intact", () => {
    const db = new Database(":memory:");
    try {
      runMigrations(db);
      const tables = db
        .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => r.name);
      expect(tables).toContain("hooks");
      expect(tables).toContain("hook_events");
      db.run(
        `INSERT INTO hook_events (id, timestamp, session_id, hook_name, event_type)
         VALUES ('e1', ?, 's1', 'gitguard', 'PreToolUse')`,
        [new Date().toISOString()],
      );
      db.run(
        `INSERT INTO hooks (id, name, version, sha256, source_type, installed_at)
         VALUES ('gitguard', 'gitguard', '0.1.0', ?, 'bundled', ?)`,
        ["abc", new Date().toISOString()],
      );
      expect(getHookRecord(db, "gitguard")?.version).toBe("0.1.0");
    } finally {
      db.close();
    }
  });

  test("runMigrations is idempotent on the hooks table", () => {
    const db = new Database(":memory:");
    try {
      runMigrations(db);
      runMigrations(db);
      const count = db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM hooks").get();
      expect(count?.n).toBe(0);
    } finally {
      db.close();
    }
  });
});

describe("hook records", () => {
  test("upsert updates in place and preserves installed_at", () => {
    const db = new Database(":memory:");
    try {
      runMigrations(db);
      upsertHookRecord(db, { name: "demo", version: "1.0.0", sha256: "a", source_type: "custom" });
      const first = getHookRecord(db, "demo");
      expect(first?.installed_at).toBeTruthy();
      expect(listHookRecords(db)).toHaveLength(1);

      upsertHookRecord(db, { name: "demo", version: "1.1.0", sha256: "b", source_type: "custom" });
      const second = getHookRecord(db, "demo");
      expect(second?.version).toBe("1.1.0");
      expect(second?.sha256).toBe("b");
      expect(second?.installed_at).toBe(first?.installed_at);
      expect(listHookRecords(db)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  test("removeHookRecord deletes and reports", () => {
    const db = new Database(":memory:");
    try {
      runMigrations(db);
      upsertHookRecord(db, { name: "demo", version: "1.0.0", sha256: "a", source_type: "custom" });
      expect(removeHookRecord(db, "demo")).toBe(true);
      expect(removeHookRecord(db, "demo")).toBe(false);
      expect(getHookRecord(db, "demo")).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe("lock file", () => {
  test("write/read round-trips with sorted keys", () => {
    writeLock({ hooks: { zebra: { version: "2.0.0", sha256: "z", source: "remote" }, alpha: { version: "1.0.0", sha256: "a", source: "bundled" } } });
    const lock = readLock();
    expect(Object.keys(lock.hooks)).toEqual(["alpha", "zebra"]);
    expect(lock.hooks.alpha).toEqual({ version: "1.0.0", sha256: "a", source: "bundled" });
  });

  test("setPinnedHook and removePinnedHook", () => {
    setPinnedHook("demo", { version: "1.0.0", sha256: "a", source: "custom" });
    expect(getPinnedHook("demo")).toEqual({ version: "1.0.0", sha256: "a", source: "custom" });
    expect(removePinnedHook("demo")).toBe(true);
    expect(getPinnedHook("demo")).toBeUndefined();
    expect(removePinnedHook("demo")).toBe(false);
  });
});

describe("sha256 trust", () => {
  test("sha256Of matches known digest", () => {
    expect(sha256Of("hello")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  test("first run pins the hash; script change refuses; retrust re-pins", async () => {
    const manifest = { name: "demo", version: "1.0.0", description: "demo", events: ["PostToolUse"], script: "hook.ts" };
    const { scriptPath } = writeCustomHook("demo", manifest, "export default 1;", "hook.ts");

    const first = await verifyScriptHash("demo", scriptPath);
    expect(first.ok).toBe(true);
    expect(first.pinned).toBe(false);

    writeFileSync(scriptPath, "export default 2;", "utf-8");
    const mismatch = await verifyScriptHash("demo", scriptPath);
    expect(mismatch.ok).toBe(false);
    expect(mismatch.expected).not.toBe(mismatch.actual);

    const trusted = retrustHook("demo", scriptPath, "1.0.0", "custom");
    expect(trusted.ok).toBe(true);
    expect(trusted.actual).toBe(mismatch.actual);

    const after = await verifyScriptHash("demo", scriptPath);
    expect(after.ok).toBe(true);
    expect(after.pinned).toBe(true);
  });
});
