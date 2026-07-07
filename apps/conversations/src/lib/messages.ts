import { getDb, getDataDir } from "./db.js";
import type { Message, Attachment, SendMessageOptions, ReadMessagesOptions, SearchMessagesOptions, SearchResult } from "../types.js";
import { createHash, randomUUID } from "crypto";
import { mkdirSync, copyFileSync, statSync, existsSync, realpathSync } from "fs";
import { join, basename, resolve } from "path";
import { fireWebhooks } from "./webhooks.js";
import { normalizeChannelName } from "./channel-names.js";
import { markChannelNotificationsRead } from "./channel-notifications.js";

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

function assertMessageSize(content: string): void {
  if (Buffer.byteLength(content, "utf8") > MAX_MESSAGE_BYTES) {
    throw new Error(`Message content exceeds maximum size of ${MAX_MESSAGE_BYTES} bytes (64 KB).`);
  }
}

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
  assertMessageSize(opts.content);

  checkRateLimit(opts.from);

  const validatedAttachments = opts.attachments && opts.attachments.length > 0
    ? opts.attachments.map((att) => validateAttachment(att.source_path, att.name))
    : [];

  const db = getDb();
  const channelName = opts.channel ? normalizeChannelName(opts.channel) : null;
  const explicitSession = opts.session_id && opts.session_id.trim().length > 0 ? opts.session_id : undefined;
  const sessionId = channelName
    ? `channel:${channelName}`
    : explicitSession ?? `${[opts.from, opts.to].sort().join("-")}-${randomUUID().slice(0, 8)}`;
  const toAgent = channelName ?? opts.to;
  const metadata = opts.metadata ? JSON.stringify(opts.metadata) : null;
  const normalizedPriority = (opts.priority === "low" || opts.priority === "normal" || opts.priority === "high" || opts.priority === "urgent")
    ? opts.priority
    : "normal";

  const blocking = opts.blocking ? 1 : 0;

  const replyTo = opts.reply_to || null;

  const msgUuid = randomUUID().replace(/-/g, "");

  const stmt = db.prepare(`
    INSERT INTO messages (uuid, session_id, from_agent, to_agent, channel, project_id, content, priority, working_dir, repository, branch, metadata, blocking, reply_to)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `);

  const row = stmt.get(
    msgUuid,
    sessionId,
    opts.from,
    toAgent,
    channelName,
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
  if (validatedAttachments.length > 0) {
    const attachmentsDir = join(getAttachmentsDir(), String(message.id));
    mkdirSync(attachmentsDir, { recursive: true });

    const attachmentInfos: Attachment[] = [];
    for (const { safeSource, safeName } of validatedAttachments) {
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
  if (channelName) {
    const mentions = parseMentions(opts.content);
    if (mentions.length > 0) {
      void processMentions(message.id, opts.from, channelName, mentions, db);
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
  if (opts.channel) {
    conditions.push("channel = ?");
    params.push(normalizeChannelName(opts.channel));
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
  const resolvedOffset = Number.isFinite(opts.offset) ? Math.floor(opts.offset as number) : 0;
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

export function markChannelRead(channelName: string, reader: string): number {
  const db = getDb();
  const normalized = normalizeChannelName(channelName);
  const stmt = db.prepare(
    `UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE channel = ? AND from_agent != ? AND read_at IS NULL`
  );
  const result = stmt.run(normalized, reader);
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
  snippet: string;
  snippet_bytes: number;
  truncated: boolean;
  priority: string;
  has_attachments: boolean;
  attachment_count: number;
  channel?: string | null;
  to?: string | null;
  reply_to?: number | null;
  unread: boolean;
}

export interface DigestResult {
  digest_id: string;
  messages: DigestMessage[];
  message_ids: number[];
  channel: string | null;
  session_id: string | null;
  to: string | null;
  since: string | null;
  cursor: number | null;
  next_cursor: number | null;
  max_bytes: number;
  byte_length: number;
  limit: number;
  count: number;
  total_available: number;
  total_unread: number;
  shown: number;
  skipped_count: number;
  has_more: boolean;
  truncated: boolean;
  marked_read: number;
  compact: true;
  hint: string;
}

export interface ReadDigestOptions {
  channel?: string;
  session_id?: string;
  to?: string;
  since?: string;
  cursor?: number;
  limit?: number;
  max_bytes?: number;
  unread_only?: boolean;
  mark_read?: boolean;
  reader?: string;
  project_id?: string;
}

export const DEFAULT_DIGEST_MAX_BYTES = 8192;
export const MIN_DIGEST_MAX_BYTES = 512;
export const MAX_DIGEST_MAX_BYTES = 65536;
export const DEFAULT_DIGEST_LIMIT = 200;
export const MAX_DIGEST_LIMIT = 1000;
export const DEFAULT_DIGEST_SNIPPET_BYTES = 320;

const DIGEST_ID_PLACEHOLDER = "0000000000000000";

function resolveDigestMaxBytes(value: unknown): number {
  if (value === undefined || value === null || value === "") return DEFAULT_DIGEST_MAX_BYTES;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_DIGEST_MAX_BYTES;
  const bytes = Math.floor(parsed);
  if (bytes < MIN_DIGEST_MAX_BYTES) {
    throw new Error(`Digest max_bytes must be at least ${MIN_DIGEST_MAX_BYTES} bytes.`);
  }
  return Math.min(bytes, MAX_DIGEST_MAX_BYTES);
}

function resolveDigestLimit(value: unknown): number {
  if (value === undefined || value === null || value === "") return DEFAULT_DIGEST_LIMIT;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DIGEST_LIMIT;
  return Math.min(Math.floor(parsed), MAX_DIGEST_LIMIT);
}

function resolveDigestCursor(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

function normalizeSnippetText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateUtf8(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const safeMax = Math.max(0, Math.floor(maxBytes));
  if (Buffer.byteLength(value, "utf8") <= safeMax) return { text: value, truncated: false };
  if (safeMax <= 0) return { text: "", truncated: value.length > 0 };

  const suffix = safeMax >= 3 ? "..." : "";
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  const budget = Math.max(0, safeMax - suffixBytes);
  let used = 0;
  let text = "";
  for (const char of value) {
    const bytes = Buffer.byteLength(char, "utf8");
    if (used + bytes > budget) break;
    text += char;
    used += bytes;
  }
  return { text: `${text}${suffix}`, truncated: true };
}

function makeDigestMessage(message: Message, snippetBytes: number): DigestMessage {
  const normalized = normalizeSnippetText(message.content);
  const snippet = truncateUtf8(normalized, snippetBytes);
  const attachmentCount = message.attachments?.length ?? 0;
  return {
    id: message.id,
    from: message.from_agent,
    created_at: message.created_at,
    snippet: snippet.text,
    snippet_bytes: Buffer.byteLength(snippet.text, "utf8"),
    truncated: snippet.truncated,
    priority: message.priority,
    has_attachments: attachmentCount > 0,
    attachment_count: attachmentCount,
    channel: message.channel,
    to: message.to_agent,
    reply_to: message.reply_to,
    unread: !message.read_at,
  };
}

function digestHash(input: Omit<DigestResult, "digest_id" | "byte_length" | "hint">): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")
    .slice(0, 16);
}

function finalizeDigestResult(result: DigestResult): DigestResult {
  const hashInput = {
    messages: result.messages,
    message_ids: result.message_ids,
    channel: result.channel,
    session_id: result.session_id,
    to: result.to,
    since: result.since,
    cursor: result.cursor,
    next_cursor: result.next_cursor,
    max_bytes: result.max_bytes,
    limit: result.limit,
    count: result.count,
    total_available: result.total_available,
    total_unread: result.total_unread,
    shown: result.shown,
    skipped_count: result.skipped_count,
    has_more: result.has_more,
    truncated: result.truncated,
    marked_read: result.marked_read,
    compact: result.compact,
  };
  const finalized = { ...result, digest_id: digestHash(hashInput) };
  for (let i = 0; i < 3; i++) {
    finalized.byte_length = Buffer.byteLength(JSON.stringify(finalized), "utf8");
  }
  return finalized;
}

function countDigestMessages(opts: {
  channel?: string;
  session_id?: string;
  to?: string;
  since?: string;
  cursor?: number;
  project_id?: string;
  unread_only?: boolean;
}): { total_available: number; total_unread: number } {
  const db = getDb();
  const baseConditions: string[] = [];
  const baseParams: (string | number)[] = [];

  if (opts.channel) { baseConditions.push("channel = ?"); baseParams.push(normalizeChannelName(opts.channel)); }
  if (opts.session_id) { baseConditions.push("session_id = ?"); baseParams.push(opts.session_id); }
  if (opts.to) { baseConditions.push("to_agent = ?"); baseParams.push(opts.to); }
  if (opts.since) { baseConditions.push("created_at > ?"); baseParams.push(opts.since); }
  if (opts.cursor !== undefined) { baseConditions.push("id > ?"); baseParams.push(opts.cursor); }
  if (opts.project_id) { baseConditions.push("project_id = ?"); baseParams.push(opts.project_id); }

  const availableConditions = opts.unread_only ? [...baseConditions, "read_at IS NULL"] : baseConditions;
  const availableWhere = availableConditions.length > 0 ? `WHERE ${availableConditions.join(" AND ")}` : "";
  const unreadWhere = `WHERE ${[...baseConditions, "read_at IS NULL"].join(" AND ")}`;
  const totalAvailable = (db.prepare(`SELECT COUNT(*) as n FROM messages ${availableWhere}`).get(...baseParams) as { n: number }).n;
  const totalUnread = (db.prepare(`SELECT COUNT(*) as n FROM messages ${unreadWhere}`).get(...baseParams) as { n: number }).n;
  return { total_available: totalAvailable, total_unread: totalUnread };
}

function queryDigestMessages(opts: {
  channel?: string;
  session_id?: string;
  to?: string;
  since?: string;
  cursor?: number;
  project_id?: string;
  unread_only?: boolean;
  limit: number;
}): Message[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (opts.channel) { conditions.push("channel = ?"); params.push(normalizeChannelName(opts.channel)); }
  if (opts.session_id) { conditions.push("session_id = ?"); params.push(opts.session_id); }
  if (opts.to) { conditions.push("to_agent = ?"); params.push(opts.to); }
  if (opts.since) { conditions.push("created_at > ?"); params.push(opts.since); }
  if (opts.cursor !== undefined) { conditions.push("id > ?"); params.push(opts.cursor); }
  if (opts.project_id) { conditions.push("project_id = ?"); params.push(opts.project_id); }
  if (opts.unread_only) conditions.push("read_at IS NULL");

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const safeLimit = Math.max(1, Math.min(Math.floor(opts.limit), MAX_DIGEST_LIMIT));
  const rows = db.prepare(
    `SELECT * FROM messages ${where} ORDER BY id ASC LIMIT ${safeLimit}`
  ).all(...params) as Record<string, unknown>[];
  return rows.map(parseMessage);
}

function buildDigestResult(opts: {
  channel: string | null;
  session_id: string | null;
  to: string | null;
  since: string | null;
  cursor: number | null;
  max_bytes: number;
  limit: number;
  total_available: number;
  total_unread: number;
  entries: DigestMessage[];
  skipped_count?: number;
  advance_cursor?: number | null;
  marked_read?: number;
}): DigestResult {
  const messageIds = opts.entries.map((message) => message.id);
  const nextCursor = opts.advance_cursor ?? (messageIds.length > 0 ? messageIds[messageIds.length - 1] : opts.cursor);
  const skippedCount = opts.skipped_count ?? 0;
  const consumedCount = opts.entries.length + skippedCount;
  const hasMore = opts.total_available > consumedCount;
  return finalizeDigestResult({
    digest_id: DIGEST_ID_PLACEHOLDER,
    messages: opts.entries,
    message_ids: messageIds,
    channel: opts.channel,
    session_id: opts.session_id,
    to: opts.to,
    since: opts.since,
    cursor: opts.cursor,
    next_cursor: nextCursor ?? null,
    max_bytes: opts.max_bytes,
    byte_length: 0,
    limit: opts.limit,
    count: opts.entries.length,
    total_available: opts.total_available,
    total_unread: opts.total_unread,
    shown: opts.entries.length,
    skipped_count: skippedCount,
    has_more: hasMore,
    truncated: hasMore || skippedCount > 0,
    marked_read: opts.marked_read ?? 0,
    compact: true,
    hint: "Use show <id>; continue with next_cursor.",
  });
}

function assertDigestFits(result: DigestResult): void {
  if (result.byte_length > result.max_bytes) {
    throw new Error(`Digest envelope exceeds max_bytes (${result.byte_length} > ${result.max_bytes}); increase --max-bytes or narrow the filters.`);
  }
}

function markDigestEntriesRead(entries: DigestMessage[], reader?: string): number {
  if (entries.length === 0) return 0;
  const ids = entries.map((entry) => entry.id);
  const markedRead = markReadByIds(ids, reader);
  if (reader) markChannelNotificationsRead(reader, ids);
  return markedRead;
}

export function readDigest(opts: ReadDigestOptions = {}): DigestResult {
  const maxBytes = resolveDigestMaxBytes(opts.max_bytes);
  const limit = resolveDigestLimit(opts.limit);
  const cursor = resolveDigestCursor(opts.cursor);
  const channel = opts.channel ? normalizeChannelName(opts.channel) : null;
  const counts = countDigestMessages({
    channel: channel ?? undefined,
    session_id: opts.session_id,
    to: opts.to,
    since: opts.since,
    cursor,
    project_id: opts.project_id,
    unread_only: opts.unread_only,
  });

  const messages = queryDigestMessages({
    channel: channel ?? undefined,
    session_id: opts.session_id,
    to: opts.to,
    since: opts.since,
    cursor,
    project_id: opts.project_id,
    unread_only: opts.unread_only ?? false,
    limit,
  });

  let entries: DigestMessage[] = [];
  for (const message of messages) {
    let low = 0;
    let high = DEFAULT_DIGEST_SNIPPET_BYTES;
    let best: DigestMessage | null = null;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidateMessage = makeDigestMessage(message, mid);
      const candidate = buildDigestResult({
        channel,
        session_id: opts.session_id ?? null,
        to: opts.to ?? null,
        since: opts.since ?? null,
        cursor: cursor ?? null,
        max_bytes: maxBytes,
        limit,
        total_available: counts.total_available,
        total_unread: counts.total_unread,
        entries: [...entries, candidateMessage],
        marked_read: opts.mark_read ? entries.length + 1 : 0,
      });

      if (candidate.byte_length <= maxBytes) {
        best = candidateMessage;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (!best) {
      let skipped = buildDigestResult({
        channel,
        session_id: opts.session_id ?? null,
        to: opts.to ?? null,
        since: opts.since ?? null,
        cursor: cursor ?? null,
        max_bytes: maxBytes,
        limit,
        total_available: counts.total_available,
        total_unread: counts.total_unread,
        entries,
        skipped_count: 1,
        advance_cursor: message.id,
        marked_read: opts.mark_read ? entries.length : 0,
      });

      if (skipped.byte_length > maxBytes && entries.length > 0) {
        let page = buildDigestResult({
          channel,
          session_id: opts.session_id ?? null,
          to: opts.to ?? null,
          since: opts.since ?? null,
          cursor: cursor ?? null,
          max_bytes: maxBytes,
          limit,
          total_available: counts.total_available,
          total_unread: counts.total_unread,
          entries,
          marked_read: opts.mark_read ? entries.length : 0,
        });

        assertDigestFits(page);
        if (opts.mark_read) {
          const markedRead = markDigestEntriesRead(entries, opts.reader);
          page = buildDigestResult({
            channel,
            session_id: opts.session_id ?? null,
            to: opts.to ?? null,
            since: opts.since ?? null,
            cursor: cursor ?? null,
            max_bytes: maxBytes,
            limit,
            total_available: counts.total_available,
            total_unread: counts.total_unread,
            entries,
            marked_read: markedRead,
          });
          assertDigestFits(page);
        }
        return page;
      }

      assertDigestFits(skipped);
      if (opts.mark_read && entries.length > 0) {
        const markedRead = markDigestEntriesRead(entries, opts.reader);
        skipped = buildDigestResult({
          channel,
          session_id: opts.session_id ?? null,
          to: opts.to ?? null,
          since: opts.since ?? null,
          cursor: cursor ?? null,
          max_bytes: maxBytes,
          limit,
          total_available: counts.total_available,
          total_unread: counts.total_unread,
          entries,
          skipped_count: 1,
          advance_cursor: message.id,
          marked_read: markedRead,
        });
        assertDigestFits(skipped);
      }
      return skipped;
    }
    entries = [...entries, best];
  }

  let markedRead = 0;
  if (opts.mark_read && entries.length > 0) {
    markedRead = markDigestEntriesRead(entries, opts.reader);
  }

  const result = buildDigestResult({
    channel,
    session_id: opts.session_id ?? null,
    to: opts.to ?? null,
    since: opts.since ?? null,
    cursor: cursor ?? null,
    max_bytes: maxBytes,
    limit,
    total_available: counts.total_available,
    total_unread: counts.total_unread,
    entries,
    marked_read: markedRead,
  });
  assertDigestFits(result);
  return result;
}

export interface ExportMessagesOptions {
  channel?: string;
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

  if (opts?.channel) {
    conditions.push("channel = ?");
    params.push(normalizeChannelName(opts.channel));
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
    const headers = "id,session_id,from_agent,to_agent,channel,content,priority,created_at,read_at";
    const lines = messages.map((m) =>
      [
        String(m.id),
        escapeCsvField(m.session_id),
        escapeCsvField(m.from_agent),
        escapeCsvField(m.to_agent),
        escapeCsvField(m.channel),
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
  assertMessageSize(newContent);

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

export function getPinnedMessages(opts?: { channel?: string; session_id?: string; limit?: number; offset?: number }): Message[] {
  const db = getDb();
  const conditions: string[] = ["pinned_at IS NOT NULL"];
  const params: (string | number)[] = [];

  if (opts?.channel) {
    conditions.push("channel = ?");
    params.push(normalizeChannelName(opts.channel));
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
  const safeOffset = Number.isFinite(opts?.offset) && (opts!.offset as number) > 0
    ? Math.floor(opts!.offset as number)
    : 0;
  const limitClause = safeLimit > 0 ? `LIMIT ${safeLimit}` : safeOffset > 0 ? "LIMIT -1" : "";
  const offsetClause = safeOffset > 0 ? `OFFSET ${safeOffset}` : "";

  const rows = db.prepare(
    `SELECT * FROM messages ${where} ORDER BY pinned_at DESC, id DESC ${limitClause} ${offsetClause}`
  ).all(...params) as Record<string, unknown>[];

  return rows.map(parseMessage);
}

export function getUnreadBlockers(agent: string, opts?: { limit?: number; offset?: number }): Message[] {
  const db = getDb();
  const safeLimit = Number.isFinite(opts?.limit) && (opts!.limit as number) > 0
    ? Math.floor(opts!.limit as number)
    : 0;
  const safeOffset = Number.isFinite(opts?.offset) && (opts!.offset as number) > 0
    ? Math.floor(opts!.offset as number)
    : 0;
  const limitClause = safeLimit > 0 ? `LIMIT ${safeLimit}` : safeOffset > 0 ? "LIMIT -1" : "";
  const offsetClause = safeOffset > 0 ? `OFFSET ${safeOffset}` : "";
  const rows = db.prepare(`
    SELECT * FROM messages
    WHERE blocking = 1 AND read_at IS NULL
    AND (
      to_agent = ?
      OR channel IN (SELECT channel FROM channel_members WHERE agent = ?)
    )
    ORDER BY created_at ASC, id ASC
    ${limitClause} ${offsetClause}
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
  const offset = Number.isFinite(opts.offset) && (opts.offset as number) > 0
    ? Math.floor(opts.offset as number)
    : 0;
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
    if (opts.channel) { extraWhere += " AND m.channel = ?"; ftsParams.push(normalizeChannelName(opts.channel)); }
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
       ${orderClause} LIMIT ${limit} OFFSET ${offset}`
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

  if (opts.channel) { conditions.push("channel = ?"); params.push(normalizeChannelName(opts.channel)); }
  if (opts.from) { conditions.push("from_agent = ?"); params.push(opts.from); }
  if (opts.to) { conditions.push("to_agent = ?"); params.push(opts.to); }
  if (opts.since) { conditions.push("created_at >= ?"); params.push(opts.since); }
  if (opts.until) { conditions.push("created_at <= ?"); params.push(opts.until); }

  const where = `WHERE ${conditions.join(" AND ")}`;

  const rows = db.prepare(
    `SELECT * FROM messages ${where} ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`
  ).all(...params) as Record<string, unknown>[];

  return rows.map((row) => {
    const msg = parseMessage(row);
    return { ...msg, snippet: null, relevance_score: 0 };
  });
}

export interface UnreadCount {
  channel: string;
  unread_count: number;
  latest_message_at: string | null;
}

/**
 * Get unread message counts per channel — lightweight alternative to read_messages.
 * Returns only channels where the agent is a member (via channel_members) or has received messages.
 * If agent is omitted, returns counts for all channels.
 */
export function listUnreadCounts(agent?: string): UnreadCount[] {
  const db = getDb();

  if (agent) {
    const rows = db.prepare(`
      SELECT
        channel,
        COUNT(CASE WHEN read_at IS NULL AND from_agent != ? THEN 1 END) AS unread_count,
        MAX(created_at) AS latest_message_at
      FROM messages
      WHERE channel IN (
        SELECT DISTINCT channel FROM channel_members WHERE agent = ?
        UNION
        SELECT DISTINCT channel FROM messages WHERE to_agent = ? AND channel IS NOT NULL
      )
      GROUP BY channel
      HAVING COUNT(*) > 0
      ORDER BY unread_count DESC, latest_message_at DESC
    `).all(agent, agent, agent) as Array<{ channel: string; unread_count: number; latest_message_at: string | null }>;
    return rows;
  }

  const rows = db.prepare(`
    SELECT
      channel,
      COUNT(CASE WHEN read_at IS NULL THEN 1 END) AS unread_count,
      MAX(created_at) AS latest_message_at
    FROM messages
    WHERE channel IS NOT NULL
    GROUP BY channel
    HAVING COUNT(*) > 0
    ORDER BY unread_count DESC, latest_message_at DESC
  `).all() as Array<{ channel: string; unread_count: number; latest_message_at: string | null }>;
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
  channel: string,
  mentionedAgents: string[],
  db: ReturnType<typeof getDb>
): Promise<void> {
  const stmt = db.prepare(
    "INSERT INTO message_mentions (message_id, mentioned_agent, from_agent, channel) VALUES (?, ?, ?, ?)"
  );
  for (const agent of mentionedAgents) {
    try {
      stmt.run(messageId, agent, fromAgent, channel);
      // Send DM notification
      if (agent !== fromAgent.toLowerCase()) {
        sendMessage({
          from: fromAgent,
          to: agent,
          content: `You were mentioned in #${channel} by ${fromAgent} (message #${messageId})`,
          metadata: { type: "mention_notification", source_message_id: messageId, channel },
        });
      }
    } catch { /* ignore duplicate/error */ }
  }
}

export interface MentionCount {
  channel: string;
  unread_count: number;
  mention_count: number;
  latest_message_at: string | null;
}

/** Get unread counts AND mention counts per channel for an agent. */
export function listUnreadCountsWithMentions(agent: string): MentionCount[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      channel,
      COUNT(CASE WHEN read_at IS NULL AND from_agent != ? THEN 1 END) AS unread_count,
      (SELECT COUNT(*) FROM message_mentions mm WHERE mm.channel = m.channel AND mm.mentioned_agent = ? AND mm.notified_at IS NULL) AS mention_count,
      MAX(created_at) AS latest_message_at
    FROM messages m
    WHERE channel IN (
      SELECT DISTINCT channel FROM channel_members WHERE agent = ?
      UNION
      SELECT DISTINCT channel FROM messages WHERE to_agent = ? AND channel IS NOT NULL
    )
    GROUP BY channel
    HAVING COUNT(*) > 0
    ORDER BY mention_count DESC, unread_count DESC, latest_message_at DESC
  `).all(agent, agent, agent, agent) as MentionCount[];
  return rows;
}

/** Get messages that mention a specific agent. */
export function getMessagesForAgent(agent: string, opts?: { channel?: string; unread_only?: boolean; limit?: number }): Array<{ message: Message; mention_id: number }> {
  const db = getDb();
  const conditions = ["mm.mentioned_agent = ?"];
  const params: (string | number)[] = [agent.toLowerCase()];
  if (opts?.channel) { conditions.push("m.channel = ?"); params.push(normalizeChannelName(opts.channel)); }
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
export function markMentionsRead(agent: string, channel?: string): number {
  const db = getDb();
  if (channel) {
    const normalized = normalizeChannelName(channel);
    const result = db.prepare(
      "UPDATE message_mentions SET notified_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE mentioned_agent = ? AND channel = ? AND notified_at IS NULL"
    ).run(agent, normalized);
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

/** Get read status summary for a channel message: who has read it and who hasn't. */
export function getMessageReadStatus(
  messageId: number,
  channel: string
): { receipts: ReadReceipt[]; unread_by: string[] } {
  const db = getDb();
  const normalized = normalizeChannelName(channel);
  const receipts = getReadReceipts(messageId);
  const readers = new Set(receipts.map((r) => r.agent));
  const members = db.prepare(
    "SELECT agent FROM channel_members WHERE channel = ?"
  ).all(normalized) as { agent: string }[];
  const unread_by = members.map((m) => m.agent).filter((a) => !readers.has(a.toLowerCase()));
  return { receipts, unread_by };
}
