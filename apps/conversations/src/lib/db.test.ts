import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getDb, getDbPath, closeDb } from "./db";
import { createChannel, getChannel } from "./channels";
import { sendMessage } from "./messages";
import { unlinkSync } from "fs";
import { Database } from "bun:sqlite";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-test-db-${Date.now()}.db`);

beforeEach(() => {
  process.env.CONVERSATIONS_DB_PATH = TEST_DB;
  closeDb();
});

afterEach(() => {
  closeDb();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + "-wal"); } catch {}
  try { unlinkSync(TEST_DB + "-shm"); } catch {}
  delete process.env.CONVERSATIONS_DB_PATH;
});

describe("db", () => {
  test("getDbPath returns env override", () => {
    expect(getDbPath()).toBe(TEST_DB);
  });

  test("getDbPath returns default when no env", () => {
    delete process.env.CONVERSATIONS_DB_PATH;
    const path = getDbPath();
    expect(path).toContain("conversations");
    expect(path).toEndWith("messages.db");
  });

  test("getDb creates database and tables", () => {
    const db = getDb();
    expect(db).toBeDefined();

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("messages");
    expect(tableNames).toContain("channels");
    expect(tableNames).toContain("channel_members");
    expect(tableNames).toContain("channel_subscriptions");
    expect(tableNames).toContain("channel_notification_reads");
    expect(tableNames).toContain("projects");
    expect(tableNames).toContain("incident_projections");
    expect(tableNames).toContain("incident_projection_scopes");
  });

  test("getDb returns singleton", () => {
    const db1 = getDb();
    const db2 = getDb();
    expect(db1).toBe(db2);
  });

  test("getDb sets WAL mode", () => {
    const db = getDb();
    const mode = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(mode.journal_mode).toBe("wal");
  });

  test("getDb creates indexes", () => {
    const db = getDb();
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[];
    const names = indexes.map((i) => i.name);
    expect(names).toContain("idx_messages_session");
    expect(names).toContain("idx_messages_to");
    expect(names).toContain("idx_messages_created");
    expect(names).toContain("idx_messages_channel");
    expect(names).toContain("idx_projects_name");
    expect(names).toContain("idx_projects_status");
    expect(names).toContain("idx_channels_project");
    expect(names).toContain("idx_channel_subscriptions_agent");
    expect(names).toContain("idx_channel_notification_reads_agent");
    expect(names).toContain("idx_incident_projections_active_scope");
    expect(names).toContain("idx_incident_projections_message");
    expect(names).toContain("idx_incident_projection_scopes_lookup");
  });

  test("closeDb closes and resets singleton", () => {
    getDb();
    closeDb();
    // Should be able to get a new connection
    const db = getDb();
    expect(db).toBeDefined();
  });

  test("closeDb is safe to call when no db open", () => {
    closeDb();
    closeDb(); // Should not throw
  });

  test("messages table has channel column", () => {
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain("channel");
  });

  test("migrates legacy channel messages before creating channel indexes", () => {
    closeDb();
    const legacyDb = new Database(TEST_DB);
    legacyDb.exec(`
      CREATE TABLE messages (
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
      );
      INSERT INTO messages (session_id, from_agent, to_agent, channel, content)
      VALUES ('channel:ops', 'alice', 'ops', 'ops', 'legacy message');
    `);
    legacyDb.close();

    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("channel");
    const row = db.prepare("SELECT session_id, channel FROM messages WHERE content = ?").get("legacy message") as {
      session_id: string;
      channel: string;
    };
    expect(row).toEqual({ session_id: "channel:ops", channel: "ops" });
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain("idx_messages_channel");
  });

  test("rebuilds legacy message FTS tables around the channel column", () => {
    closeDb();
    const legacyDb = new Database(TEST_DB);
    legacyDb.exec(`
      CREATE TABLE messages (
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
      );
      INSERT INTO messages (session_id, from_agent, to_agent, channel, content)
      VALUES ('channel:ops', 'alice', 'ops', 'ops', 'legacy fts message');
      CREATE VIRTUAL TABLE messages_fts USING fts5(
        content, from_agent, to_agent, space,
        content_rowid='id', content='messages'
      );
      INSERT INTO messages_fts(rowid, content, from_agent, to_agent, space)
      SELECT id, content, from_agent, to_agent, channel FROM messages;
    `);
    legacyDb.close();

    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(messages_fts)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain("channel");
    expect(colNames).not.toContain("space");
    const result = db.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?").get("legacy") as { rowid: number } | null;
    expect(result?.rowid).toBe(1);
  });

  test("does not import normal flat channels as legacy spaces on reopen", () => {
    createChannel("flat-channel", "alice");
    sendMessage({ from: "alice", to: "flat-channel", channel: "flat-channel", content: "flat message" });
    closeDb();

    const db = getDb();
    const channel = getChannel("flat-channel");
    expect(channel?.metadata).toBeNull();
    expect(channel?.tags).toEqual([]);
    const legacyTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'space%'").all() as { name: string }[];
    expect(legacyTables).toEqual([]);
  });

  test("channel subscriptions track the subscription starting point", () => {
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(channel_subscriptions)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain("since_message_id");
  });

  test("migrates legacy spaces and sub-spaces into flat channels without losing linked data", () => {
    closeDb();
    const legacyDb = new Database(TEST_DB);
    legacyDb.exec(`
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      );
      CREATE TABLE spaces (
        name TEXT PRIMARY KEY,
        description TEXT,
        parent_id TEXT,
        project_id TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        archived_at TEXT,
        topic TEXT
      );
      CREATE TABLE space_members (
        space TEXT NOT NULL,
        agent TEXT NOT NULL,
        joined_at TEXT NOT NULL,
        PRIMARY KEY (space, agent)
      );
      CREATE TABLE space_subscriptions (
        space TEXT NOT NULL,
        agent TEXT NOT NULL,
        created_at TEXT NOT NULL,
        preview_chars INTEGER NOT NULL DEFAULT 140,
        since_message_id INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (space, agent)
      );
      CREATE TABLE space_notification_reads (
        agent TEXT NOT NULL,
        message_id INTEGER NOT NULL,
        read_at TEXT NOT NULL,
        PRIMARY KEY (agent, message_id)
      );
      CREATE TABLE message_mentions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        mentioned_agent TEXT NOT NULL,
        from_agent TEXT NOT NULL,
        space TEXT,
        notified_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE tasks (
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
        parent_id INTEGER,
        depends_on TEXT,
        tags TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
        started_at TEXT,
        completed_at TEXT,
        cancelled_at TEXT,
        due_at TEXT
      );
      CREATE TABLE graph_edges (
        from_type TEXT NOT NULL,
        from_id TEXT NOT NULL,
        to_type TEXT NOT NULL,
        to_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1,
        metadata TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(from_type, from_id, to_type, to_id, relation)
      );
      CREATE TABLE resource_locks (
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        lock_type TEXT NOT NULL DEFAULT 'advisory',
        locked_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        UNIQUE(resource_type, resource_id, lock_type)
      );

      INSERT INTO spaces (name, description, parent_id, project_id, created_by, created_at, topic)
      VALUES
        ('platform', 'Platform coordination', NULL, NULL, 'alice', '2024-01-01T00:00:00.000', 'Core platform'),
        ('platform-mcps', 'MCP work', 'platform', NULL, 'alice', '2024-01-02T00:00:00.000', 'MCPs'),
        ('#platform', 'Hash-prefixed collision', NULL, NULL, 'bob', '2024-01-03T00:00:00.000', NULL);

      INSERT INTO messages (session_id, from_agent, to_agent, space, content, created_at)
      VALUES
        ('space:platform', 'alice', 'platform', 'platform', 'root message', '2024-01-04T00:00:00.000'),
        ('space:platform-mcps', 'bob', 'platform-mcps', 'platform-mcps', 'child message', '2024-01-05T00:00:00.000'),
        ('space:#platform', 'carol', '#platform', '#platform', 'collision message', '2024-01-06T00:00:00.000'),
        ('space:ghost-only', 'dora', 'ghost-only', 'ghost-only', 'message-only channel', '2024-01-07T00:00:00.000');

      INSERT INTO space_members (space, agent, joined_at)
      VALUES ('platform-mcps', 'bob', '2024-01-08T00:00:00.000');

      INSERT INTO space_subscriptions (space, agent, created_at, preview_chars, since_message_id)
      VALUES ('platform-mcps', 'bob', '2024-01-09T00:00:00.000', 88, 1);

      INSERT INTO space_notification_reads (agent, message_id, read_at)
      VALUES ('bob', 2, '2024-01-10T00:00:00.000');

      INSERT INTO message_mentions (message_id, mentioned_agent, from_agent, space, created_at)
      VALUES (3, 'alice', 'carol', '#platform', '2024-01-11T00:00:00.000');

      INSERT INTO tasks (subject, reporter, space, created_at)
      VALUES ('Migrate MCPs', 'alice', 'platform-mcps', '2024-01-12T00:00:00.000');

      INSERT INTO graph_edges (from_type, from_id, to_type, to_id, relation, created_at, updated_at)
      VALUES ('space', 'platform-mcps', 'agent', 'bob', 'owns', '2024-01-13T00:00:00.000', '2024-01-13T00:00:00.000');

      INSERT INTO resource_locks (resource_type, resource_id, agent_id, lock_type, locked_at, expires_at)
      VALUES ('space', 'platform-mcps', 'alice', 'advisory', '2024-01-14T00:00:00.000', '2025-01-14T00:00:00.000');
    `);
    legacyDb.close();

    const db = getDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("channels");
    expect(tableNames).not.toContain("spaces");
    expect(tableNames).not.toContain("space_members");
    expect(tableNames).not.toContain("space_subscriptions");
    expect(tableNames).not.toContain("space_notification_reads");

    const messageColumns = (db.prepare("PRAGMA table_info(messages)").all() as { name: string }[]).map((c) => c.name);
    const mentionColumns = (db.prepare("PRAGMA table_info(message_mentions)").all() as { name: string }[]).map((c) => c.name);
    const taskColumns = (db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[]).map((c) => c.name);
    const channelColumns = (db.prepare("PRAGMA table_info(channels)").all() as { name: string }[]).map((c) => c.name);
    expect(messageColumns).toContain("channel");
    expect(messageColumns).not.toContain("space");
    expect(mentionColumns).toContain("channel");
    expect(mentionColumns).not.toContain("space");
    expect(taskColumns).toContain("channel");
    expect(taskColumns).not.toContain("space");
    expect(channelColumns).not.toContain("parent_id");

    const channels = db.prepare("SELECT name, metadata, tags FROM channels ORDER BY name").all() as Array<{ name: string; metadata: string | null; tags: string | null }>;
    const names = channels.map((channel) => channel.name);
    expect(names).toContain("platform");
    expect(names).toContain("platform-mcps");
    expect(names).toContain("ghost-only");
    const collision = channels.find((channel) => {
      const metadata = JSON.parse(channel.metadata ?? "{}");
      return metadata.import_source?.name === "#platform";
    });
    expect(collision?.name.startsWith("platform--")).toBe(true);

    const child = channels.find((channel) => channel.name === "platform-mcps")!;
    const childMetadata = JSON.parse(child.metadata ?? "{}");
    const childTags = JSON.parse(child.tags ?? "[]");
    expect(childMetadata.import_source).toMatchObject({
      type: "legacy_space",
      source: "space",
      name: "platform-mcps",
      parent: "platform",
      parent_channel: "platform",
      depth: 1,
    });
    expect(childTags).toContain("legacy-parent:platform");
    expect(childTags).toContain("legacy-depth:1");

    const messages = db.prepare("SELECT id, session_id, to_agent, channel, content FROM messages ORDER BY id").all() as Array<{ id: number; session_id: string; to_agent: string; channel: string; content: string }>;
    expect(messages.find((m) => m.content === "root message")).toMatchObject({ session_id: "channel:platform", to_agent: "platform", channel: "platform" });
    expect(messages.find((m) => m.content === "child message")).toMatchObject({ session_id: "channel:platform-mcps", to_agent: "platform-mcps", channel: "platform-mcps" });
    expect(messages.find((m) => m.content === "message-only channel")).toMatchObject({ session_id: "channel:ghost-only", to_agent: "ghost-only", channel: "ghost-only" });
    const collisionMessage = messages.find((m) => m.content === "collision message")!;
    expect(collisionMessage.session_id).toBe(`channel:${collision!.name}`);
    expect(collisionMessage.to_agent).toBe(collision!.name);
    expect(collisionMessage.channel).toBe(collision!.name);

    const member = db.prepare("SELECT channel, agent FROM channel_members WHERE agent = 'bob'").get() as { channel: string; agent: string };
    expect(member).toEqual({ channel: "platform-mcps", agent: "bob" });
    const subscription = db.prepare("SELECT channel, agent, preview_chars, since_message_id FROM channel_subscriptions WHERE agent = 'bob'").get() as { channel: string; agent: string; preview_chars: number; since_message_id: number };
    expect(subscription).toEqual({ channel: "platform-mcps", agent: "bob", preview_chars: 88, since_message_id: 1 });
    const read = db.prepare("SELECT agent, message_id FROM channel_notification_reads").get() as { agent: string; message_id: number };
    expect(read).toEqual({ agent: "bob", message_id: 2 });
    const mention = db.prepare("SELECT channel FROM message_mentions WHERE mentioned_agent = 'alice'").get() as { channel: string };
    expect(mention.channel).toBe(collision!.name);
    const task = db.prepare("SELECT channel FROM tasks WHERE subject = 'Migrate MCPs'").get() as { channel: string };
    expect(task.channel).toBe("platform-mcps");
    const edge = db.prepare("SELECT from_type, from_id FROM graph_edges").get() as { from_type: string; from_id: string };
    expect(edge).toEqual({ from_type: "channel", from_id: "platform-mcps" });
    const lock = db.prepare("SELECT resource_type, resource_id FROM resource_locks").get() as { resource_type: string; resource_id: string };
    expect(lock).toEqual({ resource_type: "channel", resource_id: "platform-mcps" });
  });

  test("preserves legacy orphan reply values while rejecting new orphan writes", () => {
    closeDb();
    const legacyDb = new Database(TEST_DB);
    legacyDb.exec(`
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        channel TEXT,
        project_id TEXT,
        content TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'normal',
        working_dir TEXT,
        repository TEXT,
        branch TEXT,
        metadata TEXT,
        blocking INTEGER NOT NULL DEFAULT 0,
        attachments TEXT,
        reply_to INTEGER,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
        read_at TEXT
      );
      INSERT INTO messages (session_id, from_agent, to_agent, channel, content, reply_to)
      VALUES ('channel:incidents', 'legacy', 'incidents', 'incidents', 'orphan history', 999);
    `);
    legacyDb.close();

    const db = getDb();
    expect(db.prepare("SELECT reply_to FROM messages WHERE id = 1").get()).toEqual({ reply_to: 999 });
    expect(() => db.prepare(
      `INSERT INTO messages (session_id, from_agent, to_agent, channel, content, reply_to)
       VALUES ('channel:incidents', 'new', 'incidents', 'incidents', 'new orphan', 998)`,
    ).run()).toThrow("reply parent is missing or outside the message scope");
    expect(db.prepare("SELECT reply_to FROM messages WHERE id = 1").get()).toEqual({ reply_to: 999 });
  });
});
