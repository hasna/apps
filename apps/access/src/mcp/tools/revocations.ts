import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthorizationContext } from "../../services/authorization.js";
import { registerOpTools } from "./shared.js";

export function registerRevocationTools(server: McpServer, ctx?: AuthorizationContext): void {
  registerOpTools(server, [
    { name: "execute_revocation", op: "revocation.execute", summary: "One-click, audited revocation (credential/scope/elevation/token/identity cascade)", write: true, schema: { identity_id: z.string(), target_type: z.enum(["credential", "scope", "identity", "elevation", "token"]), target_id: z.string().optional(), reason: z.string() } },
    { name: "list_revocations", op: "revocation.list", summary: "List revocations", write: false, schema: { identity_id: z.string().optional(), entity_id: z.string().optional(), limit: z.number().optional() } },
  ], ctx);
}
