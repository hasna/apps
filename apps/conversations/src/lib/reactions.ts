import { getDb } from "./db.js";
import type { Reaction } from "../types.js";

export function addReaction(messageId: number, agent: string, emoji: string): Reaction {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO reactions (message_id, agent, emoji)
    VALUES (?, ?, ?)
    ON CONFLICT (message_id, agent, emoji) DO UPDATE SET agent = agent
    RETURNING *
  `);
  const row = stmt.get(messageId, agent, emoji) as Reaction;
  return row;
}

export function removeReaction(messageId: number, agent: string, emoji: string): boolean {
  const db = getDb();
  const stmt = db.prepare("DELETE FROM reactions WHERE message_id = ? AND agent = ? AND emoji = ?");
  const result = stmt.run(messageId, agent, emoji);
  return result.changes > 0;
}

export function getReactions(messageId: number): Reaction[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM reactions WHERE message_id = ? ORDER BY created_at ASC, id ASC"
  ).all(messageId) as Reaction[];
  return rows;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  agents: string[];
}

export function getReactionSummary(messageId: number): ReactionSummary[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT emoji, GROUP_CONCAT(agent) as agents, COUNT(*) as count
    FROM reactions
    WHERE message_id = ?
    GROUP BY emoji
    ORDER BY count DESC, MIN(created_at) ASC
  `).all(messageId) as { emoji: string; agents: string; count: number }[];

  return rows.map((row) => ({
    emoji: row.emoji,
    count: row.count,
    agents: row.agents.split(","),
  }));
}
