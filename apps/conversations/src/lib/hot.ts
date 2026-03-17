import { getDb } from "./db.js";

export interface HotSession {
  session_id: string;
  participants: string[];
  space: string | null;
  last_message_at: string;
  message_count: number;
  hotness_score: number;
  metrics: {
    msgs_last_1h: number;
    msgs_last_24h: number;
    unique_agents: number;
    reaction_count: number;
    reply_count: number;
    high_priority_count: number;
    blocker_count: number;
    hours_since_last: number;
  };
}

export interface HotSessionsOptions {
  limit?: number;
  min_score?: number;
  space?: string;
  project_id?: string;
}

export function computeHotness(sessionId: string): HotSession | null {
  const db = getDb();

  const base = db.prepare(`
    SELECT session_id,
      GROUP_CONCAT(DISTINCT from_agent) as agents,
      MAX(space) as space,
      MAX(created_at) as last_message_at,
      COUNT(*) as message_count
    FROM messages WHERE session_id = ?
    GROUP BY session_id
  `).get(sessionId) as { session_id: string; agents: string; space: string | null; last_message_at: string; message_count: number } | null;

  if (!base) return null;

  const msgsLast1h = (db.prepare(
    "SELECT COUNT(*) as c FROM messages WHERE session_id = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%f', 'now', '-1 hour')"
  ).get(sessionId) as { c: number }).c;

  const msgsLast24h = (db.prepare(
    "SELECT COUNT(*) as c FROM messages WHERE session_id = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%f', 'now', '-24 hours')"
  ).get(sessionId) as { c: number }).c;

  const uniqueAgents = (db.prepare(
    "SELECT COUNT(DISTINCT from_agent) as c FROM messages WHERE session_id = ?"
  ).get(sessionId) as { c: number }).c;

  const reactionCount = (db.prepare(
    "SELECT COUNT(*) as c FROM reactions r JOIN messages m ON r.message_id = m.id WHERE m.session_id = ?"
  ).get(sessionId) as { c: number }).c;

  const replyCount = (db.prepare(
    "SELECT COUNT(*) as c FROM messages WHERE session_id = ? AND reply_to IS NOT NULL"
  ).get(sessionId) as { c: number }).c;

  const highPriorityCount = (db.prepare(
    "SELECT COUNT(*) as c FROM messages WHERE session_id = ? AND priority IN ('high', 'urgent')"
  ).get(sessionId) as { c: number }).c;

  const blockerCount = (db.prepare(
    "SELECT COUNT(*) as c FROM messages WHERE session_id = ? AND blocking = 1"
  ).get(sessionId) as { c: number }).c;

  const lastMsgMs = new Date(base.last_message_at + "Z").getTime();
  const hoursSinceLast = Math.max(0, (Date.now() - lastMsgMs) / 3_600_000);

  const hotness_score = Math.round(
    (msgsLast1h * 3) +
    (uniqueAgents * 5) +
    (reactionCount * 2) +
    (replyCount * 4) +
    (highPriorityCount * 10) +
    (blockerCount * 20) -
    (hoursSinceLast * 2)
  );

  return {
    session_id: base.session_id,
    participants: base.agents.split(","),
    space: base.space,
    last_message_at: base.last_message_at,
    message_count: base.message_count,
    hotness_score,
    metrics: {
      msgs_last_1h: msgsLast1h,
      msgs_last_24h: msgsLast24h,
      unique_agents: uniqueAgents,
      reaction_count: reactionCount,
      reply_count: replyCount,
      high_priority_count: highPriorityCount,
      blocker_count: blockerCount,
      hours_since_last: Math.round(hoursSinceLast * 10) / 10,
    },
  };
}

export function listHotSessions(opts?: HotSessionsOptions): HotSession[] {
  const db = getDb();
  const limit = opts?.limit ?? 20;
  const minScore = opts?.min_score ?? 0;

  let where = "";
  const params: string[] = [];
  if (opts?.space) { where = " WHERE space = ?"; params.push(opts.space); }
  else if (opts?.project_id) { where = " WHERE project_id = ?"; params.push(opts.project_id); }

  const sessions = db.prepare(
    `SELECT session_id, MAX(created_at) as last_at FROM messages${where} GROUP BY session_id ORDER BY last_at DESC LIMIT 100`
  ).all(...params) as { session_id: string }[];

  const hotSessions: HotSession[] = [];
  for (const { session_id } of sessions) {
    const hot = computeHotness(session_id);
    if (hot && hot.hotness_score >= minScore) {
      hotSessions.push(hot);
    }
  }

  hotSessions.sort((a, b) => b.hotness_score - a.hotness_score);
  return hotSessions.slice(0, limit);
}
