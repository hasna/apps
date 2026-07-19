import { getDb } from "./db.js";
import { extractTopics, type TopicWeight } from "./topics.js";
import { readMessagePreviews } from "./messages.js";

export interface ConversationSummary {
  session_id: string;
  participants: string[];
  message_count: number;
  date_range: { first: string; last: string };
  topics: TopicWeight[];
  key_messages: { id: number; from: string; content: string; reason: string }[];
  unresolved_blockers: { id: number; from: string; content: string; created_at: string }[];
  activity: {
    reply_count: number;
    reaction_count: number;
    avg_priority: string;
  };
}

export interface SummaryOptions {
  limit?: number;
}

/**
 * Generate a structured summary of a conversation (session or channel).
 * Uses message metadata — no LLM needed.
 */
export function getConversationSummary(sessionOrChannel: string, opts?: SummaryOptions): ConversationSummary | null {
  const db = getDb();
  const limit = opts?.limit ?? 50;

  // Detect if this is a channel or session
  const isChannel = sessionOrChannel.startsWith("channel:") || db.prepare("SELECT 1 FROM channels WHERE name = ?").get(sessionOrChannel);
  const filterVal = isChannel && !sessionOrChannel.startsWith("channel:") ? sessionOrChannel : sessionOrChannel;

  const messages = readMessagePreviews({
    ...(isChannel ? { channel: filterVal } : { session_id: filterVal }),
    latest: limit,
    preview_bytes: 320,
  }).messages;

  if (messages.length === 0) return null;

  // Participants
  const agents = new Set<string>();
  for (const m of messages) {
    agents.add(m.from_agent);
    if (m.to_agent) agents.add(m.to_agent);
  }

  // Date range
  const dates = messages.map((m) => m.created_at).sort();
  const dateRange = { first: dates[0], last: dates[dates.length - 1] };

  // Topics
  const allContent = messages.map((m) => m.preview).join("\n");
  const topics = extractTopics(allContent, 10);

  // Key messages: high priority, pinned, most reactions, most replies
  const keyMessages: { id: number; from: string; content: string; reason: string }[] = [];

  // High priority / blocking
  for (const m of messages) {
    const priority = m.priority as string;
    if (priority === "high" || priority === "urgent") {
      keyMessages.push({
        id: m.id,
        from: m.from_agent,
        content: m.preview.slice(0, 200),
        reason: `${priority} priority`,
      });
    }
    if (m.blocking) {
      keyMessages.push({
        id: m.id,
        from: m.from_agent,
        content: m.preview.slice(0, 200),
        reason: "blocking message",
      });
    }
  }

  // Pinned
  for (const m of messages) {
    if (m.pinned_at) {
      keyMessages.push({
        id: m.id,
        from: m.from_agent,
        content: m.preview.slice(0, 200),
        reason: "pinned",
      });
    }
  }

  // Most reacted (top 3)
  const msgIds = messages.map((m) => m.id);
  if (msgIds.length > 0) {
    const placeholders = msgIds.map(() => "?").join(",");
    const reacted = db.prepare(
      `SELECT message_id, COUNT(*) as c FROM reactions WHERE message_id IN (${placeholders}) GROUP BY message_id ORDER BY c DESC LIMIT 3`
    ).all(...msgIds) as { message_id: number; c: number }[];

    for (const r of reacted) {
      const m = messages.find((msg) => msg.id === r.message_id);
      if (m) {
        keyMessages.push({
          id: r.message_id,
          from: m.from_agent,
          content: m.preview.slice(0, 200),
          reason: `${r.c} reaction(s)`,
        });
      }
    }
  }

  // Deduplicate key messages by ID
  const seen = new Set<number>();
  const uniqueKey = keyMessages.filter((k) => {
    if (seen.has(k.id)) return false;
    seen.add(k.id);
    return true;
  }).slice(0, 10);

  // Unresolved blockers
  const blockers = messages
    .filter((m) => m.blocking && m.unread)
    .map((m) => ({
      id: m.id,
      from: m.from_agent,
      content: m.preview.slice(0, 200),
      created_at: m.created_at,
    }));

  // Activity metrics
  const replyCount = messages.filter((m) => m.reply_to).length;
  const reactionCount = msgIds.length > 0
    ? (db.prepare(
        `SELECT COUNT(*) as c FROM reactions WHERE message_id IN (${msgIds.map(() => "?").join(",")})`
      ).get(...msgIds) as { c: number }).c
    : 0;

  const priorityCounts: Record<string, number> = {};
  for (const m of messages) {
    const p = m.priority as string;
    priorityCounts[p] = (priorityCounts[p] || 0) + 1;
  }
  const avgPriority = Object.entries(priorityCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "normal";

  return {
    session_id: sessionOrChannel,
    participants: [...agents].filter((a) => a !== sessionOrChannel),
    message_count: messages.length,
    date_range: dateRange,
    topics,
    key_messages: uniqueKey,
    unresolved_blockers: blockers,
    activity: {
      reply_count: replyCount,
      reaction_count: reactionCount,
      avg_priority: avgPriority,
    },
  };
}
