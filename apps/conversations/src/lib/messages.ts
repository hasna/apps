import { getDb, getDataDir } from "./db.js";
import type { Message, Attachment, SendMessageOptions, ReadMessagesOptions, SearchMessagesOptions, SearchResult } from "../types.js";
import { randomUUID } from "crypto";
import { mkdirSync, copyFileSync, statSync, existsSync, realpathSync } from "fs";
import { join, basename, resolve } from "path";
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
  return join(getDataDir(), "attachments");
}

/** Validate attachment source path and name to prevent arbitrary file read and path traversal. */
function validateAttachment(sourcePath: string, name: string): { safeSource: string; safeName: string } {
  // Resolve to absolute and verify the file exists and is a regular file
  const absolute = resolve(sourcePath);
  if (!existsSync(absolute)) {
    throw new Error(`Attachment source not found: ${sourcePath}`);
  }
  const real = realpathSync(absolute);
  const stat = statSync(real);
  if (!stat.isFile()) {
    throw new Error(`Attachment source must be a regular file: ${sourcePath}`);
  }
  // Sanitize the attachment name — strip any path components
  const safeName = basename(name.replace(/\0/g, ""));
  if (!safeName || safeName.startsWith(".")) {
    throw new Error(`Invalid attachment name: ${name}`);
  }
  return { safeSource: real, safeName };
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

/** Maximum allowed message content size in bytes (64 KB). */
export const MAX_MESSAGE_BYTES = 65536;

/** Per-agent rate limit: max messages per window. */
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

const _rateLimitCounters = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(agentId: string): void {
  // Skip in test environments (in-memory or test DB paths)
  const dbPath = process.env.CONVERSATIONS_DB_PATH ?? process.env.HASNA_CONVERSATIONS_DB_PATH ?? "";
  if (dbPath === ":memory:" || dbPath.includes("test") || dbPath.includes("tmp")) return;

  const now = Date.now();
  const entry = _rateLimitCounters.get(agentId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    _rateLimitCounters.set(agentId, { count: 1, windowStart: now });
    return;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    throw new Error(`Rate limit exceeded: ${agentId} may send at most ${RATE_LIMIT_MAX} messages per minute.`);
  }
}

export function sendMessage(opts: SendMessageOptions): Message {
  if (Buffer.byteLength(opts.content, "utf8") > MAX_MESSAGE_BYTES) {
    throw new Error(`Message content exceeds maximum size of ${MAX_MESSAGE_BYTES} bytes (64 KB).`);
  }

  checkRateLimit(opts.from);

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

  const msgUuid = randomUUID().replace(/-/g, "");

  const stmt = db.prepare(`
    INSERT INTO messages (uuid, session_id, from_agent, to_agent, space, project_id, content, priority, working_dir, repository, branch, metadata, blocking, reply_to)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `);

  const row = stmt.get(
    msgUuid,
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
      const { safeSource, safeName } = validateAttachment(att.source_path, att.name);
      const destPath = join(attachmentsDir, safeName);
      copyFileSync(safeSource, destPath);
      const stat = statSync(destPath);
      attachmentInfos.push({
        name: safeName,
        path: destPath,
        size: stat.size,
        mime_type: guessMimeType(safeName),
      });
    }

    const attachmentsJson = JSON.stringify(attachmentInfos);
    db.prepare("UPDATE messages SET attachments = ? WHERE id = ?").run(attachmentsJson, message.id);
    message.attachments = attachmentInfos;
  }

  // Parse @mentions and create notification DMs (non-blocking)
  if (opts.space) {
    const mentions = parseMentions(opts.content);
    if (mentions.length > 0) {
      void processMentions(message.id, opts.from, opts.space, mentions, db);
    }
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
  if (opts.threads_only) {
    conditions.push("reply_to IS NULL");
  }
  if (opts.mentions_only) {
    conditions.push(`id IN (SELECT message_id FROM message_mentions WHERE mentioned_agent = ?)`);
    params.push(opts.mentions_only.toLowerCase());
  }

  // latest: N — return the N most recent messages (newest first), overrides limit + order
  const isLatest = opts.latest && opts.latest > 0;
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const resolvedLimit = isLatest
    ? Math.floor(opts.latest as number)
    : Number.isFinite(opts.limit) && (opts.limit as number) > 0
      ? Math.floor(opts.limit as number)
      : 20;
  const order = isLatest ? "DESC" : (opts.order?.toLowerCase() === "desc" ? "DESC" : "ASC");

  // SQLite LIMIT/OFFSET require literal integers — validated and bounded here
  const safeLimit = Math.max(1, Math.min(resolvedLimit, 10000));
  const safeOffset = Math.max(0, Math.floor(resolvedOffset));
  const rows = db.prepare(
    `SELECT * FROM messages ${where} ORDER BY created_at ${order}, id ${order} LIMIT ${safeLimit} OFFSET ${safeOffset}`
  ).all(...params) as Record<string, unknown>[];

  let messages = rows.map(parseMessage);

  // Attach reply_count if requested
  if (opts.include_reply_counts && messages.length > 0) {
    const db2 = getDb();
    const counts = db2.prepare(
      `SELECT reply_to, COUNT(*) as c FROM messages WHERE reply_to IN (${messages.map(() => "?").join(",")}) GROUP BY reply_to`
    ).all(...messages.map((m) => m.id)) as Array<{ reply_to: number; c: number }>;
    const countMap = new Map(counts.map((r) => [r.reply_to, r.c]));
    messages = messages.map((m) => ({ ...m, reply_count: countMap.get(m.id) ?? 0 }));
  }

  // Truncate content if max_content_length is set
  if (opts.max_content_length && opts.max_content_length > 0) {
    messages = messages.map((m) => {
      if (m.content.length > opts.max_content_length!) {
        return { ...m, content: m.content.slice(0, opts.max_content_length) + "…", truncated: true };
      }
      return m;
    });
  }

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

export function markReadByIds(ids: number[], agent?: string): number {
  const db = getDb();
  if (ids.length === 0) return 0;

  if (agent) {
    // Use per-agent read receipts so other agents' unread status is preserved
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO message_read_receipts (message_id, agent, read_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'))`
    );
    const normalized = agent.toLowerCase();
    for (const id of ids) stmt.run(id, normalized);
    // Also update global read_at for backward compat
    const placeholders = ids.map(() => "?").join(", ");
    const update = db.prepare(
      `UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE id IN (${placeholders}) AND read_at IS NULL`
    );
    return update.run(...ids).changes;
  }

  // Legacy: no agent — update global read_at only
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

export interface DigestMessage {
  id: number;
  from: string;
  created_at: string;
  preview: string;
  priority: string;
  has_attachments: boolean;
  space?: string | null;
  to?: string | null;
  unread: boolean;
}

export interface DigestResult {
  messages: DigestMessage[];
  total_unread: number;
  shown: number;
}

export interface ReadDigestOptions {
  space?: string;
  session_id?: string;
  to?: string;
  since?: string;
  limit?: number;
  unread_only?: boolean;
  project_id?: string;
}

export function readDigest(opts: ReadDigestOptions = {}): DigestResult {
  const db = getDb();

  // Count total unread with same filters
  const countConditions: string[] = ["read_at IS NULL"];
  const countParams: (string | number)[] = [];
  if (opts.space) { countConditions.push("space = ?"); countParams.push(opts.space); }
  if (opts.session_id) { countConditions.push("session_id = ?"); countParams.push(opts.session_id); }
  if (opts.to) { countConditions.push("to_agent = ?"); countParams.push(opts.to); }
  if (opts.since) { countConditions.push("created_at > ?"); countParams.push(opts.since); }
  if (opts.project_id) { countConditions.push("project_id = ?"); countParams.push(opts.project_id); }
  const countWhere = `WHERE ${countConditions.join(" AND ")}`;
  const totalUnread = (db.prepare(`SELECT COUNT(*) as n FROM messages ${countWhere}`).get(...countParams) as { n: number }).n;

  // Fetch messages (unread by default)
  const messages = readMessages({ ...opts, unread_only: opts.unread_only ?? true });

  // Auto-mark as read
  if (messages.length > 0) {
    markReadByIds(messages.map((m) => m.id));
  }

  const digest: DigestMessage[] = messages.map((m) => ({
    id: m.id,
    from: m.from_agent,
    created_at: m.created_at,
    preview: m.content.slice(0, 100) + (m.content.length > 100 ? "…" : ""),
    priority: m.priority,
    has_attachments: Array.isArray(m.attachments) && m.attachments.length > 0,
    space: m.space,
    to: m.to_agent,
    unread: !m.read_at,
  }));

  return { messages: digest, total_unread: totalUnread, shown: digest.length };
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
  // LIMIT must be a literal integer — validated and capped
  const safeLimit = Number.isFinite(opts?.limit) && (opts!.limit as number) > 0
    ? Math.floor(opts!.limit as number)
    : 0;
  const limitClause = safeLimit > 0 ? `LIMIT ${safeLimit}` : "";

  const rows = db.prepare(
    `SELECT * FROM messages ${where} ORDER BY pinned_at DESC, id DESC ${limitClause}`
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
    if (opts.since) { extraWhere += " AND m.created_at >= ?"; ftsParams.push(opts.since); }
    if (opts.until) { extraWhere += " AND m.created_at <= ?"; ftsParams.push(opts.until); }

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
  if (opts.since) { conditions.push("created_at >= ?"); params.push(opts.since); }
  if (opts.until) { conditions.push("created_at <= ?"); params.push(opts.until); }

  const where = `WHERE ${conditions.join(" AND ")}`;

  const rows = db.prepare(
    `SELECT * FROM messages ${where} ORDER BY created_at DESC, id DESC LIMIT ${limit}`
  ).all(...params) as Record<string, unknown>[];

  return rows.map((row) => {
    const msg = parseMessage(row);
    return { ...msg, snippet: null, relevance_score: 0 };
  });
}

export interface UnreadCount {
  space: string;
  unread_count: number;
  latest_message_at: string | null;
}

/**
 * Get unread message counts per space — lightweight alternative to read_messages.
 * Returns only spaces where the agent is a member (via space_members) or has received messages.
 * If agent is omitted, returns counts for all spaces.
 */
export function listUnreadCounts(agent?: string): UnreadCount[] {
  const db = getDb();

  if (agent) {
    const rows = db.prepare(`
      SELECT
        space,
        COUNT(CASE WHEN read_at IS NULL AND (to_agent = ? OR to_agent IS NULL OR to_agent = '') THEN 1 END) AS unread_count,
        MAX(created_at) AS latest_message_at
      FROM messages
      WHERE space IN (
        SELECT DISTINCT space FROM space_members WHERE agent = ?
        UNION
        SELECT DISTINCT space FROM messages WHERE to_agent = ? AND space IS NOT NULL
      )
      GROUP BY space
      HAVING COUNT(*) > 0
      ORDER BY unread_count DESC, latest_message_at DESC
    `).all(agent, agent, agent) as Array<{ space: string; unread_count: number; latest_message_at: string | null }>;
    return rows;
  }

  const rows = db.prepare(`
    SELECT
      space,
      COUNT(CASE WHEN read_at IS NULL THEN 1 END) AS unread_count,
      MAX(created_at) AS latest_message_at
    FROM messages
    WHERE space IS NOT NULL
    GROUP BY space
    HAVING COUNT(*) > 0
    ORDER BY unread_count DESC, latest_message_at DESC
  `).all() as Array<{ space: string; unread_count: number; latest_message_at: string | null }>;
  return rows;
}

// ── @mention support ──────────────────────────────────────────────────────────

/** Extract @agentname mentions from message content. Returns unique agent names (lowercase). */
export function parseMentions(content: string): string[] {
  const matches = content.match(/@([a-zA-Z0-9_-]+)/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(1).toLowerCase()))];
}

/** Store mention records and send DM notifications to each mentioned agent. */
async function processMentions(
  messageId: number,
  fromAgent: string,
  space: string,
  mentionedAgents: string[],
  db: ReturnType<typeof getDb>
): Promise<void> {
  const stmt = db.prepare(
    "INSERT INTO message_mentions (message_id, mentioned_agent, from_agent, space) VALUES (?, ?, ?, ?)"
  );
  for (const agent of mentionedAgents) {
    try {
      stmt.run(messageId, agent, fromAgent, space);
      // Send DM notification
      if (agent !== fromAgent.toLowerCase()) {
        sendMessage({
          from: fromAgent,
          to: agent,
          content: `You were mentioned in #${space} by ${fromAgent} (message #${messageId})`,
          metadata: { type: "mention_notification", source_message_id: messageId, space },
        });
      }
    } catch { /* ignore duplicate/error */ }
  }
}

export interface MentionCount {
  space: string;
  unread_count: number;
  mention_count: number;
  latest_message_at: string | null;
}

/** Get unread counts AND mention counts per space for an agent. */
export function listUnreadCountsWithMentions(agent: string): MentionCount[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      space,
      COUNT(CASE WHEN read_at IS NULL AND (to_agent = ? OR to_agent IS NULL OR to_agent = '') THEN 1 END) AS unread_count,
      (SELECT COUNT(*) FROM message_mentions mm WHERE mm.space = m.space AND mm.mentioned_agent = ? AND mm.notified_at IS NULL) AS mention_count,
      MAX(created_at) AS latest_message_at
    FROM messages m
    WHERE space IN (
      SELECT DISTINCT space FROM space_members WHERE agent = ?
      UNION
      SELECT DISTINCT space FROM messages WHERE to_agent = ? AND space IS NOT NULL
    )
    GROUP BY space
    HAVING COUNT(*) > 0
    ORDER BY mention_count DESC, unread_count DESC, latest_message_at DESC
  `).all(agent, agent, agent, agent) as MentionCount[];
  return rows;
}

/** Get messages that mention a specific agent. */
export function getMessagesForAgent(agent: string, opts?: { space?: string; unread_only?: boolean; limit?: number }): Array<{ message: Message; mention_id: number }> {
  const db = getDb();
  const conditions = ["mm.mentioned_agent = ?"];
  const params: (string | number)[] = [agent.toLowerCase()];
  if (opts?.space) { conditions.push("m.space = ?"); params.push(opts.space); }
  if (opts?.unread_only) { conditions.push("mm.notified_at IS NULL"); }
  // LIMIT must be a literal integer — validated and capped
  const safeLimit = Math.max(1, Math.min(Math.floor(opts?.limit ?? 50), 1000));
  const rows = db.prepare(
    `SELECT m.*, mm.id AS mention_id FROM messages m
     JOIN message_mentions mm ON mm.message_id = m.id
     WHERE ${conditions.join(" AND ")}
     ORDER BY m.created_at DESC LIMIT ${safeLimit}`
  ).all(...params) as Array<Record<string, unknown> & { mention_id: number }>;
  return rows.map(({ mention_id, ...row }) => ({ message: parseMessage(row), mention_id }));
}

/** Mark mentions as notified (agent has seen them). */
export function markMentionsRead(agent: string, space?: string): number {
  const db = getDb();
  if (space) {
    const result = db.prepare(
      "UPDATE message_mentions SET notified_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE mentioned_agent = ? AND space = ? AND notified_at IS NULL"
    ).run(agent, space);
    return result.changes;
  }
  const result = db.prepare(
    "UPDATE message_mentions SET notified_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE mentioned_agent = ? AND notified_at IS NULL"
  ).run(agent);
  return result.changes;
}

/** Mark a specific message as unread (resets read_at to null). */
export function markUnread(messageId: number): number {
  const db = getDb();
  const result = db.prepare(
    "UPDATE messages SET read_at = NULL WHERE id = ?"
  ).run(messageId);
  return result.changes;
}

/** Mark multiple messages as unread. */
export function markUnreadByIds(ids: number[]): number {
  if (ids.length === 0) return 0;
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  const result = db.prepare(
    `UPDATE messages SET read_at = NULL WHERE id IN (${placeholders})`
  ).run(...ids);
  return result.changes;
}

// ── Per-agent read receipts ───────────────────────────────────────────────────

export interface ReadReceipt {
  message_id: number;
  agent: string;
  read_at: string;
}

/** Record that an agent has read a specific message. */
export function recordReadReceipt(messageId: number, agent: string): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO message_read_receipts (message_id, agent, read_at)
     VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'))`
  ).run(messageId, agent.toLowerCase());
}

/** Record read receipts for all messages in a batch. */
export function recordReadReceiptsBatch(messageIds: number[], agent: string): void {
  if (!messageIds.length || !agent) return;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO message_read_receipts (message_id, agent, read_at)
     VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'))`
  );
  for (const id of messageIds) {
    stmt.run(id, agent.toLowerCase());
  }
}

/** Get all read receipts for a specific message. */
export function getReadReceipts(messageId: number): ReadReceipt[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM message_read_receipts WHERE message_id = ? ORDER BY read_at ASC"
  ).all(messageId) as ReadReceipt[];
}

/** Get read status summary for a space message: who has read it and who hasn't. */
export function getMessageReadStatus(
  messageId: number,
  space: string
): { receipts: ReadReceipt[]; unread_by: string[] } {
  const db = getDb();
  const receipts = getReadReceipts(messageId);
  const readers = new Set(receipts.map((r) => r.agent));
  const members = db.prepare(
    "SELECT agent FROM space_members WHERE space = ?"
  ).all(space) as { agent: string }[];
  const unread_by = members.map((m) => m.agent).filter((a) => !readers.has(a));
  return { receipts, unread_by };
}
