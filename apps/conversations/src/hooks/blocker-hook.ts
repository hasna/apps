#!/usr/bin/env bun
/**
 * Claude Code PreToolUse hook for blocking messages.
 * Checks for unread blocking messages and warns the agent.
 * Designed to be fast: single indexed SQLite query, minimal imports.
 *
 * Uses exit 0 with stdout output (not exit 2) to avoid deadlocking
 * the agent — it needs tools to acknowledge the blockers.
 * The stdout message acts as a system prompt that compels the agent
 * to acknowledge before continuing with other work.
 *
 * Exit codes:
 *   0 = always (no output if no blockers, JSON warning if blockers found)
 */
import { getDb, closeDb } from "../lib/db.js";
import { resolveIdentity } from "../lib/identity.js";

const agent = resolveIdentity();
const db = getDb();

const blockers = db.prepare(`
  SELECT id, from_agent, content, space, created_at FROM messages
  WHERE blocking = 1 AND read_at IS NULL
  AND (
    to_agent = ?
    OR space IN (SELECT space FROM space_members WHERE agent = ?)
  )
  ORDER BY created_at ASC
  LIMIT 10
`).all(agent, agent) as { id: number; from_agent: string; content: string; space: string | null; created_at: string }[];

closeDb();

if (blockers.length === 0) {
  process.exit(0);
}

// Output as stdout JSON so it appears as a system message.
// Exit 0 to avoid deadlock — agent needs tools to acknowledge.
const ids = blockers.map((b) => b.id);
const details = blockers.map((b) => {
  const where = b.space ? `#${b.space}` : "DM";
  return `[#${b.id}] ${b.from_agent} (${where}): ${b.content}`;
}).join("\n");

console.log(`BLOCKING MESSAGES — You have ${blockers.length} unread blocker(s). You MUST acknowledge them by calling mark_read with IDs [${ids.join(", ")}] BEFORE doing any other work.\n\n${details}`);
