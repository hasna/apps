import { getDb } from "./db.js";
import { extractTopics, type TopicWeight } from "./topic-extract.js";

// Topic extraction is storage-agnostic and lives in ./topic-extract.js so the
// self_hosted/cloud API server can reuse the identical algorithm without a
// sqlite import. Re-exported here for existing callers.
export { extractTopics, type TopicWeight };

/**
 * Get topics for a channel by aggregating recent messages.
 */
export function getChannelTopics(channelName: string, opts?: { limit?: number; since?: string }): TopicWeight[] {
  const db = getDb();
  const limit = opts?.limit ?? 100;
  const sinceClause = opts?.since ? "AND created_at > ?" : "";
  const params: (string | number)[] = [channelName];
  if (opts?.since) params.push(opts.since);

  const rows = db.prepare(
    `SELECT content FROM messages WHERE channel = ? ${sinceClause} ORDER BY created_at DESC LIMIT ${limit}`
  ).all(...params) as { content: string }[];

  const combined = rows.map((r) => r.content).join("\n");
  return extractTopics(combined, 15);
}

/**
 * Get topics for a session by aggregating all messages.
 */
export function getSessionTopics(sessionId: string, opts?: { limit?: number }): TopicWeight[] {
  const db = getDb();
  const limit = opts?.limit ?? 100;

  const rows = db.prepare(
    `SELECT content FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ${limit}`
  ).all(sessionId) as { content: string }[];

  const combined = rows.map((r) => r.content).join("\n");
  return extractTopics(combined, 15);
}

/**
 * Get trending topics across all channels or a specific project.
 */
export function getTrendingTopics(opts?: { project_id?: string; hours?: number; top_n?: number }): TopicWeight[] {
  const db = getDb();
  const hours = opts?.hours ?? 24;
  const topN = opts?.top_n ?? 20;

  let where = `WHERE created_at > strftime('%Y-%m-%dT%H:%M:%f', 'now', '-${hours} hours')`;
  const params: string[] = [];
  if (opts?.project_id) {
    where += " AND project_id = ?";
    params.push(opts.project_id);
  }

  const rows = db.prepare(
    `SELECT content FROM messages ${where} ORDER BY created_at DESC LIMIT 500`
  ).all(...params) as { content: string }[];

  const combined = rows.map((r) => r.content).join("\n");
  return extractTopics(combined, topN);
}
