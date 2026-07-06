import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { resolveDbPath, resolveStorageMode, scrubDatabaseUrlEnv, type StorageMode } from "../config.js";
import { ensureFleetAppHome, getDefaultFleetDbPath } from "../core/app-home.js";
import { backupDatabaseBeforeMigration, shouldBackupBeforeMigration } from "./backup.js";
import { runMigrations } from "./schema.js";

export { backupDatabaseBeforeMigration, listDatabaseBackups } from "./backup.js";
export { getCurrentSQLiteMigrationPlan } from "./migration-plan.js";

/** Resolve the local SQLite path (env override → ~/.hasna/fleet/data/fleet.db). */
export function getDbPath(): string {
  const override = resolveDbPath();
  if (override && override !== defaultConfigPath()) return override;
  ensureFleetAppHome();
  return getDefaultFleetDbPath();
}

function defaultConfigPath(): string {
  // config.ts defaultSqlitePath() returns ~/.hasna/fleet/fleet.db; app-home uses
  // the data/ subdir. Prefer the app-home data path unless an explicit override.
  return resolve(process.env["HOME"] || "", ".hasna", "fleet", "fleet.db");
}

function ensureDir(filePath: string): void {
  if (filePath === ":memory:") return;
  const dir = dirname(resolve(filePath));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

let _db: Database | null = null;
let _mode: StorageMode = "local";

/**
 * Open (or return the cached) local SQLite database and run idempotent
 * migrations. In cloud mode, connect() is used instead (async) — the CLI/serve
 * bootstrap chooses the path. For the v0 local build, SQLite is authoritative.
 */
export function getDatabase(dbPath?: string): Database {
  if (_db) return _db;

  const mode = resolveStorageMode();
  _mode = mode;

  if (mode === "cloud" && dbPath === undefined) {
    throw new Error(
      "cloud storage mode uses the vendored Postgres storage-kit (async). Use connectCloud() / the serve bootstrap, " +
        "or pass an explicit SQLite path for local tooling.",
    );
  }

  const path = dbPath ?? getDbPath();
  ensureDir(path);

  if (shouldBackupBeforeMigration(path)) {
    // Backup precondition: a shape-changing migration must have a snapshot. A
    // throw here is fatal by design (the migration refuses to run).
    backupDatabaseBeforeMigration(path);
  }

  _db = new Database(path);
  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA busy_timeout = 5000");
  _db.run("PRAGMA foreign_keys = ON");
  runMigrations(_db);

  return _db;
}

export function getMode(): StorageMode {
  return _mode;
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

/**
 * Cloud connection path (PURE REMOTE). Lazily imports the vendored storage-kit
 * (which pulls in `pg`) so local runtime never loads a Postgres driver. Enforces
 * sslmode=verify-full via the kit's TLS resolver (§4.8). Wired for cloud-ready;
 * not exercised by the v0 local build/tests (no live DB).
 */
export async function connectCloud(): Promise<{ connectionSource: string }> {
  const mode = resolveStorageMode();
  if (mode !== "cloud") throw new Error("connectCloud() requires storage mode 'cloud'.");
  const { createCloudPoolFromEnv } = await import("../generated/storage-kit/pool.js");
  const { client, connectionSource } = createCloudPoolFromEnv("fleet");
  // After the pool is built, scrub the broadcast DSN so child processes cannot read it.
  scrubDatabaseUrlEnv();
  // The pool/client is retained by the caller in a full cloud deployment; here we
  // only prove the wiring. Immediately release the reference for the local build.
  void client;
  return { connectionSource };
}

const ALLOWED_TABLES = new Set([
  "saved_views",
  "slos",
  "error_budget_policies",
  "alert_thresholds",
  "annotations",
  "entities",
]);

/** Resolve a full or unambiguous partial id within an allowlisted table. */
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
