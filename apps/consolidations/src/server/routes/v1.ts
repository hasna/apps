import type { Hono } from "hono";
import { executeOp } from "../../services/execute.js";
import { OPS } from "../../services/registry.js";
import type { OpDef } from "../../services/op-types.js";
import { statusForCode, toStructuredError } from "../../types/index.js";
import { resolvePrincipal } from "../request-auth.js";

// Generic /v1 registration: every registry op is mounted on Hono using its HTTP
// binding, and every request routes through executeOp with the authenticated
// principal — so the /v1 surface has interface parity with CLI + MCP and shares
// the same deny-by-default, entity-scoped authorization.

function buildInput(op: OpDef, params: Record<string, string>, query: Record<string, string>, body: unknown): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...params };
  if (op.http.method === "GET" || op.http.method === "DELETE") {
    Object.assign(merged, query);
  } else if (body && typeof body === "object") {
    Object.assign(merged, body as Record<string, unknown>);
  }
  return merged;
}

export function registerV1Routes(app: Hono): void {
  for (const op of OPS) {
    const method = op.http.method.toLowerCase() as "get" | "post" | "patch" | "delete";
    app[method](op.http.pathTemplate, async (c) => {
      try {
        const principal = resolvePrincipal(c.req.raw);
        const params = c.req.param() as Record<string, string>;
        const query = c.req.query() as Record<string, string>;
        let body: unknown = undefined;
        if (op.http.method === "POST" || op.http.method === "PATCH") {
          body = await c.req.json().catch(() => ({}));
        }
        const input = buildInput(op, params, query, body);
        const result = await executeOp(op, principal, input);
        return c.json(result as Record<string, unknown>);
      } catch (error) {
        const structured = toStructuredError(error);
        return c.json(structured, statusForCode(structured.code) as never);
      }
    });
  }
}
