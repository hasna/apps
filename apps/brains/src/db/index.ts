import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { SqliteAdapter } from "@hasna/cloud";
import { mkdirSync, existsSync, readdirSync, copyFileSync, statSync } from "fs";
import { dirname, join, resolve } from "path";
import { homedir } from "os";
import * as schema from "./schema.js";

export * from "./schema.js";

function resolveDefaultDbPath(): string {
  const home = process.env["HOME"] || process.env["USERPROFILE"] || homedir();
  const newDir = join(home, ".hasna", "brains");
  const oldDir = join(home, ".brains");

  // Auto-migrate: if old dir exists and new doesn't, copy files over
  if (existsSync(oldDir) && !existsSync(newDir)) {
    mkdirSync(newDir, { recursive: true });
    try {
      for (const file of readdirSync(oldDir)) {
        const oldPath = join(oldDir, file);
        const newPath = join(newDir, file);
        try {
          if (statSync(oldPath).isFile()) {
            copyFileSync(oldPath, newPath);
          }
        } catch {
          // Skip files that can't be copied
        }
      }
    } catch {
      // If we can't read old directory, continue with new
    }
  }

  mkdirSync(newDir, { recursive: true });
  return join(newDir, "brains.db");
}

const DEFAULT_DB_PATH = resolveDefaultDbPath();

function ensureDir(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
}


export function getDb(dbPath?: string) {
  const resolvedPath = dbPath ?? DEFAULT_DB_PATH;
  ensureDir(resolvedPath);
  const adapter = new SqliteAdapter(resolvedPath);
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

  // Ensure feedback table exists (not managed by drizzle migrations)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      message TEXT NOT NULL,
      email TEXT,
      category TEXT DEFAULT 'general',
      version TEXT,
      machine_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return db;
}

/** Get a raw SqliteAdapter for direct SQL queries (e.g. feedback table). */
export function getRawDb(dbPath?: string): SqliteAdapter {
  const resolvedPath = dbPath ?? DEFAULT_DB_PATH;
  ensureDir(resolvedPath);
  return new SqliteAdapter(resolvedPath);
}
