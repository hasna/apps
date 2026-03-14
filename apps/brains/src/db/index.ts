import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import * as schema from "./schema.js";

export * from "./schema.js";

const DEFAULT_DB_PATH = join(homedir(), ".brains", "brains.db");

function ensureDir(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
}

function createTables(sqlite: Database) {
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

export function getDb(dbPath?: string) {
  const resolvedPath = dbPath ?? DEFAULT_DB_PATH;
  ensureDir(resolvedPath);
  const sqlite = new Database(resolvedPath);
  sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.run("PRAGMA foreign_keys = ON");
  createTables(sqlite);
  return drizzle(sqlite, { schema });
}
