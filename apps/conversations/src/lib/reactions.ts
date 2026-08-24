import { getDb } from "./db.js";
import { assertNoSensitiveContent, redactSensitiveText } from "./content-safety.js";
import type { Reaction, ReactionSummary, ReactionToggleResult } from "../types.js";

export type { Reaction, ReactionSummary, ReactionToggleResult };

/**
 * Thrown when a reaction operation targets a message ID that does not exist.
 * Consumers (CLI, server, MCP) can map this to a clean not-found response
 * instead of leaking a raw DB/foreign-key error as an HTTP 500.
 */
export class MessageNotFoundError extends Error {
  readonly messageId: number;
  constructor(messageId: number) {
    super(`Message #${messageId} not found.`);
    this.name = "MessageNotFoundError";
    this.messageId = messageId;
  }
}

/**
 * Canonical emoji form for storage: the exact Unicode sequence, NFKC-normalized
 * so composed/decomposed spellings (and any other NFKC-equivalent variants)
 * dedupe to a single row under the UNIQUE(message_id, agent, emoji) key.
 */
export function normalizeEmoji(emoji: string): string {
  return emoji.normalize("NFKC");
}

/**
 * Slack-style toggle: adding an emoji the SAME actor already added for this
 * message removes it. Implemented as an atomic INSERT ... ON CONFLICT DO
 * NOTHING RETURNING the row; when the unique key collides no row comes back and
 * the existing row is deleted instead. A counter-only model cannot do this and
 * the {emoji, count, agents[]} summary is derived by GROUP BY, so the actor-row
 * table is the correct shape (no denormalized counter to drift).
 */
export function toggleReaction(messageId: number, agent: string, emoji: string): ReactionToggleResult {
  const db = getDb();
  const norm = normalizeEmoji(emoji);
  // Content-safety gate at the STORE boundary, mirroring the message-content
  // assert on the send path: a credential-shaped/token-shaped string must never
  // be stored in the emoji field, where the hosted read path would otherwise
  // serve it verbatim (P1: hosted-redaction bypass, same class as fcd097bb).
  assertNoSensitiveContent(norm, "Reaction emoji");
  const exists = db.prepare("SELECT 1 FROM messages WHERE id = ?").get(messageId);
  if (!exists) {
    throw new MessageNotFoundError(messageId);
  }
  const stmt = db.prepare(`
    INSERT INTO reactions (message_id, agent, emoji)
    VALUES (?, ?, ?)
    ON CONFLICT (message_id, agent, emoji) DO NOTHING
    RETURNING *
  `);
  const row = stmt.get(messageId, agent, norm) as Reaction | undefined;
  if (row) {
    return { toggled: "added", reaction: row };
  }
  db.prepare("DELETE FROM reactions WHERE message_id = ? AND agent = ? AND emoji = ?")
    .run(messageId, agent, norm);
  return { toggled: "removed", reaction: null };
}

/**
 * Store-contract name for {@link toggleReaction}: kept so existing call sites
 * (MCP tools, api-store, analytics CLI) read as "add a reaction" while the
 * operation is a true toggle.
 */
export const addReaction = toggleReaction;

/**
 * Explicit, idempotent removal for agent-driven cleanup. Returns true only when
 * a row was actually deleted (404-equivalent for the HTTP surface).
 */
export function removeReaction(messageId: number, agent: string, emoji: string): boolean {
  const db = getDb();
  const norm = normalizeEmoji(emoji);
  const result = db.prepare("DELETE FROM reactions WHERE message_id = ? AND agent = ? AND emoji = ?")
    .run(messageId, agent, norm);
  return result.changes > 0;
}

export function getReactions(messageId: number): Reaction[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM reactions WHERE message_id = ? ORDER BY created_at ASC, id ASC"
  ).all(messageId) as Reaction[];
  // Defense-in-depth on the read path: redact a stored emoji that somehow
  // survived the write gate before it reaches any reader.
  return rows.map((row) => ({ ...row, emoji: redactSensitiveText(row.emoji) }));
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
    emoji: redactSensitiveText(row.emoji),
    count: row.count,
    agents: row.agents.split(","),
  }));
}

/**
 * Grouped summaries for MANY message ids in ONE query — the envelope helper for
 * read/digest/show, so a page of messages never pays a query per message.
 */
export function getReactionSummariesForMessages(messageIds: number[]): Map<number, ReactionSummary[]> {
  const db = getDb();
  const map = new Map<number, ReactionSummary[]>();
  if (messageIds.length === 0) return map;
  const placeholders = messageIds.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT message_id, emoji, GROUP_CONCAT(agent) as agents, COUNT(*) as count
    FROM reactions
    WHERE message_id IN (${placeholders})
    GROUP BY message_id, emoji
    ORDER BY message_id, count DESC, MIN(created_at) ASC
  `).all(...messageIds) as { message_id: number; emoji: string; agents: string; count: number }[];

  for (const row of rows) {
    const key = Number(row.message_id);
    const list = map.get(key) ?? [];
    list.push({ emoji: redactSensitiveText(String(row.emoji)), count: row.count, agents: String(row.agents).split(",") });
    map.set(key, list);
  }
  return map;
}
