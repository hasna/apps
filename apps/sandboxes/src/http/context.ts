/**
 * Self-hosted request context + fleet-wide tenancy constants.
 *
 * This module is the boundary between "who is calling" (derived server-side from
 * a verified credential) and "what tenant they act as". Nothing here is ever
 * read from a request body — tenant/user/principal are always server-derived
 * from a verified token (see auth.ts), per the fleet Auth & Tenancy standard v2.
 */

export const APP_NAME = "sandboxes" as const;

/**
 * The fixed fleet root-tenant UUID every app backfills pre-existing rows to.
 * Reproducible: uuidv5( uuidv5(DNS,"hasna.xyz"), "tenant:hasna:root" ).
 * Slug "hasna", kind "root". Locked by _AUTH-TENANCY-STANDARD-v2 §3.1.
 */
export const ROOT_TENANT_ID = "adfd95c7-ee8b-52cb-ae47-4ae65dae3313" as const;
export const ROOT_TENANT_SLUG = "hasna" as const;

/**
 * Deterministic service-principal id used by the bootstrap admin key. It is a
 * real row in sandboxes.users so allocation attribution + FKs stay intact.
 * Reproducible: uuidv5( ROOT_TENANT_ID, "service:sandboxes:bootstrap" ).
 */
export const BOOTSTRAP_PRINCIPAL_ID = "b6f2c0a1-4d3e-5f6a-8b9c-0d1e2f3a4b5c" as const;

export type PrincipalType = "user" | "service";

/** Immutable, server-derived identity of the caller for one request. */
export interface AuthContext {
  /** The isolation boundary. Never null past auth (fail-closed 403 otherwise). */
  readonly tenantId: string;
  /** users.id / service_principals.id, or null for an anonymous-but-scoped key. */
  readonly userId: string | null;
  readonly principalType: PrincipalType;
  /** Granted scopes, e.g. ["sandboxes:read","sandboxes:allocate"] or ["*"]. */
  readonly scopes: readonly string[];
  /** The credential id (kid) when known, for audit/attribution. */
  readonly kid: string | null;
  /** How the caller authenticated. */
  readonly via: "bootstrap" | "api_key" | "jws";
}

/** Canonical scope actions for the sandboxes resource server. */
export const SCOPES = {
  read: "sandboxes:read",
  allocate: "sandboxes:allocate",
  exec: "sandboxes:exec",
  checkpoint: "sandboxes:checkpoint",
  destroy: "sandboxes:destroy",
  admin: "sandboxes:admin",
} as const;

export type ScopeAction = (typeof SCOPES)[keyof typeof SCOPES];

/** True if the context's scopes satisfy the required scope (fail-closed). */
export function hasScope(ctx: AuthContext, required: ScopeAction): boolean {
  for (const scope of ctx.scopes) {
    if (scope === "*" || scope === "sandboxes:*" || scope === required) return true;
  }
  return false;
}
