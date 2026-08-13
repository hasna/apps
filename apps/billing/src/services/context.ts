import type { Database } from "bun:sqlite";
import { z } from "zod";
import type { StripeAdapter } from "../adapters/stripe.js";
import { getStripeAdapter } from "../adapters/stripe.js";
import type { ApiScope } from "../server/auth.js";
import {
  authorize,
  type AuthorizationAction,
  type AuthorizationContext,
} from "./authorization.js";
import { requireScopes } from "./scopes.js";

/**
 * Shared service context and the single dispatch path used identically by the
 * CLI (--json), the MCP tools, and the /v1 routes (BUILD-SPEC §7). Domain logic
 * lives ONCE in the service handlers; every surface calls runOp with the
 * authenticated caller principal — no surface bypasses authorization.
 */
export interface ServiceContext {
  db: Database;
  principal: AuthorizationContext;
  actor_id: string;
  stripe: StripeAdapter;
}

export function makeContext(
  db: Database,
  principal: AuthorizationContext,
  opts: { stripe?: StripeAdapter } = {},
): ServiceContext {
  return {
    db,
    principal,
    actor_id: principal.actor_id,
    stripe: opts.stripe ?? getStripeAdapter(),
  };
}

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
export type ToolProfile = "minimal" | "standard" | "full";

export interface ServiceOp {
  /** Canonical op name (also the MCP tool name and CLI action key). */
  op: string;
  resource: string;
  summary: string;
  action: AuthorizationAction;
  scopes: ApiScope[];
  mutates: boolean;
  method: HttpMethod;
  /** /v1 path with :params, e.g. /v1/customers/:id */
  path: string;
  input: z.ZodTypeAny;
  handler: (ctx: ServiceContext, input: unknown) => unknown;
  profiles: ToolProfile[];
}

/**
 * Authorize + execute an op with the CALLER principal. This is the choke point
 * that guarantees MCP and /v1 enforce identical scope + entity authorization
 * (BUILD-SPEC failure class 1). Handlers additionally enforce per-row entity
 * scoping via the context principal.
 */
export async function runOp(
  spec: ServiceOp,
  ctx: ServiceContext,
  rawInput: unknown,
): Promise<unknown> {
  const input = spec.input.parse(rawInput);
  // Single choke point: enforce required scopes AND the role→action gate with
  // the CALLER principal. Identical for CLI, MCP, and /v1 (BUILD-SPEC §7,
  // failure classes 1 & 5). Handlers additionally enforce per-row entity scope.
  requireScopes(ctx.principal, spec.scopes);
  authorize(spec.action, ctx.principal);
  return await spec.handler(ctx, input);
}

/**
 * Enforce that the caller principal may act on a specific entity's data. Knowing
 * an entity_id is NOT access (BUILD-SPEC §1c) — this authorizes the principal
 * against it, deny-by-default. Call from handlers for single-entity ops.
 */
export function assertEntity(
  ctx: ServiceContext,
  action: AuthorizationAction,
  entityId: string,
  resource: string,
): void {
  authorize(action, ctx.principal, { entity_id: entityId, resource });
}

export const entityIdSchema = z
  .string()
  .uuid()
  .describe("Seller entity id (UUIDv4). Records are anchored + authorized against this (BUILD-SPEC §1c).");

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
