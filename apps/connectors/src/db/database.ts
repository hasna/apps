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

function migrate(db: Database): void {
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
}
