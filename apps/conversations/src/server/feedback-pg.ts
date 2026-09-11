// Hosted feedback: `POST /v1/feedback`.
//
// The API-side mirror of the on-box `saveFeedback` row (src/lib/feedback.ts):
// the MCP `send_feedback` tool routes through `getStore()`, so a hosted run
// writes the same row to the app's PostgreSQL store instead of being refused
// or silently growing an on-box file.
import type { TypedQueryClient } from "../generated/storage-kit/query.js";
import type { SaveFeedbackResult } from "../lib/feedback.js";

export interface SaveFeedbackRequestBody {
  message?: unknown;
  email?: unknown;
  category?: unknown;
}

export async function saveFeedbackPg(
  client: TypedQueryClient,
  body: SaveFeedbackRequestBody,
): Promise<SaveFeedbackResult> {
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) throw new Error("message is required");
  const email = typeof body.email === "string" ? body.email : null;
  const category = typeof body.category === "string" && body.category ? body.category : "general";
  const row = await client.one<{ id: string }>(
    `INSERT INTO feedback (id, message, email, category, version)
     VALUES (gen_random_uuid()::text, $1, $2, $3, NULL)
     RETURNING id`,
    [message, email, category],
  );
  return { id: row.id, sent: true, error: null };
}