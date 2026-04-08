import { getDb } from "./db.js";
import type { SpaceNotification, SpaceNotificationSubscription } from "../types.js";

const DEFAULT_PREVIEW_CHARS = 140;

export function buildMessagePreview(content: string, maxChars = DEFAULT_PREVIEW_CHARS): string {
  const normalized = content
    .replace(/[*#`~_>\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(0, Math.max(1, maxChars)).trimEnd() + "…";
}

export function subscribeToSpaceNotifications(
  space: string,
  agent: string,
  opts?: { preview_chars?: number },
): SpaceNotificationSubscription {
  const db = getDb();
  const existingSpace = db.prepare("SELECT name FROM spaces WHERE name = ?").get(space);
  if (!existingSpace) {
    throw new Error(`Space not found: ${space}`);
  }

  const previewChars = Number.isFinite(opts?.preview_chars) && (opts?.preview_chars as number) > 0
    ? Math.floor(opts!.preview_chars as number)
    : DEFAULT_PREVIEW_CHARS;
  const currentMaxMessageId = (db.prepare(
    "SELECT COALESCE(MAX(id), 0) AS max_id FROM messages WHERE space = ?"
  ).get(space) as { max_id: number }).max_id;

  db.prepare(`
    INSERT INTO space_subscriptions (space, agent, preview_chars, since_message_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(space, agent) DO UPDATE SET preview_chars = excluded.preview_chars
  `).run(space, agent, previewChars, currentMaxMessageId);

  return db.prepare(
    "SELECT space, agent, created_at, preview_chars, since_message_id FROM space_subscriptions WHERE space = ? AND agent = ?"
  ).get(space, agent) as SpaceNotificationSubscription;
}

export function unsubscribeFromSpaceNotifications(space: string, agent: string): boolean {
  const db = getDb();
  const result = db.prepare(
    "DELETE FROM space_subscriptions WHERE space = ? AND agent = ?"
  ).run(space, agent);
  return result.changes > 0;
}

export function listSpaceNotificationSubscriptions(agent?: string): SpaceNotificationSubscription[] {
  const db = getDb();
  if (agent) {
    return db.prepare(
      "SELECT space, agent, created_at, preview_chars, since_message_id FROM space_subscriptions WHERE agent = ? ORDER BY created_at ASC, space ASC"
    ).all(agent) as SpaceNotificationSubscription[];
  }

  return db.prepare(
    "SELECT space, agent, created_at, preview_chars, since_message_id FROM space_subscriptions ORDER BY agent ASC, space ASC"
  ).all() as SpaceNotificationSubscription[];
}

export function getSubscribedSpaces(agent: string): string[] {
  return listSpaceNotificationSubscriptions(agent).map((row) => row.space);
}

export interface ReadSpaceNotificationsOptions {
  agent: string;
  space?: string;
  unread_only?: boolean;
  limit?: number;
  since?: string;
  mark_read?: boolean;
}

export function readSpaceNotifications(opts: ReadSpaceNotificationsOptions): SpaceNotification[] {
  const db = getDb();
  const conditions: string[] = [
    "s.agent = ?",
    "m.space IS NOT NULL",
    "m.from_agent != ?",
    "m.id > s.since_message_id",
  ];
  const params: (string | number)[] = [opts.agent, opts.agent];

  if (opts.space) {
    conditions.push("m.space = ?");
    params.push(opts.space);
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
      m.space,
      m.from_agent,
      m.created_at,
      m.priority,
      m.content,
      m.attachments,
      s.preview_chars,
      snr.message_id AS read_message_id
    FROM messages m
    INNER JOIN space_subscriptions s
      ON s.space = m.space
    LEFT JOIN space_notification_reads snr
      ON snr.message_id = m.id AND snr.agent = s.agent
    WHERE ${conditions.join(" AND ")}
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT ${Math.max(1, Math.min(limit, 500))}
  `).all(...params) as Array<{
    message_id: number;
    space: string;
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
    space: row.space,
    from_agent: row.from_agent,
    created_at: row.created_at,
    priority: row.priority,
    preview: buildMessagePreview(row.content, row.preview_chars),
    unread: row.read_message_id == null,
    has_attachments: !!row.attachments && row.attachments !== "[]",
  })) satisfies SpaceNotification[];

  if (opts.mark_read && notifications.length > 0) {
    markSpaceNotificationsRead(opts.agent, notifications.map((row) => row.message_id));
    for (const row of notifications) row.unread = false;
  }

  return notifications;
}

export function markSpaceNotificationsRead(agent: string, messageIds: number[]): number {
  if (messageIds.length === 0) return 0;
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO space_notification_reads (agent, message_id)
    VALUES (?, ?)
  `);

  let count = 0;
  for (const id of messageIds) {
    const result = insert.run(agent, id);
    count += result.changes;
  }
  return count;
}

export function markAllSpaceNotificationsRead(agent: string, space?: string): number {
  const unread = readSpaceNotifications({ agent, space, unread_only: true, limit: 10000 });
  return markSpaceNotificationsRead(agent, unread.map((row) => row.message_id));
}
