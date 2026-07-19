import { getDb } from "./db.js";
import { extractTopics, type TopicWeight } from "./topic-extract.js";
import {
  COLLECTION_PREVIEW_SCAN_CHARS,
  RESTRICTED_COLLECTION_SQL_PREDICATE,
  redactSensitiveText,
  resolveCollectionLimit,
} from "./message-previews.js";

// Topic extraction is storage-agnostic and lives in ./topic-extract.js so the
// self_hosted/cloud API server can reuse the identical algorithm without a
// sqlite import. Re-exported here for existing callers.
export { extractTopics, type TopicWeight };

function projectedTopicText(where: string, params: Array<string | number>, limit: unknown): string {
  const rows = getDb().prepare(
    `SELECT CASE WHEN ${RESTRICTED_COLLECTION_SQL_PREDICATE} THEN '' ELSE substr(content, 1, ${COLLECTION_PREVIEW_SCAN_CHARS}) END AS preview_source
     FROM messages ${where} ORDER BY created_at DESC LIMIT ?`,
  ).all(...params, resolveCollectionLimit(limit)) as Array<{ preview_source: string }>;
  return rows.map((row) => redactSensitiveText(row.preview_source)).join("\n");
}

/**
 * Get topics for a channel by aggregating recent messages.
 */
export function getChannelTopics(channelName: string, opts?: { limit?: number; since?: string }): TopicWeight[] {
  const sinceClause = opts?.since ? "AND created_at > ?" : "";
  const params: (string | number)[] = [channelName];
  if (opts?.since) params.push(opts.since);
  return extractTopics(projectedTopicText(`WHERE channel = ? ${sinceClause}`, params, opts?.limit ?? 100), 15);
}

/**
 * Get topics for a session by aggregating all messages.
 */
export function getSessionTopics(sessionId: string, opts?: { limit?: number }): TopicWeight[] {
  return extractTopics(projectedTopicText("WHERE session_id = ?", [sessionId], opts?.limit ?? 100), 15);
}

/**
 * Get trending topics across all channels or a specific project.
 */
export function getTrendingTopics(opts?: { project_id?: string; hours?: number; top_n?: number }): TopicWeight[] {
  const hours = opts?.hours ?? 24;
  const topN = opts?.top_n ?? 20;

  let where = `WHERE created_at > strftime('%Y-%m-%dT%H:%M:%f', 'now', '-${hours} hours')`;
  const params: string[] = [];
  if (opts?.project_id) {
    where += " AND project_id = ?";
    params.push(opts.project_id);
  }

  return extractTopics(projectedTopicText(where, params, 100), Math.min(Math.max(1, topN), 100));
}
