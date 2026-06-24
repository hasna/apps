import { getDb } from "./db.js";
import { normalizeChannelName } from "./channel-names.js";
import type { Channel, ChannelInfo, ChannelMember } from "../types.js";

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseChannel(row: Record<string, unknown>): Channel {
  return {
    name: row.name as string,
    description: (row.description as string) || null,
    topic: (row.topic as string) || null,
    project_id: (row.project_id as string) || null,
    created_by: row.created_by as string,
    created_at: row.created_at as string,
    archived_at: (row.archived_at as string) || null,
    metadata: parseJsonObject(row.metadata),
    tags: parseJsonArray(row.tags),
  };
}

function parseChannelInfo(row: Record<string, unknown>): ChannelInfo {
  return {
    ...parseChannel(row),
    member_count: row.member_count as number,
    message_count: row.message_count as number,
  };
}

export function createChannel(
  name: string,
  createdBy: string,
  options?: { description?: string; topic?: string; project_id?: string; metadata?: Record<string, unknown>; tags?: string[] },
): Channel {
  const db = getDb();
  const channelName = normalizeChannelName(name);

  if (options?.project_id) {
    const projectExists = db.prepare("SELECT id FROM projects WHERE id = ?").get(options.project_id);
    if (!projectExists) {
      throw new Error(`Project not found: ${options.project_id}`);
    }
  }

  const row = db.prepare(`
    INSERT INTO channels (name, description, topic, project_id, created_by, metadata, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    channelName,
    options?.description || null,
    options?.topic || null,
    options?.project_id || null,
    createdBy,
    options?.metadata ? JSON.stringify(options.metadata) : null,
    options?.tags ? JSON.stringify(options.tags) : null,
  ) as Record<string, unknown>;

  db.prepare(
    "INSERT OR IGNORE INTO channel_members (channel, agent) VALUES (?, ?)"
  ).run(channelName, createdBy);

  return parseChannel(row);
}

export function listChannels(options?: {
  project_id?: string;
  include_archived?: boolean;
  tag?: string;
}): ChannelInfo[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: string[] = [];

  if (options?.project_id) {
    conditions.push("c.project_id = ?");
    params.push(options.project_id);
  }
  if (options?.tag) {
    conditions.push("c.tags LIKE ?");
    params.push(`%"${options.tag}"%`);
  }
  if (!options?.include_archived) {
    conditions.push("c.archived_at IS NULL");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db.prepare(`
    SELECT
      c.*,
      (SELECT COUNT(*) FROM channel_members WHERE channel = c.name) AS member_count,
      (SELECT COUNT(*) FROM messages WHERE channel = c.name) AS message_count
    FROM channels c
    ${where}
    ORDER BY c.name ASC
  `).all(...params) as Record<string, unknown>[];

  return rows.map(parseChannelInfo);
}

export function getChannel(name: string): ChannelInfo | null {
  const db = getDb();
  const channelName = normalizeChannelName(name);
  const row = db.prepare(`
    SELECT
      c.*,
      (SELECT COUNT(*) FROM channel_members WHERE channel = c.name) AS member_count,
      (SELECT COUNT(*) FROM messages WHERE channel = c.name) AS message_count
    FROM channels c
    WHERE c.name = ?
  `).get(channelName) as Record<string, unknown> | null;
  return row ? parseChannelInfo(row) : null;
}

export function joinChannel(channelName: string, agent: string): boolean {
  const db = getDb();
  const normalized = normalizeChannelName(channelName);
  const channel = db.prepare("SELECT name FROM channels WHERE name = ?").get(normalized);
  if (!channel) return false;

  db.prepare(
    "INSERT OR IGNORE INTO channel_members (channel, agent) VALUES (?, ?)"
  ).run(normalized, agent);
  return true;
}

export function leaveChannel(channelName: string, agent: string): boolean {
  const db = getDb();
  const result = db.prepare(
    "DELETE FROM channel_members WHERE channel = ? AND agent = ?"
  ).run(normalizeChannelName(channelName), agent);
  return result.changes > 0;
}

export function getChannelMembers(channelName: string): ChannelMember[] {
  const db = getDb();
  return db.prepare(
    "SELECT channel, agent, joined_at FROM channel_members WHERE channel = ? ORDER BY joined_at ASC"
  ).all(normalizeChannelName(channelName)) as ChannelMember[];
}

export function updateChannel(name: string, updates: {
  description?: string | null;
  topic?: string | null;
  project_id?: string | null;
  metadata?: Record<string, unknown> | null;
  tags?: string[] | null;
}): Channel {
  const db = getDb();
  const channelName = normalizeChannelName(name);

  const existing = db.prepare("SELECT * FROM channels WHERE name = ?").get(channelName) as Record<string, unknown> | null;
  if (!existing) {
    throw new Error(`Channel not found: ${channelName}`);
  }

  if (updates.project_id !== undefined && updates.project_id !== null) {
    const projectExists = db.prepare("SELECT id FROM projects WHERE id = ?").get(updates.project_id);
    if (!projectExists) {
      throw new Error(`Project not found: ${updates.project_id}`);
    }
  }

  const sets: string[] = [];
  const params: (string | null)[] = [];

  if (updates.description !== undefined) {
    sets.push("description = ?");
    params.push(updates.description);
  }
  if (updates.topic !== undefined) {
    sets.push("topic = ?");
    params.push(updates.topic);
  }
  if (updates.project_id !== undefined) {
    sets.push("project_id = ?");
    params.push(updates.project_id);
  }
  if (updates.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(updates.metadata ? JSON.stringify(updates.metadata) : null);
  }
  if (updates.tags !== undefined) {
    sets.push("tags = ?");
    params.push(updates.tags ? JSON.stringify(updates.tags) : null);
  }

  if (sets.length === 0) {
    return parseChannel(existing);
  }

  params.push(channelName);
  const row = db.prepare(
    `UPDATE channels SET ${sets.join(", ")} WHERE name = ? RETURNING *`
  ).get(...params) as Record<string, unknown>;

  return parseChannel(row);
}

export function archiveChannel(name: string): Channel {
  const db = getDb();
  const channelName = normalizeChannelName(name);
  const row = db.prepare(
    "UPDATE channels SET archived_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE name = ? RETURNING *"
  ).get(channelName) as Record<string, unknown> | null;
  if (!row) {
    throw new Error(`Channel not found: ${channelName}`);
  }
  return parseChannel(row);
}

export function unarchiveChannel(name: string): Channel {
  const db = getDb();
  const channelName = normalizeChannelName(name);
  const row = db.prepare(
    "UPDATE channels SET archived_at = NULL WHERE name = ? RETURNING *"
  ).get(channelName) as Record<string, unknown> | null;
  if (!row) {
    throw new Error(`Channel not found: ${channelName}`);
  }
  return parseChannel(row);
}

export function isChannelMember(channelName: string, agent: string): boolean {
  const db = getDb();
  const row = db.prepare(
    "SELECT 1 FROM channel_members WHERE channel = ? AND agent = ?"
  ).get(normalizeChannelName(channelName), agent);
  return !!row;
}
