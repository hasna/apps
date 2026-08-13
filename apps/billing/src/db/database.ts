import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveDbPath, resolveStorageBackend, type StorageBackend } from "../config.js";
import { ensureBillingAppHome } from "../core/app-home.js";
import { backupDatabaseBeforeMigration, shouldBackupBeforeMigration } from "./backup.js";
import { migrationsApplied, runMigrations } from "./schema.js";

export { migrationsApplied } from "./schema.js";
export { buildPostgresqlPoolConfig, probePostgresqlReachable } from "./postgresql.js";

let _db: Database | null = null;

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/**
 * Open the billing store.
 *
 * - sqlite: bun:sqlite is authoritative; migrations applied idempotently.
 *   Pass ":memory:" for tests.
 * - postgresql: this synchronous SQLite entry point is not used. To avoid
 *   silently writing money/audit data to SQLite, it always fails closed,
 *   including when callers pass an explicit path.
 */
export function openDatabase(path?: string): Database {
  const backend: StorageBackend = resolveStorageBackend();

  if (backend === "postgresql") {
    throw new Error(
      "billing selected the postgresql backend: this SQLite entry point cannot serve PostgreSQL reads or writes. " +
        "This build fails closed rather than silently writing money/audit data to ephemeral storage.",
    );
  }

  const dbPath = path ?? resolveDbPath();
  if (dbPath !== ":memory:") {
    ensureBillingAppHome();
    ensureDir(dbPath);
    if (shouldBackupBeforeMigration()) backupDatabaseBeforeMigration(dbPath);
  }

  const db = new Database(dbPath);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA foreign_keys = ON");
  runMigrations(db);
  return db;
}

/** Process-wide singleton for the CLI/serve/mcp long-lived SQLite handle. */
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

/** Migrations-applied count for storage_status. */
export function appliedMigrationCount(db: Database): number {
  return migrationsApplied(db);
}
