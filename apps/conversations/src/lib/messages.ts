import { getDb } from "./db.js";
import type { Message, SendMessageOptions, ReadMessagesOptions } from "../types.js";
import { randomUUID } from "crypto";

function parseMessage(row: Record<string, unknown>): Message {
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
  } as Message;
}

export function sendMessage(opts: SendMessageOptions): Message {
  const db = getDb();
  const sessionId = opts.session_id || `${[opts.from, opts.to].sort().join("-")}-${randomUUID().slice(0, 8)}`;
  const metadata = opts.metadata ? JSON.stringify(opts.metadata) : null;

  const stmt = db.prepare(`
    INSERT INTO messages (session_id, from_agent, to_agent, channel, content, priority, working_dir, repository, branch, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `);

  const row = stmt.get(
    sessionId,
    opts.from,
    opts.to,
    opts.channel || null,
    opts.content,
    opts.priority || "normal",
    opts.working_dir || null,
    opts.repository || null,
    opts.branch || null,
    metadata
  ) as Record<string, unknown>;

  return parseMessage(row);
}

export function readMessages(opts: ReadMessagesOptions = {}): Message[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (opts.session_id) {
    conditions.push("session_id = ?");
    params.push(opts.session_id);
  }
  if (opts.from) {
    conditions.push("from_agent = ?");
    params.push(opts.from);
  }
  if (opts.to) {
    conditions.push("to_agent = ?");
    params.push(opts.to);
  }
  if (opts.channel) {
    conditions.push("channel = ?");
    params.push(opts.channel);
  }
  if (opts.since) {
    conditions.push("created_at > ?");
    params.push(opts.since);
  }
  if (opts.unread_only) {
    conditions.push("read_at IS NULL");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts.limit ? `LIMIT ${opts.limit}` : "";

  const rows = db.prepare(
    `SELECT * FROM messages ${where} ORDER BY created_at ASC ${limit}`
  ).all(...params) as Record<string, unknown>[];

  return rows.map(parseMessage);
}

export function markRead(ids: number[], reader: string): number {
  const db = getDb();
  if (ids.length === 0) return 0;

  const placeholders = ids.map(() => "?").join(", ");
  const stmt = db.prepare(
    `UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE id IN (${placeholders}) AND to_agent = ? AND read_at IS NULL`
  );
  const result = stmt.run(...ids, reader);
  return result.changes;
}

export function markSessionRead(sessionId: string, reader: string): number {
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE session_id = ? AND to_agent = ? AND read_at IS NULL`
  );
  const result = stmt.run(sessionId, reader);
  return result.changes;
}

export function markChannelRead(channelName: string, reader: string): number {
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE channel = ? AND from_agent != ? AND read_at IS NULL`
  );
  const result = stmt.run(channelName, reader);
  return result.changes;
}

export function getMessageById(id: number): Message | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? parseMessage(row) : null;
}
