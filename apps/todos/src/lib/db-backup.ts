/**
 * Local SQLite backup, restore, integrity, compact, and migration dry-run.
 */

import { randomUUID } from "node:crypto";
import { existsSync, openSync, closeSync, fsyncSync, chmodSync, rmdirSync, copyFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase } from "../db/database.js";
import { MIGRATIONS } from "../db/migrations.js";

export const DB_BACKUP_SCHEMA = "todos.db_backup.v1";

export interface BackupResult {
  schema_version: typeof DB_BACKUP_SCHEMA;
  source_path: string;
  backup_path: string;
  bytes: number;
  method: "sqlite_backup" | "sqlite_vacuum" | "file_copy";
  created_at: string;
}

export interface IntegrityResult {
  schema_version: typeof DB_BACKUP_SCHEMA;
  path: string;
  ok: boolean;
  quick_check: string;
  foreign_keys: boolean;
  tables: number;
  errors: string[];
}

export interface MigrationDryRunResult {
  schema_version: typeof DB_BACKUP_SCHEMA;
  current_version: number;
  pending_migrations: number[];
  would_apply: number;
}

function resolveDbPath(dbPath?: string): string {
  if (dbPath) return resolve(dbPath);
  if (process.env["TODOS_DB_PATH"] && process.env["TODOS_DB_PATH"] !== ":memory:") {
    return resolve(process.env["TODOS_DB_PATH"]);
  }
  const db = getDatabase();
  const filename = db.filename as string | undefined;
  if (filename && filename !== ":memory:") return filename;
  throw new Error("No database path — set TODOS_DB_PATH or pass --db");
}

function syncPath(path: string): void {
  const fd = openSync(path, "r");
  let syncFailed = false;
  try { fsyncSync(fd); } catch (error) { syncFailed = true; throw error; }
  finally {
    try { closeSync(fd); } catch (error) { if (!syncFailed) throw error; }
  }
}

export function backupDatabase(outputPath: string, sourcePath?: string): BackupResult {
  const source = resolveDbPath(sourcePath);
  if (!existsSync(source)) throw new Error(`Database not found: ${source}`);

  const sourceInfo = statSync(source);
  if (resolve(outputPath) === resolve(source)) throw new Error("Backup output resolves to the same database as the source");
  if (existsSync(outputPath)) {
    const outputInfo = statSync(outputPath);
    if (outputInfo.dev === sourceInfo.dev && outputInfo.ino === sourceInfo.ino) throw new Error("Backup output resolves to the same database as the source");
  }

  mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 });

  // serialize() preserves WAL header bytes, producing a standalone file that
  // macOS SQLite cannot reopen read-only without sidecars. SQLite VACUUM INTO
  // emits a complete rollback-journal image without modifying the source.
  const stagingDir = join(dirname(outputPath), `.todos-backup-${randomUUID()}`);
  const staging = join(stagingDir, "snapshot.db");
  const src = new Database(source, { readonly: true });
  let ownsStaging = false;
  let renamed = false;
  let primaryError: unknown;
  try {
    // macOS SQLite rejects even an existing empty VACUUM output. A private
    // exclusively created directory protects the file throughout creation.
    mkdirSync(stagingDir, { mode: 0o700 });
    ownsStaging = true;
    src.query("VACUUM INTO ?").run(staging);
    chmodSync(staging, 0o600);
    const integrity = checkDatabaseIntegrity(staging);
    if (!integrity.ok) throw new Error(`Backup failed integrity check: ${integrity.errors.join("; ")}`);
    syncPath(staging);
    renameSync(staging, outputPath);
    renamed = true;
    rmdirSync(stagingDir);
    ownsStaging = false;
    syncPath(dirname(outputPath));
  } catch (error) {
    primaryError = renamed
      ? new Error("Backup replacement may have completed but durability confirmation failed; inspect the target before retrying", { cause: error })
      : error;
    throw primaryError;
  } finally {
    let cleanupError: unknown;
    try { src.close(); } catch (error) { cleanupError = error; }
    if (ownsStaging) {
      try { unlinkSync(staging); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") cleanupError ??= error; }
      try { rmdirSync(stagingDir); } catch (error) { cleanupError ??= error; }
    }
    if (!primaryError && cleanupError) throw new Error(renamed
      ? "Backup replacement completed but cleanup failed; inspect the target before retrying"
      : "Backup staging cleanup failed", { cause: cleanupError });
  }

  const method: BackupResult["method"] = "sqlite_vacuum";

  const bytes = statSync(outputPath).size;
  return {
    schema_version: DB_BACKUP_SCHEMA,
    source_path: source,
    backup_path: outputPath,
    bytes,
    method,
    created_at: new Date().toISOString(),
  };
}

export function restoreDatabase(backupPath: string, targetPath?: string): BackupResult {
  if (!existsSync(backupPath)) throw new Error(`Backup not found: ${backupPath}`);

  const integrity = checkDatabaseIntegrity(backupPath);
  if (!integrity.ok) {
    throw new Error(`Backup failed integrity check: ${integrity.errors.join("; ")}`);
  }

  const target = targetPath ? resolve(targetPath) : resolveDbPath();
  mkdirSync(dirname(target), { recursive: true });

  // H4: close the live handle BEFORE overwriting the file. Copying over a
  // WAL-mode database while it is still open (and while stale -wal/-shm
  // sidecars remain) corrupts the result. Close, stage, drop sidecars, then
  // atomically rename the restored image into place.
  closeDatabase();

  const staging = `${target}.restore.tmp`;
  try { unlinkSync(staging); } catch { /* no stale staging file */ }
  copyFileSync(backupPath, staging);

  // Remove the previous DB's WAL/SHM sidecars — the restored image is a
  // complete database and leftover sidecars would be replayed against it.
  for (const sidecar of [`${target}-wal`, `${target}-shm`]) {
    try { if (existsSync(sidecar)) unlinkSync(sidecar); } catch { /* ignore */ }
  }

  // Atomic replace within the same directory/filesystem.
  renameSync(staging, target);

  return {
    schema_version: DB_BACKUP_SCHEMA,
    source_path: backupPath,
    backup_path: target,
    bytes: statSync(target).size,
    method: "file_copy",
    created_at: new Date().toISOString(),
  };
}

export function checkDatabaseIntegrity(dbPath?: string): IntegrityResult {
  const path = dbPath ? resolve(dbPath) : resolveDbPath();
  const errors: string[] = [];

  if (!existsSync(path)) {
    return {
      schema_version: DB_BACKUP_SCHEMA,
      path,
      ok: false,
      quick_check: "missing",
      foreign_keys: false,
      tables: 0,
      errors: [`Database file not found: ${path}`],
    };
  }

  let db: Database;
  try {
    db = new Database(path, { readonly: true });
  } catch (e) {
    return {
      schema_version: DB_BACKUP_SCHEMA,
      path,
      ok: false,
      quick_check: "open_failed",
      foreign_keys: false,
      tables: 0,
      errors: [e instanceof Error ? e.message : String(e)],
    };
  }

  let quickCheck = "unknown";
  try {
    const quick = db.query("PRAGMA quick_check").get() as { quick_check: string };
    quickCheck = quick.quick_check;
    if (quickCheck !== "ok") errors.push(`quick_check: ${quickCheck}`);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  let fkOk = true;
  try {
    db.exec("PRAGMA foreign_keys = ON");
    const fk = db.query("PRAGMA foreign_key_check").all() as unknown[];
    if (fk.length > 0) {
      fkOk = false;
      errors.push(`foreign_key_check: ${fk.length} violation(s)`);
    }
  } catch (e) {
    fkOk = false;
    errors.push(e instanceof Error ? e.message : String(e));
  }

  let tableCount = 0;
  try {
    const tables = db.query("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table'").get() as { c: number };
    tableCount = tables.c;
  } catch {
    /* ignore */
  }

  db.close();

  return {
    schema_version: DB_BACKUP_SCHEMA,
    path,
    ok: errors.length === 0,
    quick_check: quickCheck,
    foreign_keys: fkOk,
    tables: tableCount,
    errors,
  };
}

export function compactDatabase(dbPath?: string): { path: string; bytes_before: number; bytes_after: number } {
  const path = dbPath ? resolve(dbPath) : resolveDbPath();
  const before = statSync(path).size;
  const db = new Database(path);
  db.exec("VACUUM");
  db.close();
  const after = statSync(path).size;
  closeDatabase();
  return { path, bytes_before: before, bytes_after: after };
}

export function migrationDryRun(dbPath?: string): MigrationDryRunResult {
  const path = dbPath ? resolve(dbPath) : resolveDbPath();
  const db = new Database(path, { readonly: true });

  let current = 0;
  try {
    const row = db.query("SELECT MAX(id) as id FROM _migrations").get() as { id: number | null };
    current = row.id ?? 0;
  } catch {
    current = 0;
  }

  const pending: number[] = [];
  for (let i = 0; i < MIGRATIONS.length; i++) {
    const id = i + 1;
    if (id > current) pending.push(id);
  }

  db.close();

  return {
    schema_version: DB_BACKUP_SCHEMA,
    current_version: current,
    pending_migrations: pending,
    would_apply: pending.length,
  };
}

export function defaultBackupPath(dbPath?: string): string {
  const base = dbPath ? dirname(resolve(dbPath)) : dirname(resolveDbPath());
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(base, "backups", `todos-${stamp}.db`);
}

export function readBackupManifest(backupPath: string): Record<string, unknown> | null {
  const manifestPath = `${backupPath}.json`;
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function writeBackupManifest(backupPath: string, result: BackupResult): void {
  const manifestPath = `${backupPath}.json`;
  writeFileSyncSafe(manifestPath, JSON.stringify(result, null, 2));
}

function writeFileSyncSafe(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
