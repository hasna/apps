// Coverage lane (tests-coverage-sol workflow, Sol advisory Priority 3): the
// backup-on-migration path (src/db/backup.ts) had no tests at origin/main.
// These tests pin the honest, directly-reachable backup behavior: in-memory and
// nonexistent-DB skips, a successful snapshot under a 0700 backups directory
// with a 0600 file, retention N=10 removing ONLY the oldest backups (newest
// survive, ordered by mtime), and that the snapshot is a usable SQLite database.
// Per Sol: the shape-changing-triggers-backup production path is currently
// unreachable (the plan holds only the initial non-shape-changing step) and is
// NOT fabricated here; its negative arm lives in test/health-migration.test.ts.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupBeforeMigration } from "../src/db/backup.js";
import { getHoldingsBackupDir } from "../src/core/app-home.js";
import { migrationsApplied, openDatabase } from "../src/db/database.js";

let tmp: string;
let savedHome: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "holdings-bak-"));
  savedHome = process.env["HASNA_HOLDINGS_HOME"];
  process.env["HASNA_HOLDINGS_HOME"] = join(tmp, "home");
});
afterEach(() => {
  if (savedHome === undefined) delete process.env["HASNA_HOLDINGS_HOME"];
  else process.env["HASNA_HOLDINGS_HOME"] = savedHome;
  rmSync(tmp, { recursive: true, force: true });
});

describe("backupBeforeMigration — skip semantics", () => {
  it("skips in-memory databases with the exact reason", () => {
    const result = backupBeforeMigration(":memory:");
    expect(result).toEqual({ path: "", skipped: true, reason: "in-memory database" });
  });

  it("skips a database file that does not exist (initial create needs no pre-backup)", () => {
    const result = backupBeforeMigration(join(tmp, "nope.db"));
    expect(result).toEqual({ path: "", skipped: true, reason: "no existing database file" });
  });
});

describe("backupBeforeMigration — snapshot integrity and modes", () => {
  it("snapshots a real database into the 0700 backups dir as a 0600 file", () => {
    const dbPath = join(tmp, "holdings.db");
    const db = openDatabase(dbPath);
    db.close();

    const result = backupBeforeMigration(dbPath);
    expect(result.skipped).toBe(false);
    expect(result.path).toMatch(/holdings-\d{4}-\d{2}-\d{2}T.*-pre-migration\.db$/);
    expect(result.path!.startsWith(join(tmp, "home", "backups"))).toBe(true);

    const st = statSync(result.path!);
    expect(st.mode & 0o777).toBe(0o600);
    const dirSt = statSync(getHoldingsBackupDir());
    expect(dirSt.mode & 0o777).toBe(0o700);

    // The backup is a usable SQLite database, not a corrupted copy.
    const reopened = openDatabase(result.path!);
    expect(migrationsApplied()).toBeGreaterThanOrEqual(1);
    reopened.close();
  });
});

describe("backupBeforeMigration — retention N=10, newest-first", () => {
  it("keeps the newest 10 snapshots and removes ONLY the oldest, ordered by mtime", () => {
    const dbPath = join(tmp, "holdings.db");
    const db = openDatabase(dbPath);
    db.close();
    const backupsDir = getHoldingsBackupDir();
    mkdirSync(backupsDir, { recursive: true, mode: 0o700 });

    // Seed 12 older snapshots with distinct, controlled mtimes (i=0 oldest).
    for (let i = 0; i < 12; i++) {
      const path = join(backupsDir, `holdings-seed-${String(i).padStart(2, "0")}-pre-migration.db`);
      writeFileSync(path, "seed");
      const mtime = new Date(Date.now() - (12 - i) * 60_000);
      utimesSync(path, mtime, mtime);
    }

    const result = backupBeforeMigration(dbPath);
    const remaining = readdirSync(backupsDir).sort();
    expect(remaining.length).toBe(10);
    // The freshly created snapshot is the newest and survives.
    expect(remaining).toContain(join(result.path!).split("/").pop()!);
    // Exactly the two oldest seeds are pruned; the newer seeds survive.
    expect(remaining).not.toContain("holdings-seed-00-pre-migration.db");
    expect(remaining).not.toContain("holdings-seed-01-pre-migration.db");
    expect(remaining).toContain("holdings-seed-11-pre-migration.db");
    expect(remaining).toContain("holdings-seed-10-pre-migration.db");
  });

  it("does not touch snapshots of other shapes in the backups directory", () => {
    const dbPath = join(tmp, "holdings.db");
    const db = openDatabase(dbPath);
    db.close();
    const backupsDir = getHoldingsBackupDir();
    mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(backupsDir, "unrelated-file.txt"), "keep me");
    writeFileSync(join(backupsDir, "holdings-not-a-backup.db"), "keep me too");

    backupBeforeMigration(dbPath);

    expect(existsSync(join(backupsDir, "unrelated-file.txt"))).toBe(true);
    expect(existsSync(join(backupsDir, "holdings-not-a-backup.db"))).toBe(true);
  });
});
