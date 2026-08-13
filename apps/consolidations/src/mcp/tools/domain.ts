import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import { executeOp } from "../../services/execute.js";
import { OPS } from "../../services/registry.js";
import type { ApiPrincipal } from "../../server/auth.js";
import type { OpDef } from "../../services/op-types.js";
import { toolError, toolText } from "../compact.js";

export type Profile = "minimal" | "standard" | "full";

function includeInProfile(op: OpDef, profile: Profile): boolean {
  // Storage-admin tools are ALWAYS registered, regardless of profile.
  if (op.scope === "storage:admin") return true;
  if (profile === "full") return true;
  return op.profiles.includes(profile);
}

/**
 * Register every registry op as an MCP domain tool, filtered by profile. The
 * authenticated caller principal is threaded into per-op authorization exactly
 * like /v1 — a read-only or single-entity token is denied privileged/cross-entity
 * ops on the MCP transport too (no SYSTEM bypass).
 */
export function registerDomainTools(
  server: McpServer,
  options: { principal: ApiPrincipal; profile: Profile },
): void {
  for (const op of OPS) {
    if (!includeInProfile(op, options.profile)) continue;
    const shape = (op.input as { shape?: ZodRawShape }).shape ?? {};
    server.tool(op.mcpTool, op.summary, shape, async (args: Record<string, unknown>) => {
      try {
        return toolText(await executeOp(op, options.principal, args ?? {}));
      } catch (error) {
        return toolError(error);
      }
    });
  }
}
