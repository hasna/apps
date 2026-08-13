import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { appHomeDir } from "../core/app-home.js";

// Hardened backup-on-migration for the local SQLite store. Snapshots are written
// 0600 into a 0700 backups dir; the last N=10 pre-migration snapshots are kept.
// Cloud relies on RDS automated snapshots + PITR (no local plaintext dump).

export const BACKUP_RETENTION = 10;

/** Timestamped pre-migration snapshot path. */
function snapshotPath(dir: string, at = new Date()): string {
  const iso = at.toISOString().replace(/[:.]/g, "-");
  return join(dir, `consolidations-${iso}-pre-migration.db`);
}

/**
 * Snapshot the local SQLite DB before a shape-changing migration. No-op when the
 * DB file does not exist yet (initial create needs no backup) or is in-memory.
 * Throws if the required backups dir cannot be provisioned (migration must
 * refuse to run without a valid pre-backup).
 */
export function backupBeforeMigration(dbPath: string, dir = appHomeDir("backups")): string | null {
  if (dbPath === ":memory:" || !existsSync(dbPath)) return null;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!existsSync(dir)) throw new Error(`Backup dir could not be created: ${dir}`);
  const target = snapshotPath(dir);
  copyFileSync(dbPath, target);
  chmodSync(target, 0o600);
  pruneBackups(dir);
  return target;
}

/** Keep only the most recent BACKUP_RETENTION pre-migration snapshots. */
export function pruneBackups(dir: string): void {
  if (!existsSync(dir)) return;
  const snapshots = readdirSync(dir)
    .filter((name) => name.endsWith("-pre-migration.db"))
    .map((name) => ({ name, mtime: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const stale of snapshots.slice(BACKUP_RETENTION)) {
    rmSync(join(dir, stale.name), { force: true });
  }
}
