import { getDb } from "./db.js";
import type { ChannelNotification, ChannelNotificationSubscription } from "../types.js";
import { normalizeChannelName } from "./channel-names.js";
import {
  COLLECTION_MAX_LIMIT,
  COLLECTION_MAX_PREVIEW_BYTES,
  COLLECTION_PREVIEW_SCAN_CHARS,
  RESTRICTED_CHANNEL_PREVIEW,
  redactSensitiveText,
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
}

export function readChannelNotifications(opts: ReadChannelNotificationsOptions): ChannelNotification[] {
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

  const limit = Number.isFinite(opts.limit) && (opts.limit as number) > 0
    ? Math.floor(opts.limit as number)
    : 20;

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
    LIMIT ${Math.max(1, Math.min(limit, COLLECTION_MAX_LIMIT))}
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

  const notifications = rows.map((row) => ({
    message_id: row.message_id,
    channel: row.channel,
    from_agent: row.from_agent,
    created_at: row.created_at,
    priority: row.priority,
    preview: buildMessagePreview(row.preview_source, row.preview_chars),
    unread: row.read_message_id == null,
    has_attachments: row.attachment_count > 0,
  })) satisfies ChannelNotification[];

  if (opts.mark_read && notifications.length > 0) {
    markChannelNotificationsRead(opts.agent, notifications.map((row) => row.message_id));
    for (const row of notifications) row.unread = false;
  }

  return notifications;
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
