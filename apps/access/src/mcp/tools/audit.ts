import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthorizationContext } from "../../services/authorization.js";
import { registerOpTools } from "./shared.js";

export function registerAuditTools(server: McpServer, ctx?: AuthorizationContext): void {
  registerOpTools(server, [
    { name: "list_audit", op: "audit.list", summary: "List append-only audit events", write: false, schema: { entity_id: z.string().optional(), limit: z.number().optional() } },
    { name: "verify_audit", op: "audit.verify", summary: "Verify the audit hash chain", write: false, schema: {} },
  ], ctx);
}
