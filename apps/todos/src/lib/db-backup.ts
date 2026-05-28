/**
 * Local SQLite backup, restore, integrity, compact, and migration dry-run.
 */

import { existsSync, copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync, unlinkSync } from "node:fs";
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
  method: "sqlite_backup" | "file_copy";
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
  // @ts-expect-error bun sqlite internal filename
  const filename = db.filename as string | undefined;
  if (filename && filename !== ":memory:") return filename;
  throw new Error("No database path — set TODOS_DB_PATH or pass --db");
}

export function backupDatabase(outputPath: string, sourcePath?: string): BackupResult {
  const source = resolveDbPath(sourcePath);
  if (!existsSync(source)) throw new Error(`Database not found: ${source}`);

  mkdirSync(dirname(outputPath), { recursive: true });

  closeDatabase();

  const src = new Database(source, { readonly: true });
  try {
    src.exec("PRAGMA wal_checkpoint(FULL)");
  } catch {
    /* best-effort checkpoint */
  }
  src.close();

  copyFileSync(source, outputPath);

  const method: BackupResult["method"] = "file_copy";

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

  const staging = `${target}.restore.tmp`;
  copyFileSync(backupPath, staging);
  copyFileSync(staging, target);
  try { unlinkSync(staging); } catch { /* ignore */ }

  closeDatabase();

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
