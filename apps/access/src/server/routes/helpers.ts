import type { Context } from "hono";
import { authorizeApiRequest, principalToContext, type ApiScope } from "../auth.js";
import { SYSTEM_AUTHORIZATION_CONTEXT, type AuthorizationContext } from "../../services/authorization.js";
import { runOperation, type OperationInput } from "../../services/registry.js";
import { errorStatus, toErrorEnvelope } from "../../types/index.js";

export interface RouteSpec {
  op: string;
  scopes: ApiScope[];
  /** HTTP status on success (default 200; 201 for creates). */
  successStatus?: number;
  /** Optional entity id extractor for route-level tenant scoping. */
  entityIdFrom?: (input: OperationInput) => string | undefined;
}

/**
 * Execute a registry op behind the copy-verbatim auth stack, returning the
 * op result or the identical { code, message, suggestion } error envelope.
 */
export async function runRoute(c: Context, spec: RouteSpec, input: OperationInput): Promise<Response> {
  const auth = authorizeApiRequest(c.req.raw, {
    scopes: spec.scopes,
    entity_id: spec.entityIdFrom?.(input),
  });
  if (!auth.allowed) {
    return c.json(
      { code: auth.code ?? "PERMISSION_DENIED", message: auth.message ?? "Denied.", suggestion: "Provide a bearer token with the required scope and entity access." },
      (auth.status ?? 403) as 401 | 403,
    );
  }
  const ctx: AuthorizationContext = auth.principal ? principalToContext(auth.principal) : SYSTEM_AUTHORIZATION_CONTEXT;
  try {
    const result = runOperation(spec.op, input, ctx);
    return c.json(result as Record<string, unknown>, (spec.successStatus ?? 200) as 200 | 201);
  } catch (error) {
    return c.json(toErrorEnvelope(error), errorStatus(error) as 400 | 401 | 403 | 404 | 409 | 500);
  }
}

/** Merge JSON body (best-effort) with route/query params into a single op input. */
export async function collectInput(c: Context, extra: Record<string, unknown> = {}): Promise<OperationInput> {
  let body: Record<string, unknown> = {};
  if (c.req.method !== "GET" && c.req.method !== "DELETE") {
    body = await c.req.json().catch(() => ({}));
  }
  const query = Object.fromEntries(new URL(c.req.url).searchParams.entries());
  return { ...query, ...body, ...extra };
}
