import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

let db: Database | null = null;

export function getDbPath(): string {
  if (process.env.CONVERSATIONS_DB_PATH) return process.env.CONVERSATIONS_DB_PATH;
  return join(homedir(), ".conversations", "messages.db");
}

export function getDb(): Database {
  if (db) return db;

  const dbPath = getDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });

  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");

  // Messages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      channel TEXT,
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
  db.exec("CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel)");

  // Migrate: add channel column if missing (existing DBs)
  const cols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "channel")) {
    db.exec("ALTER TABLE messages ADD COLUMN channel TEXT");
  }

  // Channels table
  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      name TEXT PRIMARY KEY,
      description TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
    )
  `);

  // Channel members table
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_members (
      channel TEXT NOT NULL REFERENCES channels(name),
      agent TEXT NOT NULL,
      joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      PRIMARY KEY (channel, agent)
    )
  `);

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
