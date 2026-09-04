/**
 * SQLite-backed MessagesStore — the zero-config default server store.
 *
 * The server storage backend is selected by configuration, never by a mode
 * enum: SQLite unless HASNA_MESSAGES_DATABASE_URL is set, in which case
 * postgres-store.ts serves. Both stores implement the same MessagesStore
 * contract and are interchangeable behind MessagesService.
 *
 * Delivery model: `message_deliveries` holds one row per message per
 * recipient with the state machine stored -> delivered -> read. A message
 * with no delivery row is a sender-side message (own message, no record).
 */
import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Agent, Message, MessageDelivery, MessageDeliveryReport, Thread } from "../types";
import type { MessagesStore } from "../service";
import { getDataRoot } from "../paths";

/**
 * The local database file used when no path is configured: `<effective data
 * root>/messages.db` — the resolver data root (ruling hasna/apps#1668); the
 * store is migrated to the resolver (XDG / macOS) data home or the operator
 * sets `HASNA_DATA_HOME`; the exact-app override `HASNA_MESSAGES_HOME` names
 * an explicit root. `src/paths.ts` owns the root resolution; the
 * file-level `HASNA_MESSAGES_SQLITE_PATH` override wins over all of it.
 */
export function defaultSqlitePath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.HASNA_MESSAGES_SQLITE_PATH;
  if (explicit) return explicit;
  const dataRoot = getDataRoot(env);
  fs.mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
  return path.join(dataRoot, "messages.db");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  agent_a TEXT NOT NULL,
  agent_b TEXT NOT NULL,
  last_message_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS thread_participants (
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  agent TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  closed_at TEXT,
  PRIMARY KEY (thread_id, agent)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  content TEXT NOT NULL,
  reply_to TEXT,
  created_at TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS message_deliveries (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'stored',
  stored_at TEXT NOT NULL,
  delivered_at TEXT,
  read_at TEXT,
  PRIMARY KEY (message_id, recipient)
);
CREATE INDEX IF NOT EXISTS idx_deliveries_recipient ON message_deliveries(recipient, state);
`;

interface MessageRow {
  id: string;
  thread_id: string;
  sender: string;
  content: string;
  reply_to: string | null;
  created_at: string;
  seq: number;
}

/** A message row joined with a delivery row (delivery fields nullable when no delivery). */
interface MessageDeliveryJoin extends MessageRow {
  recipient: string | null;
  state: string | null;
  stored_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    thread_id: row.thread_id,
    from_agent: row.sender,
    content: row.content,
    reply_to: row.reply_to,
    created_at: row.created_at,
    seq: row.seq,
  };
}

function toDelivery(row: MessageDeliveryJoin): MessageDelivery {
  return {
    recipient: row.recipient!,
    state: row.state! as MessageDelivery["state"],
    stored_at: row.stored_at!,
    delivered_at: row.delivered_at,
    read_at: row.read_at,
  };
}

export class SqliteMessagesStore implements MessagesStore {
  private readonly db: Database;

  constructor(pathOrDb?: string | Database) {
    if (pathOrDb instanceof Database) {
      this.db = pathOrDb;
    } else {
      this.db = new Database(pathOrDb ?? defaultSqlitePath(), { create: true });
    }
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // --- agent identity ---

  async findAgentByName(name: string): Promise<Agent | null> {
    const row = this.db
      .query("SELECT id, name, display_name, created_at, last_seen_at FROM agents WHERE name = ?")
      .get(name) as Agent | null;
    return row ?? null;
  }

  async insertAgent(agent: Agent): Promise<void> {
    this.db
      .query(
        "INSERT INTO agents (id, name, display_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(agent.id, agent.name, agent.display_name, agent.created_at, agent.last_seen_at);
  }

  async listAgents(): Promise<Agent[]> {
    return this.db
      .query("SELECT id, name, display_name, created_at, last_seen_at FROM agents ORDER BY name ASC")
      .all() as Agent[];
  }

  async touchAgent(name: string, at: string): Promise<void> {
    this.db.query("UPDATE agents SET last_seen_at = ? WHERE name = ?").run(at, name);
  }

  // --- threads ---

  async findThread(id: string): Promise<Thread | null> {
    const row = this.db
      .query("SELECT id, agent_a, agent_b, last_message_at, created_at FROM threads WHERE id = ?")
      .get(id) as Thread | null;
    return row ?? null;
  }

  async upsertThread(thread: Thread): Promise<void> {
    this.db
      .query(
        `INSERT INTO threads (id, agent_a, agent_b, last_message_at, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_message_at = excluded.last_message_at`,
      )
      .run(thread.id, thread.agent_a, thread.agent_b, thread.last_message_at, thread.created_at);
  }

  async ensureParticipant(threadId: string, agent: string, joinedAt: string): Promise<void> {
    this.db
      .query(
        `INSERT INTO thread_participants (thread_id, agent, joined_at, closed_at)
         VALUES (?, ?, ?, NULL)
         ON CONFLICT(thread_id, agent) DO NOTHING`,
      )
      .run(threadId, agent, joinedAt);
  }

  async setParticipantClosed(threadId: string, agent: string, closedAt: string | null): Promise<void> {
    this.db
      .query("UPDATE thread_participants SET closed_at = ? WHERE thread_id = ? AND agent = ?")
      .run(closedAt, threadId, agent);
  }

  async participantClosedAt(threadId: string, agent: string): Promise<string | null> {
    const row = this.db
      .query("SELECT closed_at FROM thread_participants WHERE thread_id = ? AND agent = ?")
      .get(threadId, agent) as { closed_at: string | null } | null;
    return row?.closed_at ?? null;
  }

  async listThreads(agent: string, openOnly: boolean): Promise<Thread[]> {
    const openFilter = openOnly ? "AND tp.closed_at IS NULL" : "";
    const rows = this.db
      .query(
        `SELECT t.id, t.agent_a, t.agent_b, t.last_message_at, t.created_at
         FROM threads t
         JOIN thread_participants tp ON tp.thread_id = t.id AND tp.agent = ?
         WHERE (t.agent_a = ? OR t.agent_b = ?) ${openFilter}
         ORDER BY COALESCE(t.last_message_at, t.created_at) DESC`,
      )
      .all(agent, agent, agent) as Array<Omit<Thread, "last_message_at"> & { last_message_at: string | null }>;
    return rows;
  }

  // --- messages + deliveries ---

  async insertMessage(message: Omit<Message, "seq">): Promise<Message> {
    // Atomic per-thread seq assignment: the insert and the MAX(seq)+1 read
    // are one statement, so two concurrent sends to the same thread can never
    // observe the same MAX and duplicate a seq.
    this.db
      .query(
        `INSERT INTO messages (id, thread_id, sender, content, reply_to, created_at, seq)
         SELECT ?, ?, ?, ?, ?, ?, COALESCE(MAX(seq), 0) + 1 FROM messages WHERE thread_id = ?`,
      )
      .run(message.id, message.thread_id, message.from_agent, message.content, message.reply_to, message.created_at, message.thread_id);
    const row = this.db
      .query("SELECT id, thread_id, sender, content, reply_to, created_at, seq FROM messages WHERE id = ?")
      .get(message.id) as MessageRow;
    return toMessage(row);
  }

  async insertDelivery(messageId: string, delivery: MessageDelivery): Promise<void> {
    this.db
      .query(
        `INSERT INTO message_deliveries (message_id, recipient, state, stored_at, delivered_at, read_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(messageId, delivery.recipient, delivery.state, delivery.stored_at, delivery.delivered_at, delivery.read_at);
  }

  async listMessages(threadId: string, limit?: number): Promise<Message[]> {
    // Most recent `limit` messages, oldest-first within the window; full
    // history when limit is omitted. seq is the per-thread monotonic order.
    if (limit !== undefined) {
      const rows = this.db
        .query(
          `SELECT id, thread_id, sender, content, reply_to, created_at, seq
           FROM messages WHERE thread_id = ?
           ORDER BY seq DESC, created_at DESC LIMIT ?`,
        )
        .all(threadId, limit) as MessageRow[];
      return rows.reverse().map(toMessage);
    }
    const rows = this.db
      .query(
        `SELECT id, thread_id, sender, content, reply_to, created_at, seq
         FROM messages WHERE thread_id = ?
         ORDER BY seq ASC, created_at ASC`,
      )
      .all(threadId) as MessageRow[];
    return rows.map(toMessage);
  }

  async messagesWithDelivery(threadId: string, agent: string): Promise<Array<{ message: Message; delivery: MessageDelivery | null }>> {
    const rows = this.db
      .query(
        `SELECT m.id, m.thread_id, m.sender, m.content, m.reply_to, m.created_at, m.seq,
                d.recipient, d.state, d.stored_at, d.delivered_at, d.read_at
         FROM messages m
         LEFT JOIN message_deliveries d ON d.message_id = m.id AND d.recipient = ?
         WHERE m.thread_id = ?
         ORDER BY m.seq ASC, m.created_at ASC`,
      )
      .all(agent, threadId) as MessageDeliveryJoin[];
    return rows.map((row) => ({
      message: toMessage(row),
      delivery: row.state === null ? null : toDelivery(row),
    }));
  }

  async deliveryReport(threadId: string): Promise<MessageDeliveryReport[]> {
    const rows = this.db
      .query(
        `SELECT m.id, m.thread_id, m.sender, m.content, m.reply_to, m.created_at, m.seq,
                d.recipient, d.state, d.stored_at, d.delivered_at, d.read_at
         FROM messages m
         LEFT JOIN message_deliveries d ON d.message_id = m.id
         WHERE m.thread_id = ?
         ORDER BY m.seq ASC, m.created_at ASC`,
      )
      .all(threadId) as MessageDeliveryJoin[];
    const byMessage = new Map<string, MessageDeliveryReport>();
    for (const row of rows) {
      let report = byMessage.get(row.id);
      if (!report) {
        report = { message: toMessage(row), deliveries: [] };
        byMessage.set(row.id, report);
      }
      if (row.state !== null) report.deliveries.push(toDelivery(row));
    }
    return [...byMessage.values()];
  }

  async deliverTo(recipient: string, at: string): Promise<Array<{ message: Message; delivery: MessageDelivery }>> {
    // 1. Capture the stored (undelivered) rows for the recipient.
    const stored = this.db
      .query(
        `SELECT m.id, m.thread_id, m.sender, m.content, m.reply_to, m.created_at, m.seq,
                d.recipient, d.state, d.stored_at, d.delivered_at, d.read_at
         FROM message_deliveries d
         JOIN messages m ON m.id = d.message_id
         WHERE d.recipient = ? AND d.state = 'stored'
         ORDER BY m.seq ASC, m.created_at ASC`,
      )
      .all(recipient) as MessageDeliveryJoin[];
    if (stored.length === 0) return [];
    // 2. Transition them to delivered (single-writer SQLite: atomic per connection).
    const ids = stored.map((row) => row.id);
    const placeholders = ids.map(() => "?").join(", ");
    this.db
      .query(
        `UPDATE message_deliveries SET state = 'delivered', delivered_at = ?
         WHERE recipient = ? AND message_id IN (${placeholders})`,
      )
      .run(at, recipient, ...ids);
    // 3. Return the delivered rows (fresh delivery state).
    return stored.map((row) => ({
      message: toMessage(row),
      delivery: {
        recipient: row.recipient!,
        state: "delivered" as const,
        stored_at: row.stored_at!,
        delivered_at: at,
        read_at: row.read_at,
      },
    }));
  }

  async markThreadRead(threadId: string, agent: string, at: string): Promise<void> {
    this.db
      .query(
        `UPDATE message_deliveries SET state = 'read', read_at = ?
         WHERE message_id IN (SELECT id FROM messages WHERE thread_id = ?)
           AND recipient = ? AND state != 'read'`,
      )
      .run(at, threadId, agent);
  }

  async markMessageRead(messageId: string, agent: string, at: string): Promise<void> {
    this.db
      .query(
        `UPDATE message_deliveries SET state = 'read', read_at = ?
         WHERE message_id = ? AND recipient = ? AND state != 'read'`,
      )
      .run(at, messageId, agent);
  }

  // --- counts ---

  async countUnread(threadId: string, agent: string): Promise<number> {
    const row = this.db
      .query(
        `SELECT COUNT(*) AS n FROM message_deliveries
         WHERE message_id IN (SELECT id FROM messages WHERE thread_id = ?)
           AND recipient = ? AND state != 'read'`,
      )
      .get(threadId, agent) as { n: number };
    return row.n;
  }

  async countMessages(threadId: string): Promise<number> {
    const row = this.db
      .query("SELECT COUNT(*) AS n FROM messages WHERE thread_id = ?")
      .get(threadId) as { n: number };
    return row.n;
  }
}
