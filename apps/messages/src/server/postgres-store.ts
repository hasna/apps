/**
 * PostgreSQL-backed MessagesStore — the harness server store.
 *
 * Selected when HASNA_MESSAGES_DATABASE_URL is set (the messages app v1
 * requirement: PostgreSQL backend for the internal harness). The schema
 * mirrors sqlite-store.ts exactly; both stores implement the same
 * MessagesStore contract behind MessagesService.
 */
import pg from "pg";
import type { Message, Thread } from "../types";
import type { MessagesStore } from "../service";

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

export class PostgresMessagesStore implements MessagesStore {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }

  async init(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async insertMessage(message: Message): Promise<void> {
    await this.pool.query(
      `INSERT INTO messages (id, thread_id, from_agent, to_agent, content, reply_to, created_at, read_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [message.id, message.thread_id, message.from_agent, message.to_agent, message.content, message.reply_to, message.created_at, message.read_at],
    );
  }

  async findThread(id: string): Promise<Thread | null> {
    const { rows } = await this.pool.query(
      `SELECT id, agent_a, agent_b, last_message_at, created_at FROM threads WHERE id = $1`,
      [id],
    );
    return (rows[0] as Thread | undefined) ?? null;
  }

  async upsertThread(thread: Thread): Promise<void> {
    await this.pool.query(
      `INSERT INTO threads (id, agent_a, agent_b, last_message_at, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET last_message_at = EXCLUDED.last_message_at`,
      [thread.id, thread.agent_a, thread.agent_b, thread.last_message_at, thread.created_at],
    );
  }

  async listMessages(threadId: string, limit?: number): Promise<Message[]> {
    const q = limit
      ? `SELECT id, thread_id, from_agent, to_agent, content, reply_to, created_at, read_at
         FROM messages WHERE thread_id = $1
         ORDER BY created_at DESC, id DESC LIMIT $2`
      : `SELECT id, thread_id, from_agent, to_agent, content, reply_to, created_at, read_at
         FROM messages WHERE thread_id = $1
         ORDER BY created_at DESC, id DESC`;
    const { rows } = await this.pool.query(q, limit ? [threadId, limit] : [threadId]);
    return (rows as Message[]).reverse();
  }

  async listThreads(agent: string): Promise<Thread[]> {
    const { rows } = await this.pool.query(
      `SELECT id, agent_a, agent_b, last_message_at, created_at
       FROM threads
       WHERE agent_a = $1 OR agent_b = $1
       ORDER BY COALESCE(last_message_at, created_at) DESC`,
      [agent],
    );
    return rows as Thread[];
  }

  async countUnread(threadId: string, agent: string): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM messages
       WHERE thread_id = $1 AND to_agent = $2 AND read_at IS NULL`,
      [threadId, agent],
    );
    return (rows[0] as { n: number }).n;
  }

  async countMessages(threadId: string): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM messages WHERE thread_id = $1`,
      [threadId],
    );
    return (rows[0] as { n: number }).n;
  }

  async markThreadRead(threadId: string, agent: string, at: string): Promise<void> {
    await this.pool.query(
      `UPDATE messages SET read_at = $1
       WHERE thread_id = $2 AND to_agent = $3 AND read_at IS NULL`,
      [at, threadId, agent],
    );
  }
}
