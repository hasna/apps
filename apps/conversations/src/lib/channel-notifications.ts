import { getDb } from "./db.js";
import type { ChannelNotification, ChannelNotificationPage, ChannelNotificationSubscription } from "../types.js";
import { normalizeChannelName } from "./channel-names.js";
import {
  COLLECTION_MAX_LIMIT,
  COLLECTION_MAX_PREVIEW_BYTES,
  COLLECTION_PREVIEW_SCAN_CHARS,
  RESTRICTED_CHANNEL_PREVIEW,
  redactSensitiveText,
  resolveCollectionLimit,
  resolveCollectionMaxBytes,
  resolveCollectionOffset,
  resolveCollectionPreviewBytes,
  resolveCollectionTimeoutMs,
  truncateUtf8,
} from "./message-previews.js";

const DEFAULT_PREVIEW_CHARS = 140;

export function buildMessagePreview(content: string, maxChars = DEFAULT_PREVIEW_CHARS): string {
  if (content === RESTRICTED_CHANNEL_PREVIEW) return content;
  const markers: string[] = [];
  const protectedContent = redactSensitiveText(content).replace(/\[REDACTED:[A-Z_]+\]/g, (marker) => {
    const placeholder = `REDACTIONMARKER${markers.length}TOKEN`;
    markers.push(marker);
    return placeholder;
  });
  const normalized = protectedContent
    .replace(/[*#`~_>\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/REDACTIONMARKER(\d+)TOKEN/g, (_match, index) => markers[Number(index)] ?? "[REDACTED]");
  const boundedMaxChars = Math.min(Math.max(1, maxChars), COLLECTION_MAX_PREVIEW_BYTES);
  if (normalized.length <= boundedMaxChars) return normalized;
  return normalized.slice(0, boundedMaxChars).trimEnd() + "…";
}

/** Apply the subscription's character cap and the caller's UTF-8 byte cap. */
export function buildByteBoundedMessagePreview(content: string, maxChars: number, maxBytes: number): string {
  const preview = buildMessagePreview(content, maxChars);
  // Keep the explicit restricted-channel marker intact; it contains no body-derived data.
  if (preview === RESTRICTED_CHANNEL_PREVIEW) return preview;
  return truncateUtf8(preview, resolveCollectionPreviewBytes(maxBytes)).text;
}

export function subscribeToChannelNotifications(
  channel: string,
  agent: string,
  opts?: { preview_chars?: number },
): ChannelNotificationSubscription {
  const db = getDb();
  const channelName = normalizeChannelName(channel);
  const existingChannel = db.prepare("SELECT name FROM channels WHERE name = ?").get(channelName);
  if (!existingChannel) {
    throw new Error(`Channel not found: ${channel}`);
  }

  const previewChars = Number.isFinite(opts?.preview_chars) && (opts?.preview_chars as number) > 0
    ? Math.floor(opts!.preview_chars as number)
    : DEFAULT_PREVIEW_CHARS;
  const currentMaxMessageId = (db.prepare(
    "SELECT COALESCE(MAX(id), 0) AS max_id FROM messages WHERE channel = ?"
  ).get(channelName) as { max_id: number }).max_id;

  db.prepare(`
    INSERT INTO channel_subscriptions (channel, agent, preview_chars, since_message_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(channel, agent) DO UPDATE SET preview_chars = excluded.preview_chars
  `).run(channelName, agent, previewChars, currentMaxMessageId);

  return db.prepare(
    "SELECT channel, agent, created_at, preview_chars, since_message_id FROM channel_subscriptions WHERE channel = ? AND agent = ?"
  ).get(channelName, agent) as ChannelNotificationSubscription;
}

export function unsubscribeFromChannelNotifications(channel: string, agent: string): boolean {
  const db = getDb();
  const channelName = normalizeChannelName(channel);
  const result = db.prepare(
    "DELETE FROM channel_subscriptions WHERE channel = ? AND agent = ?"
  ).run(channelName, agent);
  return result.changes > 0;
}

export function listChannelNotificationSubscriptions(agent?: string): ChannelNotificationSubscription[] {
  const db = getDb();
  if (agent) {
    return db.prepare(
      "SELECT channel, agent, created_at, preview_chars, since_message_id FROM channel_subscriptions WHERE agent = ? ORDER BY created_at ASC, channel ASC"
    ).all(agent) as ChannelNotificationSubscription[];
  }

  return db.prepare(
    "SELECT channel, agent, created_at, preview_chars, since_message_id FROM channel_subscriptions ORDER BY agent ASC, channel ASC"
  ).all() as ChannelNotificationSubscription[];
}

export function getSubscribedChannels(agent: string): string[] {
  return listChannelNotificationSubscriptions(agent).map((row) => row.channel);
}

export interface ReadChannelNotificationsOptions {
  agent: string;
  channel?: string;
  unread_only?: boolean;
  limit?: number;
  since?: string;
  mark_read?: boolean;
  cursor?: number;
  max_bytes?: number;
  preview_bytes?: number;
  timeout_ms?: number;
}

export function finalizeChannelNotificationPage(page: ChannelNotificationPage): ChannelNotificationPage {
  let finalized = page;
  for (let index = 0; index < 3; index++) {
    finalized = { ...finalized, byte_length: Buffer.byteLength(JSON.stringify(finalized), "utf8") };
  }
  return finalized;
}

export function packChannelNotificationPage(
  candidates: ChannelNotification[],
  options: { limit?: unknown; cursor?: unknown; max_bytes?: unknown; timeout_ms?: unknown; marked_read?: number } = {},
): ChannelNotificationPage {
  const limit = resolveCollectionLimit(options.limit);
  const cursor = resolveCollectionOffset(options.cursor);
  const maxBytes = resolveCollectionMaxBytes(options.max_bytes);
  const timeoutMs = resolveCollectionTimeoutMs(options.timeout_ms);
  const windowed = candidates.slice(0, limit + 1);
  const available = windowed.slice(0, limit);

  const buildPage = (notifications: ChannelNotification[], skippedCount: number): ChannelNotificationPage => {
    const consumed = notifications.length + skippedCount;
    const hasMore = windowed.length > consumed;
    return finalizeChannelNotificationPage({
      notifications,
      count: notifications.length,
      limit,
      cursor,
      next_cursor: hasMore || skippedCount > 0 ? cursor + consumed : null,
      has_more: hasMore,
      skipped_count: skippedCount,
      byte_length: 0,
      max_bytes: maxBytes,
      timeout_ms: timeoutMs,
      marked_read: Math.max(0, Math.floor(options.marked_read ?? 0)),
      compact: true,
      detail_path: "messages/{id}",
    });
  };

  let notifications: ChannelNotification[] = [];
  let skippedCount = 0;
  for (const candidate of available) {
    const next = buildPage([...notifications, candidate], skippedCount);
    if (next.byte_length > maxBytes) {
      if (notifications.length === 0) skippedCount = 1;
      break;
    }
    notifications = [...notifications, candidate];
  }

  const page = buildPage(notifications, skippedCount);
  if (page.byte_length > maxBytes) {
    throw new Error(`channel notification envelope exceeds max_bytes (${page.byte_length} > ${maxBytes})`);
  }
  return page;
}

export function readChannelNotifications(opts: ReadChannelNotificationsOptions): ChannelNotificationPage {
  if (!opts.agent?.trim()) throw new Error("agent must be a non-empty string");
  if (opts.channel !== undefined && !opts.channel.trim()) throw new Error("channel must be a non-empty string");
  if (opts.since !== undefined && !Number.isFinite(Date.parse(opts.since))) {
    throw new Error("since must be a valid ISO 8601 date");
  }
  const db = getDb();
  const conditions: string[] = [
    "s.agent = ?",
    "m.channel IS NOT NULL",
    "m.from_agent != ?",
    "m.id > s.since_message_id",
  ];
  const params: (string | number)[] = [opts.agent, opts.agent];

  if (opts.channel) {
    conditions.push("m.channel = ?");
    params.push(normalizeChannelName(opts.channel));
  }
  if (opts.since) {
    conditions.push("m.created_at > ?");
    params.push(opts.since);
  }
  if (opts.unread_only !== false) {
    conditions.push("snr.message_id IS NULL");
  }

  const limit = resolveCollectionLimit(opts.limit);
  const cursor = resolveCollectionOffset(opts.cursor);
  const maxBytes = resolveCollectionMaxBytes(opts.max_bytes);
  const previewBytes = resolveCollectionPreviewBytes(opts.preview_bytes);
  const timeoutMs = resolveCollectionTimeoutMs(opts.timeout_ms);

  const restricted = `(lower(COALESCE(m.channel, '')) LIKE '%incident%' OR lower(COALESCE(m.channel, '')) LIKE '%security%' OR lower(COALESCE(m.to_agent, '')) LIKE '%incident%' OR lower(COALESCE(m.to_agent, '')) LIKE '%security%' OR lower(COALESCE(m.session_id, '')) LIKE '%incident%' OR lower(COALESCE(m.session_id, '')) LIKE '%security%')`;
  const rows = db.prepare(`
    SELECT
      m.id AS message_id,
      m.channel,
      m.from_agent,
      m.created_at,
      m.priority,
      CASE WHEN ${restricted} THEN '${RESTRICTED_CHANNEL_PREVIEW}' ELSE substr(m.content, 1, ${COLLECTION_PREVIEW_SCAN_CHARS}) END AS preview_source,
      CASE WHEN m.attachments IS NULL OR m.attachments = '' THEN 0 ELSE json_array_length(m.attachments) END AS attachment_count,
      s.preview_chars,
      snr.message_id AS read_message_id
    FROM messages m
    INNER JOIN channel_subscriptions s
      ON s.channel = m.channel
    LEFT JOIN channel_notification_reads snr
      ON snr.message_id = m.id AND snr.agent = s.agent
    WHERE ${conditions.join(" AND ")}
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT ${Math.max(1, Math.min(limit + 1, COLLECTION_MAX_LIMIT + 1))}
    OFFSET ${cursor}
  `).all(...params) as Array<{
    message_id: number;
    channel: string;
    from_agent: string;
    created_at: string;
    priority: "low" | "normal" | "high" | "urgent";
    preview_source: string;
    attachment_count: number;
    preview_chars: number;
    read_message_id: number | null;
  }>;

  const candidates = rows.map((row) => ({
    message_id: row.message_id,
    channel: row.channel,
    from_agent: row.from_agent,
    created_at: row.created_at,
    priority: row.priority,
    preview: buildByteBoundedMessagePreview(row.preview_source, row.preview_chars, previewBytes),
    unread: row.read_message_id == null,
    has_attachments: row.attachment_count > 0,
  })) satisfies ChannelNotification[];

  let page = packChannelNotificationPage(candidates, {
    limit,
    cursor,
    max_bytes: maxBytes,
    timeout_ms: timeoutMs,
  });

  let markedRead = 0;
  if (opts.mark_read && page.notifications.length > 0) {
    markedRead = markChannelNotificationsRead(opts.agent, page.notifications.map((row) => row.message_id));
    page = finalizeChannelNotificationPage({
      ...page,
      notifications: page.notifications.map((row) => ({ ...row, unread: false })),
      marked_read: markedRead,
    });
  }

  if (page.byte_length > maxBytes) {
    throw new Error(`channel notification envelope exceeds max_bytes (${page.byte_length} > ${maxBytes})`);
  }
  return page;
}

export function markChannelNotificationsRead(agent: string, messageIds: number[]): number {
  if (messageIds.length === 0) return 0;
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO channel_notification_reads (agent, message_id)
    VALUES (?, ?)
  `);

  let count = 0;
  for (const id of messageIds) {
    const result = insert.run(agent, id);
    count += result.changes;
  }
  return count;
}

export function markAllChannelNotificationsRead(agent: string, channel?: string): number {
  const db = getDb();
  const channelName = channel ? normalizeChannelName(channel) : null;
  const result = db.prepare(`
    INSERT OR IGNORE INTO channel_notification_reads (agent, message_id)
    SELECT ?, m.id
    FROM messages m
    INNER JOIN channel_subscriptions s ON s.channel = m.channel AND s.agent = ?
    WHERE m.channel IS NOT NULL
      AND m.from_agent != ?
      AND m.id > s.since_message_id
      ${channelName ? "AND m.channel = ?" : ""}
  `).run(...(channelName ? [agent, agent, agent, channelName] : [agent, agent, agent]));
  return result.changes;
}
