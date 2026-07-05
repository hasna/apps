import { afterEach, describe, expect, it } from "bun:test";
import {
  CANONICAL_CONVERSATIONS_DATABASE_ENV,
  CANONICAL_CONVERSATIONS_RDS_CLUSTER,
  CANONICAL_CONVERSATIONS_RDS_DATABASE,
  CANONICAL_CONVERSATIONS_RDS_SECRET_PATH,
  CONVERSATIONS_DATABASE_FALLBACK_ENV,
  CLOUD_RUNTIME_STORAGE_TABLES,
  DEFAULT_STORAGE_TABLES,
  STORAGE_CONFIG_PATH_ENV,
  STORAGE_DATABASE_ENV,
  STORAGE_LOCAL_ONLY_TABLES,
  STORAGE_MODE_ENV,
  detectAndLogConflicts,
  ensureConflictsTable,
  getCanonicalConversationsRdsConfig,
  getStorageConfig,
  getStorageDatabaseUrl,
  getStorageReadiness,
  listConflicts,
  listDuplicateMessageUuids,
  resolveTables,
  syncPull,
  syncPush,
} from "./storage-sync.js";
import { ConversationsDatabase } from "./db.js";

const ENV_NAMES = [
  ...STORAGE_DATABASE_ENV,
  ...STORAGE_CONFIG_PATH_ENV,
  ...STORAGE_MODE_ENV,
  ["HASNA", "CONVERSATIONS", "CLOUD", "DATABASE", "URL"].join("_"),
  ["OPEN", "CONVERSATIONS", "CLOUD", "DATABASE", "URL"].join("_"),
  ["CONVERSATIONS", "CLOUD", "DATABASE", "URL"].join("_"),
  ["HASNA", "CONVERSATIONS", "CLOUD", "MODE"].join("_"),
  ["OPEN", "CONVERSATIONS", "CLOUD", "MODE"].join("_"),
  ["CONVERSATIONS", "CLOUD", "MODE"].join("_"),
  "CONVERSATIONS_ATTACHMENTS_DIR",
] as const;

class SqliteRemoteAdapter {
  constructor(private readonly db: ConversationsDatabase) {}

  async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    const translated = sql
      .replace(/\bGREATEST\(/g, "max(")
      .replace(/\bLEAST\(/g, "min(");
    return this.db.run(translated, ...params);
  }

  async all(sql: string, ...params: unknown[]): Promise<unknown[]> {
    if (sql.includes("information_schema.columns")) {
      const table = String(params[0]);
      return this.db.all<{ name: string; type: string }>(`PRAGMA table_info("${table.replace(/"/g, '""')}")`)
        .map((row) => ({
          column_name: row.name,
          data_type: row.type.toLowerCase().includes("int") ? "integer" : "text",
        }));
    }
    return this.db.all(sql, ...params);
  }

  async get(sql: string, ...params: unknown[]): Promise<unknown | null> {
    return this.db.get(sql, ...params);
  }

  async close(): Promise<void> {}
}

function asRemote(db: ConversationsDatabase) {
  return new SqliteRemoteAdapter(db) as any;
}

function createSyncDb(): ConversationsDatabase {
  const db = new ConversationsDatabase(":memory:");
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      session_id TEXT NOT NULL,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      channel TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00.000',
      read_at TEXT,
      reply_to INTEGER,
      attachments TEXT
    );
    CREATE TABLE channel_subscriptions (
      channel TEXT NOT NULL,
      agent TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00.000',
      preview_chars INTEGER NOT NULL DEFAULT 140,
      since_message_id INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (channel, agent)
    );
    CREATE TABLE message_read_receipts (
      message_id INTEGER NOT NULL,
      agent TEXT NOT NULL,
      read_at TEXT NOT NULL,
      PRIMARY KEY (message_id, agent)
    );
    CREATE TABLE channel_notification_reads (
      agent TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      read_at TEXT NOT NULL,
      PRIMARY KEY (agent, message_id)
    );
    CREATE TABLE reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      agent TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(message_id, agent, emoji)
    );
    CREATE TABLE message_mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      mentioned_agent TEXT NOT NULL,
      from_agent TEXT NOT NULL,
      channel TEXT,
      notified_at TEXT,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

function insertMessage(
  db: ConversationsDatabase,
  uuid: string,
  content: string,
  options?: { replyTo?: number | null; attachments?: string | null },
): number {
  const row = db.get<{ id: number }>(`
    INSERT INTO messages (uuid, session_id, from_agent, to_agent, channel, content, reply_to, attachments)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `, uuid, `channel:test`, "alice", "test", "test", content, options?.replyTo ?? null, options?.attachments ?? null);
  return row!.id;
}

afterEach(() => {
  for (const name of ENV_NAMES) {
    delete process.env[name];
  }
});

describe("conversations storage configuration", () => {
  it("exposes the canonical Hasna XYZ RDS descriptor without secret values", () => {
    expect(getCanonicalConversationsRdsConfig()).toEqual({
      cluster: CANONICAL_CONVERSATIONS_RDS_CLUSTER,
      database: CANONICAL_CONVERSATIONS_RDS_DATABASE,
      runtimeSecretPath: CANONICAL_CONVERSATIONS_RDS_SECRET_PATH,
      env: CANONICAL_CONVERSATIONS_DATABASE_ENV,
      fallbackEnv: CONVERSATIONS_DATABASE_FALLBACK_ENV,
    });
    expect(STORAGE_DATABASE_ENV).toEqual([
      "HASNA_CONVERSATIONS_DATABASE_URL",
      "CONVERSATIONS_DATABASE_URL",
    ]);
  });

  it("uses canonical storage database envs", () => {
    process.env["HASNA_CONVERSATIONS_DATABASE_URL"] = "postgres://new.example/conversations";

    expect(getStorageDatabaseUrl()).toBe("postgres://new.example/conversations");
  });

  it("does not treat retired cloud database envs as storage config", () => {
    process.env["HASNA_CONVERSATIONS_STORAGE_MODE"] = "local";
    process.env[["OPEN", "CONVERSATIONS", "CLOUD", "DATABASE", "URL"].join("_")] = "postgres://old.example/conversations";

    expect(getStorageDatabaseUrl()).toBeNull();
  });

  it("uses canonical storage mode envs", () => {
    process.env["HASNA_CONVERSATIONS_STORAGE_MODE"] = "hybrid";

    expect(getStorageConfig().mode).toBe("hybrid");
  });

  it("does not map retired cloud modes to storage modes", () => {
    process.env["CONVERSATIONS_STORAGE_MODE"] = "local";
    process.env[["HASNA", "CONVERSATIONS", "CLOUD", "MODE"].join("_")] = "remote";

    expect(getStorageConfig().mode).toBe("local");
  });

  it("returns default storage tables and rejects unsupported tables", () => {
    expect(resolveTables()).toEqual([...DEFAULT_STORAGE_TABLES]);
    expect(resolveTables("metadata")).toEqual([...DEFAULT_STORAGE_TABLES]);
    expect(resolveTables("cloud-runtime")).toEqual([...CLOUD_RUNTIME_STORAGE_TABLES]);
    expect(resolveTables("messages,read-state")).toEqual([
      "messages",
      "message_read_receipts",
      "channel_notification_reads",
      "message_mentions",
      "reactions",
    ]);
    expect(() => resolveTables("channels,missing")).toThrow("Unsupported conversations storage table");
  });

  it("reports readiness without exposing database URL secrets", () => {
    process.env["HASNA_CONVERSATIONS_DATABASE_URL"] = "postgres://example.invalid/conversations";
    process.env.CONVERSATIONS_ATTACHMENTS_DIR = "/tmp/custom-conversations-attachments";

    const readiness = getStorageReadiness();

    expect(readiness.configured).toBe(true);
    expect(readiness.tableGroups.default).toEqual([...DEFAULT_STORAGE_TABLES]);
    expect(readiness.tableGroups.cloudRuntime).toEqual([...CLOUD_RUNTIME_STORAGE_TABLES]);
    expect(readiness.tableGroups.localOnly).toEqual([...STORAGE_LOCAL_ONLY_TABLES]);
    expect(readiness.runtimePaths.map((path) => path.surface)).toEqual([
      "local-sqlite",
      "remote-postgres",
      "messages-and-sessions",
      "read-state",
      "search-and-digests",
      "attachments",
      "aws-production",
    ]);
    expect(readiness.runtimePaths.find((path) => path.surface === "attachments")?.remote)
      .toContain("omits local attachment metadata");
    expect(readiness.local.attachments).toBe("/tmp/custom-conversations-attachments");
    expect(JSON.stringify(readiness)).not.toContain("postgres://");
  });

  it("exports storage helpers from the storage subpath source", async () => {
    const storage = await import("../storage.js");

    expect(storage.DEFAULT_STORAGE_TABLES).toEqual(DEFAULT_STORAGE_TABLES);
    expect(storage.CLOUD_RUNTIME_STORAGE_TABLES).toEqual(CLOUD_RUNTIME_STORAGE_TABLES);
    expect(storage.getStorageDatabaseUrl()).toBeNull();
    expect(storage.getStorageReadiness().tableGroups.cloudRuntime).toContain("messages");
    expect(storage.PG_MIGRATIONS.length).toBeGreaterThan(0);
    expect(typeof storage.PgAdapterAsync).toBe("function");
  });

  it("migrates legacy conflict tables before listing conflicts", () => {
    const db = new ConversationsDatabase(":memory:");
    try {
      db.exec(`
        CREATE TABLE _sync_conflicts (
          id TEXT PRIMARY KEY,
          table_name TEXT NOT NULL,
          pk TEXT NOT NULL,
          local_row TEXT NOT NULL,
          remote_row TEXT NOT NULL
        )
      `);
      db.prepare(`
        INSERT INTO _sync_conflicts (id, table_name, pk, local_row, remote_row)
        VALUES (?, ?, ?, ?, ?)
      `).run("conflict-1", "channels", "general", "{}", "{}");

      ensureConflictsTable(db);

      expect(listConflicts(db, { resolved: false })).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("reports duplicate message UUIDs for migration preflight diagnostics", () => {
    const db = new ConversationsDatabase(":memory:");
    try {
      db.exec("CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT)");
      db.run("INSERT INTO messages (uuid) VALUES (?)", "duplicate");
      db.run("INSERT INTO messages (uuid) VALUES (?)", "duplicate");
      db.run("INSERT INTO messages (uuid) VALUES (?)", "unique");

      expect(listDuplicateMessageUuids(db)).toEqual([{ uuid: "duplicate", count: 2 }]);
    } finally {
      db.close();
    }
  });

  it("logs conflicts for composite-key agent presence rows", async () => {
    const local = new ConversationsDatabase(":memory:");
    const remote = new ConversationsDatabase(":memory:");
    try {
      for (const db of [local, remote]) {
        db.exec(`
          CREATE TABLE agent_presence (
            id TEXT NOT NULL DEFAULT '',
            agent TEXT NOT NULL,
            project_id TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'online',
            created_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            PRIMARY KEY (agent, project_id)
          )
        `);
      }
      local.run(`
        INSERT INTO agent_presence (agent, project_id, status, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?)
      `, "alice", "project-a", "online", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
      remote.run(`
        INSERT INTO agent_presence (agent, project_id, status, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?)
      `, "alice", "project-a", "away", "2026-01-02T00:00:00.000Z", "2026-01-02T00:00:00.000Z");

      const count = await detectAndLogConflicts(local, asRemote(remote), "agent_presence");
      const conflicts = listConflicts(local, { resolved: false });

      expect(count).toBe(1);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]?.pk).toBe("agent=alice|project_id=project-a");
    } finally {
      local.close();
      remote.close();
    }
  });

  it("syncs message threads through UUIDs instead of raw reply_to ids", async () => {
    const local = createSyncDb();
    const remote = createSyncDb();
    const target = createSyncDb();
    try {
      insertMessage(remote, "remote-unrelated", "remote id padding");
      insertMessage(target, "target-unrelated-1", "target id padding 1");
      insertMessage(target, "target-unrelated-2", "target id padding 2");

      const parentId = insertMessage(local, "parent-uuid", "parent");
      insertMessage(local, "child-uuid", "child", {
        replyTo: parentId,
        attachments: JSON.stringify([{ path: "/home/hasna/private.txt" }]),
      });

      const pushResult = await syncPush(local, asRemote(remote), { tables: ["messages"] });
      expect(pushResult[0].errors).toEqual([]);

      const remoteParent = remote.get<{ id: number; attachments: string | null }>(
        "SELECT id, attachments FROM messages WHERE uuid = ?",
        "parent-uuid",
      )!;
      const remoteChild = remote.get<{ id: number; reply_to: number; attachments: string | null }>(
        "SELECT id, reply_to, attachments FROM messages WHERE uuid = ?",
        "child-uuid",
      )!;
      expect(remoteChild.reply_to).toBe(remoteParent.id);
      expect(remoteChild.reply_to).not.toBe(parentId);
      expect(remoteParent.attachments).toBeNull();
      expect(remoteChild.attachments).toBeNull();

      const pullResult = await syncPull(asRemote(remote), target, { tables: ["messages"] });
      expect(pullResult[0].errors).toEqual([]);

      const targetParent = target.get<{ id: number }>("SELECT id FROM messages WHERE uuid = ?", "parent-uuid")!;
      const targetChild = target.get<{ id: number; reply_to: number }>("SELECT id, reply_to FROM messages WHERE uuid = ?", "child-uuid")!;
      expect(targetChild.reply_to).toBe(targetParent.id);
      expect(targetChild.reply_to).not.toBe(remoteParent.id);
    } finally {
      local.close();
      remote.close();
      target.close();
    }
  });

  it("keeps channel subscription cursors local during metadata sync", async () => {
    const local = createSyncDb();
    const remote = createSyncDb();
    try {
      local.run(`
        INSERT INTO channel_subscriptions (channel, agent, preview_chars, since_message_id)
        VALUES (?, ?, ?, ?)
      `, "ops", "reader", 240, 999);
      remote.run(`
        INSERT INTO channel_subscriptions (channel, agent, preview_chars, since_message_id)
        VALUES (?, ?, ?, ?)
      `, "ops", "reader", 140, 3);

      const result = await syncPush(local, asRemote(remote), { tables: ["channel_subscriptions"] });
      expect(result[0].errors).toEqual([]);

      const row = remote.get<{ preview_chars: number; since_message_id: number }>(
        "SELECT preview_chars, since_message_id FROM channel_subscriptions WHERE channel = ? AND agent = ?",
        "ops",
        "reader",
      )!;
      expect(row.preview_chars).toBe(240);
      expect(row.since_message_id).toBe(3);
    } finally {
      local.close();
      remote.close();
    }
  });
});
