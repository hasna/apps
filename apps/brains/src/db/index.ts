import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createDatabase, migrateDotfile, SqliteAdapter, ensureFeedbackTable } from "@hasna/cloud";
import { resolve } from "path";
import * as schema from "./schema.js";

export * from "./schema.js";

let _migrated = false;
function ensureMigrated() {
  if (_migrated) return;
  migrateDotfile("brains");
  _migrated = true;
}

export function getDb(dbPath?: string) {
  ensureMigrated();
  const adapter = (dbPath ? new SqliteAdapter(dbPath) : createDatabase({ service: "brains" })) as SqliteAdapter;
  const sqlite = adapter.raw;
  const db = drizzle(sqlite, { schema });

  // Run migrations (idempotent — drizzle tracks applied migrations in __drizzle_migrations table)
  try {
    const migrationsFolder = resolve(import.meta.dir, "../../drizzle");
    migrate(db, { migrationsFolder });
  } catch {
    // Fall back to raw SQL for environments where migrations folder is unavailable
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS fine_tuned_models (
        id TEXT PRIMARY KEY,
        base_model TEXT NOT NULL,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        fine_tune_job_id TEXT,
        display_name TEXT,
        description TEXT,
        collection TEXT,
        tags TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS training_jobs (
        id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL REFERENCES fine_tuned_models(id),
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        metrics TEXT,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS training_datasets (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        file_path TEXT NOT NULL,
        example_count INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        used_in_job_id TEXT REFERENCES training_jobs(id)
      );
    `);
  }

  // Ensure feedback table exists (uses @hasna/cloud standard schema)
  ensureFeedbackTable(adapter);

  return db;
}

/** Get a raw SqliteAdapter for direct SQL queries (e.g. feedback table). */
export function getRawDb(dbPath?: string): SqliteAdapter {
  ensureMigrated();
  return (dbPath ? new SqliteAdapter(dbPath) : createDatabase({ service: "brains" })) as SqliteAdapter;
}
