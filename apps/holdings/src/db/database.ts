import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveDbPath, resolveStorageMode, scrubDatabaseUrl } from "../config.js";
import { backupBeforeMigration } from "./backup.js";
import { MIGRATION_PLAN } from "./migration-plan.js";
import { SCHEMA } from "./schema.js";

// openDatabase(): bun:sqlite for local, cloud Postgres via the vendored kit.
// Local (SQLite) is authoritative in this build; cloud is wired but not exercised.

let migrationsAppliedCount = 0;

/**
 * Open the app database.
 *
 * - local: `new Database(resolveDbPath())` with WAL + foreign_keys; applies the
 *   idempotent SCHEMA and the forward-only migration plan (backup-on-migration).
 * - cloud: PURE REMOTE via the vendored storage-kit (sslmode=verify-full). Not
 *   exercised in local builds — see src/db/cloud.ts.
 *
 * Pass `":memory:"` for tests.
 */
export function openDatabase(path?: string): Database {
  const mode = resolveStorageMode();
  if (mode === "cloud" && path === undefined) {
    throw new Error(
      "cloud storage mode is PURE REMOTE (Postgres via the vendored storage-kit) and is not " +
        "exercised in the local build. Set HASNA_HOLDINGS_STORAGE_MODE=local for the SQLite path.",
    );
  }

  const dbPath = path ?? resolveDbPath();
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  }

  const isNew = dbPath === ":memory:" || !existsSync(dbPath);
  const db = new Database(dbPath);
  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA foreign_keys = ON;");

  applyMigrations(db, dbPath, isNew);

  // Once connected, scrub any broadcast DSN so child processes cannot read it (§2.4).
  scrubDatabaseUrl();
  return db;
}

function currentLedgerId(db: Database): number {
  const row = db.query<{ id: number }, []>("SELECT MAX(id) AS id FROM schema_migrations").get();
  return row?.id ?? 0;
}

function applyMigrations(db: Database, dbPath: string, isNew: boolean): void {
  db.run(SCHEMA);
  let applied = 0;
  for (const step of MIGRATION_PLAN) {
    const already = db.query<{ id: number }, [number]>("SELECT id FROM schema_migrations WHERE id = ?").get(step.id);
    if (already) continue;
    if (step.shapeChanging && !isNew) {
      const result = backupBeforeMigration(dbPath);
      if (!result.skipped && !result.path) {
        throw new Error(`Refusing migration ${step.id}: pre-migration backup could not be created.`);
      }
    }
    if (step.sql) db.run(step.sql);
    db.query("INSERT OR IGNORE INTO schema_migrations (id) VALUES (?)").run(step.id);
    applied += 1;
  }
  migrationsAppliedCount = currentLedgerId(db);
  void applied;
}

/** Number of migrations recorded in the ledger for the most recently opened DB. */
export function migrationsApplied(): number {
  return migrationsAppliedCount;
}
