import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { SqliteAdapter } from "./sqlite-adapter.js";
import * as schema from "./schema.js";

export * from "./schema.js";

function resolveDefaultDbPath(): string {
  const home = process.env["HOME"] || process.env["USERPROFILE"] || homedir();
  const newDir = join(home, ".hasna", "brains");
  const oldDir = join(home, ".brains");

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
          // Skip files that cannot be copied during best-effort migration.
        }
      }
    } catch {
      // If the legacy directory cannot be read, continue with the new path.
    }
  }

  mkdirSync(newDir, { recursive: true });
  return join(newDir, "brains.db");
}

const DEFAULT_DB_PATH = resolveDefaultDbPath();

function ensureDir(filePath: string): void {
  if (filePath === ":memory:" || filePath.startsWith("file::memory:")) return;
  mkdirSync(dirname(filePath), { recursive: true });
}

export function getBrainsDbPath(dbPath?: string): string {
  return dbPath ?? process.env["HASNA_BRAINS_DB_PATH"] ?? process.env["BRAINS_DB_PATH"] ?? DEFAULT_DB_PATH;
}

function ensureLocalTables(sqlite: SqliteAdapter["raw"]): void {
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
}

export function getDb(dbPath?: string) {
  const resolvedPath = getBrainsDbPath(dbPath);
  ensureDir(resolvedPath);
  const adapter = new SqliteAdapter(resolvedPath);
  const sqlite = adapter.raw;
  const db = drizzle(sqlite, { schema });

  try {
    const migrationsFolder = resolve(import.meta.dir, "../../drizzle");
    migrate(db, { migrationsFolder });
  } catch {
    ensureLocalTables(sqlite);
  }

  ensureLocalTables(sqlite);
  return db;
}

/** Get a raw SqliteAdapter for direct SQL queries (e.g. feedback table). */
export function getRawDb(dbPath?: string): SqliteAdapter {
  const resolvedPath = getBrainsDbPath(dbPath);
  ensureDir(resolvedPath);
  const adapter = new SqliteAdapter(resolvedPath);
  ensureLocalTables(adapter.raw);
  return adapter;
}
