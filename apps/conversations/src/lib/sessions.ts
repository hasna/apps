import { getDb } from "./db.js";
import type { Database } from "./db.js";
import type { Session } from "../types.js";

export interface SessionActivity {
  session_id: string;
  msgs_last_1h: number;
  msgs_last_24h: number;
  unique_agents: number;
  reply_ratio: number;
  avg_priority: string;
  reaction_count: number;
  is_trending: boolean;
}

/**
 * List sessions, optionally filtered to those involving a specific agent.
 * Sessions are derived from messages — no separate sessions table.
 */
export function listSessions(agent?: string): Session[] {
  const db = getDb();

  const agentFilter = agent
    ? "WHERE from_agent = ? OR to_agent = ?"
    : "";
  const params = agent ? [agent, agent] : [];

  const rows = db.prepare(`
    SELECT
      session_id,
      GROUP_CONCAT(DISTINCT from_agent) || ',' || GROUP_CONCAT(DISTINCT to_agent) AS all_agents,
      MAX(created_at) AS last_message_at,
      COUNT(*) AS message_count,
      SUM(CASE WHEN read_at IS NULL ${agent ? "AND to_agent = ?" : ""} THEN 1 ELSE 0 END) AS unread_count
    FROM messages
    ${agentFilter}
    GROUP BY session_id
    ORDER BY last_message_at DESC
  `).all(...params, ...(agent ? [agent] : [])) as Record<string, unknown>[];

  return rows.map((row) => {
    const allAgents = (row.all_agents as string).split(",");
    const participants = [...new Set(allAgents)];
    return {
      session_id: row.session_id as string,
      participants,
      last_message_at: row.last_message_at as string,
      message_count: row.message_count as number,
      unread_count: row.unread_count as number,
    };
  });
}

/**
 * Get a single session by ID.
 */
export function getSession(sessionId: string): Session | null {
  const db = getDb();

  const row = db.prepare(`
    SELECT
      session_id,
      GROUP_CONCAT(DISTINCT from_agent) || ',' || GROUP_CONCAT(DISTINCT to_agent) AS all_agents,
      MAX(created_at) AS last_message_at,
      COUNT(*) AS message_count,
      SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread_count
    FROM messages
    WHERE session_id = ?
    GROUP BY session_id
  `).get(sessionId) as Record<string, unknown> | null;

  if (!row) return null;

  const allAgents = (row.all_agents as string).split(",");
  const participants = [...new Set(allAgents)];

  return {
    session_id: row.session_id as string,
    participants,
    last_message_at: row.last_message_at as string,
    message_count: row.message_count as number,
    unread_count: row.unread_count as number,
  };
}

/**
 * Get activity metrics for a session — velocity, engagement, trending status.
 */
export function getSessionActivity(
  sessionId: string,
  database: Database = getDb(),
): SessionActivity | null {
  const db = database;

  const exists = db.prepare("SELECT 1 FROM messages WHERE session_id = ? LIMIT 1").get(sessionId);
  if (!exists) return null;

  const msgsLast1h = (db.prepare(
    "SELECT COUNT(*) as c FROM messages WHERE session_id = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%f', 'now', '-1 hour')"
  ).get(sessionId) as { c: number }).c;

  const msgsLast24h = (db.prepare(
    "SELECT COUNT(*) as c FROM messages WHERE session_id = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%f', 'now', '-24 hours')"
  ).get(sessionId) as { c: number }).c;

  const uniqueAgents = (db.prepare(
    "SELECT COUNT(DISTINCT from_agent) as c FROM messages WHERE session_id = ?"
  ).get(sessionId) as { c: number }).c;

  const totalMsgs = (db.prepare(
    "SELECT COUNT(*) as c FROM messages WHERE session_id = ?"
  ).get(sessionId) as { c: number }).c;

  const replyCount = (db.prepare(
    "SELECT COUNT(*) as c FROM messages WHERE session_id = ? AND reply_to IS NOT NULL"
  ).get(sessionId) as { c: number }).c;

  const replyRatio = totalMsgs > 0 ? Math.round((replyCount / totalMsgs) * 100) / 100 : 0;

  const priorityRow = db.prepare(
    "SELECT priority, COUNT(*) as c FROM messages WHERE session_id = ? GROUP BY priority ORDER BY c DESC LIMIT 1"
  ).get(sessionId) as { priority: string; c: number } | null;

  const reactionCount = (db.prepare(
    "SELECT COUNT(*) as c FROM reactions r JOIN messages m ON r.message_id = m.id WHERE m.session_id = ?"
  ).get(sessionId) as { c: number }).c;

  // Trending = more than 5 msgs in last hour OR more than 3 unique agents in last hour
  const agentsLast1h = (db.prepare(
    "SELECT COUNT(DISTINCT from_agent) as c FROM messages WHERE session_id = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%f', 'now', '-1 hour')"
  ).get(sessionId) as { c: number }).c;

  const isTrending = msgsLast1h >= 5 || agentsLast1h >= 3;

  return {
    session_id: sessionId,
    msgs_last_1h: msgsLast1h,
    msgs_last_24h: msgsLast24h,
    unique_agents: uniqueAgents,
    reply_ratio: replyRatio,
    avg_priority: priorityRow?.priority ?? "normal",
    reaction_count: reactionCount,
    is_trending: isTrending,
  };
}
