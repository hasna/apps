import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ensureAppHome, getDefaultDbPath } from "../core/app-home.js";
import { resolveDbPath, resolveStorageMode, type StorageMode } from "../config.js";
import { backupDatabaseBeforeMigration, shouldBackupBeforeMigration } from "./backup.js";
import { applySchema } from "./schema.js";
import { applyPendingMigrations, pendingMigrations } from "./migration-plan.js";

/**
 * openDatabase() resolves mode via config.ts.
 *   - local: bun:sqlite (authoritative), WAL + foreign_keys, idempotent schema.
 *   - cloud: PURE REMOTE via the vendored storage-kit Postgres pool (sslmode
 *     verify-full). The cloud path is wired but not connected during local
 *     builds; see resolveCloudPoolConfig().
 */

let _db: Database | null = null;

export function getStorageMode(): StorageMode {
  return resolveStorageMode();
}

function ensureDir(filePath: string): void {
  if (filePath === ":memory:") return;
  const dir = dirname(resolve(filePath));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function resolveLocalDbPath(): string {
  const configured = resolveDbPath();
  if (configured && configured !== getDefaultDbPath()) return configured;
  ensureAppHome();
  return getDefaultDbPath();
}

export function openDatabase(dbPath?: string): Database {
  if (_db) return _db;

  const mode = getStorageMode();
  if (mode === "cloud") {
    throw new Error(
      "cloud mode is PURE REMOTE and connects to Postgres via the vendored storage-kit; " +
        "it is not available in this local build. Set HASNA_ACCESS_STORAGE_MODE=local.",
    );
  }

  const path = dbPath ?? resolveLocalDbPath();
  ensureDir(path);

  const isNew = path === ":memory:" || !existsSync(path);
  // Back up before applying any shape-changing migration to an existing DB.
  if (!isNew && shouldBackupBeforeMigration(path) && willMigrate(path)) {
    backupDatabaseBeforeMigration(path);
  }

  _db = new Database(path);
  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA busy_timeout = 5000");
  _db.run("PRAGMA foreign_keys = ON");
  applySchema(_db);
  applyPendingMigrations(_db);
  return _db;
}

function willMigrate(path: string): boolean {
  // Peek whether the existing DB has pending shape-changing migrations without
  // holding the primary handle. The initial (id=1) create is not shape-changing.
  try {
    const probe = new Database(path, { readonly: true });
    try {
      const pending = pendingMigrations(probe).filter((step) => step.shapeChanging);
      return pending.length > 0;
    } finally {
      probe.close();
    }
  } catch {
    return true;
  }
}

/** Alias kept for readability at call sites. */
export function getDatabase(dbPath?: string): Database {
  return openDatabase(dbPath);
}

export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function resetDatabase(): void {
  _db = null;
}

export function now(): string {
  return new Date().toISOString();
}

export function uuid(): string {
  return crypto.randomUUID();
}
