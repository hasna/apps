import type { Hono } from "hono";
import type { Database } from "bun:sqlite";
import type { FleetAdapters } from "../../adapters/types.js";
import { matchHttpRoute, validateInput, type OpContext } from "../../services/registry.js";
import { toErrorEnvelope } from "../../types/index.js";
import { principalHasScope, type ApiPrincipal } from "../auth.js";
import { queryToInput } from "../list-query.js";

type Variables = { principal: ApiPrincipal };

function errorStatus(code: string): number {
  if (code.endsWith("NOT_FOUND")) return 404;
  if (code === "PERMISSION_DENIED" || code === "ENTITY_ACCESS_DENIED" || code === "READ_ONLY_RESOURCE") return 403;
  if (code === "VALIDATION_ERROR" || code === "ZodError") return 400;
  return 500;
}

/**
 * Register the versioned /v1 surface. All resources are dispatched from the shared
 * op registry, so CLI/MCP/API stay in parity. Config resources support full CRUD;
 * fused observability resources are GET-only (a write to a fused path yields 405).
 */
export function registerV1Routes(
  app: Hono<{ Variables: Variables }>,
  getDb: () => Database,
  adapters: FleetAdapters,
): void {
  app.all("/v1/*", async (c) => {
    const url = new URL(c.req.url);
    const matched = matchHttpRoute(c.req.method, url.pathname);
    if (!matched) {
      const anyMethod = ["GET", "POST", "PATCH", "DELETE"].some((m) => matchHttpRoute(m, url.pathname));
      return c.json(
        anyMethod
          ? { code: "METHOD_NOT_ALLOWED", message: `${c.req.method} not allowed on ${url.pathname}. Fused observability is read-only.`, suggestion: "Use a supported method for this resource." }
          : { code: "NOT_FOUND", message: `No route for ${c.req.method} ${url.pathname}.`, suggestion: "Check the /v1 API surface." },
        anyMethod ? 405 : 404,
      );
    }

    const { op, params } = matched;
    const principal = c.get("principal");
    const missing = op.scopes.filter((scope) => !principalHasScope(principal, scope));
    if (missing.length > 0) {
      return c.json(
        { code: "PERMISSION_DENIED", message: `Credential lacks required scope: ${missing.join(", ")}.`, suggestion: "Request a credential with the needed scope." },
        403,
      );
    }

    let body: Record<string, unknown> = {};
    if (c.req.method === "POST" || c.req.method === "PATCH") {
      try {
        body = (await c.req.json()) as Record<string, unknown>;
      } catch {
        body = {};
      }
    }
    const raw = { ...queryToInput(url), ...body, ...params };

    try {
      const input = validateInput(op, raw);
      const ctx: OpContext = { db: getDb(), principal, adapters };
      const result = op.run(ctx, input);
      return c.json(result as never);
    } catch (error) {
      const env = toErrorEnvelope(error);
      return c.json(env, errorStatus(env.code) as never);
    }
  });
}
