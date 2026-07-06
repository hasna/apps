import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { openDatabase } from "../../db/database.js";
import { contextFromPrincipal } from "../../services/context.js";
import type { ApiPrincipal } from "../../server/auth.js";
import { OPS, coerceField, type OpDef, type Profile } from "../../services/registry.js";
import { ok, fail } from "../compact.js";

function zodShapeFor(op: OpDef): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of op.fields) {
    let base: z.ZodTypeAny;
    if (f.type === "int" || f.type === "number") base = z.number();
    else if (f.type === "bool") base = z.boolean();
    else base = z.string();
    shape[f.name] = f.required ? base : base.optional();
  }
  return shape;
}

function assembleInput(op: OpDef, args: Record<string, unknown>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const f of op.fields) {
    const v = coerceField(f, args[f.name]);
    if (v !== undefined) input[f.name] = v;
  }
  return input;
}

/**
 * Register every registry op as an MCP domain tool, threading the CALLER
 * principal into per-op authorization exactly like /v1 — never a SYSTEM bypass
 * (defeats wave-1 failure class #1). Filtered by the active tool profile.
 */
export function registerDomainTools(server: McpServer, principal: ApiPrincipal, profile: Profile): void {
  for (const op of OPS) {
    if (!op.profiles.includes(profile)) continue;
    server.tool(op.name, op.description, zodShapeFor(op), async (args: Record<string, unknown>) => {
      try {
        const db = await openDatabase();
        const rc = contextFromPrincipal(db, principal);
        return ok(await op.run(rc, assembleInput(op, args)));
      } catch (e) {
        return fail(e);
      }
    });
  }
}
