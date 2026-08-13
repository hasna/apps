import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthorizationContext } from "../../services/authorization.js";
import { registerOpTools } from "./shared.js";

export function registerScopeTools(server: McpServer, ctx?: AuthorizationContext): void {
  registerOpTools(server, [
    { name: "grant_scope", op: "scope.grant", summary: "Grant an MCP tool scope to an identity", write: true, schema: { identity_id: z.string(), scope: z.string().describe("MCP tool scope, e.g. wallets:read") } },
    { name: "get_scope", op: "scope.get", summary: "Get a scope grant by id", write: false, schema: { id: z.string() } },
    { name: "list_scopes", op: "scope.list", summary: "List scope grants", write: false, schema: { identity_id: z.string().optional(), entity_id: z.string().optional(), status: z.enum(["granted", "revoked"]).optional(), limit: z.number().optional() } },
    { name: "revoke_scope", op: "scope.revoke", summary: "Revoke a scope grant", write: true, schema: { id: z.string(), reason: z.string().optional() } },
    { name: "effective_scopes", op: "scope.effective", summary: "Effective scopes for an identity (grants + active elevations)", write: false, schema: { identity_id: z.string() } },
  ], ctx);
}
