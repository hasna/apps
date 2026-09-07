import { getDb } from "./db.js";
import { requireConversationsLocalStore } from "./store/index.js";

/**
 * Save a feedback entry to the local `feedback` table. Feedback is a local-only
 * convenience surface (there is no cross-machine feedback transport and the
 * hosted API has no feedback route), so it lives here alongside the other
 * domain helpers — the only sanctioned layer that opens `bun:sqlite`. It never
 * connects to any remote database or DSN.
 *
 * LOCAL-ONLY MEANS OPT-IN, NOT A SIDE DOOR. Before this gate the MCP tool
 * called `getDb()` unconditionally, so `send_feedback` on a hosted station —
 * whose every other tool talks to the fleet through `getStore()` — silently
 * created `~/.hasna/conversations/messages.db` (plus WAL/SHM) and wrote into
 * it. Now the on-box store is opened only when the operator asked for it by
 * name (`HASNA_CONVERSATIONS_DB_PATH`), announced once on stderr like every
 * other local run; otherwise this throws {@link ConversationsStoreConfigError}
 * naming the opt-in, and nothing is opened (hasna/apps#1720 validation).
 */
export function saveFeedback(message: string, email?: string): { id: string; sent: false; error: string } {
  requireConversationsLocalStore("send_feedback");
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO feedback (id, message, email, category, version) VALUES (?, ?, ?, ?, ?)").run(
    id,
    message,
    email ?? null,
    "general",
    null,
  );
  return { id, sent: false, error: "Saved locally; remote feedback transport is not configured." };
}
