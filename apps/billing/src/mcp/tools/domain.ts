import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import { ZodObject } from "zod";
import { ok, fail } from "../compact.js";
import { getDatabase } from "../../db/database.js";
import { ALL_OPS } from "../../services/registry.js";
import { makeContext, runOp } from "../../services/context.js";
import { SYSTEM_AUTHORIZATION_CONTEXT, type AuthorizationContext } from "../../services/authorization.js";
import type { ApiPrincipal } from "../../server/auth.js";

/**
 * Register the billing domain tools from the shared service registry so the MCP
 * surface stays in lockstep with CLI + /v1 (interface parity, BUILD-SPEC §7).
 *
 * §5.1a / failure class 1: MCP domain tools MUST enforce the SAME scope +
 * entity authorization as /v1. We thread the authenticated CALLER principal
 * into the service context and dispatch through the SAME runOp choke point the
 * serve tier uses — a read-only or single-entity token is therefore denied
 * privileged/cross-entity ops on the MCP transport exactly as on /v1. Callers
 * with no principal (stdio single-user) fall back to the SYSTEM context, which
 * the parity harness also exercises.
 */
export function registerDomainTools(
  server: McpServer,
  principal: ApiPrincipal | undefined,
  shouldRegister: (opName: string) => boolean,
): void {
  const principalCtx: AuthorizationContext = principal ?? SYSTEM_AUTHORIZATION_CONTEXT;

  for (const op of ALL_OPS) {
    if (!shouldRegister(op.op)) continue;
    const shape = (op.input instanceof ZodObject ? op.input.shape : {}) as ZodRawShape;
    server.tool(op.op, op.summary, shape, async (args: Record<string, unknown>) => {
      try {
        const ctx = makeContext(getDatabase(), principalCtx);
        const result = await runOp(op, ctx, args);
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    });
  }
}
