import { ZodError } from "zod";
import { openStore } from "../db/database.js";
import { apiScopes, type ApiPrincipal } from "../server/auth.js";
import { authorize, type AuthorizationContext } from "./authorization.js";
import type { OpContext, OpDef } from "./op-types.js";
import { PermissionDeniedError, ValidationError } from "../types/index.js";

// The single execution path shared by CLI, MCP, and /v1. Every surface routes
// here, so interface parity holds by construction and the caller principal is
// threaded into per-op authorization identically on every transport.

/** SYSTEM principal for local single-user CLI use (loopback, local mode). */
export const SYSTEM_PRINCIPAL: ApiPrincipal = {
  actor_id: "system",
  credential_id: "system",
  credential_type: "session",
  roles: ["system"],
  scopes: [...apiScopes],
  bypass: true,
};

function principalContext(principal: ApiPrincipal): AuthorizationContext {
  return principal;
}

/** Capability check: required scope + role action (no entity binding yet). */
export function authorizeScope(op: OpDef, principal: ApiPrincipal): void {
  if (!principal.bypass && !principal.scopes.includes(op.scope)) {
    throw new PermissionDeniedError(op.action, op.op);
  }
  authorize(op.action, principalContext(principal), {});
}

/** Execute an op end-to-end (validate -> authorize scope -> open store -> run). */
export async function executeOp(
  op: OpDef,
  principal: ApiPrincipal,
  rawInput: Record<string, unknown>,
): Promise<unknown> {
  let input: Record<string, unknown>;
  try {
    input = op.input.parse(rawInput) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ZodError) {
      const detail = error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
      throw new ValidationError(detail || "Invalid input");
    }
    throw error;
  }

  authorizeScope(op, principal);

  const store = await openStore();
  const ctx: OpContext = {
    store,
    principal,
    requireEntity(entityId: string) {
      authorize(op.action, principalContext(principal), { entity_id: entityId });
    },
    requireAllEntities(entityIds: string[]) {
      authorize(op.action, principalContext(principal), { entity_ids: entityIds });
    },
  };
  try {
    return await op.handler(ctx, input);
  } finally {
    await store.close();
  }
}
