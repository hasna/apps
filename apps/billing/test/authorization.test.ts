// Agent-authored (SOL consult refused: "Selected model is at capacity" on two
// distinct healthy Codewith accounts — no SOL opinion was produced for this repo).
//
// Pure-function unit tests for the deny-by-default security stack
// (src/services/authorization.ts + src/services/scopes.ts). The surface-level
// auth tests prove the wiring; these pin the primitives themselves — the
// empty-allowlist denial, the SQL entity-scope predicate, group checks, and
// scope-string enforcement. A regression here is a tenant-isolation leak by
// construction.

import { describe, expect, it } from "bun:test";
import {
  SYSTEM_AUTHORIZATION_CONTEXT,
  allowedEntityIds,
  authorize,
  authorizeAll,
  entityScopeFilter,
  hasAllEntityAccess,
  hasEntityAccess,
  roleAllows,
  scopeToEntities,
  scopesForRoles,
} from "../src/services/authorization.js";
import { requireScopes } from "../src/services/scopes.js";
import { PermissionDeniedError } from "../src/types/index.js";

const ENTITY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ENTITY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ENTITY_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("hasEntityAccess", () => {
  it("lets the bypass principal through anything", () => {
    expect(hasEntityAccess(SYSTEM_AUTHORIZATION_CONTEXT, ENTITY_A)).toBe(true);
    expect(hasEntityAccess(SYSTEM_AUTHORIZATION_CONTEXT, undefined)).toBe(true);
  });

  it("denies a scoped principal access to an entity outside its allowlist", () => {
    const ctx = { actor_id: "a", roles: ["owner"] as const, entity_ids: [ENTITY_A] };
    expect(hasEntityAccess(ctx, ENTITY_A)).toBe(true);
    expect(hasEntityAccess(ctx, ENTITY_B)).toBe(false);
  });

  it("denies an unscoped non-bypass principal everything (empty allowlist, never wildcard)", () => {
    const ctx = { actor_id: "a", roles: ["owner"] as const };
    expect(hasEntityAccess(ctx, ENTITY_A)).toBe(false);
  });

  it("treats a resource with no entity as not blocked by scoping", () => {
    const ctx = { actor_id: "a", roles: ["readonly"] as const };
    expect(hasEntityAccess(ctx, undefined)).toBe(true);
  });
});

describe("allowedEntityIds", () => {
  it("returns null (unconstrained) only for bypass", () => {
    expect(allowedEntityIds(SYSTEM_AUTHORIZATION_CONTEXT)).toBeNull();
  });
  it("returns the explicit allowlist for a scoped principal", () => {
    const ctx = { actor_id: "a", roles: [] as const, entity_id: ENTITY_A, entity_ids: [ENTITY_B] };
    expect(allowedEntityIds(ctx)?.sort()).toEqual([ENTITY_A, ENTITY_B].sort());
  });
  it("returns an empty array for an unscoped principal — never null", () => {
    const ctx = { actor_id: "a", roles: ["owner"] as const };
    expect(allowedEntityIds(ctx)).toEqual([]);
  });
});

describe("entityScopeFilter (SQL form)", () => {
  it("returns null for bypass", () => {
    expect(entityScopeFilter(SYSTEM_AUTHORIZATION_CONTEXT)).toBeNull();
  });
  it("returns an always-false predicate for an empty allowlist", () => {
    const ctx = { actor_id: "a", roles: ["owner"] as const };
    expect(entityScopeFilter(ctx)).toEqual({ clause: "1 = 0", params: [] });
  });
  it("emits a parameterized IN clause for a scoped principal", () => {
    const ctx = { actor_id: "a", roles: [] as const, entity_ids: [ENTITY_A, ENTITY_B] };
    expect(entityScopeFilter(ctx)).toEqual({ clause: "entity_id IN (?, ?)", params: [ENTITY_A, ENTITY_B] });
  });
  it("honors a custom column name", () => {
    const ctx = { actor_id: "a", roles: [] as const, entity_ids: [ENTITY_A] };
    expect(entityScopeFilter(ctx, "tenant_id")?.clause).toBe("tenant_id IN (?)");
  });
});

describe("scopeToEntities (in-memory form)", () => {
  const rows = [
    { entity_id: ENTITY_A, id: "1" },
    { entity_id: ENTITY_B, id: "2" },
  ];

  it("returns everything for bypass", () => {
    expect(scopeToEntities(rows, SYSTEM_AUTHORIZATION_CONTEXT)).toHaveLength(2);
  });
  it("filters to the allowlist", () => {
    const ctx = { actor_id: "a", roles: [] as const, entity_ids: [ENTITY_B] };
    expect(scopeToEntities(rows, ctx).map((r) => r.id)).toEqual(["2"]);
  });
  it("returns nothing for an unscoped principal", () => {
    const ctx = { actor_id: "a", roles: ["owner"] as const };
    expect(scopeToEntities(rows, ctx)).toEqual([]);
  });
});

describe("hasAllEntityAccess (group form)", () => {
  const ctx = { actor_id: "a", roles: [] as const, entity_ids: [ENTITY_A, ENTITY_B] };
  it("passes only when EVERY entity is allowed", () => {
    expect(hasAllEntityAccess(ctx, [ENTITY_A, ENTITY_B])).toBe(true);
    expect(hasAllEntityAccess(ctx, [ENTITY_A])).toBe(true);
    expect(hasAllEntityAccess(ctx, [ENTITY_A, ENTITY_C])).toBe(false);
  });
  it("passes vacuously for an empty group", () => {
    expect(hasAllEntityAccess(ctx, [])).toBe(true);
  });
});

describe("roleAllows", () => {
  it("grants exactly the mapped actions", () => {
    expect(roleAllows("readonly", "read")).toBe(true);
    expect(roleAllows("readonly", "write")).toBe(false);
    expect(roleAllows("dunning_operator", "run")).toBe(true);
    expect(roleAllows("dunning_operator", "write")).toBe(false);
    expect(roleAllows("owner", "admin")).toBe(true);
  });
});

describe("authorize (deny-by-default)", () => {
  it("passes a bypass principal without any role or scope", () => {
    expect(() => authorize("write", SYSTEM_AUTHORIZATION_CONTEXT, { entity_id: ENTITY_A })).not.toThrow();
  });

  it("denies an action the role does not grant even with entity access", () => {
    const ctx = { actor_id: "a", roles: ["readonly"] as const, entity_ids: [ENTITY_A] };
    expect(() => authorize("write", ctx, { entity_id: ENTITY_A })).toThrow(PermissionDeniedError);
  });

  it("denies entity access even for a role that grants the action", () => {
    const ctx = { actor_id: "a", roles: ["owner"] as const, entity_ids: [ENTITY_A] };
    expect(() => authorize("read", ctx, { entity_id: ENTITY_B })).toThrow(PermissionDeniedError);
  });

  it("denies an unscoped principal even with an owner role and a known entity id (id is not a capability)", () => {
    const ctx = { actor_id: "a", roles: ["owner"] as const };
    expect(() => authorize("read", ctx, { entity_id: ENTITY_A })).toThrow(PermissionDeniedError);
  });

  it("denies a group resource unless every entity is allowed", () => {
    const ctx = { actor_id: "a", roles: ["owner"] as const, entity_ids: [ENTITY_A] };
    expect(() => authorize("read", ctx, { entity_ids: [ENTITY_A, ENTITY_B] })).toThrow(PermissionDeniedError);
  });

  it("denies with the PERMISSION_DENIED code and a stable envelope", () => {
    const ctx = { actor_id: "a", roles: ["readonly"] as const, entity_ids: [ENTITY_A] };
    try {
      authorize("write", ctx, { entity_id: ENTITY_A, resource: "invoices" });
      throw new Error("expected denial");
    } catch (error) {
      expect(error).toBeInstanceOf(PermissionDeniedError);
      expect((error as PermissionDeniedError).code).toBe("PERMISSION_DENIED");
      expect((error as Error).message).toContain("invoices");
    }
  });
});

describe("authorizeAll", () => {
  it("passes when every action is allowed and aborts on the first denied", () => {
    const ctx = { actor_id: "a", roles: ["readonly"] as const, entity_ids: [ENTITY_A] };
    expect(() => authorizeAll(["read"], ctx, { entity_id: ENTITY_A })).not.toThrow();
    expect(() => authorizeAll(["read", "write"], ctx, { entity_id: ENTITY_A })).toThrow(PermissionDeniedError);
  });
});

describe("scopesForRoles", () => {
  it("unions the actions across roles without duplicates", () => {
    expect(scopesForRoles(["readonly", "auditor"]).sort()).toEqual(["export", "read"]);
    expect(scopesForRoles(["system"]).sort()).toEqual(["admin", "export", "read", "run", "write"]);
  });
});

describe("requireScopes (scope-string layer)", () => {
  it("skips the check for bypass principals", () => {
    expect(() => requireScopes(SYSTEM_AUTHORIZATION_CONTEXT, ["billing:write"])).not.toThrow();
  });

  it("denies when a required scope is missing, naming the missing scope", () => {
    const ctx = { actor_id: "a", roles: [] as const, scopes: ["billing:read"] };
    try {
      requireScopes(ctx, ["billing:read", "dunning:run"]);
      throw new Error("expected denial");
    } catch (error) {
      expect(error).toBeInstanceOf(PermissionDeniedError);
      expect((error as PermissionDeniedError).code).toBe("PERMISSION_DENIED");
      expect((error as Error).message).toContain("scope:dunning:run");
    }
  });

  it("passes when all required scopes are held", () => {
    const ctx = { actor_id: "a", roles: [] as const, scopes: ["billing:read", "dunning:run"] };
    expect(() => requireScopes(ctx, ["billing:read"])).not.toThrow();
  });
});
