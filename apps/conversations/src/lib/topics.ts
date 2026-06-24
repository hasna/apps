import { getDb } from "./db.js";

// Common English stopwords to filter out
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of",
  "with", "by", "from", "is", "it", "this", "that", "are", "was", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "shall", "can", "need", "not", "no", "so",
  "if", "then", "than", "too", "very", "just", "about", "up", "out", "all",
  "also", "as", "into", "only", "other", "each", "every", "both", "few", "more",
  "most", "some", "such", "any", "over", "after", "before", "between", "under",
  "above", "here", "there", "when", "where", "how", "what", "which", "who",
  "whom", "why", "its", "my", "your", "his", "her", "our", "their", "we",
  "you", "he", "she", "they", "i", "me", "him", "us", "them",
  "now", "new", "get", "got", "go", "going", "done", "make", "made", "see",
  "know", "think", "want", "one", "two", "like", "still", "back", "even",
]);

export interface TopicWeight {
  topic: string;
  weight: number;
  count: number;
}

/**
 * Extract weighted topics from a text string using TF-style keyword extraction.
 * Filters stopwords, short words, and markdown syntax.
 */
export function extractTopics(text: string, topN: number = 10): TopicWeight[] {
  // Strip markdown syntax, URLs, code blocks
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#*_~|>\[\](){}]/g, " ")
    .replace(/\d+/g, " ")
    .toLowerCase();

  const words = cleaned.split(/\s+/).filter((w) =>
    w.length >= 3 && !STOPWORDS.has(w) && /^[a-z]/.test(w)
  );

  // Count frequencies
  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) || 0) + 1);
  }

  // Sort by frequency, return top N
  const totalWords = words.length || 1;
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([topic, count]) => ({
      topic,
      weight: Math.round((count / totalWords) * 1000) / 1000,
      count,
    }));
}

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
