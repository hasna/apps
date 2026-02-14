import { getDb } from "./db.js";
import type { Session } from "../types.js";

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
