import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodTypeAny } from "zod";
import { runOperation } from "../../services/registry.js";
import { SYSTEM_AUTHORIZATION_CONTEXT, type AuthorizationContext } from "../../services/authorization.js";
import { errorResult, toToolResult } from "../compact.js";
import { mcpWriteConfirmationSchema, stripMcpWriteConfirmation } from "../schemas.js";
import { shouldRegisterTool } from "../profile.js";

export interface OpToolDef {
  name: string;
  op: string;
  summary: string;
  write: boolean;
  schema: Record<string, ZodTypeAny>;
}

/**
 * Register a domain MCP tool that dispatches through the shared op registry.
 * Writes require confirm:true (stripped before the service call). Transport-level
 * bearer auth (§5.1a) authenticates the caller AND derives its scoped
 * AuthorizationContext, which is threaded here so domain ops enforce the SAME
 * scope + entity/org authorization as the /v1 routes. Absent a caller context
 * (stdio fallback / local-dev auth-off) the system context is used.
 */
export function registerOpTool(server: McpServer, def: OpToolDef, ctx?: AuthorizationContext): void {
  if (!shouldRegisterTool(def.name)) return;
  const schema = def.write ? { ...def.schema, ...mcpWriteConfirmationSchema } : def.schema;
  server.tool(def.name, def.summary, schema, async (args: Record<string, unknown>) => {
    try {
      const input = def.write ? stripMcpWriteConfirmation(args ?? {}, def.name) : args ?? {};
      const result = runOperation(def.op, input, ctx ?? SYSTEM_AUTHORIZATION_CONTEXT);
      return toToolResult(result) as never;
    } catch (error) {
      return errorResult(error) as never;
    }
  });
}

export function registerOpTools(server: McpServer, defs: OpToolDef[], ctx?: AuthorizationContext): void {
  for (const def of defs) registerOpTool(server, def, ctx);
}
