import { getDb } from "./db.js";
import type { Channel, ChannelInfo, ChannelMember } from "../types.js";

export function createChannel(name: string, createdBy: string, description?: string): Channel {
  const db = getDb();
  const row = db.prepare(
    "INSERT INTO channels (name, description, created_by) VALUES (?, ?, ?) RETURNING *"
  ).get(name, description || null, createdBy) as Channel;

  // Auto-join creator
  db.prepare(
    "INSERT OR IGNORE INTO channel_members (channel, agent) VALUES (?, ?)"
  ).run(name, createdBy);

  return row;
}

export function listChannels(): ChannelInfo[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      c.name,
      c.description,
      c.created_by,
      c.created_at,
      (SELECT COUNT(*) FROM channel_members WHERE channel = c.name) AS member_count,
      (SELECT COUNT(*) FROM messages WHERE channel = c.name) AS message_count
    FROM channels c
    ORDER BY c.name ASC
  `).all() as ChannelInfo[];
  return rows;
}

export function getChannel(name: string): ChannelInfo | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      c.name,
      c.description,
      c.created_by,
      c.created_at,
      (SELECT COUNT(*) FROM channel_members WHERE channel = c.name) AS member_count,
      (SELECT COUNT(*) FROM messages WHERE channel = c.name) AS message_count
    FROM channels c
    WHERE c.name = ?
  `).get(name) as ChannelInfo | null;
  return row;
}

export function joinChannel(channelName: string, agent: string): boolean {
  const db = getDb();
  const channel = db.prepare("SELECT name FROM channels WHERE name = ?").get(channelName);
  if (!channel) return false;

  db.prepare(
    "INSERT OR IGNORE INTO channel_members (channel, agent) VALUES (?, ?)"
  ).run(channelName, agent);
  return true;
}

export function leaveChannel(channelName: string, agent: string): boolean {
  const db = getDb();
  const result = db.prepare(
    "DELETE FROM channel_members WHERE channel = ? AND agent = ?"
  ).run(channelName, agent);
  return result.changes > 0;
}

export function getChannelMembers(channelName: string): ChannelMember[] {
  const db = getDb();
  return db.prepare(
    "SELECT channel, agent, joined_at FROM channel_members WHERE channel = ? ORDER BY joined_at ASC"
  ).all(channelName) as ChannelMember[];
}

export function isChannelMember(channelName: string, agent: string): boolean {
  const db = getDb();
  const row = db.prepare(
    "SELECT 1 FROM channel_members WHERE channel = ? AND agent = ?"
  ).get(channelName, agent);
  return !!row;
}
