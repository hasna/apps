import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

let db: Database | null = null;

export function getDbPath(): string {
  return join(homedir(), ".conversations", "messages.db");
}

export function getDb(): Database {
  if (db) return db;

  const dbPath = getDbPath();
  mkdirSync(join(homedir(), ".conversations"), { recursive: true });

  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      content TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal',
      working_dir TEXT,
      repository TEXT,
      branch TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      read_at TEXT
    )
  `);

  db.exec("CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_agent)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at)");

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
