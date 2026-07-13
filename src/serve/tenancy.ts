// Tenancy primitives for projects-serve (R1 additive migration).
//
// Implements the fleet-wide Auth & Tenancy Standard v2 for the projects app:
//   - the FIXED default-tenant UUID every app backfills pre-existing rows to,
//   - the request TenantContext derived from the verified API-key principal,
//   - the kid -> (tenant_id, user_id) bridge lookup (api_key_context table).
//
// R1 SCOPE (deliberate, per _EXECUTION-PLAN.md):
//   - tenant_id is ADDITIVE and nullable in the DB; rows are backfilled to the
//     ROOT tenant. NOT NULL / RLS FORCE / strict statusChecker() are R2.
//   - Auth is NOT fail-closed this pass: a cryptographically valid key with no
//     api_key_context binding resolves to the ROOT tenant (transitional bridge),
//     so the flip is reversible and no live client is locked out. Fail-closed
//     (missing tenant => 403) is an R2 flip and is intentionally not enabled.

import type { ApiKeyPrincipal } from "@hasna/contracts/auth";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";

/**
 * The one FIXED default-tenant UUID shared by every app in the fleet migration
 * (Auth & Tenancy Standard v2 §3.1). slug `hasna`, kind `root`.
 * Reproducible: uuidv5(uuidv5(DNS,"hasna.xyz"),"tenant:hasna:root").
 * Every pre-existing row backfills to exactly this id; never invent another.
 */
export const ROOT_TENANT_ID = "adfd95c7-ee8b-52cb-ae47-4ae65dae3313";
export const ROOT_TENANT_SLUG = "hasna";

/** A system principal id used for backfilled/unbound keys (deterministic). */
export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

export type PrincipalType = "user" | "service";

/** Server-derived request context. Never populated from the request body. */
export interface TenantContext {
  tenantId: string;
  userId: string | null;
  principalType: PrincipalType;
  /** True when the tenant came from an api_key_context binding row (vs. the R1 default). */
  bound: boolean;
  kid: string | null;
}

/** The ROOT/default context used for unbound keys during the R1 transition. */
export function rootTenantContext(kid: string | null = null): TenantContext {
  return { tenantId: ROOT_TENANT_ID, userId: null, principalType: "service", bound: false, kid };
}

interface ApiKeyContextRow {
  kid: string;
  tenant_id: string;
  user_id: string | null;
  principal_type: string | null;
}

/**
 * Resolve a verified principal to a TenantContext via the kid -> tenant bridge
 * (`api_key_context`). R1 is NOT fail-closed: an unbound valid key falls back to
 * the ROOT tenant. (R2 switches this to fail-closed 403 + strict statusChecker.)
 */
export async function resolveTenantContext(
  db: TypedQueryClient,
  principal: ApiKeyPrincipal,
): Promise<TenantContext> {
  const kid = principal.kid;
  try {
    const row = await db.get<ApiKeyContextRow>(
      "SELECT kid, tenant_id, user_id, principal_type FROM api_key_context WHERE kid = $1",
      [kid],
    );
    if (row && row.tenant_id) {
      return {
        tenantId: row.tenant_id,
        userId: row.user_id ?? null,
        principalType: (row.principal_type as PrincipalType) ?? "service",
        bound: true,
        kid,
      };
    }
  } catch {
    // Bridge table may be absent on an un-migrated DB; tolerate in R1.
  }
  // R1 transitional: unbound but cryptographically valid key -> ROOT tenant.
  return rootTenantContext(kid);
}
