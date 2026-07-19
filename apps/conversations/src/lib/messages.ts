import { getDb, getDataDir } from "./db.js";
import type {
  Message,
  Attachment,
  SendMessageOptions,
  ReadMessagesOptions,
  ReadMessagePreviewsOptions,
  ReadMentionPreviewsOptions,
  SearchMessagesOptions,
  SearchMessagePreviewsOptions,
  SearchResult,
  MessagePreview,
  MessagePreviewPage,
  ExportMessagesOptions,
  MessageExportArtifact,
} from "../types.js";
import { createHash, randomUUID } from "crypto";
import { mkdirSync, copyFileSync, statSync, existsSync, realpathSync } from "fs";
import { join, basename, resolve } from "path";
import { fireWebhooks } from "./webhooks.js";
import { normalizeChannelName } from "./channel-names.js";
import { markChannelNotificationsRead } from "./channel-notifications.js";
import {
  COLLECTION_PREVIEW_SCAN_CHARS,
  COLLECTION_MAX_MAX_BYTES,
  buildMessagePreview,
  packMessagePreviewPage,
  previewAsCompatibilityMessage,
  resolveCollectionLimit,
  resolveCollectionOffset,
  resolveCollectionPreviewBytes,
  resolveCollectionTimeoutMs,
} from "./message-previews.js";
import {
  IncidentProjectorConfigurationError,
  metadataSpoofsIncidentProjection,
  validateIncidentProjectorBinding,
} from "./incident-projection-contract.js";
import {
  resolveMessageExportOptions,
  serializeMessageExport,
  writeMessageExportArtifact,
} from "./message-exports.js";

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

export function parseMessage(row: Record<string, unknown>): Message {
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

  // Coerce integer id columns to numbers: SQLite already yields numbers, but the
  // cloud API serializes Postgres bigint as a string ("23"), which would break
  // numeric id comparisons/paging downstream. Number() is a no-op for numbers.
  const id = row.id === undefined || row.id === null ? row.id : Number(row.id);
  const replyToRaw = row.reply_to === undefined || row.reply_to === null ? null : Number(row.reply_to);
  const replyCount = row.reply_count === undefined || row.reply_count === null ? undefined : Number(row.reply_count);

  return {
    ...row,
    id,
    metadata,
    attachments,
    blocking: !!row.blocking,
    reply_to: replyToRaw || null,
    ...(replyCount === undefined ? {} : { reply_count: replyCount }),
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

  if (metadataSpoofsIncidentProjection(opts.metadata)) {
    throw new Error("Canonical incident projection metadata is reserved for the dedicated projector");
  }

  checkRateLimit(opts.from);

  const validatedAttachments = opts.attachments && opts.attachments.length > 0
    ? opts.attachments.map((att) => validateAttachment(att.source_path, att.name))
    : [];

  const db = getDb();
  const requestedChannel = opts.channel ? normalizeChannelName(opts.channel) : null;
  const explicitSession = opts.session_id && opts.session_id.trim().length > 0 ? opts.session_id : undefined;
  const metadata = opts.metadata ? JSON.stringify(opts.metadata) : null;
  const normalizedPriority = (opts.priority === "low" || opts.priority === "normal" || opts.priority === "high" || opts.priority === "urgent")
    ? opts.priority
    : "normal";

  const blocking = opts.blocking ? 1 : 0;

  const replyTo = opts.reply_to ?? null;
  if (replyTo != null && (!Number.isSafeInteger(replyTo) || replyTo <= 0)) {
    throw new Error("reply_to must be a positive integer");
  }

  const msgUuid = randomUUID().replace(/-/g, "");

  const inserted = db.transaction(() => {
    let channelName = requestedChannel;
    let projectId = opts.project_id ?? null;
    let sessionId: string;

    if (replyTo != null) {
      const parent = db.prepare(
        "SELECT session_id, channel, project_id FROM messages WHERE id = ?",
      ).get(replyTo) as { session_id: string; channel: string | null; project_id: string | null } | undefined;
      if (!parent) throw new Error("reply parent not found");
      if (requestedChannel != null && requestedChannel !== parent.channel) {
        throw new Error("reply parent is outside the message scope");
      }
      if (opts.project_id != null && opts.project_id !== parent.project_id) {
        throw new Error("reply parent is outside the message scope");
      }
      if (explicitSession != null && explicitSession !== parent.session_id) {
        throw new Error("reply parent is outside the message scope");
      }
      channelName = parent.channel;
      projectId = parent.project_id;
      sessionId = parent.session_id;
    } else {
      sessionId = channelName
        ? `channel:${channelName}`
        : explicitSession ?? `${[opts.from, opts.to].sort().join("-")}-${randomUUID().slice(0, 8)}`;
    }

    const toAgent = channelName ?? opts.to;
    const row = db.prepare(`
      INSERT INTO messages (uuid, session_id, from_agent, to_agent, channel, project_id, content, priority, working_dir, repository, branch, metadata, blocking, reply_to)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      msgUuid,
      sessionId,
      opts.from,
      toAgent,
      channelName,
      projectId,
      opts.content,
      normalizedPriority,
      opts.working_dir || null,
      opts.repository || null,
      opts.branch || null,
      metadata,
      blocking,
      replyTo,
    ) as Record<string, unknown>;
    return { message: parseMessage(row), channelName };
  });

  const { message, channelName } = inserted;

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

function previewProjectionColumns(alias = ""): string {
  const c = alias ? `${alias}.` : "";
  const restricted = `(lower(COALESCE(${c}channel, '')) LIKE '%incident%' OR lower(COALESCE(${c}channel, '')) LIKE '%security%' OR lower(COALESCE(${c}to_agent, '')) LIKE '%incident%' OR lower(COALESCE(${c}to_agent, '')) LIKE '%security%' OR lower(COALESCE(${c}session_id, '')) LIKE '%incident%' OR lower(COALESCE(${c}session_id, '')) LIKE '%security%')`;
  return `${c}id, ${c}uuid, ${c}session_id, ${c}from_agent, ${c}to_agent, ${c}channel, ${c}project_id,
          ${c}priority, ${c}blocking, ${c}reply_to, ${c}working_dir, ${c}repository, ${c}branch,
          ${c}created_at, ${c}read_at, ${c}edited_at, ${c}pinned_at,
          CASE WHEN ${c}metadata IS NULL OR ${c}metadata = '' THEN 0 ELSE 1 END AS has_metadata,
          CASE WHEN json_valid(${c}attachments) THEN json_array_length(${c}attachments) ELSE 0 END AS attachment_count,
          CASE WHEN ${restricted} THEN '' ELSE substr(${c}content, 1, ${COLLECTION_PREVIEW_SCAN_CHARS}) END AS preview_source,
          length(CAST(${c}content AS BLOB)) AS content_bytes`;
}

function assertCollectionDeadline(startedAt: number, timeoutMs: number): void {
  if (performance.now() - startedAt > timeoutMs) {
    throw new Error(`message collection exceeded timeout_ms (${timeoutMs})`);
  }
}

function assertOptionalPositiveId(name: string, value: unknown, allowZero = false): void {
  if (value === undefined || value === null) return;
  if (!Number.isSafeInteger(value) || (allowZero ? Number(value) < 0 : Number(value) <= 0)) {
    throw new Error(`${name} must be ${allowZero ? "a non-negative" : "a positive"} integer`);
  }
}

function assertOptionalFilter(name: string, value: unknown): void {
  if (value !== undefined && value !== null && (typeof value !== "string" || !value.trim())) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function assertOptionalDate(name: string, value: unknown): void {
  assertOptionalFilter(name, value);
  if (typeof value === "string" && !Number.isFinite(Date.parse(value))) {
    throw new Error(`${name} must be a valid ISO 8601 date`);
  }
}

function validateReadPreviewFilters(opts: ReadMessagePreviewsOptions): void {
  assertOptionalPositiveId("id", opts.id);
  assertOptionalPositiveId("reply_to", opts.reply_to);
  assertOptionalPositiveId("since_id", opts.since_id, true);
  for (const [name, value] of [
    ["session_id", opts.session_id], ["from", opts.from], ["to", opts.to], ["channel", opts.channel],
    ["project_id", opts.project_id], ["mentions_only", opts.mentions_only],
  ] as const) assertOptionalFilter(name, value);
  assertOptionalDate("since", opts.since);
  if (opts.order !== undefined && opts.order !== "asc" && opts.order !== "desc") {
    throw new Error("order must be asc or desc");
  }
}

/**
 * Bounded collection read used by CLI/MCP/audit surfaces. The SQL projection
 * never selects the full content or raw metadata value into the caller.
 */
export function readMessagePreviews(opts: ReadMessagePreviewsOptions = {}): MessagePreviewPage {
  validateReadPreviewFilters(opts);
  const startedAt = performance.now();
  const timeoutMs = resolveCollectionTimeoutMs(opts.timeout_ms);
  const limit = resolveCollectionLimit(opts.latest ?? opts.limit);
  const offset = resolveCollectionOffset(opts.offset);
  const previewBytes = resolveCollectionPreviewBytes(opts.preview_bytes);
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (opts.id !== undefined) { conditions.push("id = ?"); params.push(opts.id); }
  if (opts.session_id) { conditions.push("session_id = ?"); params.push(opts.session_id); }
  if (opts.from) { conditions.push("from_agent = ?"); params.push(opts.from); }
  if (opts.to) { conditions.push("to_agent = ?"); params.push(opts.to); }
  if (opts.channel) { conditions.push("channel = ?"); params.push(normalizeChannelName(opts.channel)); }
  if (opts.project_id) { conditions.push("project_id = ?"); params.push(opts.project_id); }
  if (opts.since) { conditions.push("created_at > ?"); params.push(opts.since); }
  if (opts.since_id !== undefined) { conditions.push("id > ?"); params.push(opts.since_id); }
  if (opts.unread_only) conditions.push("read_at IS NULL");
  if (opts.threads_only) conditions.push("reply_to IS NULL");
  if (opts.reply_to !== undefined) { conditions.push("reply_to = ?"); params.push(opts.reply_to); }
  if (opts.pinned_only) conditions.push("pinned_at IS NOT NULL");
  if (opts.mentions_only) {
    conditions.push("id IN (SELECT message_id FROM message_mentions WHERE mentioned_agent = ?)");
    params.push(opts.mentions_only.toLowerCase());
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const order = opts.latest || opts.order?.toLowerCase() === "desc" ? "DESC" : "ASC";
  const replyCountSelect = opts.include_reply_counts
    ? ", (SELECT COUNT(*) FROM messages replies WHERE replies.reply_to = messages.id) AS reply_count"
    : "";
  const rows = db.prepare(
    `SELECT ${previewProjectionColumns()}${replyCountSelect}
     FROM messages ${where} ORDER BY created_at ${order}, id ${order} LIMIT ${limit + 1} OFFSET ${offset}`,
  ).all(...params) as Record<string, unknown>[];
  assertCollectionDeadline(startedAt, timeoutMs);
  const previews = rows.map((row) => buildMessagePreview(row, previewBytes));
  const page = packMessagePreviewPage(previews, {
    limit,
    cursor: offset,
    max_bytes: opts.max_bytes,
    timeout_ms: timeoutMs,
  });
  assertCollectionDeadline(startedAt, timeoutMs);
  return page;
}

/**
 * Public compatibility collection read. It returns bounded/redacted preview
 * text in the legacy `content` slot and never returns raw metadata or
 * attachments. Use getMessageById for one explicit full message.
 */
export function readMessages(opts: ReadMessagesOptions = {}): Message[] {
  const page = readMessagePreviews({
    ...opts,
    preview_bytes: opts.max_content_length,
    max_bytes: COLLECTION_MAX_MAX_BYTES,
  });
  return page.messages.map(previewAsCompatibilityMessage);
}

export interface CountMessagesOptions {
  session_id?: string;
  from?: string;
  to?: string;
  channel?: string;
  project_id?: string;
  since?: string;
  since_id?: number;
  unread_only?: boolean;
  blocking_only?: boolean;
}

/**
 * Authoritative COUNT of messages matching the given filters. Mirrors the filter
 * surface of {@link readMessages} and the server `/messages?count=1` endpoint so
 * both Store transports (LocalStore, ApiStore) return identical totals. Used by
 * aggregation callers (e.g. the project panel) that need a total without paging
 * every row through memory.
 */
export function countMessages(opts: CountMessagesOptions = {}): number {
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
  if (opts.blocking_only) {
    conditions.push("blocking = 1");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const row = db.prepare(`SELECT COUNT(*) AS n FROM messages ${where}`).get(...params) as { n: number } | undefined;
  return row?.n ?? 0;
}

function visibleProjectionMessageIds(agent: string): Message[] {
  const db = getDb();
  const isProjection = db.prepare("SELECT 1 AS present FROM incident_projections WHERE message_id = ?");
  return getUnreadBlockers(agent).filter((message) => Boolean(isProjection.get(message.id)));
}

function insertProjectionReceipts(ids: number[], reader: string): number {
  if (ids.length === 0) return 0;
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO message_read_receipts (message_id, agent, read_at)
     VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'))`,
  );
  const normalized = reader.toLowerCase();
  let inserted = 0;
  for (const id of new Set(ids)) inserted += insert.run(id, normalized).changes;
  return inserted;
}

function markExplicitRead(ids: number[], reader: string, requireRecipient: boolean): number {
  const db = getDb();
  const uniqueIds = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (uniqueIds.length === 0) return 0;
  return db.transaction(() => {
    const visibleProjected = new Set(visibleProjectionMessageIds(reader).map((message) => message.id));
    const messageLookup = db.prepare(`
      SELECT m.to_agent,
             EXISTS (SELECT 1 FROM incident_projections p WHERE p.message_id = m.id) AS projected
      FROM messages m WHERE m.id = ?
    `);
    const receipt = db.prepare(
      `INSERT OR IGNORE INTO message_read_receipts (message_id, agent, read_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'))`,
    );
    const markLegacy = db.prepare(
      `UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
       WHERE id = ? AND read_at IS NULL`,
    );
    const normalized = reader.toLowerCase();
    let marked = 0;
    for (const id of uniqueIds) {
      const row = messageLookup.get(id) as { to_agent: string; projected: number } | undefined;
      if (!row) continue;
      const projected = Boolean(row.projected);
      if (projected && !visibleProjected.has(id)) continue;
      if (!projected && requireRecipient && row.to_agent.toLowerCase() !== normalized) continue;
      const receiptChanged = projected ? receipt.run(id, normalized).changes > 0 : false;
      const globalChanged = projected ? false : markLegacy.run(id).changes > 0;
      if (receiptChanged || globalChanged) marked += 1;
    }
    return marked;
  });
}

export function markRead(ids: number[], reader: string): number {
  return markExplicitRead(ids, reader, true);
}

export function markSessionRead(sessionId: string, reader: string): number {
  const db = getDb();
  return db.transaction(() => {
    const projected = visibleProjectionMessageIds(reader).filter((message) => message.session_id === sessionId);
    const acknowledged = insertProjectionReceipts(projected.map((message) => message.id), reader);
    const result = db.prepare(
      `UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
       WHERE session_id = ? AND to_agent = ? AND read_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM incident_projections p WHERE p.message_id = messages.id)`
    ).run(sessionId, reader);
    return acknowledged + result.changes;
  });
}

export function markChannelRead(channelName: string, reader: string): number {
  const db = getDb();
  const normalized = normalizeChannelName(channelName);
  return db.transaction(() => {
    const projected = visibleProjectionMessageIds(reader).filter((message) => message.channel === normalized);
    const acknowledged = insertProjectionReceipts(projected.map((message) => message.id), reader);
    const result = db.prepare(
      `UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
       WHERE channel = ? AND from_agent != ? AND read_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM incident_projections p WHERE p.message_id = messages.id)`
    ).run(normalized, reader);
    return acknowledged + result.changes;
  });
}

export function getMessageById(id: number): Message | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? parseMessage(row) : null;
}

export function markReadByIds(ids: number[], agent?: string): number {
  const db = getDb();
  if (ids.length === 0) return 0;

  if (agent) return markExplicitRead(ids, agent, false);

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
  return db.transaction(() => {
    const projected = visibleProjectionMessageIds(agent);
    const acknowledged = insertProjectionReceipts(projected.map((message) => message.id), agent);
    const result = db.prepare(
      `UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
       WHERE to_agent = ? AND read_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM incident_projections p WHERE p.message_id = messages.id)`
    ).run(agent);
    return acknowledged + result.changes;
  });
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
export const MAX_DIGEST_LIMIT = 100;
export const DEFAULT_DIGEST_SNIPPET_BYTES = 320;

const DIGEST_ID_PLACEHOLDER = "0000000000000000";

export function resolveDigestMaxBytes(value: unknown): number {
  if (value === undefined || value === null || value === "") return DEFAULT_DIGEST_MAX_BYTES;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_DIGEST_MAX_BYTES;
  const bytes = Math.floor(parsed);
  if (bytes < MIN_DIGEST_MAX_BYTES) {
    throw new Error(`Digest max_bytes must be at least ${MIN_DIGEST_MAX_BYTES} bytes.`);
  }
  return Math.min(bytes, MAX_DIGEST_MAX_BYTES);
}

export function resolveDigestLimit(value: unknown): number {
  if (value === undefined || value === null || value === "") return DEFAULT_DIGEST_LIMIT;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DIGEST_LIMIT;
  return Math.min(Math.floor(parsed), MAX_DIGEST_LIMIT);
}

export function resolveDigestCursor(value: unknown): number | undefined {
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

function makeDigestMessage(message: MessagePreview, snippetBytes: number): DigestMessage {
  const normalized = normalizeSnippetText(message.preview);
  const snippet = truncateUtf8(normalized, snippetBytes);
  const attachmentCount = message.attachment_count;
  return {
    id: message.id,
    from: message.from_agent,
    created_at: message.created_at,
    snippet: snippet.text,
    snippet_bytes: Buffer.byteLength(snippet.text, "utf8"),
    truncated: message.truncated || snippet.truncated,
    priority: message.priority,
    has_attachments: attachmentCount > 0,
    attachment_count: attachmentCount,
    channel: message.channel,
    to: message.to_agent,
    reply_to: message.reply_to,
    unread: message.unread,
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
}): MessagePreview[] {
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
    `SELECT ${previewProjectionColumns()} FROM messages ${where} ORDER BY id ASC LIMIT ${safeLimit}`
  ).all(...params) as Record<string, unknown>[];
  return rows.map((row) => buildMessagePreview(row, DEFAULT_DIGEST_SNIPPET_BYTES));
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

/** Normalized digest inputs shared by the local and cloud digest paths. */
export interface DigestNorm {
  channel: string | null;
  session_id?: string;
  to?: string;
  since?: string;
  cursor?: number;
  maxBytes: number;
  limit: number;
}

/** Counts a digest reports (total matching + total unread). */
export interface DigestCounts {
  total_available: number;
  total_unread: number;
}

/**
 * Result of assembling a digest page: the entries that would be marked read
 * (empty when nothing shown) and a `rebuild(markedRead)` closure that produces
 * the final DigestResult for a given marked-read count. The heavy byte-budget
 * packing is done ONCE here, storage-agnostic — the caller supplies the counts
 * and pre-fetched rows (from SQLite locally, or the cloud API), then marks the
 * entries and calls `rebuild`. This keeps the packing algorithm a single source
 * of truth across the local and self_hosted digest paths.
 */
export interface DigestAssembly {
  rebuild: (markedRead: number) => DigestResult;
  markableEntries: DigestMessage[];
}

/**
 * Pure digest packer: given the normalized filters, the counts, the candidate
 * rows (id ASC), and whether mark_read was requested (so the byte budget can
 * reserve room for the marked_read counter), pack as many messages as fit under
 * `maxBytes` and return the terminal shape as a rebuild closure.
 */
export function assembleDigest(
  norm: DigestNorm,
  counts: DigestCounts,
  messages: MessagePreview[],
  markReadRequested: boolean,
): DigestAssembly {
  const build = (entries: DigestMessage[], extra: Partial<Parameters<typeof buildDigestResult>[0]> = {}): DigestResult =>
    buildDigestResult({
      channel: norm.channel,
      session_id: norm.session_id ?? null,
      to: norm.to ?? null,
      since: norm.since ?? null,
      cursor: norm.cursor ?? null,
      max_bytes: norm.maxBytes,
      limit: norm.limit,
      total_available: counts.total_available,
      total_unread: counts.total_unread,
      entries,
      ...extra,
    });

  let entries: DigestMessage[] = [];
  for (const message of messages) {
    let low = 0;
    let high = DEFAULT_DIGEST_SNIPPET_BYTES;
    let best: DigestMessage | null = null;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidateMessage = makeDigestMessage(message, mid);
      const candidate = build([...entries, candidateMessage], {
        marked_read: markReadRequested ? entries.length + 1 : 0,
      });
      if (candidate.byte_length <= norm.maxBytes) {
        best = candidateMessage;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (!best) {
      const skipped = build(entries, {
        skipped_count: 1,
        advance_cursor: message.id,
        marked_read: markReadRequested ? entries.length : 0,
      });

      if (skipped.byte_length > norm.maxBytes && entries.length > 0) {
        // Even skipping this message overflows: drop it, keep the cursor put.
        const captured = entries;
        return {
          markableEntries: captured,
          rebuild: (markedRead: number) => {
            const page = build(captured, { marked_read: markedRead });
            assertDigestFits(page);
            return page;
          },
        };
      }

      const captured = entries;
      const capturedAdvance = message.id;
      return {
        markableEntries: captured,
        rebuild: (markedRead: number) => {
          const s = build(captured, {
            skipped_count: 1,
            advance_cursor: capturedAdvance,
            marked_read: markedRead,
          });
          assertDigestFits(s);
          return s;
        },
      };
    }
    entries = [...entries, best];
  }

  const captured = entries;
  return {
    markableEntries: captured,
    rebuild: (markedRead: number) => {
      const result = build(captured, { marked_read: markedRead });
      assertDigestFits(result);
      return result;
    },
  };
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

  const norm: DigestNorm = { channel, session_id: opts.session_id, to: opts.to, since: opts.since, cursor, maxBytes, limit };
  const assembly = assembleDigest(norm, counts, messages, !!opts.mark_read);

  let markedRead = 0;
  if (opts.mark_read && assembly.markableEntries.length > 0) {
    markedRead = markDigestEntriesRead(assembly.markableEntries, opts.reader);
  }
  return assembly.rebuild(markedRead);
}

/**
 * Write a bounded export artifact. Preview projection is the default; raw
 * bodies are selected only after explicit full-export authorization passes.
 */
export function exportMessages(opts: ExportMessagesOptions = {}): MessageExportArtifact {
  const resolved = resolveMessageExportOptions(opts);
  const startedAt = performance.now();
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

  const projection = resolved.detail === "preview" ? previewProjectionColumns() : "*";
  const rows = db.prepare(
    `SELECT ${projection} FROM messages ${where} ORDER BY created_at ASC, id ASC LIMIT ${resolved.limit + 1}`,
  ).all(...params) as Record<string, unknown>[];
  assertCollectionDeadline(startedAt, resolved.timeoutMs);
  const records = rows.slice(0, resolved.limit).map((row) => resolved.detail === "preview"
    ? buildMessagePreview(row, resolved.previewBytes) as unknown as Record<string, unknown>
    : parseMessage(row) as unknown as Record<string, unknown>);
  const serialized = serializeMessageExport(records, {
    format: resolved.format,
    detail: resolved.detail,
    maxBytes: resolved.maxBytes,
    hasMore: rows.length > resolved.limit,
  });
  assertCollectionDeadline(startedAt, resolved.timeoutMs);
  return writeMessageExportArtifact(
    serialized,
    resolved,
    opts.authorization?.principal ?? "local",
    "local",
  );
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

/** Bounded preview compatibility reader for pinned collections. */
export function getPinnedMessages(opts?: { channel?: string; session_id?: string; limit?: number; offset?: number }): Message[] {
  assertOptionalFilter("channel", opts?.channel);
  assertOptionalFilter("session_id", opts?.session_id);
  const db = getDb();
  const conditions = ["pinned_at IS NOT NULL"];
  const params: (string | number)[] = [];
  if (opts?.channel) {
    conditions.push("channel = ?");
    params.push(normalizeChannelName(opts.channel));
  }
  if (opts?.session_id) {
    conditions.push("session_id = ?");
    params.push(opts.session_id);
  }
  const limit = resolveCollectionLimit(opts?.limit);
  const offset = resolveCollectionOffset(opts?.offset);
  const rows = db.prepare(
    `SELECT ${previewProjectionColumns()} FROM messages
     WHERE ${conditions.join(" AND ")}
     ORDER BY pinned_at DESC, id DESC LIMIT ${limit + 1} OFFSET ${offset}`,
  ).all(...params) as Record<string, unknown>[];
  return packMessagePreviewPage(rows.map((row) => buildMessagePreview(row)), {
    limit,
    cursor: offset,
    max_bytes: COLLECTION_MAX_MAX_BYTES,
  }).messages.map(previewAsCompatibilityMessage);
}

function queryUnreadBlockerRows(
  agent: string,
  opts: { limit?: number; offset?: number } | undefined,
): Record<string, unknown>[] {
  const db = getDb();
  const tenantId = process.env.HASNA_CONVERSATIONS_TENANT_ID?.trim();
  const authorityId = process.env.HASNA_CONVERSATIONS_INCIDENT_AUTHORITY_ID?.trim();
  const anyProjection = db.prepare("SELECT 1 AS present FROM incident_projections LIMIT 1").get();
  if ((!tenantId || !authorityId) && (anyProjection || tenantId || authorityId)) {
    throw new IncidentProjectorConfigurationError(
      "Canonical blocker reads require HASNA_CONVERSATIONS_TENANT_ID and HASNA_CONVERSATIONS_INCIDENT_AUTHORITY_ID",
    );
  }
  const binding = tenantId && authorityId ? validateIncidentProjectorBinding(tenantId, authorityId) : null;
  const selectedProjection = binding
    ? db.prepare(
        "SELECT 1 AS present FROM incident_projections WHERE tenant_id = ? AND authority_id = ? LIMIT 1",
      ).get(binding.tenant_id, binding.authority_id)
    : null;
  if (anyProjection && binding && !selectedProjection) {
    throw new IncidentProjectorConfigurationError(
      "Configured incident projector tenant/authority does not match stored canonical projections",
    );
  }
  const safeLimit = Number.isFinite(opts?.limit) && (opts!.limit as number) > 0
    ? Math.floor(opts!.limit as number)
    : 0;
  const safeOffset = Number.isFinite(opts?.offset) && (opts!.offset as number) > 0
    ? Math.floor(opts!.offset as number)
    : 0;
  const limitClause = safeLimit > 0 ? `LIMIT ${safeLimit}` : safeOffset > 0 ? "LIMIT -1" : "";
  const offsetClause = safeOffset > 0 ? `OFFSET ${safeOffset}` : "";
  return db.prepare(`
    WITH member_channel_scopes(scope) AS (
      SELECT 'channel:' || lower(channel)
      FROM channel_members
      WHERE lower(agent) = lower(?)
      UNION
      SELECT 'channel:' || lower(alias.old_channel)
      FROM channel_rename_aliases alias
      JOIN channel_members member ON lower(member.channel) = lower(alias.current_channel)
      WHERE lower(member.agent) = lower(?)
    ),
    latest AS (
      SELECT p.*
      FROM incident_projections p
      JOIN (
        SELECT tenant_id, authority_id, incident_id, MAX(incident_version) AS incident_version
        FROM incident_projections
        WHERE tenant_id = ? AND authority_id = ?
        GROUP BY tenant_id, authority_id, incident_id
      ) current
        ON current.tenant_id = p.tenant_id
       AND current.authority_id = p.authority_id
       AND current.incident_id = p.incident_id
       AND current.incident_version = p.incident_version
    ),
    blocker_candidates AS (
      SELECT p.*,
             CASE WHEN p.status = 'superseded'
                        AND p.superseded_by_incident_id IS NOT NULL
                        AND NOT EXISTS (
                          SELECT 1 FROM incident_projections replacement
                          WHERE replacement.tenant_id = p.tenant_id
                            AND replacement.authority_id = p.authority_id
                            AND replacement.incident_id = p.superseded_by_incident_id
                            AND replacement.supersedes_incident_id = p.incident_id
                        )
                  THEN 1 ELSE 0 END AS pending_handoff
      FROM latest p
    ),
    projected_ids AS (
      SELECT DISTINCT m.id
      FROM blocker_candidates p
      JOIN messages m ON m.id = p.message_id
      JOIN incident_projection_scopes scope
        ON scope.projection_id = p.id AND scope.scope_type = 'blocked'
      WHERE (
          (p.status IN ('open','investigating','contained','monitoring') AND p.blocking = 1)
          OR p.pending_handoff = 1
        )
        AND (
          p.pending_handoff = 1
          OR NOT EXISTS (
            SELECT 1 FROM message_read_receipts receipt
            WHERE receipt.message_id = m.id AND lower(receipt.agent) = lower(?)
          )
        )
        AND (
          lower(scope.scope) = 'agent:' || lower(?)
          OR lower(scope.scope) IN (SELECT scope FROM member_channel_scopes)
          OR scope.scope IN (
            SELECT 'project:' || project_id FROM agent_presence
            WHERE lower(agent) = lower(?) AND project_id <> ''
          )
        )
    ),
    legacy_ids AS (
      SELECT m.id
      FROM messages m
      LEFT JOIN incident_projections p ON p.message_id = m.id
      WHERE p.id IS NULL AND m.blocking = 1 AND m.read_at IS NULL
        AND (
          lower(m.to_agent) = lower(?)
          OR m.channel IN (SELECT channel FROM channel_members WHERE lower(agent) = lower(?))
        )
    ),
    eligible_ids AS (
      SELECT id FROM projected_ids
      UNION
      SELECT id FROM legacy_ids
    )
    SELECT ${previewProjectionColumns("m")} FROM messages m JOIN eligible_ids eligible ON eligible.id = m.id
    ORDER BY m.created_at ASC, m.id ASC
    ${limitClause} ${offsetClause}
  `).all(agent, agent, binding?.tenant_id ?? null, binding?.authority_id ?? null, agent, agent, agent, agent, agent) as Record<string, unknown>[];
}

export function getUnreadBlockers(agent: string, opts?: { limit?: number; offset?: number }): Message[] {
  return getUnreadBlockerPreviews(agent, {
    ...opts,
    max_bytes: COLLECTION_MAX_MAX_BYTES,
  }).messages.map(previewAsCompatibilityMessage);
}

export function getUnreadBlockerPreviews(
  agent: string,
  opts: { limit?: number; offset?: number; max_bytes?: number; preview_bytes?: number; timeout_ms?: number } = {},
): MessagePreviewPage {
  assertOptionalFilter("agent", agent);
  const startedAt = performance.now();
  const timeoutMs = resolveCollectionTimeoutMs(opts.timeout_ms);
  const limit = resolveCollectionLimit(opts.limit);
  const offset = resolveCollectionOffset(opts.offset);
  const previewBytes = resolveCollectionPreviewBytes(opts.preview_bytes);
  const rows = queryUnreadBlockerRows(agent, { limit: limit + 1, offset });
  assertCollectionDeadline(startedAt, timeoutMs);
  const page = packMessagePreviewPage(rows.map((row) => buildMessagePreview(row, previewBytes)), {
    limit,
    cursor: offset,
    max_bytes: opts.max_bytes,
    timeout_ms: timeoutMs,
  });
  assertCollectionDeadline(startedAt, timeoutMs);
  return page;
}

export function getThreadReplies(messageId: number): Message[] {
  return readMessagePreviews({
    reply_to: messageId,
    order: "asc",
    limit: 100,
    max_bytes: COLLECTION_MAX_MAX_BYTES,
  }).messages.map(previewAsCompatibilityMessage);
}

/** Search equivalent of readMessagePreviews; FTS/LIKE run in SQLite but only a
 * bounded, redacted snippet projection leaves the storage boundary. */
export function searchMessagePreviews(opts: SearchMessagePreviewsOptions): MessagePreviewPage {
  assertOptionalFilter("query", opts.query);
  assertOptionalFilter("channel", opts.channel);
  assertOptionalFilter("from", opts.from);
  assertOptionalFilter("to", opts.to);
  assertOptionalDate("since", opts.since);
  assertOptionalDate("until", opts.until);
  if (opts.since && opts.until && Date.parse(opts.since) > Date.parse(opts.until)) {
    throw new Error("since must not be later than until");
  }
  const startedAt = performance.now();
  const timeoutMs = resolveCollectionTimeoutMs(opts.timeout_ms);
  const limit = resolveCollectionLimit(opts.limit);
  const offset = resolveCollectionOffset(opts.offset);
  const previewBytes = resolveCollectionPreviewBytes(opts.preview_bytes);
  const db = getDb();
  const sortByRelevance = opts.sort !== "recent";

  try {
    const params: (string | number)[] = [];
    const query = opts.query.trim();
    const ftsQuery = query.startsWith('"') && query.endsWith('"')
      ? query
      : query.split(/\s+/).filter(Boolean).map((word) => `"${word.replace(/"/g, '""')}"`).join(" ");
    params.push(ftsQuery);
    const clauses: string[] = [];
    if (opts.channel) { clauses.push("m.channel = ?"); params.push(normalizeChannelName(opts.channel)); }
    if (opts.from) { clauses.push("m.from_agent = ?"); params.push(opts.from); }
    if (opts.to) { clauses.push("m.to_agent = ?"); params.push(opts.to); }
    if (opts.since) { clauses.push("m.created_at >= ?"); params.push(opts.since); }
    if (opts.until) { clauses.push("m.created_at <= ?"); params.push(opts.until); }
    const extra = clauses.length > 0 ? ` AND ${clauses.join(" AND ")}` : "";
    const order = sortByRelevance ? "ORDER BY rank" : "ORDER BY m.created_at DESC, m.id DESC";
    const rows = db.prepare(
      `SELECT ${previewProjectionColumns("m")}, ABS(rank) AS relevance_score
       FROM messages m JOIN messages_fts ON messages_fts.rowid = m.id
       WHERE messages_fts MATCH ?${extra} ${order} LIMIT ${limit + 1} OFFSET ${offset}`,
    ).all(...params) as Record<string, unknown>[];
    assertCollectionDeadline(startedAt, timeoutMs);
    const page = packMessagePreviewPage(rows.map((row) => buildMessagePreview(row, previewBytes)), {
      limit,
      cursor: offset,
      max_bytes: opts.max_bytes,
      timeout_ms: timeoutMs,
      query: opts.query,
    });
    assertCollectionDeadline(startedAt, timeoutMs);
    return page;
  } catch (error) {
    if (error instanceof Error && (error.message.includes("max_bytes") || error.message.includes("timeout_ms") || error.message.includes("envelope exceeds"))) throw error;
  }

  const conditions: string[] = ["content LIKE ?"];
  const params: (string | number)[] = [`%${opts.query}%`];
  if (opts.channel) { conditions.push("channel = ?"); params.push(normalizeChannelName(opts.channel)); }
  if (opts.from) { conditions.push("from_agent = ?"); params.push(opts.from); }
  if (opts.to) { conditions.push("to_agent = ?"); params.push(opts.to); }
  if (opts.since) { conditions.push("created_at >= ?"); params.push(opts.since); }
  if (opts.until) { conditions.push("created_at <= ?"); params.push(opts.until); }
  const rows = db.prepare(
    `SELECT ${previewProjectionColumns()}, 0 AS relevance_score FROM messages
     WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ${limit + 1} OFFSET ${offset}`,
  ).all(...params) as Record<string, unknown>[];
  assertCollectionDeadline(startedAt, timeoutMs);
  return packMessagePreviewPage(rows.map((row) => buildMessagePreview(row, previewBytes)), {
    limit,
    cursor: offset,
    max_bytes: opts.max_bytes,
    timeout_ms: timeoutMs,
    query: opts.query,
  });
}

/** Public compatibility search: preview text only, never raw rows. */
export function searchMessages(opts: SearchMessagesOptions): SearchResult[] {
  return searchMessagePreviews({
    ...opts,
    preview_bytes: opts.snippet_length,
    max_bytes: COLLECTION_MAX_MAX_BYTES,
  }).messages.map((preview) => ({
    ...previewAsCompatibilityMessage(preview),
    snippet: preview.preview,
    relevance_score: preview.relevance_score ?? 0,
  }));
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

/** Dedicated bounded @mention projection keyed by message_mentions.id/notified_at. */
export function readMentionPreviews(agent: string, opts: ReadMentionPreviewsOptions = {}): MessagePreviewPage {
  assertOptionalFilter("agent", agent);
  assertOptionalFilter("channel", opts.channel);
  const startedAt = performance.now();
  const timeoutMs = resolveCollectionTimeoutMs(opts.timeout_ms);
  const limit = resolveCollectionLimit(opts.limit ?? 50);
  const offset = resolveCollectionOffset(opts.offset);
  const previewBytes = resolveCollectionPreviewBytes(opts.preview_bytes);
  const db = getDb();
  const conditions = ["mm.mentioned_agent = ?"];
  const params: (string | number)[] = [agent.toLowerCase()];
  if (opts.channel) {
    conditions.push("m.channel = ?");
    params.push(normalizeChannelName(opts.channel));
  }
  if (opts.unread_only) conditions.push("mm.notified_at IS NULL");
  const rows = db.prepare(
    `SELECT ${previewProjectionColumns("m")}, mm.id AS mention_id,
            CASE WHEN mm.notified_at IS NULL THEN 1 ELSE 0 END AS unread
     FROM messages m
     JOIN message_mentions mm ON mm.message_id = m.id
     WHERE ${conditions.join(" AND ")}
     ORDER BY m.created_at DESC, m.id DESC LIMIT ${limit + 1} OFFSET ${offset}`,
  ).all(...params) as Record<string, unknown>[];
  assertCollectionDeadline(startedAt, timeoutMs);
  const page = packMessagePreviewPage(rows.map((row) => buildMessagePreview(row, previewBytes)), {
    limit,
    cursor: offset,
    max_bytes: opts.max_bytes,
    timeout_ms: timeoutMs,
  });
  assertCollectionDeadline(startedAt, timeoutMs);
  return page;
}

/** Bounded preview compatibility reader for mention collections. */
export function getMessagesForAgent(agent: string, opts?: { channel?: string; unread_only?: boolean; limit?: number }): Array<{ message: Message; mention_id: number }> {
  const page = readMentionPreviews(agent, {
    ...opts,
    max_bytes: COLLECTION_MAX_MAX_BYTES,
  });
  return page.messages.map((preview) => ({
    message: previewAsCompatibilityMessage(preview),
    mention_id: preview.mention_id!,
  }));
}

/** Mark only explicitly returned mention rows for the named agent. */
export function markMentionsReadByIds(agent: string, mentionIds: number[]): number {
  assertOptionalFilter("agent", agent);
  if (mentionIds.length === 0) return 0;
  if (mentionIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("mention_ids must contain only positive integers");
  }
  const db = getDb();
  const placeholders = mentionIds.map(() => "?").join(",");
  const result = db.prepare(
    `UPDATE message_mentions
     SET notified_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
     WHERE mentioned_agent = ? AND id IN (${placeholders}) AND notified_at IS NULL`,
  ).run(agent.toLowerCase(), ...mentionIds);
  return result.changes;
}

/** Mark mentions as notified (agent has seen them). */
export function markMentionsRead(agent: string, channel?: string): number {
  assertOptionalFilter("agent", agent);
  assertOptionalFilter("channel", channel);
  const db = getDb();
  if (channel) {
    const normalized = normalizeChannelName(channel);
    const result = db.prepare(
      "UPDATE message_mentions SET notified_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE mentioned_agent = ? AND channel = ? AND notified_at IS NULL"
    ).run(agent.toLowerCase(), normalized);
    return result.changes;
  }
  const result = db.prepare(
    "UPDATE message_mentions SET notified_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE mentioned_agent = ? AND notified_at IS NULL"
  ).run(agent.toLowerCase());
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
