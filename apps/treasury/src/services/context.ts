import type { QueryClient } from "../db/database.js";
import type { ApiPrincipal, ApiScope } from "../server/auth.js";
import { authorize, type AuthorizationAction, type AuthorizationContext, SYSTEM_AUTHORIZATION_CONTEXT } from "./authorization.js";
import { PermissionDeniedError } from "../types/index.js";

/** Everything an op needs: the store + the authenticated caller principal. */
export interface RunContext {
  db: QueryClient;
  auth: AuthorizationContext;
  scopes: ApiScope[];
}

/** Build a run context from an authenticated API principal (serve + MCP). */
export function contextFromPrincipal(db: QueryClient, principal: ApiPrincipal): RunContext {
  return {
    db,
    auth: {
      actor_id: principal.actor_id,
      roles: principal.roles,
      ...(principal.entity_ids ? { entity_ids: principal.entity_ids } : {}),
      ...(principal.bypass ? { bypass: true } : {}),
    },
    scopes: principal.scopes,
  };
}

/**
 * A local/dev owner context (used by the CLI in local loopback mode when no
 * scoped credential is supplied). Full scopes + bypass. Scoped credentials
 * still exercise the real deny-by-default path on every transport.
 */
export function localOwnerContext(db: QueryClient): RunContext {
  return {
    db,
    auth: SYSTEM_AUTHORIZATION_CONTEXT,
    scopes: ["treasury:read", "treasury:write", "treasury:recommend", "treasury:export", "treasury:admin", "storage:admin"],
  };
}

/**
 * Deny-by-default gate for a single op: the principal must hold the required
 * scope AND be authorized for the action on the target entity (§1c). Threading
 * this on EVERY transport (serve + MCP) — not a SYSTEM bypass — is mandatory.
 */
export function guard(rc: RunContext, scope: ApiScope, action: AuthorizationAction, entity_id?: string): void {
  if (!rc.auth.bypass && !rc.scopes.includes(scope)) {
    throw new PermissionDeniedError(action, `missing scope ${scope}`);
  }
  authorize(action, rc.auth, entity_id ? { entity_id } : {});
}
