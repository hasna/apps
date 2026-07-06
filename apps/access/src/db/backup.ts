import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { getBackupDir } from "../core/app-home.js";

/**
 * Backup-on-migration (§4.4, hardened). Before applying any shape-changing
 * migration to an existing local DB, snapshot it to
 * ~/.hasna/access/backups/access-<ISO>-pre-migration.db (mode 0600), keeping at
 * most N=10 snapshots. A migration MUST refuse to run if the pre-backup cannot
 * be created.
 */

const RETENTION = 10;

export interface BackupResult {
  path: string;
  bytes: number;
}

export function shouldBackupBeforeMigration(dbPath: string): boolean {
  // Only back up an existing, non-empty, non-memory database.
  if (dbPath === ":memory:" || dbPath.startsWith("file::memory:")) return false;
  if (!existsSync(dbPath)) return false;
  try {
    return statSync(dbPath).size > 0;
  } catch {
    return false;
  }
}

export function backupDatabaseBeforeMigration(dbPath: string, backupDir = getBackupDir()): BackupResult {
  if (!existsSync(dbPath)) {
    throw new Error(`Refusing to migrate: source database missing at ${dbPath}`);
  }
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(backupDir, 0o700);
  } catch {
    /* best-effort */
  }
  const iso = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(backupDir, `access-${iso}-pre-migration.db`);
  copyFileSync(dbPath, dest);
  try {
    chmodSync(dest, 0o600);
  } catch {
    /* best-effort */
  }
  if (!existsSync(dest)) {
    throw new Error(`Refusing to migrate: backup was not written to ${dest}`);
  }
  pruneOldBackups(backupDir);
  return { path: dest, bytes: statSync(dest).size };
}

export function listDatabaseBackups(backupDir = getBackupDir()): string[] {
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir)
    .filter((f) => f.startsWith("access-") && f.endsWith("-pre-migration.db"))
    .sort();
}

function pruneOldBackups(backupDir: string): void {
  const backups = listDatabaseBackups(backupDir);
  if (backups.length <= RETENTION) return;
  const excess = backups.slice(0, backups.length - RETENTION);
  for (const name of excess) rmSync(join(backupDir, name), { force: true });
}
