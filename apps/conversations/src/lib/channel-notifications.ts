import { getDb } from "./db.js";
import type { ChannelNotification, ChannelNotificationSubscription } from "../types.js";
import { normalizeChannelName } from "./channel-names.js";
import { redactSensitiveText } from "./content-safety.js";
import { CHANNEL_SUBSCRIPTION_AGENT_ORDER, CHANNEL_SUBSCRIPTION_ALL_ORDER, simpleOrderByClause } from "./list-order.js";
import { getPresence } from "./presence.js";
import { resolveSelfSenderId } from "./sender-identity.js";

/**
 * How much of a channel message a notification `preview` carries.
 *
 * Exported because it is load-bearing for callers deciding whether they need
 * `include_content`: together with the character-class strip in
 * {@link buildMessagePreview} it is why a preview cannot be parsed for
 * identifiers. Note this is NOT the DM preview length — that is
 * `DEFAULT_PREVIEW_CHARS` in ./compact-output.ts, which is 160 and strips
 * nothing.
 */
export const DEFAULT_PREVIEW_CHARS = 140;

export function buildMessagePreview(content: string, maxChars = DEFAULT_PREVIEW_CHARS): string {
  const normalized = redactSensitiveText(content)
    .replace(/[*#`~_>\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(0, Math.max(1, maxChars)).trimEnd() + "…";
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
      `SELECT channel, agent, created_at, preview_chars, since_message_id FROM channel_subscriptions WHERE agent = ? ${simpleOrderByClause(CHANNEL_SUBSCRIPTION_AGENT_ORDER)}, channel ASC`
    ).all(agent) as ChannelNotificationSubscription[];
  }

  return db.prepare(
    `SELECT channel, agent, created_at, preview_chars, since_message_id FROM channel_subscriptions ${simpleOrderByClause(CHANNEL_SUBSCRIPTION_ALL_ORDER)}, channel ASC`
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
  /**
   * Also return the full, un-stripped message body as `content`.
   *
   * Opt-in, because `preview` is a display string that several callers already
   * render as-is and adding a second field to every one of them would be a cost
   * they did not ask for. `preview` is unaffected either way.
   */
  include_content?: boolean;
}

export function readChannelNotifications(opts: ReadChannelNotificationsOptions): ChannelNotification[] {
  const db = getDb();
  const selfSenderId = resolveSelfSenderId(opts.agent, getPresence(opts.agent));
  const conditions: string[] = [
    "s.agent = ?",
    "m.channel IS NOT NULL",
    "m.from_agent != ?",
    "m.id > s.since_message_id",
  ];
  const params: (string | number)[] = [opts.agent, selfSenderId];

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

  const rows = db.prepare(`
    SELECT
      m.id AS message_id,
      m.channel,
      m.from_agent,
      m.created_at,
      m.priority,
      m.content,
      m.attachments,
      s.preview_chars,
      snr.message_id AS read_message_id
    FROM messages m
    INNER JOIN channel_subscriptions s
      ON s.channel = m.channel
    LEFT JOIN channel_notification_reads snr
      ON snr.message_id = m.id AND snr.agent = s.agent
    WHERE ${conditions.join(" AND ")}
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT ${Math.max(1, Math.min(limit, 500))}
  `).all(...params) as Array<{
    message_id: number;
    channel: string;
    from_agent: string;
    created_at: string;
    priority: "low" | "normal" | "high" | "urgent";
    content: string;
    attachments: string | null;
    preview_chars: number;
    read_message_id: number | null;
  }>;

  const notifications = rows.map((row) => ({
    message_id: row.message_id,
    channel: row.channel,
    from_agent: row.from_agent,
    created_at: row.created_at,
    priority: row.priority,
    preview: buildMessagePreview(row.content, row.preview_chars),
    unread: row.read_message_id == null,
    has_attachments: !!row.attachments && row.attachments !== "[]",
    // Redacted on exactly the same terms as the preview. Widening what a
    // notification carries must not widen what a credential can ride out on:
    // the preview's redaction is the reason a legacy DSN in the store does not
    // reach a watcher's terminal, and full content has to clear the same bar.
    ...(opts.include_content ? { content: redactSensitiveText(row.content) } : {}),
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

/**
 * Atomically acknowledge the channel notifications visible for one identity at
 * arm time.
 *
 * The INSERT ... SELECT is one database statement, so it reads one fixed
 * snapshot. A message committed after that snapshot is not acknowledged and
 * remains available to the live notification poll.
 */
export function baselineChannelNotifications(agent: string): number {
  const db = getDb();
  const selfSenderId = resolveSelfSenderId(agent, getPresence(agent));
  const result = db.prepare(`
    INSERT OR IGNORE INTO channel_notification_reads (agent, message_id)
    SELECT ?, m.id
    FROM messages m
    INNER JOIN channel_subscriptions s
      ON s.channel = m.channel
    WHERE s.agent = ?
      AND m.channel IS NOT NULL
      AND m.from_agent != ?
      AND m.id > s.since_message_id
  `).run(agent, agent, selfSenderId);
  return result.changes;
}

export function markAllChannelNotificationsRead(agent: string, channel?: string): number {
  const unread = readChannelNotifications({ agent, channel, unread_only: true, limit: 10000 });
  return markChannelNotificationsRead(agent, unread.map((row) => row.message_id));
}
