// Sol-guided coverage (tests-coverage-sol workflow, 2026-08-19).
//
// Priority 3 — backup-on-migration contracts. EVERY backup path here points
// into a temporary directory (explicit backupDir or HASNA_BILLING_BACKUP_DIR);
// nothing touches ~/.hasna. Coverage: memory/missing/empty skips, successful
// backups with directory mode 0700 and file mode 0600, retention
// BACKUP_RETENTION=10 keeping only the newest ten with deterministic
// ordering, and the shouldBackupBeforeMigration truth matrix.

import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BACKUP_RETENTION,
  backupDatabaseBeforeMigration,
  listDatabaseBackups,
  pruneBackups,
  shouldBackupBeforeMigration,
} from "../src/db/backup.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "billing-backup-test-"));
}

afterEach(() => {
  delete process.env["HASNA_BILLING_BACKUP_DIR"];
  delete process.env["HASNA_BILLING_BACKUP_BEFORE_MIGRATION"];
});

describe("backup skip matrix", () => {
  it("skips an in-memory database", () => {
    const result = backupDatabaseBeforeMigration(":memory:", { backupDir: tempDir() });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("memory database");
  });

  it("skips a missing database file", () => {
    const result = backupDatabaseBeforeMigration(join(tempDir(), "does-not-exist.db"), { backupDir: tempDir() });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("database file does not exist");
  });

  it("skips an empty database file", () => {
    const dir = tempDir();
    const dbPath = join(dir, "empty.db");
    writeFileSync(dbPath, "");
    const result = backupDatabaseBeforeMigration(dbPath, { backupDir: join(dir, "backups") });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("database file is empty");
  });

  it("forces a backup of an empty file when force is set (explicit operator choice)", () => {
    const dir = tempDir();
    const dbPath = join(dir, "empty.db");
    writeFileSync(dbPath, "");
    const result = backupDatabaseBeforeMigration(dbPath, { backupDir: join(dir, "backups"), force: true });
    expect(result.skipped).toBe(false);
    expect(result.backup_path).toBeDefined();
  });
});

describe("successful backup", () => {
  it("copies the db to a 0600 file inside a 0700 directory, preserving the source", async () => {
    const dir = tempDir();
    const dbPath = join(dir, "billing.db");
    writeFileSync(dbPath, "sqlite-content-bytes");
    const backupDir = join(dir, "backups");

    const result = backupDatabaseBeforeMigration(dbPath, { backupDir, now: new Date("2026-08-19T12:00:00.000Z") });
    expect(result.skipped).toBe(false);
    expect(result.backup_path).toBe(join(backupDir, "billing.db-2026-08-19T12-00-00-000Z-pre-migration.db"));

    // Directory 0700, snapshot file 0600.
    expect(statSync(backupDir).mode & 0o777).toBe(0o700);
    expect(statSync(result.backup_path!).mode & 0o777).toBe(0o600);

    // Content preserved, source untouched.
    const snapshot = await Bun.file(result.backup_path!).text();
    expect(snapshot).toBe("sqlite-content-bytes");
    expect(await Bun.file(dbPath).text()).toBe("sqlite-content-bytes");
  });

  it("honors HASNA_BILLING_BACKUP_DIR for the destination", () => {
    const dir = tempDir();
    const dbPath = join(dir, "billing.db");
    writeFileSync(dbPath, "content");
    process.env["HASNA_BILLING_BACKUP_DIR"] = join(dir, "env-backups");
    const result = backupDatabaseBeforeMigration(dbPath);
    expect(result.backup_path).toContain(join(dir, "env-backups"));
    expect(statSync(process.env["HASNA_BILLING_BACKUP_DIR"]).mode & 0o777).toBe(0o700);
  });
});

describe("retention and ordering", () => {
  it("keeps exactly the newest BACKUP_RETENTION snapshots and deletes only older ones", () => {
    const dir = tempDir();
    const backupDir = join(dir, "backups");
    mkdirSync(backupDir, { recursive: true });
    const base = "billing.db";
    const names: string[] = [];
    // 12 backups at deterministic 1-second spacing — name order == time order.
    for (let i = 0; i < 12; i++) {
      const stamp = `2026-08-19T12:00:${String(i).padStart(2, "0")}-000Z`;
      names.push(join(backupDir, `${base}-${stamp}-pre-migration.db`));
    }
    for (const name of names) writeFileSync(name, "x");

    pruneBackups(backupDir, base);

    const remaining = readdirSync(backupDir).sort();
    expect(remaining).toHaveLength(BACKUP_RETENTION);
    // Newest ten survive (indexes 2..11), the two oldest (0,1) are deleted.
    expect(remaining[0]).toContain("12:00:02");
    expect(remaining[9]).toContain("12:00:11");
    expect(remaining.some((n) => n.includes("12:00:00") || n.includes("12:00:01"))).toBe(false);
  });

  it("never deletes when there are fewer snapshots than the retention cap", () => {
    const dir = tempDir();
    const backupDir = join(dir, "backups");
    mkdirSync(backupDir, { recursive: true });
    for (let i = 0; i < 3; i++) {
      writeFileSync(join(backupDir, `billing.db-2026-08-19T12:00:${String(i).padStart(2, "0")}-000Z-pre-migration.db`), "x");
    }
    pruneBackups(backupDir, "billing.db");
    expect(readdirSync(backupDir)).toHaveLength(3);
  });

  it("lists backups in deterministic newest-first order", () => {
    const dir = tempDir();
    const backupDir = join(dir, "backups");
    mkdirSync(backupDir, { recursive: true });
    const dbPath = join(dir, "billing.db");
    writeFileSync(dbPath, "content");
    for (const stamp of ["2026-08-19T12:00:00-000Z", "2026-08-19T12:00:01-000Z", "2026-08-19T12:00:02-000Z"]) {
      writeFileSync(join(backupDir, `billing.db-${stamp}-pre-migration.db`), "x");
    }
    const listed = listDatabaseBackups(dbPath, { backupDir });
    const seconds = listed.map((p) => p.match(/(\d{2})-000Z-pre-migration/)?.[1] ?? "");
    expect(seconds).toEqual(["02", "01", "00"]);
  });
});

describe("shouldBackupBeforeMigration truth matrix", () => {
  it.each([
    ["0", false],
    ["false", false],
    ["no", false],
    ["off", false],
    ["1", true],
    ["true", true],
    ["yes", true],
    ["on", true],
    ["", true], // empty string -> default enabled
  ])("treats BACKUP_BEFORE_MIGRATION=%s as %p", (value, expected) => {
    process.env["HASNA_BILLING_BACKUP_BEFORE_MIGRATION"] = value;
    expect(shouldBackupBeforeMigration()).toBe(expected);
  });

  it("defaults to enabled when the variable is unset", () => {
    expect(shouldBackupBeforeMigration()).toBe(true);
  });
});
