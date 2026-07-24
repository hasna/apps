import { getDb } from "./db.js";

/**
 * Save a feedback entry to the local `feedback` table. Feedback is a local-only
 * convenience surface (there is no cross-machine feedback transport), so it lives
 * here alongside the other domain helpers — the only sanctioned layer that opens
 * `bun:sqlite`. It never connects to any remote database or DSN.
 */
export function saveFeedback(message: string, email?: string): { id: string; sent: false; error: string } {
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
