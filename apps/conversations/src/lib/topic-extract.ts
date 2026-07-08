// ── Pure topic extraction ────────────────────────────────────────────────────
//
// Storage-agnostic keyword extraction shared by the local store (topics.ts,
// summary.ts) and the self_hosted/cloud API server (src/server/api.ts). Kept in
// its own module with NO database import so the server can reuse the identical
// algorithm without pulling in bun:sqlite. This is the single source of truth
// for topic weighting across both transports.

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

export { STOPWORDS };

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
