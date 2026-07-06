import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthorizationContext } from "../../services/authorization.js";
import { registerOpTools } from "./shared.js";

export function registerTokenTools(server: McpServer, ctx?: AuthorizationContext): void {
  registerOpTools(server, [
    { name: "issue_token", op: "token.issue", summary: "Issue an MCP bearer token for an identity (access is the cohort issuer)", write: true, schema: { identity_id: z.string(), scopes: z.array(z.string()).optional(), entity_ids: z.array(z.string()).optional(), credential_id: z.string().optional(), ttl_minutes: z.number().optional() } },
    { name: "verify_token", op: "token.verify", summary: "Verify an MCP bearer token", write: false, schema: { token: z.string() } },
    { name: "get_token", op: "token.get", summary: "Get an issued token record by id", write: false, schema: { id: z.string() } },
    { name: "list_tokens", op: "token.list", summary: "List issued tokens", write: false, schema: { identity_id: z.string().optional(), entity_id: z.string().optional(), status: z.enum(["active", "revoked"]).optional(), limit: z.number().optional() } },
    { name: "revoke_token", op: "token.revoke", summary: "Revoke an issued token", write: true, schema: { id: z.string(), reason: z.string().optional() } },
  ], ctx);
}
