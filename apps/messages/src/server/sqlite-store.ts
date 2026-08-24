/**
 * SQLite-backed MessagesStore — the zero-config default server store.
 *
 * The server storage backend is selected by configuration, never by a mode
 * enum: SQLite unless HASNA_MESSAGES_DATABASE_URL is set, in which case
 * postgres-store.ts serves. Both stores implement the same MessagesStore
 * contract and are interchangeable behind MessagesService.
 */
import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message, Thread } from "../types";
import type { MessagesStore } from "../service";

export function defaultSqlitePath(): string {
  const explicit = process.env.HASNA_MESSAGES_SQLITE_PATH;
  if (explicit) return explicit;
  const home = process.env.HASNA_MESSAGES_HOME ?? path.join(os.homedir(), ".hasna", "messages");
  fs.mkdirSync(home, { recursive: true });
  return path.join(home, "messages.db");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  agent_a TEXT NOT NULL,
  agent_b TEXT NOT NULL,
  last_message_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  content TEXT NOT NULL,
  reply_to TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(to_agent, read_at);
`;

export class SqliteMessagesStore implements MessagesStore {
  private readonly db: Database;

  constructor(pathOrDb?: string | Database) {
    if (pathOrDb instanceof Database) {
      this.db = pathOrDb;
    } else {
      this.db = new Database(pathOrDb ?? defaultSqlitePath(), { create: true });
    }
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  async insertMessage(message: Message): Promise<void> {
    this.db
      .query(
        `INSERT INTO messages (id, thread_id, from_agent, to_agent, content, reply_to, created_at, read_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.thread_id,
        message.from_agent,
        message.to_agent,
        message.content,
        message.reply_to,
        message.created_at,
        message.read_at,
      );
  }

  async findThread(id: string): Promise<Thread | null> {
    const row = this.db
      .query(`SELECT id, agent_a, agent_b, last_message_at, created_at FROM threads WHERE id = ?`)
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

  async listMessages(threadId: string, limit?: number): Promise<Message[]> {
    // Most recent `limit` messages, ordered oldest-first within the window;
    // full history when limit is omitted.
    const q = this.db.query(
      `SELECT id, thread_id, from_agent, to_agent, content, reply_to, created_at, read_at
       FROM messages WHERE thread_id = ?
       ORDER BY created_at DESC, id DESC ${limit ? "LIMIT ?" : ""}`,
    );
    const rows = (limit ? (q.all(threadId, limit) as Message[]) : (q.all(threadId) as Message[])).reverse();
    return rows;
  }

  async listThreads(agent: string): Promise<Thread[]> {
    const rows = this.db
      .query(
        `SELECT id, agent_a, agent_b, last_message_at, created_at
         FROM threads
         WHERE agent_a = ? OR agent_b = ?
         ORDER BY COALESCE(last_message_at, created_at) DESC`,
      )
      .all(agent, agent) as Thread[];
    return rows;
  }

  async countUnread(threadId: string, agent: string): Promise<number> {
    const row = this.db
      .query(
        `SELECT COUNT(*) AS n FROM messages
         WHERE thread_id = ? AND to_agent = ? AND read_at IS NULL`,
      )
      .get(threadId, agent) as { n: number };
    return row.n;
  }

  async countMessages(threadId: string): Promise<number> {
    const row = this.db
      .query(`SELECT COUNT(*) AS n FROM messages WHERE thread_id = ?`)
      .get(threadId) as { n: number };
    return row.n;
  }

  async markThreadRead(threadId: string, agent: string, at: string): Promise<void> {
    this.db
      .query(
        `UPDATE messages SET read_at = ?
         WHERE thread_id = ? AND to_agent = ? AND read_at IS NULL`,
      )
      .run(at, threadId, agent);
  }
}
