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
import { getStore } from "../lib/store/index.js";
import { closeDb } from "../lib/db.js";
import { resolveIdentity } from "../lib/identity.js";
import { printLine } from "../lib/stdout.js";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  printLine("conversations-hook: Claude Code PreToolUse hook for blocking messages.\n\nUsage: conversations-hook\n\nReads HASNA_CONVERSATIONS_AGENT_ID (legacy CONVERSATIONS_AGENT_ID) to identify the agent. Exits 0 and stays silent\nwhen no identity is declared, since it runs before every tool call.\nOutputs blocking messages to stdout and exits 0.");
  process.exit(0);
}

// A session that never declared an identity has no inbox of its own, and this
// hook must not be the thing that says so: it runs before EVERY tool call, and
// its contract is to always exit 0 (see above — a non-zero exit here deadlocks
// the agent). Guessing an identity is what corrupted attribution in the first
// place, but reading somebody else's blockers is a read, not a write, so the
// safe degradation is to stay quiet and let the first identity-scoped WRITE
// (send/register/whoami) raise the error where it can actually be acted on.
let agent: string;
try {
  agent = resolveIdentity();
} catch {
  process.exit(0);
}

// Routed through the Store: local sqlite or the HTTP API.
const blockers = await getStore().getUnreadBlockers(agent, { limit: 10 });

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

printLine(`BLOCKING MESSAGES — You have ${blockers.length} unread blocker(s). You MUST acknowledge them by calling mark_read with IDs [${ids.join(", ")}] BEFORE doing any other work.\n\n${details}`);
