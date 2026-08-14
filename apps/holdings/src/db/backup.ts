import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { getHoldingsBackupDir } from "../core/app-home.js";

// Backup-on-migration (§4.4): before applying a shape-changing migration, snapshot
// the current local DB with mode 0600 into ~/.hasna/holdings/backups (dir 0700), keep N=10.

const RETENTION = 10;
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

export interface BackupResult {
  path: string;
  skipped: boolean;
  reason?: string;
}

/**
 * Snapshot the local SQLite DB before a migration. Returns skipped=true for
 * in-memory or non-existent DBs (initial create needs no pre-backup).
 */
export function backupBeforeMigration(dbPath: string): BackupResult {
  if (dbPath === ":memory:") return { path: "", skipped: true, reason: "in-memory database" };
  if (!existsSync(dbPath)) return { path: "", skipped: true, reason: "no existing database file" };

  const dir = getHoldingsBackupDir();
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });

  const iso = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(dir, `holdings-${iso}-pre-migration.db`);
  copyFileSync(dbPath, target);
  try {
    chmodSync(target, FILE_MODE);
  } catch {
    // best-effort on platforms without chmod
  }
  pruneOldBackups(dir);
  return { path: target, skipped: false };
}

function pruneOldBackups(dir: string): void {
  const snapshots = readdirSync(dir)
    .filter((f) => f.startsWith("holdings-") && f.endsWith("-pre-migration.db"))
    .map((f) => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const stale of snapshots.slice(RETENTION)) {
    rmSync(join(dir, stale.f), { force: true });
  }
}
