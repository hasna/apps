import { SqliteAdapter as Database } from "@hasna/cloud";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

let db: Database | null = null;

export function getDataDir(): string {
  const home = process.env["HOME"] || process.env["USERPROFILE"] || homedir();
  const newDir = join(home, ".hasna", "conversations");
  const oldDir = join(home, ".conversations");

  // Auto-migrate old dir to new location
  if (existsSync(oldDir) && !existsSync(newDir)) {
    mkdirSync(newDir, { recursive: true });
    for (const file of readdirSync(oldDir)) {
      const oldPath = join(oldDir, file);
      if (statSync(oldPath).isFile()) {
        copyFileSync(oldPath, join(newDir, file));
      }
    }
  }

  mkdirSync(newDir, { recursive: true });
  return newDir;
}

export function getDbPath(): string {
  if (process.env.HASNA_CONVERSATIONS_DB_PATH) return process.env.HASNA_CONVERSATIONS_DB_PATH;
  if (process.env.CONVERSATIONS_DB_PATH) return process.env.CONVERSATIONS_DB_PATH;
  return join(getDataDir(), "messages.db");
}

export function getDb(): Database {
  if (db) return db;

  const dbPath = getDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");

  // Messages table (new DBs get 'space' column; existing DBs migrate below)
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))),
      session_id TEXT NOT NULL,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      space TEXT,
      project_id TEXT,
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
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_uuid ON messages(uuid)");

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
      id TEXT NOT NULL,
      agent TEXT PRIMARY KEY,
      session_id TEXT,
      role TEXT NOT NULL DEFAULT 'agent',
      project_id TEXT,
      status TEXT NOT NULL DEFAULT 'online',
      last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      metadata TEXT
    )
  `);

  // Resource locks table (advisory + exclusive write coordination)
  db.exec(`
    CREATE TABLE IF NOT EXISTS resource_locks (
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      lock_type TEXT NOT NULL DEFAULT 'advisory',
      locked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      expires_at TEXT NOT NULL,
      UNIQUE(resource_type, resource_id, lock_type)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_locks_resource ON resource_locks(resource_type, resource_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_locks_agent ON resource_locks(agent_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_locks_expires ON resource_locks(expires_at)");

  // Reactions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      agent TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      UNIQUE(message_id, agent, emoji)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id)");

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
  if (!spaceColNames.includes("topic")) {
    db.exec("ALTER TABLE spaces ADD COLUMN topic TEXT");
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
  if (!colNames2.includes("blocking")) {
    db.exec("ALTER TABLE messages ADD COLUMN blocking INTEGER NOT NULL DEFAULT 0");
    db.exec("CREATE INDEX IF NOT EXISTS idx_messages_blocking ON messages(blocking)");
  }
  if (!colNames2.includes("attachments")) {
    db.exec("ALTER TABLE messages ADD COLUMN attachments TEXT");
  }
  if (!colNames2.includes("reply_to")) {
    db.exec("ALTER TABLE messages ADD COLUMN reply_to INTEGER REFERENCES messages(id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to)");
  }
  if (!colNames2.includes("project_id")) {
    db.exec("ALTER TABLE messages ADD COLUMN project_id TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id)");
  }
  if (!colNames2.includes("uuid")) {
    db.exec("ALTER TABLE messages ADD COLUMN uuid TEXT");
    // Backfill existing rows with unique UUIDs
    db.exec("UPDATE messages SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_uuid ON messages(uuid)");
  }

  // Migrate agent_presence: add id, session_id, role, created_at columns
  const presenceCols = db.prepare("PRAGMA table_info(agent_presence)").all() as { name: string }[];
  const presenceColNames = presenceCols.map((c) => c.name);
  if (!presenceColNames.includes("id")) {
    db.exec("ALTER TABLE agent_presence ADD COLUMN id TEXT NOT NULL DEFAULT ''");
    // Backfill existing rows with generated IDs
    const rows = db.prepare("SELECT agent FROM agent_presence").all() as { agent: string }[];
    for (const row of rows) {
      const id = crypto.randomUUID().slice(0, 8);
      db.prepare("UPDATE agent_presence SET id = ? WHERE agent = ?").run(id, row.agent);
    }
  }
  if (!presenceColNames.includes("session_id")) {
    db.exec("ALTER TABLE agent_presence ADD COLUMN session_id TEXT");
  }
  if (!presenceColNames.includes("role")) {
    db.exec("ALTER TABLE agent_presence ADD COLUMN role TEXT NOT NULL DEFAULT 'agent'");
  }
  if (!presenceColNames.includes("created_at")) {
    // SQLite ALTER TABLE does not support non-constant defaults — use empty string, backfill from last_seen_at
    db.exec("ALTER TABLE agent_presence ADD COLUMN created_at TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE agent_presence SET created_at = last_seen_at WHERE created_at = ''");
  }
  if (!presenceColNames.includes("project_id")) {
    db.exec("ALTER TABLE agent_presence ADD COLUMN project_id TEXT");
  }

  // Per-agent space message read receipts
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_read_receipts (
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      agent TEXT NOT NULL,
      read_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      PRIMARY KEY (message_id, agent)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_read_receipts_message ON message_read_receipts(message_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_read_receipts_agent ON message_read_receipts(agent)");

  // Message mentions table — @agent notifications
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      mentioned_agent TEXT NOT NULL,
      from_agent TEXT NOT NULL,
      space TEXT,
      notified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_mentions_agent ON message_mentions(mentioned_agent)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_mentions_message ON message_mentions(message_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_mentions_notified ON message_mentions(notified_at)");

  // FTS5 virtual table for full-text search
  const ftsExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'"
  ).get();
  if (!ftsExists) {
    db.exec(`
      CREATE VIRTUAL TABLE messages_fts USING fts5(
        content, from_agent, to_agent, space,
        content_rowid='id', content='messages'
      )
    `);
    // Populate from existing messages
    db.exec(`
      INSERT INTO messages_fts(rowid, content, from_agent, to_agent, space)
      SELECT id, content, from_agent, to_agent, space FROM messages
    `);
    // Triggers to keep FTS in sync
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content, from_agent, to_agent, space)
        VALUES (new.id, new.content, new.from_agent, new.to_agent, new.space);
      END
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content, from_agent, to_agent, space)
        VALUES ('delete', old.id, old.content, old.from_agent, old.to_agent, old.space);
      END
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF content ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content, from_agent, to_agent, space)
        VALUES ('delete', old.id, old.content, old.from_agent, old.to_agent, old.space);
        INSERT INTO messages_fts(rowid, content, from_agent, to_agent, space)
        VALUES (new.id, new.content, new.from_agent, new.to_agent, new.space);
      END
    `);
  }

  // Feedback table
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      message TEXT NOT NULL,
      email TEXT,
      category TEXT DEFAULT 'general',
      version TEXT,
      machine_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
