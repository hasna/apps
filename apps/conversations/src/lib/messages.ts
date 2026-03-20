import { getDb } from "./db.js";
import type { Message, Attachment, SendMessageOptions, ReadMessagesOptions, SearchMessagesOptions, SearchResult } from "../types.js";
import { randomUUID } from "crypto";
import { mkdirSync, copyFileSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { fireWebhooks } from "./webhooks.js";

/** Strip null/undefined fields from a message for compact output. */
export function compactMessage(msg: Message): Partial<Message> {
  const result: Partial<Message> = {};
  for (const key of Object.keys(msg) as (keyof Message)[]) {
    const val = msg[key];
    if (val !== null && val !== undefined) {
      (result as Record<string, unknown>)[key] = val;
    }
  }
  return result;
}

function parseMessage(row: Record<string, unknown>): Message {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata as string);
    } catch {
      metadata = null;
    }
  }

  let attachments: Attachment[] | null = null;
  if (row.attachments) {
    try {
      attachments = JSON.parse(row.attachments as string);
    } catch {
      attachments = null;
    }
  }

  return {
    ...row,
    metadata,
    attachments,
    blocking: !!(row.blocking as number),
    reply_to: (row.reply_to as number) || null,
  } as Message;
}

function getAttachmentsDir(): string {
  if (process.env.CONVERSATIONS_ATTACHMENTS_DIR) return process.env.CONVERSATIONS_ATTACHMENTS_DIR;
  return join(homedir(), ".conversations", "attachments");
}

function guessMimeType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    txt: "text/plain", md: "text/markdown", json: "application/json",
    js: "text/javascript", ts: "text/typescript", py: "text/x-python",
    html: "text/html", css: "text/css", xml: "application/xml",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    svg: "image/svg+xml", webp: "image/webp",
    pdf: "application/pdf", zip: "application/zip", gz: "application/gzip",
    csv: "text/csv", yaml: "text/yaml", yml: "text/yaml",
  };
  return mimeMap[ext || ""] || "application/octet-stream";
}

export function sendMessage(opts: SendMessageOptions): Message {
  const db = getDb();
  const explicitSession = opts.session_id && opts.session_id.trim().length > 0 ? opts.session_id : undefined;
  const sessionId = explicitSession
    ?? (opts.space ? `space:${opts.space}` : `${[opts.from, opts.to].sort().join("-")}-${randomUUID().slice(0, 8)}`);
  const metadata = opts.metadata ? JSON.stringify(opts.metadata) : null;
  const normalizedPriority = (opts.priority === "low" || opts.priority === "normal" || opts.priority === "high" || opts.priority === "urgent")
    ? opts.priority
    : "normal";

  const blocking = opts.blocking ? 1 : 0;

  const replyTo = opts.reply_to || null;

  const stmt = db.prepare(`
    INSERT INTO messages (session_id, from_agent, to_agent, space, project_id, content, priority, working_dir, repository, branch, metadata, blocking, reply_to)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `);

  const row = stmt.get(
    sessionId,
    opts.from,
    opts.to,
    opts.space || null,
    opts.project_id || null,
    opts.content,
    normalizedPriority,
    opts.working_dir || null,
    opts.repository || null,
    opts.branch || null,
    metadata,
    blocking,
    replyTo
  ) as Record<string, unknown>;

  const message = parseMessage(row);

  // Handle file attachments
  if (opts.attachments && opts.attachments.length > 0) {
    const attachmentsDir = join(getAttachmentsDir(), String(message.id));
    mkdirSync(attachmentsDir, { recursive: true });

    const attachmentInfos: Attachment[] = [];
    for (const att of opts.attachments) {
      const destPath = join(attachmentsDir, att.name);
      copyFileSync(att.source_path, destPath);
      const stat = statSync(destPath);
      attachmentInfos.push({
        name: att.name,
        path: destPath,
        size: stat.size,
        mime_type: guessMimeType(att.name),
      });
    }

    const attachmentsJson = JSON.stringify(attachmentInfos);
    db.prepare("UPDATE messages SET attachments = ? WHERE id = ?").run(attachmentsJson, message.id);
    message.attachments = attachmentInfos;
  }

  // Fire webhooks async (never blocks)
  fireWebhooks(message);

  return message;
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
  if (opts.space) {
    conditions.push("space = ?");
    params.push(opts.space);
  }
  if (opts.project_id) {
    conditions.push("project_id = ?");
    params.push(opts.project_id);
  }
  if (opts.since) {
    conditions.push("created_at > ?");
    params.push(opts.since);
  }
  if (opts.since_id !== undefined) {
    conditions.push("id > ?");
    params.push(opts.since_id);
  }
  if (opts.unread_only) {
    conditions.push("read_at IS NULL");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const resolvedLimit = Number.isFinite(opts.limit) && (opts.limit as number) > 0
    ? Math.floor(opts.limit as number)
    : 20;
  const order = opts.order?.toLowerCase() === "desc" ? "DESC" : "ASC";

  const rows = db.prepare(
    `SELECT * FROM messages ${where} ORDER BY created_at ${order}, id ${order} LIMIT ${resolvedLimit}`
  ).all(...params) as Record<string, unknown>[];

  const messages = rows.map(parseMessage);
  if (opts.compact) return messages.map(compactMessage) as Message[];
  return messages;
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

export function markSpaceRead(spaceName: string, reader: string): number {
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE space = ? AND from_agent != ? AND read_at IS NULL`
  );
  const result = stmt.run(spaceName, reader);
  return result.changes;
}

export function getMessageById(id: number): Message | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? parseMessage(row) : null;
}

export function markReadByIds(ids: number[]): number {
  const db = getDb();
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(", ");
  const stmt = db.prepare(
    `UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE id IN (${placeholders}) AND read_at IS NULL`
  );
  const result = stmt.run(...ids);
  return result.changes;
}

export function markAllRead(agent: string): number {
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE to_agent = ? AND read_at IS NULL`
  );
  const result = stmt.run(agent);
  return result.changes;
}

export interface ExportMessagesOptions {
  space?: string;
  session_id?: string;
  from?: string;
  since?: string;
  until?: string;
  format?: "json" | "csv";
}

function escapeCsvField(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportMessages(opts?: ExportMessagesOptions): string {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (opts?.space) {
    conditions.push("space = ?");
    params.push(opts.space);
  }
  if (opts?.session_id) {
    conditions.push("session_id = ?");
    params.push(opts.session_id);
  }
  if (opts?.from) {
    conditions.push("from_agent = ?");
    params.push(opts.from);
  }
  if (opts?.since) {
    conditions.push("created_at >= ?");
    params.push(opts.since);
  }
  if (opts?.until) {
    conditions.push("created_at <= ?");
    params.push(opts.until);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db.prepare(
    `SELECT * FROM messages ${where} ORDER BY created_at ASC, id ASC`
  ).all(...params) as Record<string, unknown>[];

  const messages = rows.map(parseMessage);
  const format = opts?.format ?? "json";

  if (format === "csv") {
    const headers = "id,session_id,from_agent,to_agent,space,content,priority,created_at,read_at";
    const lines = messages.map((m) =>
      [
        String(m.id),
        escapeCsvField(m.session_id),
        escapeCsvField(m.from_agent),
        escapeCsvField(m.to_agent),
        escapeCsvField(m.space),
        escapeCsvField(m.content),
        escapeCsvField(m.priority),
        escapeCsvField(m.created_at),
        escapeCsvField(m.read_at),
      ].join(",")
    );
    return [headers, ...lines].join("\n");
  }

  return JSON.stringify(messages, null, 2);
}

export function deleteMessage(id: number, agent: string): boolean {
  const db = getDb();
  const stmt = db.prepare("DELETE FROM messages WHERE id = ? AND from_agent = ?");
  const result = stmt.run(id, agent);
  return result.changes > 0;
}

export function editMessage(id: number, agent: string, newContent: string): Message | null {
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE messages SET content = ?, edited_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE id = ? AND from_agent = ? RETURNING *`
  );
  const row = stmt.get(newContent, id, agent) as Record<string, unknown> | null;
  return row ? parseMessage(row) : null;
}

export function pinMessage(id: number): Message | null {
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE messages SET pinned_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE id = ? RETURNING *`
  );
  const row = stmt.get(id) as Record<string, unknown> | null;
  return row ? parseMessage(row) : null;
}

export function unpinMessage(id: number): Message | null {
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE messages SET pinned_at = NULL WHERE id = ? RETURNING *`
  );
  const row = stmt.get(id) as Record<string, unknown> | null;
  return row ? parseMessage(row) : null;
}

export function getPinnedMessages(opts?: { space?: string; session_id?: string; limit?: number }): Message[] {
  const db = getDb();
  const conditions: string[] = ["pinned_at IS NOT NULL"];
  const params: (string | number)[] = [];

  if (opts?.space) {
    conditions.push("space = ?");
    params.push(opts.space);
  }
  if (opts?.session_id) {
    conditions.push("session_id = ?");
    params.push(opts.session_id);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  const limit = Number.isFinite(opts?.limit) && (opts!.limit as number) > 0
    ? `LIMIT ${Math.floor(opts!.limit as number)}`
    : "";

  const rows = db.prepare(
    `SELECT * FROM messages ${where} ORDER BY pinned_at DESC, id DESC ${limit}`
  ).all(...params) as Record<string, unknown>[];

  return rows.map(parseMessage);
}

export function getUnreadBlockers(agent: string): Message[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM messages
    WHERE blocking = 1 AND read_at IS NULL
    AND (
      to_agent = ?
      OR space IN (SELECT space FROM space_members WHERE agent = ?)
    )
    ORDER BY created_at ASC, id ASC
  `).all(agent, agent) as Record<string, unknown>[];
  return rows.map(parseMessage);
}

export function getThreadReplies(messageId: number): Message[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM messages WHERE reply_to = ? ORDER BY created_at ASC, id ASC"
  ).all(messageId) as Record<string, unknown>[];
  return rows.map(parseMessage);
}

export function searchMessages(opts: SearchMessagesOptions): SearchResult[] {
  const db = getDb();

  const limit = Number.isFinite(opts.limit) && (opts.limit as number) > 0
    ? Math.floor(opts.limit as number)
    : 20;
  const sortByRelevance = opts.sort !== "recent";

  // Priority weight map for scoring boost
  const priorityWeights: Record<string, number> = { urgent: 10, high: 5, normal: 1, low: 0.5 };

  // Try FTS5 first for proper full-text search with BM25 ranking
  try {
    const ftsParams: (string | number)[] = [];

    // Build FTS match expression — support phrase queries and prefix matching
    const query = opts.query.trim();
    let ftsQuery: string;
    if (query.startsWith('"') && query.endsWith('"')) {
      // Exact phrase query — pass through
      ftsQuery = query;
    } else {
      // Quote each word for prefix matching
      const words = query.split(/\s+/).filter(Boolean);
      ftsQuery = words.map((w) => `"${w.replace(/"/g, '""')}"`).join(" ");
    }

    ftsParams.push(ftsQuery);

    let extraWhere = "";
    if (opts.space) { extraWhere += " AND m.space = ?"; ftsParams.push(opts.space); }
    if (opts.from) { extraWhere += " AND m.from_agent = ?"; ftsParams.push(opts.from); }
    if (opts.to) { extraWhere += " AND m.to_agent = ?"; ftsParams.push(opts.to); }

    const orderClause = sortByRelevance ? "ORDER BY rank" : "ORDER BY m.created_at DESC, m.id DESC";

    const rows = db.prepare(
      `SELECT m.*, rank,
        snippet(messages_fts, 0, '**', '**', '...', 20) as snippet
       FROM messages m
       JOIN messages_fts ON messages_fts.rowid = m.id
       WHERE messages_fts MATCH ?${extraWhere}
       ${orderClause} LIMIT ${limit}`
    ).all(...ftsParams) as Record<string, unknown>[];

    // Normalize: FTS5 rank is negative (closer to 0 = better). Convert to positive scale.
    const maxRank = rows.reduce((max, r) => Math.max(max, Math.abs(r.rank as number || 0)), 0) || 1;

    return rows.map((row) => {
      const msg = parseMessage(row);
      // Normalize FTS rank to 0-100 scale (higher = more relevant)
      const ftsScore = maxRank > 0 ? (Math.abs(row.rank as number || 0) / maxRank) * 100 : 50;
      const priorityBoost = priorityWeights[msg.priority] || 1;
      const pinnedBoost = msg.pinned_at ? 20 : 0;
      const blockingBoost = msg.blocking ? 15 : 0;
      const relevance_score = Math.round((ftsScore * priorityBoost + pinnedBoost + blockingBoost) * 100) / 100;
      return { ...msg, snippet: (row.snippet as string) || null, relevance_score };
    });
  } catch {
    // Fallback to LIKE if FTS not available
  }

  // LIKE fallback
  const conditions: string[] = ["content LIKE ?"];
  const params: (string | number)[] = [`%${opts.query}%`];

  if (opts.space) { conditions.push("space = ?"); params.push(opts.space); }
  if (opts.from) { conditions.push("from_agent = ?"); params.push(opts.from); }
  if (opts.to) { conditions.push("to_agent = ?"); params.push(opts.to); }

  const where = `WHERE ${conditions.join(" AND ")}`;

  const rows = db.prepare(
    `SELECT * FROM messages ${where} ORDER BY created_at DESC, id DESC LIMIT ${limit}`
  ).all(...params) as Record<string, unknown>[];

  return rows.map((row) => {
    const msg = parseMessage(row);
    return { ...msg, snippet: null, relevance_score: 0 };
  });
}
