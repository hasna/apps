import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { getDefaultBillingBackupDir, getDefaultBillingDbPath } from "../core/app-home.js";

/**
 * Hardened backup-on-migration (BUILD-SPEC §4.4). Before a shape-changing
 * migration the local SQLite DB is snapshotted to a 0600 file in the 0700
 * backups dir; only the last N=10 pre-migration snapshots are retained.
 */
export const BACKUP_RETENTION = 10;

export interface BackupResult {
  skipped: boolean;
  reason?: string;
  source_path: string;
  backup_path?: string;
  created_at: string;
}

function safeTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function defaultBackupDir(dbPath: string): string {
  const resolved = resolve(dbPath);
  if (resolved === resolve(getDefaultBillingDbPath())) return getDefaultBillingBackupDir();
  return join(dirname(resolved), "backups");
}

function backupDirFor(dbPath: string, backupDir?: string): string {
  return resolve(backupDir || process.env["HASNA_BILLING_BACKUP_DIR"] || defaultBackupDir(dbPath));
}

export function shouldBackupBeforeMigration(): boolean {
  const raw = process.env["HASNA_BILLING_BACKUP_BEFORE_MIGRATION"];
  if (!raw) return true;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

/** Snapshot the DB before a migration. Returns skipped=true for :memory:/empty. */
export function backupDatabaseBeforeMigration(
  dbPath: string,
  options: { backupDir?: string; force?: boolean; now?: Date } = {},
): BackupResult {
  const sourcePath = dbPath === ":memory:" ? dbPath : resolve(dbPath);
  const created_at = (options.now ?? new Date()).toISOString();

  if (sourcePath === ":memory:") return { skipped: true, reason: "memory database", source_path: sourcePath, created_at };
  if (!existsSync(sourcePath)) return { skipped: true, reason: "database file does not exist", source_path: sourcePath, created_at };
  if (!options.force && statSync(sourcePath).size === 0)
    return { skipped: true, reason: "database file is empty", source_path: sourcePath, created_at };

  const backupDir = backupDirFor(sourcePath, options.backupDir);
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });

  const backupPath = join(backupDir, `${basename(sourcePath)}-${safeTimestamp(options.now ?? new Date())}-pre-migration.db`);
  copyFileSync(sourcePath, backupPath);
  chmodSync(backupPath, 0o600);

  pruneBackups(backupDir, basename(sourcePath));

  return { skipped: false, source_path: sourcePath, backup_path: backupPath, created_at };
}

/** Keep only the most recent BACKUP_RETENTION pre-migration snapshots. */
export function pruneBackups(backupDir: string, sourceBase: string): void {
  if (!existsSync(backupDir)) return;
  const prefix = `${sourceBase}-`;
  const snapshots = readdirSync(backupDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith("-pre-migration.db"))
    .map((name) => ({ name, path: join(backupDir, name) }))
    .sort((a, b) => b.name.localeCompare(a.name));
  for (const stale of snapshots.slice(BACKUP_RETENTION)) {
    try {
      unlinkSync(stale.path);
    } catch {
      // best-effort prune
    }
  }
}

export function listDatabaseBackups(dbPath: string, options: { backupDir?: string } = {}): string[] {
  const sourcePath = dbPath === ":memory:" ? dbPath : resolve(dbPath);
  const backupDir = backupDirFor(sourcePath, options.backupDir);
  if (!existsSync(backupDir)) return [];
  const prefix = `${basename(sourcePath)}-`;
  return readdirSync(backupDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith("-pre-migration.db"))
    .map((name) => join(backupDir, name))
    .sort()
    .reverse();
}
