import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKUP_RETENTION, backupBeforeMigration } from "../src/db/backup.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "consolidations-backup-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("backup-on-migration", () => {
  it("no-ops for :memory: and missing files", () => {
    expect(backupBeforeMigration(":memory:", join(root, "backups"))).toBeNull();
    expect(backupBeforeMigration(join(root, "absent.db"), join(root, "backups"))).toBeNull();
  });

  it("writes a 0600 snapshot into a 0700 backups dir", () => {
    const db = join(root, "consolidations.db");
    writeFileSync(db, "data");
    const backups = join(root, "backups");
    const snapshot = backupBeforeMigration(db, backups);
    expect(snapshot).not.toBeNull();
    expect(existsSync(snapshot!)).toBe(true);
    expect(statSync(snapshot!).mode & 0o777).toBe(0o600);
    expect(statSync(backups).mode & 0o777).toBe(0o700);
  });

  it("retains only the last N snapshots", async () => {
    const db = join(root, "consolidations.db");
    writeFileSync(db, "data");
    const backups = join(root, "backups");
    for (let i = 0; i < BACKUP_RETENTION + 5; i += 1) {
      backupBeforeMigration(db, backups);
      await new Promise((r) => setTimeout(r, 2));
    }
    const snapshots = readdirSync(backups).filter((n) => n.endsWith("-pre-migration.db"));
    expect(snapshots.length).toBeLessThanOrEqual(BACKUP_RETENTION);
  });
});
