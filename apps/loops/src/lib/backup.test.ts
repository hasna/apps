import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupDatabase } from "./backup.js";
import { Store } from "./store.js";

function makeDb(root: string): string {
  const dbFile = join(root, "loops.db");
  const store = new Store(dbFile);
  try {
    store.createLoop(
      {
        name: "backup-probe",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: "true" },
      },
      new Date("2025-12-31T00:00:00Z"),
    );
  } finally {
    store.close();
  }
  return dbFile;
}

describe("backupDatabase", () => {
  test("writes a valid VACUUM INTO snapshot with owner-only permissions", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-backup-"));
    const dbFile = makeDb(root);
    const result = backupDatabase({ reason: "pre-migration", dbFile, now: new Date("2026-01-01T00:00:00.000Z") });
    expect(result.skipped).toBe(false);
    expect(result.path).toBeDefined();
    expect(existsSync(result.path!)).toBe(true);
    expect(statSync(result.path!).mode & 0o777).toBe(0o600);
    const snapshot = new Database(result.path!, { readonly: true });
    try {
      const row = snapshot.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM loops").get();
      expect(row?.count).toBe(1);
    } finally {
      snapshot.close();
    }
  });

  test("debounces per reason within an hour but not across reasons", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-backup-debounce-"));
    const dbFile = makeDb(root);
    const first = backupDatabase({ reason: "daily", dbFile, now: new Date("2026-01-01T00:00:00.000Z") });
    expect(first.skipped).toBe(false);
    const debounced = backupDatabase({ reason: "daily", dbFile, now: new Date("2026-01-01T00:30:00.000Z") });
    expect(debounced.skipped).toBe(true);
    expect(debounced.path).toBeUndefined();
    const otherReason = backupDatabase({ reason: "pre-migration", dbFile, now: new Date("2026-01-01T00:30:00.000Z") });
    expect(otherReason.skipped).toBe(false);
    const later = backupDatabase({ reason: "daily", dbFile, now: new Date("2026-01-01T01:30:00.000Z") });
    expect(later.skipped).toBe(false);
    expect(later.path).not.toBe(first.path);
  });

  test("force writes a fresh backup inside the debounce window", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-backup-force-"));
    const dbFile = makeDb(root);
    const first = backupDatabase({ reason: "output-quarantine", dbFile, now: new Date("2026-01-01T00:00:00.000Z") });
    const forced = backupDatabase({
      reason: "output-quarantine",
      dbFile,
      force: true,
      now: new Date("2026-01-01T00:30:00.000Z"),
    });
    expect(first.skipped).toBe(false);
    expect(forced.skipped).toBe(false);
    expect(forced.path).toBeDefined();
    expect(forced.path).not.toBe(first.path);
    expect(existsSync(forced.path!)).toBe(true);
  });

  test("prunes old backups beyond keep per reason", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-backup-retention-"));
    const dbFile = makeDb(root);
    const paths: string[] = [];
    for (let hour = 0; hour < 5; hour += 1) {
      const result = backupDatabase({
        reason: "daily",
        dbFile,
        keep: 3,
        now: new Date(Date.UTC(2026, 0, 1, hour * 2)),
      });
      expect(result.skipped).toBe(false);
      paths.push(result.path!);
    }
    const backupsDir = join(root, "backups");
    const remaining = readdirSync(backupsDir).filter((name) => name.startsWith("loops-daily-"));
    expect(remaining).toHaveLength(3);
    expect(existsSync(paths[0]!)).toBe(false);
    expect(existsSync(paths[1]!)).toBe(false);
    expect(existsSync(paths[4]!)).toBe(true);
  });

  test("skips when the database file is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-backup-missing-"));
    const result = backupDatabase({ reason: "daily", dbFile: join(root, "absent.db") });
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain("not found");
  });
});
