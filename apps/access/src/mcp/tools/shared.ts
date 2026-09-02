import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodTypeAny } from "zod";
import type { CoreOperation } from "../../client/routes.js";
import { runOperation } from "../../services/registry.js";
import { SYSTEM_AUTHORIZATION_CONTEXT, type AuthorizationContext } from "../../services/authorization.js";
import { errorResult, toToolResult } from "../compact.js";
import { mcpWriteConfirmationSchema, stripMcpWriteConfirmation } from "../schemas.js";
import { shouldRegisterTool } from "../profile.js";

export interface OpToolDef {
  name: string;
  op: CoreOperation;
  summary: string;
  write: boolean;
  schema: Record<string, ZodTypeAny>;
}

export type DomainExecutor = (operation: CoreOperation, input: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>;

/**
 * Stdio explicitly injects its validated HTTPS executor. HTTP does not: it keeps
 * the legacy registry bound to its caller's context, never the process API key.
 * Both paths retain schemas, profiles, confirmation and structured output.
 */
export function registerOpTool(server: McpServer, def: OpToolDef, ctx?: AuthorizationContext, execute?: DomainExecutor): void {
  if (!shouldRegisterTool(def.name)) return;
  const schema = def.write ? { ...def.schema, ...mcpWriteConfirmationSchema } : def.schema;
  server.tool(def.name, def.summary, schema, async (args: Record<string, unknown>) => {
    try {
      const input = def.write ? stripMcpWriteConfirmation(args ?? {}, def.name) : args ?? {};
      const result = await (execute ? execute(def.op, input) : runOperation(def.op, input, ctx ?? SYSTEM_AUTHORIZATION_CONTEXT));
      return toToolResult(result) as never;
    } catch (error) {
      return errorResult(error) as never;
    }
  });
}

export function registerOpTools(server: McpServer, defs: OpToolDef[], ctx?: AuthorizationContext, execute?: DomainExecutor): void {
  for (const def of defs) registerOpTool(server, def, ctx, execute);
}
