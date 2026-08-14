import { getDb } from "./database.js";

export interface FeedbackInput {
  message: string;
  email?: string;
  category?: string;
  version: string;
}

/** Persist a feedback record (on-box SQLite). */
export function recordFeedback(input: FeedbackInput): void {
  getDb().run(
    "INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)",
    [input.message, input.email ?? null, input.category ?? "general", input.version],
  );
}
