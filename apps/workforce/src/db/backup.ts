import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { getDefaultWorkforceBackupDir, getDefaultWorkforceDbPath } from "../core/app-home.js";

// Hardened backup-on-migration (§4.4): 0600 snapshots in a 0700 dir, retention
// of the last N pre-migration snapshots, and a refusal to proceed when a
// required backup cannot be written.

const RETENTION = 10;

export interface DatabaseBackupResult {
  skipped: boolean;
  reason?: string;
  source_path: string;
  backup_path?: string;
  created_at: string;
}

export interface DatabaseBackupEntry {
  backup_path: string;
  label: string;
  created_at: string | null;
  size_bytes: number;
}

export interface DatabaseBackupVerification {
  backup_path: string;
  valid: boolean;
  size_bytes: number;
  checksum_sha256?: string;
  quick_check?: string;
  issues: string[];
}

export function shouldBackupBeforeMigration(): boolean {
  const raw = process.env["HASNA_WORKFORCE_BACKUP_BEFORE_MIGRATION"];
  if (!raw) return true;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

function safeTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function defaultBackupDir(dbPath: string): string {
  if (resolve(dbPath) === resolve(getDefaultWorkforceDbPath())) return getDefaultWorkforceBackupDir();
  return join(dirname(resolve(dbPath)), "backups");
}

function backupDirFor(dbPath: string, backupDir?: string): string {
  return resolve(backupDir || process.env["HASNA_WORKFORCE_DB_BACKUP_DIR"] || defaultBackupDir(dbPath));
}

/** Snapshot the DB before a shape-changing migration. Refuses (throws) if it cannot write. */
export function backupDatabaseBeforeMigration(
  dbPath: string,
  options: { backupDir?: string; label?: string; now?: Date; force?: boolean } = {},
): DatabaseBackupResult {
  const sourcePath = dbPath === ":memory:" ? dbPath : resolve(dbPath);
  const timestamp = options.now ?? new Date();
  const createdAt = timestamp.toISOString();

  if (sourcePath === ":memory:") return { skipped: true, reason: "memory database", source_path: sourcePath, created_at: createdAt };
  if (!existsSync(sourcePath)) return { skipped: true, reason: "database file does not exist", source_path: sourcePath, created_at: createdAt };
  if (!options.force && statSync(sourcePath).size === 0) return { skipped: true, reason: "database file is empty", source_path: sourcePath, created_at: createdAt };

  const dir = backupDirFor(sourcePath, options.backupDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // best-effort on platforms without POSIX perms
  }

  const label = options.label || "pre-migration";
  const backupPath = join(dir, `${basename(sourcePath)}.${label}.${safeTimestamp(timestamp)}.bak`);
  copyFileSync(sourcePath, backupPath);
  try {
    chmodSync(backupPath, 0o600);
  } catch {
    // best-effort
  }

  pruneOldBackups(sourcePath, dir);
  return { skipped: false, source_path: sourcePath, backup_path: backupPath, created_at: createdAt };
}

function pruneOldBackups(sourcePath: string, dir: string): void {
  const entries = listBackupsIn(sourcePath, dir);
  for (const stale of entries.slice(RETENTION)) {
    try {
      unlinkSync(stale.backup_path);
    } catch {
      // best-effort
    }
  }
}

function listBackupsIn(sourcePath: string, dir: string): DatabaseBackupEntry[] {
  if (!existsSync(dir)) return [];
  const prefix = `${basename(sourcePath)}.`;
  return readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".bak"))
    .map((name) => {
      const full = join(dir, name);
      const body = name.slice(prefix.length, -4);
      const sep = body.lastIndexOf(".");
      return {
        backup_path: full,
        label: sep === -1 ? body : body.slice(0, sep),
        created_at: sep === -1 ? null : body.slice(sep + 1),
        size_bytes: statSync(full).size,
      };
    })
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}

export function listDatabaseBackups(dbPath: string, options: { backupDir?: string } = {}): DatabaseBackupEntry[] {
  const sourcePath = dbPath === ":memory:" ? dbPath : resolve(dbPath);
  return listBackupsIn(sourcePath, backupDirFor(sourcePath, options.backupDir));
}

export function verifyDatabaseBackup(backupPath: string): DatabaseBackupVerification {
  const resolved = resolve(backupPath);
  const issues: string[] = [];
  if (!existsSync(resolved)) return { backup_path: resolved, valid: false, size_bytes: 0, issues: ["backup file does not exist"] };
  const size = statSync(resolved).size;
  if (size === 0) issues.push("backup file is empty");
  let checksum: string | undefined;
  let quickCheck: string | undefined;
  if (size > 0) {
    checksum = createHash("sha256").update(readFileSync(resolved)).digest("hex");
    try {
      const db = new Database(resolved);
      const rows = db.query("PRAGMA quick_check").all() as Array<{ quick_check: string }>;
      db.close();
      quickCheck = rows.map((r) => r.quick_check).join("; ");
      if (quickCheck !== "ok") issues.push(`sqlite quick_check failed: ${quickCheck}`);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { backup_path: resolved, valid: issues.length === 0, size_bytes: size, checksum_sha256: checksum, quick_check: quickCheck, issues };
}
