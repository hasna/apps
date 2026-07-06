import { describe, expect, it } from "bun:test";
import { ConversationsDatabase } from "./db.js";
import {
  ensureLocalMessageSyncReady,
  getMessageSyncState,
  messageSyncStatus,
  pullMessages,
  pullReceipts,
  pushMessages,
  pushReceipts,
  toLocalTimestamp,
  toRemoteTimestamp,
  type RemoteAdapter,
} from "./message-sync.js";

// Mirrors the production SQLite shape for the columns message sync touches.
// uuid is intentionally NULLABLE (older machines got it via ALTER TABLE) so the
// repair pass is exercised.
const LOCAL_DDL = `
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT,
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
    edited_at TEXT,
    pinned_at TEXT,
    blocking INTEGER NOT NULL DEFAULT 0,
    attachments TEXT,
    reply_to INTEGER REFERENCES messages(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
    read_at TEXT
  );
  CREATE TABLE message_read_receipts (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    agent TEXT NOT NULL,
    read_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
    PRIMARY KEY (message_id, agent)
  );
`;

// SQLite stand-in for the hub Postgres schema (ids are hub-scoped, uuid unique).
const REMOTE_DDL = `
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
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
    edited_at TEXT,
    pinned_at TEXT,
    blocking INTEGER NOT NULL DEFAULT 0,
    attachments TEXT,
    reply_to INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    read_at TEXT
  );
  CREATE TABLE message_read_receipts (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    agent TEXT NOT NULL,
    read_at TEXT NOT NULL,
    PRIMARY KEY (message_id, agent)
  );
`;

class FakeRemote implements RemoteAdapter {
  readonly db: ConversationsDatabase;

  constructor() {
    this.db = new ConversationsDatabase(":memory:");
    this.db.exec(REMOTE_DDL);
  }

  async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    return this.db.run(sql, ...params);
  }

  async all(sql: string, ...params: unknown[]): Promise<unknown[]> {
    return this.db.all(sql, ...params);
  }

  async get(sql: string, ...params: unknown[]): Promise<unknown | null> {
    return this.db.get(sql, ...params);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

function newLocal(): ConversationsDatabase {
  const db = new ConversationsDatabase(":memory:");
  db.exec(LOCAL_DDL);
  return db;
}

let timestampCounter = 0;

function insertMessage(
  db: ConversationsDatabase,
  overrides: Partial<Record<string, unknown>> = {},
): { id: number; uuid: string } {
  const uuid = overrides["uuid"] === undefined ? crypto.randomUUID().replaceAll("-", "") : overrides["uuid"];
  const createdAt = overrides["created_at"] ?? `2026-07-06T10:00:${String(timestampCounter++ % 60).padStart(2, "0")}.000`;
  db.run(
    `INSERT INTO messages (uuid, session_id, from_agent, to_agent, channel, content, priority, blocking, reply_to, created_at, read_at, edited_at, pinned_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    uuid,
    overrides["session_id"] ?? "session-1",
    overrides["from_agent"] ?? "agent-a",
    overrides["to_agent"] ?? "channel",
    overrides["channel"] ?? "general",
    overrides["content"] ?? "hello",
    overrides["priority"] ?? "normal",
    overrides["blocking"] ?? 0,
    overrides["reply_to"] ?? null,
    createdAt,
    overrides["read_at"] ?? null,
    overrides["edited_at"] ?? null,
    overrides["pinned_at"] ?? null,
    overrides["metadata"] ?? null,
  );
  const row = db.get<{ id: number; uuid: string }>("SELECT id, uuid FROM messages ORDER BY id DESC LIMIT 1");
  return { id: row!.id, uuid: row!.uuid };
}

describe("timestamp normalization", () => {
  it("suffixes naive UTC text and strips it back", () => {
    expect(toRemoteTimestamp("2026-07-06T10:00:00.123")).toBe("2026-07-06T10:00:00.123Z");
    expect(toRemoteTimestamp("2026-07-06 10:00:00")).toBe("2026-07-06T10:00:00Z");
    expect(toRemoteTimestamp(new Date(Date.UTC(2026, 6, 6, 10, 0, 0, 123)))).toBe("2026-07-06T10:00:00.123Z");
    expect(toRemoteTimestamp(null)).toBeNull();
    expect(toLocalTimestamp("2026-07-06T10:00:00.123Z")).toBe("2026-07-06T10:00:00.123");
    expect(toLocalTimestamp(new Date(Date.UTC(2026, 6, 6, 10, 0, 0, 123)))).toBe("2026-07-06T10:00:00.123");
    expect(toLocalTimestamp(null)).toBeNull();
  });
});

describe("ensureLocalMessageSyncReady", () => {
  it("backfills NULL and duplicate uuids and keeps them unique", () => {
    const db = newLocal();
    insertMessage(db, { uuid: null });
    insertMessage(db, { uuid: null });
    insertMessage(db, { uuid: "dupe" });
    insertMessage(db, { uuid: "dupe" });

    ensureLocalMessageSyncReady(db);

    const nulls = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE uuid IS NULL OR uuid = ''");
    expect(nulls!.n).toBe(0);
    const dupes = db.all("SELECT uuid FROM messages GROUP BY uuid HAVING COUNT(*) > 1");
    expect(dupes).toHaveLength(0);
    // idempotent: uuids do not churn on repeat runs
    const before = db.all<{ id: number; uuid: string }>("SELECT id, uuid FROM messages ORDER BY id");
    ensureLocalMessageSyncReady(db);
    const after = db.all<{ id: number; uuid: string }>("SELECT id, uuid FROM messages ORDER BY id");
    expect(after).toEqual(before);
    db.close();
  });
});

describe("message push/pull round trip", () => {
  it("replicates messages across machines with reply_to remapped through uuids", async () => {
    const machineA = newLocal();
    const machineB = newLocal();
    const remote = new FakeRemote();

    const root = insertMessage(machineA, { content: "root", created_at: "2026-07-06T10:00:00.000" });
    const reply = insertMessage(machineA, { content: "reply", reply_to: root.id, created_at: "2026-07-06T10:00:01.000" });
    insertMessage(machineA, { content: "third", created_at: "2026-07-06T10:00:02.000" });

    const push = await pushMessages(machineA, remote);
    expect(push.errors).toEqual([]);
    expect(push.rowsRead).toBe(3);
    expect(push.rowsWritten).toBe(3);

    // hub: created_at is zone-explicit, reply_to remapped to the hub id of root
    const hubRows = remote.db.all<Record<string, unknown>>("SELECT * FROM messages ORDER BY id");
    expect(hubRows).toHaveLength(3);
    expect(hubRows[0]!["created_at"]).toBe("2026-07-06T10:00:00.000Z");
    const hubRoot = remote.db.get<{ id: number }>("SELECT id FROM messages WHERE uuid = ?", root.uuid);
    const hubReply = remote.db.get<{ reply_to: number }>("SELECT reply_to FROM messages WHERE uuid = ?", reply.uuid);
    expect(hubReply!.reply_to).toBe(hubRoot!.id);

    // machine B: offset its autoincrement so local ids differ from hub ids
    for (let i = 0; i < 5; i += 1) insertMessage(machineB, { content: `b-noise-${i}` });

    const pull = await pullMessages(remote, machineB);
    expect(pull.errors).toEqual([]);
    expect(pull.rowsRead).toBe(3);
    expect(pull.rowsWritten).toBe(3);

    const bRoot = machineB.get<{ id: number; content: string; created_at: string }>("SELECT id, content, created_at FROM messages WHERE uuid = ?", root.uuid);
    const bReply = machineB.get<{ reply_to: number }>("SELECT reply_to FROM messages WHERE uuid = ?", reply.uuid);
    expect(bRoot!.content).toBe("root");
    expect(bRoot!.created_at).toBe("2026-07-06T10:00:00.000");
    expect(bReply!.reply_to).toBe(bRoot!.id);
    expect(bRoot!.id).not.toBe(hubRoot!.id);

    // incremental: immediate re-run writes nothing (pull re-scans a small id
    // margin behind the cursor by design; the conflict WHERE gate no-ops it)
    const rePush = await pushMessages(machineA, remote);
    expect(rePush.rowsRead).toBe(0);
    expect(rePush.rowsWritten).toBe(0);
    const rePull = await pullMessages(remote, machineB);
    expect(rePull.rowsWritten).toBe(0);

    machineA.close();
    machineB.close();
    await remote.close();
  });

  it("is bidirectional: pull-then-push exchanges messages both ways", async () => {
    const machineA = newLocal();
    const machineB = newLocal();
    const remote = new FakeRemote();

    const fromA = insertMessage(machineA, { content: "from A", from_agent: "agent-a" });
    const fromB = insertMessage(machineB, { content: "from B", from_agent: "agent-b" });

    // each machine runs the sync cycle: pull then push
    await pullMessages(remote, machineA);
    await pushMessages(machineA, remote);
    await pullMessages(remote, machineB);
    await pushMessages(machineB, remote);
    await pullMessages(remote, machineA);

    expect(machineA.get("SELECT id FROM messages WHERE uuid = ?", fromB.uuid)).not.toBeNull();
    expect(machineB.get("SELECT id FROM messages WHERE uuid = ?", fromA.uuid)).not.toBeNull();
    // A pulling its own pushed rows back is a no-op (conflict WHERE gate)
    const aCount = machineA.get<{ n: number }>("SELECT COUNT(*) AS n FROM messages");
    expect(aCount!.n).toBe(2);

    machineA.close();
    machineB.close();
    await remote.close();
  });

  it("heals rows that become visible behind the pull cursor (concurrent-push race)", async () => {
    const machineB = newLocal();
    const remote = new FakeRemote();

    // rows 1 and 3 are visible; id 2 is still in-flight from another pusher
    remote.db.run(
      "INSERT INTO messages (id, uuid, session_id, from_agent, to_agent, channel, content, created_at) VALUES (1, 'u1', 's', 'a', 'channel', 'general', 'one', '2026-07-06T10:00:00.000Z')",
    );
    remote.db.run(
      "INSERT INTO messages (id, uuid, session_id, from_agent, to_agent, channel, content, created_at) VALUES (3, 'u3', 's', 'a', 'channel', 'general', 'three', '2026-07-06T10:00:02.000Z')",
    );
    await pullMessages(remote, machineB);
    expect(machineB.get<{ n: number }>("SELECT COUNT(*) AS n FROM messages")!.n).toBe(2);

    // the in-flight row commits after the cursor already advanced to 3
    remote.db.run(
      "INSERT INTO messages (id, uuid, session_id, from_agent, to_agent, channel, content, created_at) VALUES (2, 'u2', 's', 'a', 'channel', 'general', 'two', '2026-07-06T10:00:01.000Z')",
    );
    const heal = await pullMessages(remote, machineB);
    expect(heal.rowsWritten).toBe(1);
    expect(machineB.get("SELECT id FROM messages WHERE uuid = 'u2'")).not.toBeNull();

    machineB.close();
    await remote.close();
  });

  it("applies edit LWW and set-once read/pinned semantics when a row re-syncs", async () => {
    const machineA = newLocal();
    const remote = new FakeRemote();

    const msg = insertMessage(machineA, { content: "v1", created_at: "2026-07-06T10:00:00.000" });
    await pushMessages(machineA, remote);

    // remote row got edited (newer edited_at) + read elsewhere
    remote.db.run(
      "UPDATE messages SET content = 'v2', edited_at = '2026-07-06T11:00:00.000', read_at = '2026-07-06T11:01:00.000' WHERE uuid = ?",
      msg.uuid,
    );
    // force a re-pull from scratch (cursor reset simulates re-sync)
    const pull = await pullMessages(remote, machineA);
    expect(pull.rowsWritten).toBe(1);
    const local = machineA.get<{ content: string; edited_at: string; read_at: string }>(
      "SELECT content, edited_at, read_at FROM messages WHERE uuid = ?",
      msg.uuid,
    );
    expect(local!.content).toBe("v2");
    expect(local!.edited_at).toBe("2026-07-06T11:00:00.000");
    expect(local!.read_at).toBe("2026-07-06T11:01:00.000");

    // an OLDER edit must not clobber a newer one
    remote.db.run("UPDATE messages SET content = 'stale', edited_at = '2026-07-06T09:00:00.000' WHERE uuid = ?", msg.uuid);
    machineA.run("UPDATE messages SET reply_to = NULL WHERE uuid = ?", msg.uuid); // no-op, keeps row untouched
    const dbForReset = machineA;
    // reset pull cursor to re-read everything
    dbForReset.run("UPDATE _message_sync_state SET value = '0' WHERE key = 'messages_pull_last_remote_id'");
    await pullMessages(remote, dbForReset);
    const local2 = machineA.get<{ content: string }>("SELECT content FROM messages WHERE uuid = ?", msg.uuid);
    expect(local2!.content).toBe("v2");

    machineA.close();
    await remote.close();
  });
});

describe("receipt push/pull", () => {
  it("replicates receipts keyed by message uuid with per-machine id translation", async () => {
    const machineA = newLocal();
    const machineB = newLocal();
    const remote = new FakeRemote();

    const msg = insertMessage(machineA, { content: "read me" });
    machineA.run(
      "INSERT INTO message_read_receipts (message_id, agent, read_at) VALUES (?, ?, ?)",
      msg.id,
      "reader-1",
      "2026-07-06T12:00:00.000",
    );

    await pushMessages(machineA, remote);
    const pushR = await pushReceipts(machineA, remote);
    expect(pushR.errors).toEqual([]);
    expect(pushR.rowsWritten).toBe(1);

    const hubReceipt = remote.db.get<{ message_id: number; read_at: string }>(
      "SELECT message_id, read_at FROM message_read_receipts WHERE agent = 'reader-1'",
    );
    const hubMsg = remote.db.get<{ id: number }>("SELECT id FROM messages WHERE uuid = ?", msg.uuid);
    expect(hubReceipt!.message_id).toBe(hubMsg!.id);
    expect(hubReceipt!.read_at).toBe("2026-07-06T12:00:00.000Z");

    // machine B with offset ids
    insertMessage(machineB, { content: "noise" });
    await pullMessages(remote, machineB);
    const pullR = await pullReceipts(remote, machineB);
    expect(pullR.errors).toEqual([]);
    expect(pullR.rowsWritten).toBe(1);

    const bMsg = machineB.get<{ id: number }>("SELECT id FROM messages WHERE uuid = ?", msg.uuid);
    const bReceipt = machineB.get<{ message_id: number; read_at: string }>(
      "SELECT message_id, read_at FROM message_read_receipts WHERE agent = 'reader-1'",
    );
    expect(bReceipt!.message_id).toBe(bMsg!.id);
    expect(bReceipt!.read_at).toBe("2026-07-06T12:00:00.000");

    // idempotent re-runs
    expect((await pushReceipts(machineA, remote)).rowsWritten).toBe(0);
    expect((await pullReceipts(remote, machineB)).rowsWritten).toBe(0);

    machineA.close();
    machineB.close();
    await remote.close();
  });

  it("holds the cursor back for receipts whose message has not replicated yet", async () => {
    const machineB = newLocal();
    const remote = new FakeRemote();

    // hub has a message + receipt, but B pulls receipts BEFORE messages
    remote.db.run(
      `INSERT INTO messages (uuid, session_id, from_agent, to_agent, channel, content, created_at)
       VALUES ('orphan-uuid', 's', 'a', 'channel', 'general', 'hi', '2026-07-06T10:00:00.000Z')`,
    );
    const hubMsg = remote.db.get<{ id: number }>("SELECT id FROM messages WHERE uuid = 'orphan-uuid'");
    remote.db.run(
      "INSERT INTO message_read_receipts (message_id, agent, read_at) VALUES (?, 'reader-2', '2026-07-06T12:00:00.000Z')",
      hubMsg!.id,
    );

    const first = await pullReceipts(remote, machineB);
    expect(first.rowsWritten).toBe(0);
    // cursor held at the missing receipt's read_at, so it retries
    expect(getMessageSyncState(machineB, "receipts_pull_since")).toBe("2026-07-06T12:00:00.000Z");

    await pullMessages(remote, machineB);
    const second = await pullReceipts(remote, machineB);
    expect(second.rowsWritten).toBe(1);

    machineB.close();
    await remote.close();
  });
});

describe("messageSyncStatus", () => {
  it("reports cursors and local counts", async () => {
    const db = newLocal();
    const remote = new FakeRemote();
    insertMessage(db, { content: "one" });
    await pushMessages(db, remote);

    const status = messageSyncStatus(db);
    expect(status.local_messages).toBe(1);
    expect(status.null_uuid_messages).toBe(0);
    expect(status.push_last_message_id).toBe(1);
    expect(status.pull_last_remote_message_id).toBe(0);

    db.close();
    await remote.close();
  });
});
