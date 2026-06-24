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

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("conversations-hook: Claude Code PreToolUse hook for blocking messages.\n\nUsage: conversations-hook\n\nReads CONVERSATIONS_AGENT_ID or CLAUDE_AGENT_ID env var to identify the agent.\nOutputs blocking messages to stdout and exits 0.");
  process.exit(0);
}

const agent = resolveIdentity();
const db = getDb();

const blockers = db.prepare(`
  SELECT id, from_agent, content, channel, created_at FROM messages
  WHERE blocking = 1 AND read_at IS NULL
  AND (
    to_agent = ?
    OR channel IN (SELECT channel FROM channel_members WHERE agent = ?)
  )
  ORDER BY created_at ASC
  LIMIT 10
`).all(agent, agent) as { id: number; from_agent: string; content: string; channel: string | null; created_at: string }[];

closeDb();

if (blockers.length === 0) {
  process.exit(0);
}

// Output as stdout JSON so it appears as a system message.
// Exit 0 to avoid deadlock — agent needs tools to acknowledge.
const ids = blockers.map((b) => b.id);
const details = blockers.map((b) => {
  const where = b.channel ? `#${b.channel}` : "DM";
  return `[#${b.id}] ${b.from_agent} (${where}): ${b.content}`;
}).join("\n");

console.log(`BLOCKING MESSAGES — You have ${blockers.length} unread blocker(s). You MUST acknowledge them by calling mark_read with IDs [${ids.join(", ")}] BEFORE doing any other work.\n\n${details}`);
