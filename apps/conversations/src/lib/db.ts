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

  // Messages table (new DBs get 'space' column; existing DBs migrate below)
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      space TEXT,
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
  db.exec("CREATE INDEX IF NOT EXISTS idx_messages_space ON messages(space)");

  // Projects table
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      path TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      metadata TEXT,
      tags TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      repository TEXT,
      settings TEXT
    )
  `);

  db.exec("CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)");

  // Spaces table
  db.exec(`
    CREATE TABLE IF NOT EXISTS spaces (
      name TEXT PRIMARY KEY,
      description TEXT,
      parent_id TEXT REFERENCES spaces(name),
      project_id TEXT REFERENCES projects(id),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      archived_at TEXT
    )
  `);

  db.exec("CREATE INDEX IF NOT EXISTS idx_spaces_parent ON spaces(parent_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_spaces_project ON spaces(project_id)");

  // Space members table
  db.exec(`
    CREATE TABLE IF NOT EXISTS space_members (
      space TEXT NOT NULL REFERENCES spaces(name),
      agent TEXT NOT NULL,
      joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      PRIMARY KEY (space, agent)
    )
  `);

  // Agent presence table
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_presence (
      agent TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'online',
      last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      metadata TEXT
    )
  `);

  // ---- Migrations for existing databases ----

  const existingTables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table'"
  ).all() as { name: string }[];
  const tableNames = existingTables.map((t) => t.name);

  // Migrate channels -> spaces (if old DB)
  if (tableNames.includes("channels") && tableNames.includes("spaces")) {
    const spaceCount = (db.prepare("SELECT COUNT(*) as c FROM spaces").get() as { c: number }).c;
    const channelCount = (db.prepare("SELECT COUNT(*) as c FROM channels").get() as { c: number }).c;

    if (channelCount > 0 && spaceCount === 0) {
      db.exec("BEGIN");
      try {
        db.exec(`
          INSERT OR IGNORE INTO spaces (name, description, created_by, created_at)
          SELECT name, description, created_by, created_at FROM channels
        `);
        if (tableNames.includes("channel_members")) {
          db.exec(`
            INSERT OR IGNORE INTO space_members (space, agent, joined_at)
            SELECT channel, agent, joined_at FROM channel_members
          `);
        }
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }

    // Drop old tables after migration
    db.exec("DROP TABLE IF EXISTS channel_members");
    db.exec("DROP TABLE IF EXISTS channels");
  }

  // Migrate messages.channel -> messages.space column
  const msgCols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  const colNames = msgCols.map((c) => c.name);

  if (colNames.includes("channel") && !colNames.includes("space")) {
    db.exec("ALTER TABLE messages ADD COLUMN space TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_messages_space ON messages(space)");
    db.exec("UPDATE messages SET space = channel WHERE channel IS NOT NULL");
    db.exec(`
      UPDATE messages
      SET session_id = 'space:' || substr(session_id, 9)
      WHERE session_id LIKE 'channel:%'
    `);
  }

  // Migrate spaces table: add archived_at column
  const spaceCols = db.prepare("PRAGMA table_info(spaces)").all() as { name: string }[];
  const spaceColNames = spaceCols.map((c) => c.name);
  if (!spaceColNames.includes("archived_at")) {
    db.exec("ALTER TABLE spaces ADD COLUMN archived_at TEXT");
  }

  // Add edited_at and pinned_at columns if missing
  const msgCols2 = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  const colNames2 = msgCols2.map((c) => c.name);
  if (!colNames2.includes("edited_at")) {
    db.exec("ALTER TABLE messages ADD COLUMN edited_at TEXT");
  }
  if (!colNames2.includes("pinned_at")) {
    db.exec("ALTER TABLE messages ADD COLUMN pinned_at TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_messages_pinned ON messages(pinned_at)");
  }

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
