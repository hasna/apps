import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthorizationContext } from "../../services/authorization.js";
import { registerOpTools } from "./shared.js";

export function registerReviewTools(server: McpServer, ctx?: AuthorizationContext): void {
  registerOpTools(server, [
    { name: "schedule_review", op: "review.schedule", summary: "Schedule an access recertification review", write: true, schema: { entity_id: z.string(), name: z.string(), scheduled_at: z.string().optional(), due_at: z.string().optional(), scope_filter: z.string().optional() } },
    { name: "get_review", op: "review.get", summary: "Get an access review by id", write: false, schema: { id: z.string() } },
    { name: "list_reviews", op: "review.list", summary: "List access reviews", write: false, schema: { entity_id: z.string().optional(), status: z.enum(["scheduled", "in_progress", "completed", "cancelled"]).optional(), limit: z.number().optional() } },
    { name: "start_review", op: "review.start", summary: "Start an access review", write: true, schema: { id: z.string() } },
    { name: "complete_review", op: "review.complete", summary: "Complete an access review", write: true, schema: { id: z.string(), completed_by: z.string().optional() } },
    { name: "cancel_review", op: "review.cancel", summary: "Cancel an access review", write: true, schema: { id: z.string() } },
  ], ctx);
}
