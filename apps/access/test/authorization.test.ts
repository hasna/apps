import { describe, expect, it } from "bun:test";
import {
  SYSTEM_AUTHORIZATION_CONTEXT,
  allowedEntityIds,
  authorize,
  authorizeAll,
  entityScopeFilter,
  hasAllEntityAccess,
  hasEntityAccess,
  principalCanSeeEntity,
  roleAllows,
  scopesForRoles,
  scopeToEntities,
  type AuthorizationContext,
} from "../src/services/authorization.js";
import { authorize as scopeAuthorize, hasStorageAdmin, scopeAllows } from "../src/services/authorization-scopes.js";
import { PermissionDeniedError } from "../src/types/index.js";

/**
 * Direct unit tests for the deny-by-default authorization mechanism
 * (src/services/authorization.ts + src/services/authorization-scopes.ts).
 * The domain/tenant-isolation tests exercise the mechanism indirectly through
 * services and transports; these pin the MECHANISM itself — the SQL predicate
 * shapes, the bypass-vs-unscoped asymmetry, and the scope path that must never
 * widen entity reach.
 */

function principal(partial: Partial<AuthorizationContext> = {}): AuthorizationContext {
  return { actor_id: "tester", roles: [], ...partial };
}

describe("hasEntityAccess — the single-entity gate", () => {
  it("bypass is unrestricted even with no entity set", () => {
    expect(hasEntityAccess(SYSTEM_AUTHORIZATION_CONTEXT, "any-entity")).toBe(true);
  });

  it("a resource with no entity to check is not blocked by scoping", () => {
    expect(hasEntityAccess(principal({ entity_ids: [] }), undefined)).toBe(true);
  });

  it("an unscoped non-bypass principal can reach NO entity", () => {
    expect(hasEntityAccess(principal({ entity_ids: [] }), "e1")).toBe(false);
    expect(hasEntityAccess(principal(), "e1")).toBe(false);
  });

  it("an allowed entity_id grants access to exactly that id", () => {
    expect(hasEntityAccess(principal({ entity_id: "e1" }), "e1")).toBe(true);
    expect(hasEntityAccess(principal({ entity_id: "e1" }), "e2")).toBe(false);
  });

  it("org_id and org_ids aliases are accepted as entity-scope ids", () => {
    expect(hasEntityAccess(principal({ org_id: "o1" }), "o1")).toBe(true);
    expect(hasEntityAccess(principal({ org_ids: ["o1", "o2"] }), "o2")).toBe(true);
    expect(hasEntityAccess(principal({ org_ids: ["o1"] }), "o3")).toBe(false);
  });

  it("entity_ids list membership grants access to each listed id", () => {
    const ctx = principal({ entity_ids: ["a", "b"] });
    expect(hasEntityAccess(ctx, "a")).toBe(true);
    expect(hasEntityAccess(ctx, "b")).toBe(true);
    expect(hasEntityAccess(ctx, "c")).toBe(false);
  });
});

describe("hasAllEntityAccess — the group gate", () => {
  it("requires EVERY entity in the set to be allowed", () => {
    const ctx = principal({ entity_ids: ["a", "b"] });
    expect(hasAllEntityAccess(ctx, ["a", "b"])).toBe(true);
    expect(hasAllEntityAccess(ctx, ["a"])).toBe(true);
    expect(hasAllEntityAccess(ctx, ["a", "c"])).toBe(false);
    expect(hasAllEntityAccess(ctx, [])).toBe(true);
  });

  it("bypass passes any group", () => {
    expect(hasAllEntityAccess(SYSTEM_AUTHORIZATION_CONTEXT, ["x", "y"])).toBe(true);
  });
});

describe("allowedEntityIds — the single source of truth for list isolation", () => {
  it("bypass resolves to null (unconstrained), never to a wildcard array", () => {
    expect(allowedEntityIds(SYSTEM_AUTHORIZATION_CONTEXT)).toBeNull();
    expect(allowedEntityIds(undefined)).toBeNull();
  });

  it("an unscoped principal resolves to the EMPTY array — sees nothing", () => {
    expect(allowedEntityIds(principal({ entity_ids: [] }))).toEqual([]);
    expect(allowedEntityIds(principal())).toEqual([]);
  });

  it("unions entity_id, entity_ids, org_id and org_ids without duplicates", () => {
    const ctx = principal({ entity_id: "a", entity_ids: ["a", "b"], org_id: "c", org_ids: ["b", "d"] });
    expect([...allowedEntityIds(ctx)!.sort()]).toEqual(["a", "b", "c", "d"]);
  });
});

describe("principalCanSeeEntity", () => {
  it("an unconstrained principal sees every entity", () => {
    expect(principalCanSeeEntity("anything", SYSTEM_AUTHORIZATION_CONTEXT)).toBe(true);
  });

  it("a constrained principal sees only its allowlisted entities", () => {
    const ctx = principal({ entity_ids: ["e1"] });
    expect(principalCanSeeEntity("e1", ctx)).toBe(true);
    expect(principalCanSeeEntity("e2", ctx)).toBe(false);
  });

  it("an unscoped principal sees nothing", () => {
    expect(principalCanSeeEntity("e1", principal({ entity_ids: [] }))).toBe(false);
  });
});

describe("entityScopeFilter — SQL predicate isolation by construction", () => {
  it("bypass returns null so the query is not constrained", () => {
    expect(entityScopeFilter(SYSTEM_AUTHORIZATION_CONTEXT)).toBeNull();
  });

  it("an empty allowlist yields an always-false predicate so no rows leak", () => {
    expect(entityScopeFilter(principal({ entity_ids: [] }))).toEqual({ clause: "1 = 0", params: [] });
  });

  it("a scoped principal yields an IN predicate with exactly its allowlist", () => {
    expect(entityScopeFilter(principal({ entity_id: "e1", org_ids: ["o2"] }))).toEqual({
      clause: "entity_id IN (?, ?)",
      params: ["e1", "o2"],
    });
  });

  it("honors a custom column name", () => {
    const filter = entityScopeFilter(principal({ entity_ids: ["e1"] }), "home_entity_id");
    expect(filter!.clause.startsWith("home_entity_id IN")).toBe(true);
  });
});

describe("scopeToEntities — the in-memory post-filter", () => {
  const rows = [
    { entity_id: "a", id: 1 },
    { entity_id: "b", id: 2 },
  ] as Array<{ entity_id: string; id: number }>;

  it("bypass returns the rows untouched", () => {
    expect(scopeToEntities(rows, SYSTEM_AUTHORIZATION_CONTEXT)).toBe(rows);
  });

  it("filters to the allowlisted entities", () => {
    const result = scopeToEntities(rows, principal({ entity_ids: ["a"] }));
    expect(result.map((r) => r.entity_id)).toEqual(["a"]);
  });

  it("an unscoped principal sees zero rows", () => {
    expect(scopeToEntities(rows, principal({ entity_ids: [] }))).toEqual([]);
  });
});

describe("authorize — deny by default on BOTH dimensions", () => {
  it("bypass authorizes any action on any resource", () => {
    expect(() => authorize("admin", SYSTEM_AUTHORIZATION_CONTEXT, { entity_id: "x" })).not.toThrow();
  });

  it("a role that allows the action passes with the entity in scope", () => {
    const ctx = principal({ roles: ["auditor"], entity_ids: ["e1"] });
    expect(() => authorize("read", ctx, { entity_id: "e1" })).not.toThrow();
  });

  it("entity reach is required EVEN when the role allows the action", () => {
    const ctx = principal({ roles: ["owner"], entity_ids: ["e1"] });
    expect(() => authorize("read", ctx, { entity_id: "e2" })).toThrow(PermissionDeniedError);
  });

  it("an unscoped principal is denied even with a full-action role", () => {
    const ctx = principal({ roles: ["owner"] });
    expect(() => authorize("read", ctx, { entity_id: "e1" })).toThrow(PermissionDeniedError);
  });

  it("action denial carries the resource name", () => {
    const ctx = principal({ roles: ["auditor"], entity_ids: ["e1"] });
    try {
      authorize("write", ctx, { entity_id: "e1", resource: "credentials" });
      throw new Error("expected denial");
    } catch (error) {
      expect(error).toBeInstanceOf(PermissionDeniedError);
      expect((error as PermissionDeniedError).message).toContain("credentials");
    }
  });

  it("a resource with no entity and an allowed role passes", () => {
    expect(() => authorize("read", principal({ roles: ["auditor"] }), { resource: "audit" })).not.toThrow();
  });

  it("entity group resources require ALL ids in scope", () => {
    const ctx = principal({ roles: ["admin"], entity_ids: ["a", "b"] });
    expect(() => authorize("write", ctx, { entity_ids: ["a", "b"] })).not.toThrow();
    expect(() => authorize("write", ctx, { entity_ids: ["a", "c"] })).toThrow(PermissionDeniedError);
  });
});

describe("authorizeAll", () => {
  it("passes when every action is allowed", () => {
    const ctx = principal({ roles: ["identity_admin"], entity_ids: ["e1"] });
    expect(() => authorizeAll(["read", "write"], ctx, { entity_id: "e1" })).not.toThrow();
  });

  it("throws on the FIRST denied action and stops", () => {
    const ctx = principal({ roles: ["auditor"], entity_ids: ["e1"] });
    expect(() => authorizeAll(["read", "write"], ctx, { entity_id: "e1" })).toThrow(PermissionDeniedError);
  });
});

describe("roleAllows and scopesForRoles", () => {
  it("roleAllows reflects the role permission table", () => {
    expect(roleAllows("auditor", "read")).toBe(true);
    expect(roleAllows("auditor", "write")).toBe(false);
    expect(roleAllows("issuer", "issue")).toBe(true);
    expect(roleAllows("integration", "revoke")).toBe(false);
  });

  it("system/owner/admin each grant the full action set", () => {
    for (const role of ["system", "owner", "admin"]) {
      expect(scopesForRoles([role as never]).sort()).toEqual(
        ["read", "write", "admin", "approve", "issue", "revoke", "review", "export"].sort(),
      );
    }
  });

  it("unions the action sets of multiple roles without duplicates", () => {
    expect(scopesForRoles(["auditor", "issuer"]).sort()).toEqual(["read", "issue", "review", "revoke", "export"].sort());
  });
});

describe("authorization-scopes — the scope path", () => {
  it("scopeAllows maps each fixed serve/token scope to its actions", () => {
    expect(scopeAllows("access:read", "read")).toBe(true);
    expect(scopeAllows("access:write", "write")).toBe(true);
    expect(scopeAllows("credential:admin", "revoke")).toBe(true);
    expect(scopeAllows("elevation:approve", "approve")).toBe(true);
    expect(scopeAllows("token:issue", "issue")).toBe(true);
    expect(scopeAllows("review:manage", "review")).toBe(true);
    expect(scopeAllows("storage:admin", "export")).toBe(true);
    expect(scopeAllows("org:admin", "revoke")).toBe(true);
  });

  it("an unmapped or foreign scope grants NOTHING (deny-by-default)", () => {
    expect(scopeAllows("wallets:read", "read")).toBe(false);
    expect(scopeAllows("access:read", "write")).toBe(false);
    expect(scopeAllows("", "read")).toBe(false);
    expect(scopeAllows("access:read", "admin")).toBe(false);
  });

  it("hasStorageAdmin requires an explicit elevated capability", () => {
    expect(hasStorageAdmin()).toBe(false);
    expect(hasStorageAdmin(principal({ roles: [], scopes: ["access:read"] }))).toBe(false);
    expect(hasStorageAdmin(principal({ roles: ["auditor"] }))).toBe(false);
  });

  it("hasStorageAdmin honors bypass, reserved roles, and the storage:admin scope", () => {
    expect(hasStorageAdmin(SYSTEM_AUTHORIZATION_CONTEXT)).toBe(true);
    expect(hasStorageAdmin(principal({ roles: ["system"] }))).toBe(true);
    expect(hasStorageAdmin(principal({ roles: ["owner"] }))).toBe(true);
    expect(hasStorageAdmin(principal({ roles: ["admin"] }))).toBe(true);
    expect(hasStorageAdmin(principal({ roles: [], scopes: ["storage:admin"] }))).toBe(true);
  });

  it("scopes widen the ACTION dimension only — never entity reach", () => {
    // org:admin carries the full action set, but the entity gate runs FIRST and
    // unchanged: without the entity in the allowlist, the call is denied.
    const ctx = principal({ roles: [], scopes: ["org:admin"], entity_ids: ["e1"] });
    expect(() => scopeAuthorize("admin", ctx, { entity_id: "e1" })).not.toThrow();
    expect(() => scopeAuthorize("admin", ctx, { entity_id: "e2" })).toThrow(PermissionDeniedError);
  });

  it("a scope with the action passes only AFTER the entity gate", () => {
    const scoped = principal({ roles: [], scopes: ["access:read"], entity_ids: ["e1"] });
    expect(() => scopeAuthorize("read", scoped, { entity_id: "e1" })).not.toThrow();
    expect(() => scopeAuthorize("read", scoped, { entity_id: "e2" })).toThrow(PermissionDeniedError);
    expect(() => scopeAuthorize("write", scoped, { entity_id: "e1" })).toThrow(PermissionDeniedError);
  });

  it("an unscoped scope-bearing principal is denied on entity resources", () => {
    const scoped = principal({ roles: [], scopes: ["org:admin"], entity_ids: [] });
    expect(() => scopeAuthorize("read", scoped, { entity_id: "e1" })).toThrow(PermissionDeniedError);
  });

  it("a role-based principal still authorizes through the scope-aware path", () => {
    const ctx = principal({ roles: ["auditor"], entity_ids: ["e1"] });
    expect(() => scopeAuthorize("read", ctx, { entity_id: "e1" })).not.toThrow();
    expect(() => scopeAuthorize("write", ctx, { entity_id: "e1" })).toThrow(PermissionDeniedError);
  });
});
