import { getDb } from "./db.js";

/**
 * Save a feedback entry to the on-box `feedback` table.
 *
 * Feedback is a Store surface like any other (owner campaign: every command and
 * tool works in every transport — hosted API or on-box store). The LOCAL
 * implementation writes the row the same day the MCP tool used to, through the
 * same `bun:sqlite` bound helpers; the hosted transport writes the same row
 * through `POST /v1/feedback` (ApiStore). Nothing here opens the on-box store
 * for a run that did not ask for it by name — the store routing in
 * `getStore()` decides which transport runs, and the fail-closed rule still
 * holds: no credential and no store path is a config refusal, and a hosted run
 * reaches the hosted feedback route instead of silently growing
 * `~/.hasna/conversations/messages.db`.
 */
export interface SaveFeedbackInput {
  message: string;
  email?: string | null;
  category?: string | null;
}

export interface SaveFeedbackResult {
  id: string;
  sent: boolean;
  error: string | null;
}

export function saveFeedbackLocal(input: SaveFeedbackInput): SaveFeedbackResult {
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO feedback (id, message, email, category, version) VALUES (?, ?, ?, ?, ?)").run(
    id,
    input.message,
    input.email ?? null,
    input.category ?? "general",
    null,
  );
  return { id, sent: true, error: null };
}