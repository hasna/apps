import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { resolveDbPath, resolveStorageMode } from "../config.js";
import { ensureWorkforceAppHome, getDefaultWorkforceDbPath } from "../core/app-home.js";
import { applySchema } from "./schema.js";
import { backupDatabaseBeforeMigration, shouldBackupBeforeMigration } from "./backup.js";

export { backupDatabaseBeforeMigration, listDatabaseBackups, verifyDatabaseBackup } from "./backup.js";
export type { DatabaseBackupResult, DatabaseBackupEntry } from "./backup.js";

/** Resolve the local SQLite path, provisioning the app home when using the default. */
export function getDbPath(): string {
  const override = resolveDbPath();
  const defaultPath = resolve(getDefaultWorkforceDbPath());
  if (resolve(override) === resolve(defaultPath)) {
    ensureWorkforceAppHome();
    return defaultPath;
  }
  return override;
}

function ensureDir(filePath: string): void {
  if (filePath === ":memory:") return;
  const dir = dirname(resolve(filePath));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

let _db: Database | null = null;

/**
 * Open a workforce database.
 *
 * - local: bun:sqlite (WAL, foreign_keys ON), authoritative.
 * - cloud: PURE REMOTE Postgres via the vendored storage-kit (see openCloudPool).
 *   Cloud wiring is dynamically imported so the local runtime never loads `pg`.
 *
 * Pass ":memory:" for tests.
 */
export function openDatabase(path?: string): Database {
  const mode = resolveStorageMode();
  if (mode === "cloud" && path === undefined) {
    throw new Error(
      "cloud storage mode uses PURE REMOTE Postgres via the vendored storage-kit; " +
        "openDatabase() returns a local SQLite handle only. Use the cloud query client for cloud mode.",
    );
  }
  const dbPath = path ?? getDbPath();
  ensureDir(dbPath);
  if (dbPath !== ":memory:" && shouldBackupBeforeMigration() && existsSync(dbPath)) {
    backupDatabaseBeforeMigration(dbPath);
  }
  const db = new Database(dbPath);
  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA busy_timeout = 5000;");
  db.run("PRAGMA foreign_keys = ON;");
  applySchema(db);
  return db;
}

/** Process-wide singleton used by the CLI/MCP/serve surfaces. */
export function getDatabase(dbPath?: string): Database {
  if (_db) return _db;
  _db = openDatabase(dbPath);
  return _db;
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

const ALLOWED_TABLES = new Set(["members", "capabilities", "assignments", "lifecycle_events"]);

/** Resolve a full or short id prefix to a unique row id, or null when ambiguous/absent. */
export function resolvePartialId(db: Database, table: string, partialId: string): string | null {
  if (!ALLOWED_TABLES.has(table)) throw new Error(`Invalid table name: ${table}`);
  if (partialId.length >= 36) {
    const row = db.query(`SELECT id FROM ${table} WHERE id = ?`).get(partialId) as { id: string } | null;
    return row?.id ?? null;
  }
  const rows = db.query(`SELECT id FROM ${table} WHERE id LIKE ?`).all(`${partialId}%`) as { id: string }[];
  if (rows.length === 1) return rows[0]!.id;
  return null;
}

/**
 * Cloud pool factory (documented cloud-ready seam). Dynamically imports the
 * vendored kit so `pg` is never loaded in local mode. TLS is verify-full.
 */
export async function openCloudPool(dsn: string) {
  const kit = await import("../generated/storage-kit/index.js");
  // TLS is derived from the DSN by the kit; the fleet contract mandates
  // sslmode=verify-full (§4.8). Enforce it rather than silently downgrading.
  const withTls = /[?&]sslmode=/.test(dsn) ? dsn : `${dsn}${dsn.includes("?") ? "&" : "?"}sslmode=verify-full`;
  if (!/sslmode=verify-full/.test(withTls)) {
    throw new Error("Cloud DSN must use sslmode=verify-full (sslmode=require is forbidden).");
  }
  return kit.createPgPool({ connectionString: withTls });
}
