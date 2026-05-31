import { SqliteAdapter as Database } from "@hasna/cloud";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

let db: Database | null = null;

type PresenceColumnInfo = {
  name: string;
  notnull: number;
  pk: number;
};

type LegacyPresenceRow = Record<string, unknown> & {
  _rowid: number;
};

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

function parsePresenceTimestamp(value: unknown): number {
  if (typeof value !== "string" || !value) return 0;
  return new Date(`${value}Z`).getTime() || 0;
}

function normalizePresenceText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function shouldRebuildAgentPresenceTable(columns: PresenceColumnInfo[]): boolean {
  const byName = new Map(columns.map((column) => [column.name, column]));
  const agentCol = byName.get("agent");
  const projectCol = byName.get("project_id");

  if (!agentCol) return false;
  if (!projectCol) return true;

  return agentCol.pk !== 1
    || projectCol.pk !== 2
    || projectCol.notnull !== 1
    || byName.has("pid");
}

function rebuildLegacyAgentPresenceTable(db: Database): void {
  const fallbackNow = (db.prepare(
    "SELECT strftime('%Y-%m-%dT%H:%M:%f', 'now') AS now"
  ).get() as { now: string }).now;
  const legacyRows = db.prepare("SELECT rowid AS _rowid, * FROM agent_presence").all() as LegacyPresenceRow[];

  legacyRows.sort((left, right) => {
    const lastSeenDelta = parsePresenceTimestamp(right.last_seen_at) - parsePresenceTimestamp(left.last_seen_at);
    if (lastSeenDelta !== 0) return lastSeenDelta;

    const createdDelta = parsePresenceTimestamp(right.created_at) - parsePresenceTimestamp(left.created_at);
    if (createdDelta !== 0) return createdDelta;

    const projectDelta = Number(Boolean(normalizePresenceText(right.project_id))) - Number(Boolean(normalizePresenceText(left.project_id)));
    if (projectDelta !== 0) return projectDelta;

    return right._rowid - left._rowid;
  });

  const dedupedRows = new Map<string, LegacyPresenceRow>();
  for (const row of legacyRows) {
    const normalizedAgent = normalizePresenceText(row.agent)?.toLowerCase();
    if (!normalizedAgent) continue;

    const storedProjectId = normalizePresenceText(row.project_id) ?? "";
    const dedupeKey = `${normalizedAgent}\u0000${storedProjectId}`;
    if (dedupedRows.has(dedupeKey)) continue;
    dedupedRows.set(dedupeKey, row);
  }

  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE agent_presence_new (
        id TEXT NOT NULL,
        agent TEXT NOT NULL,
        session_id TEXT,
        role TEXT NOT NULL DEFAULT 'agent',
        project_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'online',
        last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
        metadata TEXT,
        PRIMARY KEY (agent, project_id)
      )
    `);

    const insertPresence = db.prepare(`
      INSERT INTO agent_presence_new (id, agent, session_id, role, project_id, status, last_seen_at, created_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const [dedupeKey, row] of dedupedRows) {
      const [agent, projectKey] = dedupeKey.split("\u0000");
      const id = normalizePresenceText(row.id) ?? crypto.randomUUID().slice(0, 8);
      const sessionId = normalizePresenceText(row.session_id);
      const role = normalizePresenceText(row.role) ?? "agent";
      const projectId = projectKey;
      const status = normalizePresenceText(row.status) ?? "online";
      const lastSeenAt = normalizePresenceText(row.last_seen_at) ?? fallbackNow;
      const createdAt = normalizePresenceText(row.created_at) ?? lastSeenAt;
      const metadata = typeof row.metadata === "string"
        ? row.metadata
        : row.metadata == null
          ? null
          : JSON.stringify(row.metadata);

      insertPresence.run(id, agent, sessionId, role, projectId, status, lastSeenAt, createdAt, metadata);
    }

    db.exec("DROP TABLE agent_presence");
    db.exec("ALTER TABLE agent_presence_new RENAME TO agent_presence");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function collapseDuplicateAgentPresenceRows(db: Database): void {
  const rows = db.prepare("SELECT rowid AS _rowid, * FROM agent_presence").all() as LegacyPresenceRow[];

  rows.sort((left, right) => {
    const lastSeenDelta = parsePresenceTimestamp(right.last_seen_at) - parsePresenceTimestamp(left.last_seen_at);
    if (lastSeenDelta !== 0) return lastSeenDelta;

    const createdDelta = parsePresenceTimestamp(right.created_at) - parsePresenceTimestamp(left.created_at);
    if (createdDelta !== 0) return createdDelta;

    const projectDelta = Number(Boolean(normalizePresenceText(right.project_id))) - Number(Boolean(normalizePresenceText(left.project_id)));
    if (projectDelta !== 0) return projectDelta;

    return right._rowid - left._rowid;
  });

  const rowIdsToDelete: number[] = [];
  const seenAgents = new Set<string>();
  for (const row of rows) {
    const normalizedAgent = normalizePresenceText(row.agent)?.toLowerCase();
    if (!normalizedAgent) continue;
    if (seenAgents.has(normalizedAgent)) {
      rowIdsToDelete.push(row._rowid);
      continue;
    }
    seenAgents.add(normalizedAgent);
  }

  if (rowIdsToDelete.length === 0) return;

  db.exec("BEGIN");
  try {
    const deleteRow = db.prepare("DELETE FROM agent_presence WHERE rowid = ?");
    for (const rowId of rowIdsToDelete) {
      deleteRow.run(rowId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function ensureAgentPresenceAgentUniqueIndex(db: Database): void {
  collapseDuplicateAgentPresenceRows(db);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_presence_agent_unique ON agent_presence(agent)");
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

  const initialMsgCols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  const initialMsgColNames = initialMsgCols.map((c) => c.name);
  if (initialMsgColNames.includes("channel") && !initialMsgColNames.includes("space")) {
    db.exec("ALTER TABLE messages ADD COLUMN space TEXT");
    db.exec("UPDATE messages SET space = channel WHERE channel IS NOT NULL");
    db.exec(`
      UPDATE messages
      SET session_id = 'space:' || substr(session_id, 9)
      WHERE session_id LIKE 'channel:%'
    `);
  }

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
  db.exec(`
    CREATE TABLE IF NOT EXISTS space_subscriptions (
      space TEXT NOT NULL REFERENCES spaces(name),
      agent TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      preview_chars INTEGER NOT NULL DEFAULT 140,
      since_message_id INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (space, agent)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_space_subscriptions_agent ON space_subscriptions(agent)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_space_subscriptions_space ON space_subscriptions(space)");

  // Agent presence table
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_presence (
      id TEXT NOT NULL,
      agent TEXT NOT NULL,
      session_id TEXT,
      role TEXT NOT NULL DEFAULT 'agent',
      project_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'online',
      last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      metadata TEXT,
      PRIMARY KEY (agent, project_id)
    )
  `);
  ensureAgentPresenceAgentUniqueIndex(db);

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

  db.exec(`
    CREATE TABLE IF NOT EXISTS space_notification_reads (
      agent TEXT NOT NULL,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      read_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      PRIMARY KEY (agent, message_id)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_space_notification_reads_agent ON space_notification_reads(agent)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_space_notification_reads_message ON space_notification_reads(message_id)");

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

  const spaceSubscriptionCols = db.prepare("PRAGMA table_info(space_subscriptions)").all() as { name: string }[];
  const spaceSubscriptionColNames = spaceSubscriptionCols.map((c) => c.name);
  if (!spaceSubscriptionColNames.includes("since_message_id")) {
    db.exec("ALTER TABLE space_subscriptions ADD COLUMN since_message_id INTEGER NOT NULL DEFAULT 0");
    db.exec(`
      UPDATE space_subscriptions
      SET since_message_id = COALESCE(
        (SELECT MAX(m.id) FROM messages m WHERE m.space = space_subscriptions.space),
        0
      )
      WHERE since_message_id = 0
    `);
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
  let presenceCols = db.prepare("PRAGMA table_info(agent_presence)").all() as PresenceColumnInfo[];
  let presenceColNames = presenceCols.map((c) => c.name);

  // Normalize legacy presence schemas into the current composite agent+project form.
  if (shouldRebuildAgentPresenceTable(presenceCols)) {
    rebuildLegacyAgentPresenceTable(db);
    presenceCols = db.prepare("PRAGMA table_info(agent_presence)").all() as PresenceColumnInfo[];
    presenceColNames = presenceCols.map((c) => c.name);
  }

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
    db.exec("UPDATE agent_presence SET project_id = '' WHERE project_id IS NULL");
  }

  ensureAgentPresenceAgentUniqueIndex(db);

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

  // Tasks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))),
      subject TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      priority TEXT NOT NULL DEFAULT 'medium',
      assignee TEXT,
      reporter TEXT NOT NULL,
      project_id TEXT,
      space TEXT,
      parent_id INTEGER REFERENCES tasks(id),
      depends_on TEXT,
      tags TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      started_at TEXT,
      completed_at TEXT,
      cancelled_at TEXT,
      due_at TEXT
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_uuid ON tasks(uuid)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_reporter ON tasks(reporter)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_space ON tasks(space)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority)");

  // Task comments table
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      agent TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id)");

  // Task activity log
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      agent TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_task_activity_task ON task_activity(task_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_task_activity_agent ON task_activity(agent)");

  // Task dependencies table (many-to-many)
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      depends_on_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, depends_on_id)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_task_deps_depends ON task_dependencies(depends_on_id)");

  // FTS5 virtual table for full-text task search
  const hasTasksFts = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='tasks_fts'"
  ).get();
  if (!hasTasksFts) {
    db.exec(`
      CREATE VIRTUAL TABLE tasks_fts USING fts5(
        subject, description, tags
      )
    `);
    // Populate from existing data — strip JSON brackets/quotes from tags
    db.exec(`
      INSERT INTO tasks_fts(rowid, subject, description, tags)
      SELECT id, COALESCE(subject, ''), COALESCE(description, ''),
             COALESCE(REPLACE(REPLACE(REPLACE(tags, '[', ''), ']', ''), '"', ''), '')
      FROM tasks
    `);
    // Triggers to keep FTS in sync using rowid = task.id
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS tasks_fts_insert AFTER INSERT ON tasks BEGIN
        INSERT INTO tasks_fts(rowid, subject, description, tags)
        VALUES (new.id, COALESCE(new.subject, ''), COALESCE(new.description, ''),
                COALESCE(REPLACE(REPLACE(REPLACE(new.tags, '[', ''), ']', ''), '"', ''), ''));
      END
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS tasks_fts_delete AFTER DELETE ON tasks BEGIN
        DELETE FROM tasks_fts WHERE rowid = old.id;
      END
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS tasks_fts_update AFTER UPDATE ON tasks BEGIN
        INSERT OR REPLACE INTO tasks_fts(rowid, subject, description, tags)
        VALUES (new.id, COALESCE(new.subject, ''), COALESCE(new.description, ''),
                COALESCE(REPLACE(REPLACE(REPLACE(new.tags, '[', ''), ']', ''), '"', ''), ''));
      END
    `);
  }

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
