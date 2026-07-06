import { PermissionDeniedError } from "../types/index.js";
import type { AuthorizationContext } from "./authorization.js";

/**
 * Billing-specific scope layer, kept OUT of `authorization.ts` so that file stays
 * byte-identical to the canonical security stack shared across all 9 apps
 * (BUILD-SPEC §6.3 / §10.1). The canonical `authorize()` enforces role→action +
 * entity scope; this module adds granular scope-STRING enforcement on top via
 * interface declaration merging — it does NOT fork any canonical function.
 *
 * billing threads granular scope strings on the principal so runOp enforces
 * scope + role-action + entity scope in one choke point (BUILD-SPEC failure
 * class 1).
 */

// Additive per-app extension of the canonical AuthorizationContext: scope-carrying
// credentials (as in access/billing). Module augmentation keeps the canonical
// interface untouched while every surface still imports the type from
// `./authorization.js`.
declare module "./authorization.js" {
  interface AuthorizationContext {
    /** Granted scope strings (attached by the auth layer for ApiPrincipals). */
    scopes?: string[];
  }
}

/**
 * Assert the principal holds every required scope (deny-by-default). Enforced at
 * the single dispatch choke point so MCP and /v1 apply identical scope gates
 * (BUILD-SPEC failure class 1). Bypass (SYSTEM) contexts skip the check.
 */
export function requireScopes(context: AuthorizationContext, required: string[]): void {
  if (context.bypass) return;
  const held = new Set(context.scopes ?? []);
  const missing = required.filter((scope) => !held.has(scope));
  if (missing.length > 0) {
    throw new PermissionDeniedError(`scope:${missing.join(",")}`);
  }
}
