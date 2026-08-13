import type { AuthorizationContext } from "../services/authorization.js";
import type { ApiPrincipal } from "./auth.js";

// Map an authenticated API principal to the service-layer AuthorizationContext.
// Admin-class roles get a bypass so they can operate across all entities; every
// other principal is scoped to its explicit entity set (deny-by-default, §1c).

export function principalToAuthContext(principal: ApiPrincipal): AuthorizationContext {
  const isAdmin = principal.roles.some((r) => r === "system" || r === "owner" || r === "admin");
  const ctx: AuthorizationContext = {
    actor_id: principal.actor_id,
    roles: principal.roles,
  };
  if (isAdmin) {
    ctx.bypass = true;
  } else {
    if (principal.entity_id !== undefined) ctx.entity_id = principal.entity_id;
    if (principal.entity_ids !== undefined) ctx.entity_ids = principal.entity_ids;
  }
  return ctx;
}

/** The implicit local-dev principal used when auth is neither required nor configured. */
export const LOCAL_DEV_PRINCIPAL: ApiPrincipal = {
  actor_id: "local-dev",
  credential_id: "local-dev",
  credential_type: "api_key",
  roles: ["owner"],
  scopes: ["holdings:read", "holdings:write", "holdings:register", "holdings:renew", "holdings:export", "holdings:admin", "storage:admin"],
};
