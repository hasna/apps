import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { getDefaultFleetBackupDir } from "../core/app-home.js";

export interface DatabaseBackupOptions {
  backupDir?: string;
  now?: Date;
  retention?: number;
}

export interface DatabaseBackupResult {
  skipped: boolean;
  reason?: string;
  source_path: string;
  backup_path?: string;
  created_at: string;
}

const DEFAULT_RETENTION = 10;

/** Whether a shape-changing migration backup is warranted (skip for :memory: / fresh). */
export function shouldBackupBeforeMigration(dbPath: string): boolean {
  if (dbPath === ":memory:") return false;
  return existsSync(dbPath) && statSync(dbPath).size > 0;
}

/**
 * Snapshot the local DB before a shape-changing migration. Writes a 0600 file
 * into the 0700 backups dir and prunes to the last N snapshots. A migration must
 * refuse to proceed if this precondition cannot be satisfied — callers should
 * treat a throw as fatal.
 */
export function backupDatabaseBeforeMigration(
  sourcePath: string,
  options: DatabaseBackupOptions = {},
): DatabaseBackupResult {
  const now = options.now ?? new Date();
  const createdAt = now.toISOString();

  if (!shouldBackupBeforeMigration(sourcePath)) {
    return { skipped: true, reason: "no existing database to back up", source_path: sourcePath, created_at: createdAt };
  }

  const backupDir = options.backupDir ?? getDefaultFleetBackupDir();
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  chmodSyncSafe(backupDir, 0o700);

  const stamp = createdAt.replace(/[:.]/g, "-");
  const backupPath = join(backupDir, `fleet-${stamp}-pre-migration.db`);
  copyFileSync(sourcePath, backupPath);
  chmodSyncSafe(backupPath, 0o600);

  pruneBackups(backupDir, options.retention ?? DEFAULT_RETENTION);

  return { skipped: false, source_path: sourcePath, backup_path: backupPath, created_at: createdAt };
}

export function listDatabaseBackups(backupDir = getDefaultFleetBackupDir()): string[] {
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir)
    .filter((f) => f.startsWith("fleet-") && f.endsWith("-pre-migration.db"))
    .map((f) => join(backupDir, f))
    .sort();
}

function pruneBackups(backupDir: string, retention: number): void {
  const backups = listDatabaseBackups(backupDir);
  if (backups.length <= retention) return;
  for (const old of backups.slice(0, backups.length - retention)) {
    try {
      unlinkSync(old);
    } catch {
      // best-effort prune; leave the file if it cannot be removed.
    }
  }
}

function chmodSyncSafe(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // chmod may be unsupported on some filesystems; dir creation mode still applies.
  }
}
