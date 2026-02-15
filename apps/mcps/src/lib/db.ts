import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { MCPS_DIR, DB_PATH } from "./config.js";

let db: Database | null = null;

export function getDb(): Database {
  if (db) return db;

  mkdirSync(MCPS_DIR, { recursive: true });

  db = new Database(DB_PATH, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      command TEXT NOT NULL,
      args TEXT NOT NULL DEFAULT '[]',
      env TEXT NOT NULL DEFAULT '{}',
      transport TEXT NOT NULL DEFAULT 'stdio',
      url TEXT,
      source TEXT NOT NULL DEFAULT 'local',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_cache (
      server_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      input_schema TEXT NOT NULL DEFAULT '{}',
      cached_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (server_id, name),
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
    )
  `);

  db.exec("CREATE INDEX IF NOT EXISTS idx_tool_cache_server ON tool_cache(server_id)");

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
