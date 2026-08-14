import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { getDefaultTreasuryBackupDir } from "../core/app-home.js";

const RETENTION = 10;

export function backupsDisabled(): boolean {
  const raw = process.env["HASNA_TREASURY_BACKUP_BEFORE_MIGRATION"] ?? process.env["TREASURY_BACKUP_BEFORE_MIGRATION"];
  if (!raw) return false;
  return ["0", "false", "no", "off"].includes(raw.toLowerCase());
}

function backupDirFor(dbPath: string): string {
  const override = process.env["HASNA_TREASURY_BACKUP_DIR"] ?? process.env["TREASURY_BACKUP_DIR"];
  if (override) return resolve(override);
  const resolved = resolve(dbPath);
  if (resolved === resolve(getDefaultTreasuryBackupDir(), "..", "data", "treasury.db")) {
    return getDefaultTreasuryBackupDir();
  }
  return getDefaultTreasuryBackupDir();
}

export interface BackupResult {
  skipped: boolean;
  reason?: string;
  backup_path?: string;
}

/**
 * Snapshot an existing local DB before applying migrations (BUILD-SPEC §4.4).
 * File mode 0600; backups dir 0700; retains the last N=10 snapshots.
 * Refuses to proceed if it cannot write the required snapshot.
 */
export function maybeBackupBeforeMigration(dbPath: string): BackupResult {
  if (backupsDisabled()) return { skipped: true, reason: "disabled" };
  if (dbPath === ":memory:") return { skipped: true, reason: "memory database" };
  if (!existsSync(dbPath)) return { skipped: true, reason: "no existing database" };
  if (statSync(dbPath).size === 0) return { skipped: true, reason: "empty database" };

  const dir = backupDirFor(dbPath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(dir, `${basename(dbPath)}-${stamp}-pre-migration.db`);
  copyFileSync(dbPath, backupPath);
  chmodSync(backupPath, 0o600);
  pruneOldBackups(dir, basename(dbPath));
  return { skipped: false, backup_path: backupPath };
}

function pruneOldBackups(dir: string, dbBase: string): void {
  const prefix = `${dbBase}-`;
  const entries = readdirSync(dir)
    .filter((n) => n.startsWith(prefix) && n.endsWith("-pre-migration.db"))
    .map((n) => ({ name: n, path: join(dir, n), mtime: statSync(join(dir, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const stale of entries.slice(RETENTION)) {
    try {
      unlinkSync(stale.path);
    } catch {
      /* best-effort prune */
    }
  }
}

export function listBackups(dbPath: string): string[] {
  const dir = backupDirFor(dbPath);
  if (!existsSync(dir)) return [];
  const prefix = `${basename(dbPath)}-`;
  return readdirSync(dir)
    .filter((n) => n.startsWith(prefix) && n.endsWith("-pre-migration.db"))
    .map((n) => join(dir, n));
}
