import { hostname } from "node:os";
import { getDatabase } from "./database.js";

export interface LocalFeedbackInput {
  message: string;
  email?: string | null;
  category?: string | null;
  version?: string | null;
  machine_id?: string | null;
}

export interface LocalFeedbackResult {
  id: string;
  saved: true;
  sent: false;
  mode: "local";
}

export function saveLocalFeedback(input: LocalFeedbackInput): LocalFeedbackResult {
  const id = crypto.randomUUID();
  const db = getDatabase();
  db.run(
    `INSERT INTO feedback (id, message, email, category, version, machine_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.message,
      input.email ?? null,
      input.category ?? "general",
      input.version ?? null,
      input.machine_id ?? hostname(),
      new Date().toISOString(),
    ]
  );
  return { id, saved: true, sent: false, mode: "local" };
}
