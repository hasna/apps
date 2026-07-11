import { Database } from "bun:sqlite";
import { getConfigDir } from "../lib/config.js";
import { runMigrations } from "./migrations";

let instance: Database | null = null;

function ensureFeedbackTable(db: Database): void {
  db.exec(`
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

export function getDbPath(): string {
  // Support env var overrides
  const envPath = Bun.env.HASNA_SEARCH_DB_PATH ?? Bun.env.SEARCH_DB_PATH;
  if (envPath) return envPath;

  return `${getConfigDir()}/data.db`;
}

export function getDb(): Database {
  if (instance) return instance;

  const path = getDbPath();
  const db = new Database(path);

  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA synchronous = NORMAL");

  runMigrations(db);
  ensureFeedbackTable(db);

  instance = db;
  return instance;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

export function getDbForTesting(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA synchronous = NORMAL");
  runMigrations(db);
  ensureFeedbackTable(db);
  return db;
}
