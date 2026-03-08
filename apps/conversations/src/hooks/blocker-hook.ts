#!/usr/bin/env bun
/**
 * Claude Code PreToolUse hook for blocking messages.
 * Checks for unread blocking messages and blocks tool use if any exist.
 * Designed to be fast: single indexed SQLite query, minimal imports.
 *
 * Exit codes:
 *   0 = no blockers, proceed
 *   2 = blockers found, stderr fed to Claude as blocking error
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

const lines = blockers.map((b) => {
  const where = b.space ? `in #${b.space}` : "via DM";
  return `[BLOCKER #${b.id}] ${b.from_agent} ${where}: ${b.content}`;
});

console.error(`⚠ You have ${blockers.length} blocking message(s) that require acknowledgment:\n`);
for (const line of lines) {
  console.error(line);
}
console.error(`\nUse mark_read to acknowledge these messages before continuing.`);
console.error(`Message IDs: ${blockers.map((b) => b.id).join(", ")}`);

process.exit(2);
