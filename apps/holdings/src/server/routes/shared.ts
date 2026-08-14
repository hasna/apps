import type { Context, Hono } from "hono";
import type { Database } from "bun:sqlite";
import { errorStatus, toErrorEnvelope } from "../../types/index.js";
import { invokeOp, type OpDef } from "../../services/registry.js";
import { principalToAuthContext } from "../principal.js";
import type { AppEnv } from "../hono-env.js";

// Shared /v1 route mounting. Each resource router calls mountOps with its subset
// of OP_REGISTRY; every handler dispatches through invokeOp (the service layer),
// so REST stays at parity with CLI + MCP and never re-implements domain logic.

export interface RouteDeps {
  db: Database;
}

const NUMERIC_QUERY_KEYS = new Set(["within_days", "reminder_days", "nice_class"]);

async function buildInput(c: Context<AppEnv>, def: OpDef): Promise<Record<string, unknown>> {
  const input: Record<string, unknown> = {};
  // query params
  const url = new URL(c.req.url);
  for (const [key, value] of url.searchParams.entries()) {
    input[key] = NUMERIC_QUERY_KEYS.has(key) ? Number(value) : value;
  }
  // path param :id
  const id = c.req.param("id");
  if (id) input.id = id;
  // body for writes
  if (def.api.method === "POST" || def.api.method === "PATCH") {
    try {
      const body = await c.req.json();
      if (body && typeof body === "object") Object.assign(input, body);
    } catch {
      // empty/invalid body → leave input as-is; zod validation will report.
    }
  }
  return input;
}

export function mountOps(app: Hono<AppEnv>, defs: OpDef[], deps: RouteDeps): void {
  // Register static paths (e.g. /v1/renewals/upcoming) before param paths
  // (/v1/renewals/:id) so the literal route wins.
  const ordered = [...defs].sort((a, b) => {
    const ap = a.api.path.includes(":") ? 1 : 0;
    const bp = b.api.path.includes(":") ? 1 : 0;
    if (ap !== bp) return ap - bp;
    return b.api.path.length - a.api.path.length;
  });
  for (const def of ordered) {
    const honoPath = def.api.path.replace(/:([A-Za-z_]+)/g, ":$1"); // Hono uses :id natively
    const method = def.api.method.toLowerCase() as "get" | "post" | "patch" | "delete";
    app[method](honoPath, async (c) => {
      const principal = c.get("principal");
      if (!principal) {
        return c.json({ code: "UNAUTHORIZED", message: "Invalid or missing API credential.", suggestion: "Provide a valid Bearer token." }, 401);
      }
      const isAdmin = principal.roles.some((r) => r === "system" || r === "owner" || r === "admin");
      if (!isAdmin && !principal.scopes.includes(def.scope)) {
        return c.json(
          { code: "PERMISSION_DENIED", message: `Credential lacks required scope: ${def.scope}.`, suggestion: "Use a credential with the required scope." },
          403,
        );
      }
      try {
        const input = await buildInput(c, def);
        const result = invokeOp({ db: deps.db, auth: principalToAuthContext(principal) }, def.op, input);
        return c.json(result as never, 200);
      } catch (error) {
        return c.json(toErrorEnvelope(error) as never, errorStatus(error) as never);
      }
    });
  }
}
