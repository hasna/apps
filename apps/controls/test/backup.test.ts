// Sol-guided coverage (tests-coverage-sol workflow, lane controls) — Priority 4:
// pre-migration SQLite backups (src/db/backup.ts).
//
// DOCUMENTED LIMITATION (per Sol guidance): MIGRATION_PLAN (src/db/migration-plan.ts)
// currently holds only the baseline step — no shape-changing step — so the
// AUTOMATIC backup trigger inside getDatabase() (backupIfMigrationPending) is
// not end-to-end exercisable today: with the ledger already at the current
// migration id, no backup fires. backupDatabaseBeforeMigration is therefore
// tested DIRECTLY here, and when a shape-changing migration step is appended
// the trigger path should gain its own regression test.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupBasename, backupDatabaseBeforeMigration, listDatabaseBackups } from "../src/db/backup.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "controls-backup-"));
  process.env["HASNA_CONTROLS_HOME"] = tmp;
});

afterEach(() => {
  delete process.env["HASNA_CONTROLS_HOME"];
  rmSync(tmp, { recursive: true, force: true });
});

describe("backup: skip semantics", () => {
  it("skips an in-memory database", () => {
    expect(backupDatabaseBeforeMigration(":memory:")).toEqual({
      path: null,
      skipped: true,
      reason: "no on-disk database to back up",
    });
  });

  it("skips a missing database file", () => {
    expect(backupDatabaseBeforeMigration(join(tmp, "does-not-exist.db"))).toEqual({
      path: null,
      skipped: true,
      reason: "no on-disk database to back up",
    });
  });
});

describe("backup: snapshot hardening", () => {
  it("copies the database with file mode 0600 inside a 0700 backups directory", () => {
    const src = join(tmp, "live.db");
    writeFileSync(src, "money ledger bytes");

    const res = backupDatabaseBeforeMigration(src);
    expect(res.skipped).toBe(false);
    expect(res.path).not.toBeNull();
    expect(existsSync(res.path!)).toBe(true);
    expect(backupBasename(res.path!)).toMatch(/^controls-.*-pre-migration\.db$/);
    expect(statSync(join(tmp, "backups")).mode & 0o777).toBe(0o700);
    expect(statSync(res.path!).mode & 0o777).toBe(0o600);
    // The snapshot carries the exact source bytes.
    expect(readFileSync(res.path!)).toEqual(readFileSync(src));
  });
});

describe("backup: retention and ordering", () => {
  it("retains only the ten newest backups, oldest pruned, listing deterministic", () => {
    const src = join(tmp, "live.db");
    writeFileSync(src, "x");
    const dir = join(tmp, "backups");
    mkdirSync(dir, { recursive: true, mode: 0o700 });

    // 12 pre-existing backups with strictly increasing mtimes.
    const base = Date.UTC(2026, 0, 1);
    for (let i = 1; i <= 12; i++) {
      const p = join(dir, `controls-2026-01-01T00-00-00-${String(i).padStart(3, "0")}Z-pre-migration.db`);
      writeFileSync(p, "stale");
      const t = new Date(base + i * 60_000);
      utimesSync(p, t, t);
    }

    const res = backupDatabaseBeforeMigration(src);
    expect(res.skipped).toBe(false);

    // 12 stale + 1 new = 13; the 3 oldest are pruned.
    const all = listDatabaseBackups();
    expect(all).toHaveLength(10);
    expect(all.some((p) => p.endsWith("2026-01-01T00-00-00-001Z-pre-migration.db"))).toBe(false);
    expect(all.some((p) => p.endsWith("2026-01-01T00-00-00-003Z-pre-migration.db"))).toBe(false);
    expect(all.some((p) => p.endsWith("2026-01-01T00-00-00-012Z-pre-migration.db"))).toBe(true);
    expect(all.some((p) => p.endsWith("2026-01-01T00-00-00-004Z-pre-migration.db"))).toBe(true);

    // Deterministic ascending order (ISO-chronological filenames).
    expect(all).toEqual([...all].sort());
  });
});
