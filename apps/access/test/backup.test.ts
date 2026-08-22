import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupDatabaseBeforeMigration, listDatabaseBackups, shouldBackupBeforeMigration } from "../src/db/backup.js";

/**
 * Direct tests for backup-on-migration (src/db/backup.ts): when a backup is
 * owed, that it is byte-identical and 0600, and that retention stays at 10.
 * All file work happens under a private temp dir; the real ~/.hasna/access
 * backup directory is never touched.
 */

let dir: string;
let backupDir: string;

function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "access-backup-test-"));
  backupDir = join(d, "backups");
  return d;
}

/** A real non-empty SQLite-shaped file as the "database to migrate". */
function writeSourceDb(contents = "file-data-v1"): string {
  const dbPath = join(dir, "source.db");
  writeFileSync(dbPath, contents);
  return dbPath;
}

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("shouldBackupBeforeMigration", () => {
  it("refuses in-memory databases", () => {
    dir = freshDir();
    expect(shouldBackupBeforeMigration(":memory:")).toBe(false);
    expect(shouldBackupBeforeMigration("file::memory:?cache=shared")).toBe(false);
  });

  it("refuses a missing database file", () => {
    dir = freshDir();
    expect(shouldBackupBeforeMigration(join(dir, "does-not-exist.db"))).toBe(false);
  });

  it("refuses an empty (zero-byte) database file", () => {
    dir = freshDir();
    const dbPath = join(dir, "empty.db");
    writeFileSync(dbPath, "");
    expect(shouldBackupBeforeMigration(dbPath)).toBe(false);
  });

  it("returns true for a non-empty existing database", () => {
    dir = freshDir();
    expect(shouldBackupBeforeMigration(writeSourceDb())).toBe(true);
  });
});

describe("backupDatabaseBeforeMigration", () => {
  it("refuses when the source database is missing", () => {
    dir = freshDir();
    expect(() => backupDatabaseBeforeMigration(join(dir, "missing.db"), backupDir)).toThrow(/source database missing/);
  });

  it("fails explicitly when the backup destination cannot become a directory", () => {
    dir = freshDir();
    const source = writeSourceDb();
    // A regular file at the backup-dir path: mkdirSync cannot create a directory over it.
    writeFileSync(backupDir, "not a directory");
    expect(() => backupDatabaseBeforeMigration(source, backupDir)).toThrow();
    // The source database is untouched by the failed backup.
    expect(readFileSync(source, "utf8")).toBe("file-data-v1");
  });

  it("writes a byte-identical, 0600, access-*-pre-migration.db snapshot", () => {
    dir = freshDir();
    const source = writeSourceDb("sqlite-content-with-bytes");
    const result = backupDatabaseBeforeMigration(source, backupDir);

    expect(existsSync(result.path)).toBe(true);
    expect(result.path).toMatch(/access-.*-pre-migration\.db$/);
    expect(result.bytes).toBe(Buffer.byteLength("sqlite-content-with-bytes"));
    expect(readFileSync(result.path)).toEqual(readFileSync(source));
    expect(statSync(result.path).mode & 0o777).toBe(0o600);
    expect(statSync(backupDir).mode & 0o777).toBe(0o700);
    expect(listDatabaseBackups(backupDir)).toEqual([result.path.split("/").pop()]);
  });

  it("lists only access-*-pre-migration.db files and ignores foreign files", () => {
    dir = freshDir();
    const source = writeSourceDb();
    backupDatabaseBeforeMigration(source, backupDir);
    writeFileSync(join(backupDir, "notes.txt"), "not a backup");
    writeFileSync(join(backupDir, "access-2026-01-01-wal.db"), "not pre-migration");
    const names = listDatabaseBackups(backupDir);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^access-.*-pre-migration\.db$/);
  });

  it("returns an empty list for a missing backup dir", () => {
    dir = freshDir();
    expect(listDatabaseBackups(join(dir, "no-such-dir"))).toEqual([]);
  });
});

describe("retention — at most 10 snapshots, oldest pruned", () => {
  it("prunes to the newest 10 after an 11th backup", () => {
    dir = freshDir();
    const source = writeSourceDb();
    mkdirSync(backupDir, { recursive: true });

    // Pre-create 11 older backups with distinct, lexicographically-ordered names.
    const iso = (day: number, hour: number) => `2026-01-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}-00-00-000Z`;
    for (let day = 1; day <= 11; day++) {
      const name = `access-${iso(day, 1)}-pre-migration.db`;
      writeFileSync(join(backupDir, name), `old-${day}`);
    }
    expect(listDatabaseBackups(backupDir)).toHaveLength(11);

    const result = backupDatabaseBeforeMigration(source, backupDir);
    const names = listDatabaseBackups(backupDir);

    expect(names).toHaveLength(10);
    // The two oldest (day 1 and day 2) were pruned; the newest created backup is kept.
    expect(names).not.toContain("access-2026-01-01T01-00-00-000Z-pre-migration.db");
    expect(names).not.toContain("access-2026-01-02T01-00-00-000Z-pre-migration.db");
    expect(names).toContain(result.path.split("/").pop());
  });

  it("keeps 10 or fewer backups untouched", () => {
    dir = freshDir();
    const source = writeSourceDb();
    mkdirSync(backupDir, { recursive: true });
    for (let day = 1; day <= 10; day++) {
      const name = `access-2026-01-${String(day).padStart(2, "0")}T01-00-00-000Z-pre-migration.db`;
      writeFileSync(join(backupDir, name), `old-${day}`);
    }
    backupDatabaseBeforeMigration(source, backupDir);
    expect(listDatabaseBackups(backupDir)).toHaveLength(10);
  });
});
