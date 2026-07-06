import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthorizationContext } from "../../services/authorization.js";
import { registerOpTools } from "./shared.js";

export function registerIdentityTools(server: McpServer, ctx?: AuthorizationContext): void {
  registerOpTools(server, [
    { name: "create_identity", op: "identity.create", summary: "Register a non-human identity (agent/service/human)", write: true, schema: { entity_id: z.string().describe("Home entity UUIDv4"), kind: z.enum(["agent", "service", "human"]), name: z.string(), owner_ref: z.string().optional(), entity_slug: z.string().optional() } },
    { name: "get_identity", op: "identity.get", summary: "Get an identity by id", write: false, schema: { id: z.string() } },
    { name: "list_identities", op: "identity.list", summary: "List identities", write: false, schema: { entity_id: z.string().optional(), kind: z.enum(["agent", "service", "human"]).optional(), status: z.enum(["active", "suspended", "retired"]).optional(), limit: z.number().optional(), offset: z.number().optional() } },
    { name: "update_identity", op: "identity.update", summary: "Update an identity", write: true, schema: { id: z.string(), name: z.string().optional(), owner_ref: z.string().optional(), entity_slug: z.string().optional() } },
    { name: "suspend_identity", op: "identity.suspend", summary: "Suspend an identity", write: true, schema: { id: z.string() } },
    { name: "retire_identity", op: "identity.retire", summary: "Retire an identity", write: true, schema: { id: z.string() } },
  ], ctx);
}
