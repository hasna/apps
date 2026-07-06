import { PermissionDeniedError } from "../types/index.js";
import {
  SYSTEM_AUTHORIZATION_CONTEXT,
  hasEntityAccess,
  hasAllEntityAccess,
  roleAllows,
  allActions,
  type AuthorizationAction,
  type AuthorizationContext as BaseAuthorizationContext,
  type AuthorizationResource,
} from "./authorization.js";

/**
 * ACCESS-SPECIFIC scope layer, kept OUT of the copy-verbatim `authorization.ts`
 * (which is byte-identical to entities across the cohort — BUILD-SPEC §6.3/§10.1).
 * access is the cohort bearer-token issuer, so a principal may carry token `scopes`
 * (an access-issued MCP token or a scope-only serve credential that has scopes but
 * no roles). Scope-based authorization is layered ON TOP of the canonical
 * role/entity mechanism — never a fork of it and never a widening bypass:
 *
 *   - the entity-scope gate (`hasEntityAccess`/`hasAllEntityAccess`) is the SAME
 *     canonical primitive and runs UNCHANGED before any action check;
 *   - an unmapped scope grants NOTHING (deny-by-default);
 *   - scopes only widen the ACTION dimension, never entity reach.
 *
 * `authorize` here delegates every gate to the canonical primitives and merely
 * adds the scope path after the role path, so it cannot drift from the shared
 * mechanism.
 */

/** The canonical context PLUS access-issued token/serve-credential scopes. */
export interface AuthorizationContext extends BaseAuthorizationContext {
  /**
   * API/token scopes carried by the principal. Scope-based principals authorize
   * via these; role-based principals continue to authorize via `roles`. Scopes are
   * an additive grant path, never a widening bypass.
   */
  scopes?: string[];
}

/**
 * Maps a serve/token scope (the fixed `apiScopes` set from server/auth.ts) to the
 * domain actions it authorizes. Bundles include `read` wherever the corresponding
 * write/revoke/approve/issue ops read-then-mutate, mirroring the role permission
 * sets so a scope-based principal behaves like the equivalent role. Deny-by-default:
 * an unmapped scope (e.g. a foreign MCP tool scope like `wallets:read`) grants
 * nothing here.
 */
const scopeActions: Record<string, AuthorizationAction[]> = {
  "access:read": ["read"],
  "access:write": ["read", "write"],
  "identity:admin": ["read", "write", "admin"],
  "credential:admin": ["read", "write", "admin", "revoke"],
  "scope:grant": ["read", "write", "revoke"],
  "elevation:approve": ["read", "approve"],
  "review:manage": ["read", "review"],
  "revoke:execute": ["read", "revoke"],
  "token:issue": ["read", "issue"],
  "storage:admin": ["read", "admin", "export"],
  "org:admin": allActions,
};

export function scopeAllows(scope: string, action: AuthorizationAction): boolean {
  return scopeActions[scope]?.includes(action) ?? false;
}

/** Whether a principal carries an elevated storage-admin capability (§4.6). */
export function hasStorageAdmin(context?: AuthorizationContext): boolean {
  if (!context) return false;
  if (context.bypass) return true;
  if (context.roles.some((role) => role === "system" || role === "owner" || role === "admin")) return true;
  return context.scopes?.includes("storage:admin") ?? false;
}

/**
 * Deny by default: BOTH the entity scope AND the action scope must pass. Throws
 * PermissionDeniedError otherwise. Identical to the canonical `authorize` except a
 * scope-bearing principal (e.g. an access-issued MCP token that carries scopes but
 * no roles) may authorize via its token scopes AFTER the canonical entity + role
 * gates — this only widens the ACTION dimension, never entity reach. The SAME
 * context flows through the /v1 serve tier AND the MCP tools; MCP tools thread the
 * CALLER principal, never a SYSTEM bypass (BUILD-SPEC failure class 1).
 */
export function authorize(
  action: AuthorizationAction,
  context?: AuthorizationContext,
  resource: AuthorizationResource = {},
): void {
  const principal: AuthorizationContext = context ?? SYSTEM_AUTHORIZATION_CONTEXT;
  if (!hasEntityAccess(principal, resource.entity_id)) {
    throw new PermissionDeniedError(action, resource.resource || resource.entity_id);
  }
  if (resource.entity_ids && !hasAllEntityAccess(principal, resource.entity_ids)) {
    throw new PermissionDeniedError(action, resource.resource || "entity-group");
  }
  if (principal.bypass || principal.roles.some((role) => roleAllows(role, action))) {
    return;
  }
  if (principal.scopes?.some((scope) => scopeAllows(scope, action))) {
    return;
  }
  throw new PermissionDeniedError(action, resource.resource);
}

export function authorizeAll(
  actions: AuthorizationAction[],
  context?: AuthorizationContext,
  resource: AuthorizationResource = {},
): void {
  for (const action of actions) authorize(action, context, resource);
}
