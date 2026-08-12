import { getDb } from "./db.js";
import { extractTopics, type TopicWeight } from "./topic-extract.js";
import { boundedPreviewSourceSql, restrictedCollectionSqlPredicate } from "./message-previews.js";
import { redactSensitiveText } from "./content-safety.js";

/**
 * Build the extractor's corpus from bounded, redacted, unrestricted rows only.
 *
 * These queries used to select whole `content`. A topic list is the body
 * sampled — every term in it appeared in some message — so extracting over a
 * restricted incident/security row publishes that row one weighted word at a
 * time, and extracting over an unbounded body lets text far past the shared
 * preview scan window decide what the channel is "about". The SQL drops
 * restricted rows outright; `preview_source` bounds what remains.
 */
function corpusFrom(rows: Array<{ preview_source: string | null }>): string {
  return rows.map((row) => redactSensitiveText(row.preview_source ?? "")).join("\n");
}

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
    `SELECT ${boundedPreviewSourceSql()} FROM messages
     WHERE channel = ? ${sinceClause} AND NOT ${restrictedCollectionSqlPredicate()}
     ORDER BY created_at DESC LIMIT ${limit}`
  ).all(...params) as { preview_source: string }[];

  return extractTopics(corpusFrom(rows), 15);
}

/**
 * Get topics for a session by aggregating all messages.
 */
export function getSessionTopics(sessionId: string, opts?: { limit?: number }): TopicWeight[] {
  const db = getDb();
  const limit = opts?.limit ?? 100;

  const rows = db.prepare(
    `SELECT ${boundedPreviewSourceSql()} FROM messages
     WHERE session_id = ? AND NOT ${restrictedCollectionSqlPredicate()}
     ORDER BY created_at DESC LIMIT ${limit}`
  ).all(sessionId) as { preview_source: string }[];

  return extractTopics(corpusFrom(rows), 15);
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
    `SELECT ${boundedPreviewSourceSql()} FROM messages ${where} AND NOT ${restrictedCollectionSqlPredicate()}
     ORDER BY created_at DESC LIMIT 500`
  ).all(...params) as { preview_source: string }[];

  return extractTopics(corpusFrom(rows), topN);
}
