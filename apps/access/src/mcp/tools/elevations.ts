import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthorizationContext } from "../../services/authorization.js";
import { registerOpTools } from "./shared.js";

export function registerElevationTools(server: McpServer, ctx?: AuthorizationContext): void {
  registerOpTools(server, [
    { name: "request_elevation", op: "elevation.request", summary: "Request a just-in-time elevation", write: true, schema: { identity_id: z.string(), scope: z.string(), reason: z.string(), ttl_minutes: z.number().optional() } },
    { name: "approve_elevation", op: "elevation.approve", summary: "Approve a pending elevation", write: true, schema: { id: z.string(), approver: z.string() } },
    { name: "get_elevation", op: "elevation.get", summary: "Get an elevation by id", write: false, schema: { id: z.string() } },
    { name: "list_elevations", op: "elevation.list", summary: "List elevations", write: false, schema: { identity_id: z.string().optional(), entity_id: z.string().optional(), status: z.enum(["active", "expired", "revoked"]).optional(), limit: z.number().optional() } },
    { name: "revoke_elevation", op: "elevation.revoke", summary: "Revoke an elevation", write: true, schema: { id: z.string(), reason: z.string().optional() } },
    { name: "expire_elevations", op: "elevation.expire", summary: "Sweep expired elevations", write: true, schema: {} },
  ], ctx);
}
