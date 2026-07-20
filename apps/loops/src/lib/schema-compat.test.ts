import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.js";

// Neutralization coverage for the schema-compat soft-open (reviewer finding F1
// on the 0.4.18 drain-reliability review). The 2026-07-07 schema-8 lockout:
// a newer binary auto-migrated the production database (additive migrations
// 0009+0010, user_version 7 -> 8) and every older CLI hard-refused to open it,
// bricking the fleet even though the delta was harmless. The database now
// carries a compatibility floor (`schema_compat.min_compatible_user_version`,
// raised only by BREAKING migrations); an older binary opens newer databases
// whenever it meets the floor and refuses only on a known-breaking delta.

describe("schema-compat soft-open", () => {
  let root: string;
  let dbFile: string;
  let oldDataDir: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "loops-schema-compat-"));
    dbFile = join(root, "loops.db");
    oldDataDir = process.env.LOOPS_DATA_DIR;
    process.env.LOOPS_DATA_DIR = root;
    // Seed a real database at this binary's schema (writes the floor row).
    const store = new Store(dbFile);
    store.createLoop({
      name: "schema-compat-seed",
      schedule: { type: "interval", everyMs: 60_000 },
      target: { type: "command", command: "true" },
    });
    store.close();
  });
  afterEach(() => {
    if (oldDataDir === undefined) delete process.env.LOOPS_DATA_DIR;
    else process.env.LOOPS_DATA_DIR = oldDataDir;
    rmSync(root, { recursive: true, force: true });
  });

  /** Simulate a NEWER binary having migrated this database. */
  function simulateNewerBinary(opts: { userVersion: number; floor?: number; dropFloor?: boolean }): void {
    const raw = new Database(dbFile);
    try {
      raw.exec(`PRAGMA user_version = ${opts.userVersion}`);
      raw.query("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
        "0099_future_additive_feature",
        new Date().toISOString(),
      );
      raw.exec("CREATE TABLE IF NOT EXISTS future_additive_feature (id TEXT PRIMARY KEY, payload TEXT)");
      if (opts.floor !== undefined) {
        raw.query("UPDATE schema_compat SET min_compatible_user_version = ? WHERE id = 1").run(opts.floor);
      }
      if (opts.dropFloor) raw.exec("DROP TABLE schema_compat");
    } finally {
      raw.close();
    }
  }

  function rawUserVersion(): number {
    const raw = new Database(dbFile);
    try {
      return (raw.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version) ?? -1;
    } finally {
      raw.close();
    }
  }

  test("opens a newer database whose extra migrations are additive (floor met)", () => {
    // A newer binary migrated to user_version 9 with an additive migration and
    // left the floor untouched. Before the fix this threw "newer than this
    // binary supports" — the exact lockout that bricked the CLI fleet.
    simulateNewerBinary({ userVersion: 9 });
    const reopened = new Store(dbFile);
    try {
      expect(reopened.listLoops().length).toBe(1);
      // Still fully usable for writes.
      reopened.createLoop({
        name: "schema-compat-after-soft-open",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      expect(reopened.listLoops().length).toBe(2);
    } finally {
      reopened.close();
    }
    // The newer stamp is preserved — never downgraded by the older binary.
    expect(rawUserVersion()).toBe(9);
  });

  test("refuses a newer database whose floor exceeds this binary (known-breaking delta)", () => {
    simulateNewerBinary({ userVersion: 9, floor: 9 });
    expect(() => new Store(dbFile)).toThrow(/requires a binary with schema support >= 9/);
  });

  test("refuses a newer database that carries no compatibility floor (conservative)", () => {
    simulateNewerBinary({ userVersion: 9, dropFloor: true });
    expect(() => new Store(dbFile)).toThrow(/carries no compatibility floor/);
  });

  test("an older binary never lowers a higher floor written by a newer one", () => {
    // Newer binary raised the floor to 8 but this binary (8) still meets it:
    // soft-open works AND the floor stays 8 after our max() upsert.
    simulateNewerBinary({ userVersion: 9, floor: 8 });
    const reopened = new Store(dbFile);
    reopened.close();
    const raw = new Database(dbFile);
    try {
      const floor = raw
        .query<{ min_compatible_user_version: number }, []>("SELECT min_compatible_user_version FROM schema_compat WHERE id = 1")
        .get();
      expect(floor?.min_compatible_user_version).toBe(8);
    } finally {
      raw.close();
    }
  });
});
