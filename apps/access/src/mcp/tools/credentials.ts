import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthorizationContext } from "../../services/authorization.js";
import { registerOpTools } from "./shared.js";

export function registerCredentialTools(server: McpServer, ctx?: AuthorizationContext): void {
  registerOpTools(server, [
    { name: "register_credential", op: "credential.register", summary: "Register a credential REFERENCE (never a value; points at @hasna/secrets)", write: true, schema: { identity_id: z.string(), name: z.string(), kind: z.enum(["api_key", "oauth", "mcp_token", "ssh_key", "webhook_secret"]), secret_ref: z.string().describe("A @hasna/secrets reference, e.g. hasna/agents/foo/token") } },
    { name: "get_credential", op: "credential.get", summary: "Get a credential by id", write: false, schema: { id: z.string() } },
    { name: "list_credentials", op: "credential.list", summary: "List credentials", write: false, schema: { identity_id: z.string().optional(), entity_id: z.string().optional(), status: z.enum(["active", "revoked"]).optional(), limit: z.number().optional() } },
    { name: "revoke_credential", op: "credential.revoke", summary: "Revoke a credential", write: true, schema: { id: z.string(), reason: z.string().optional() } },
  ], ctx);
}
