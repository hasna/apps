import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defaultAdapters } from "../../adapters/index.js";
import { getDatabase } from "../../db/database.js";
import { toErrorEnvelope } from "../../types/index.js";
import { principalHasScope, type ApiPrincipal } from "../../server/auth.js";
import { REGISTRY, opInProfile, validateInput, type OpContext, type Profile } from "../../services/registry.js";
import { mcpError, mcpText } from "../compact.js";

// Domain MCP tools GENERATED from the shared op registry, so MCP stays in parity
// with CLI and /v1. Every tool enforces the op's scopes; mutating tools require a
// write scope; destructive (delete) tools live only in the `full` profile and are
// therefore absent from `minimal` (mcp-safety asserts both).

export function registerDomainTools(server: McpServer, principal: ApiPrincipal, profile: Profile): void {
  const adapters = defaultAdapters();

  for (const op of REGISTRY) {
    if (!opInProfile(op, profile)) continue;

    server.tool(op.mcpTool, op.summary, op.inputShape, async (args: Record<string, unknown>) => {
      const missing = op.scopes.filter((scope) => !principalHasScope(principal, scope));
      if (missing.length > 0) {
        return mcpError({
          code: "PERMISSION_DENIED",
          message: `${op.mcpTool} requires scope: ${missing.join(", ")}.`,
          suggestion: "Use a credential granted the required scope (deny-by-default).",
        });
      }
      try {
        const input = validateInput(op, args ?? {});
        const ctx: OpContext = { db: getDatabase(), principal, adapters };
        return mcpText(op.run(ctx, input));
      } catch (error) {
        return mcpError(toErrorEnvelope(error));
      }
    });
  }
}
