import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync } from "fs";

const DB_DIR = join(homedir(), ".connectors");
const DB_PATH = join(DB_DIR, "connectors.db");

let _db: Database | null = null;

export function getDatabase(path?: string): Database {
  if (_db) return _db;
  const dbPath = path ?? DB_PATH;
  mkdirSync(join(dbPath, ".."), { recursive: true });
  _db = new Database(dbPath);
  _db.run("PRAGMA journal_mode = WAL");
  migrate(_db);
  return _db;
}

export function closeDatabase(): void {
  _db?.close();
  _db = null;
}

/** ISO timestamp string */
export function now(): string {
  return new Date().toISOString();
}

/** 8-char UUID prefix */
export function shortUuid(): string {
  return crypto.randomUUID().slice(0, 8);
}

function migrate(db: Database): void {
  // Migration 1: agents table
  db.run(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      session_id TEXT,
      role TEXT NOT NULL DEFAULT 'agent',
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  // Migration 2: resource_locks table for concurrent multi-agent coordination
  db.run(`
    CREATE TABLE IF NOT EXISTS resource_locks (
      id TEXT PRIMARY KEY,
      resource_type TEXT NOT NULL CHECK(resource_type IN ('connector', 'agent', 'profile', 'token')),
      resource_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      lock_type TEXT NOT NULL DEFAULT 'exclusive' CHECK(lock_type IN ('advisory', 'exclusive')),
      locked_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_resource_locks_exclusive
      ON resource_locks(resource_type, resource_id)
      WHERE lock_type = 'exclusive'
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_resource_locks_agent ON resource_locks(agent_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_resource_locks_expires ON resource_locks(expires_at)`);
}
