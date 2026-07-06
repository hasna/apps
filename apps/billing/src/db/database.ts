import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { assertModeConsistency, resolveDbPath, type StorageMode } from "../config.js";
import { ensureBillingAppHome } from "../core/app-home.js";
import { backupDatabaseBeforeMigration, shouldBackupBeforeMigration } from "./backup.js";
import { migrationsApplied, runMigrations } from "./schema.js";

export { migrationsApplied } from "./schema.js";
export { buildCloudPoolConfig, probeCloudReachable } from "./cloud.js";

let _db: Database | null = null;

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/**
 * Open the billing store.
 *
 * - local: bun:sqlite is authoritative; migrations applied idempotently.
 *   Pass ":memory:" for tests.
 * - cloud: PURE REMOTE. This synchronous SQLite entry point is NOT used for
 *   cloud; cloud reads/writes go directly to Postgres via the vendored kit
 *   (src/db/cloud.ts). To avoid EVER silently writing money/audit data to an
 *   ephemeral SQLite, cloud mode FAILS CLOSED here with a clear throw
 *   (BUILD-SPEC §2.2 failure class 2) unless an explicit local path is given
 *   (tests). The mode-consistency guard (§2.3) runs first.
 */
export function openDatabase(path?: string): Database {
  const mode: StorageMode = assertModeConsistency();

  if (mode === "cloud" && path === undefined) {
    throw new Error(
      "billing is in cloud (PURE REMOTE) mode: reads/writes go directly to cloud Postgres via the " +
        "vendored storage-kit, not this local SQLite path. This build fails closed rather than silently " +
        "writing money/audit data to ephemeral storage. Run in local mode (unset HASNA_BILLING_STORAGE_MODE) " +
        "or deploy the serve/mcp tier against the cloud pool (docker-compose.yml).",
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

/** Process-wide singleton for the CLI/serve/mcp long-lived handle (local). */
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
