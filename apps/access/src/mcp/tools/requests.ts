import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthorizationContext } from "../../services/authorization.js";
import { registerOpTools } from "./shared.js";

export function registerRequestTools(server: McpServer, ctx?: AuthorizationContext): void {
  registerOpTools(server, [
    { name: "create_request", op: "request.create", summary: "Create an access request", write: true, schema: { requested_by_identity_id: z.string(), provider: z.string(), resource_kind: z.string(), resource_ref: z.string(), decision_metadata: z.record(z.unknown()).optional() } },
    { name: "get_request", op: "request.get", summary: "Get an access request by id", write: false, schema: { id: z.string() } },
    { name: "list_requests", op: "request.list", summary: "List access requests", write: false, schema: { requested_by_identity_id: z.string().optional(), entity_id: z.string().optional(), provider: z.string().optional(), resource_kind: z.string().optional(), resource_ref: z.string().optional(), status: z.enum(["pending", "approved", "provisioned", "failed", "cancelled"]).optional(), policy_decision: z.enum(["allow", "deny", "manual_review"]).optional(), limit: z.number().optional() } },
    { name: "approve_request", op: "request.approve", summary: "Approve an access request", write: true, schema: { id: z.string(), approved_by: z.string().optional(), policy_reason: z.string().optional(), decision_metadata: z.record(z.unknown()).optional(), expected_version: z.number().optional() } },
    { name: "provision_request", op: "request.provision", summary: "Mark an access request provisioned", write: true, schema: { id: z.string(), provisioned_by: z.string().optional(), provision_metadata: z.record(z.unknown()).optional(), expected_version: z.number().optional() } },
    { name: "fail_request", op: "request.fail", summary: "Mark an access request failed", write: true, schema: { id: z.string(), reason: z.string(), failed_by: z.string().optional(), provision_metadata: z.record(z.unknown()).optional(), expected_version: z.number().optional() } },
    { name: "cancel_request", op: "request.cancel", summary: "Cancel an access request", write: true, schema: { id: z.string(), reason: z.string().optional(), cancelled_by: z.string().optional(), expected_version: z.number().optional() } },
  ], ctx);
}
