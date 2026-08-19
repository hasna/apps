// Coverage lane (tests-coverage-sol workflow, Sol advisory Priority 1): the
// deny-by-default authorization stack in src/services/authorization.ts had ZERO
// direct tests at origin/main — auth.test.ts only exercised the transport tier.
// These tests pin the FULL role/action matrix (every role x every action, both
// the allowed and the denied arm), hasEntityAccess / hasAllEntityAccess (a group
// requires EVERY entity, not any one), allowedEntityIds ([] for an unscoped
// non-bypass principal, null ONLY for bypass), entityScopeFilter ("1 = 0" for an
// empty allowlist, an exact IN clause otherwise), scopeToEntities post-filtering,
// scopesForRoles union, authorize()/authorizeAll() deny-by-default, and
// SYSTEM_AUTHORIZATION_CONTEXT bypass semantics — so a permissive default cannot
// pass.
import { describe, expect, it } from "bun:test";
import {
  SYSTEM_AUTHORIZATION_CONTEXT,
  allActions,
  allowedEntityIds,
  authorize,
  authorizeAll,
  entityScopeFilter,
  hasAllEntityAccess,
  hasEntityAccess,
  principalCanSeeEntity,
  roleAllows,
  rolePermissions,
  scopeToEntities,
  scopesForRoles,
} from "../src/services/authorization.js";
import type { AuthorizationAction, AuthorizationRole } from "../src/services/authorization.js";
import { PermissionDeniedError } from "../src/types/index.js";

const ACTIONS: AuthorizationAction[] = ["read", "write", "register", "renew", "export", "admin"];

const ROLES: AuthorizationRole[] = ["system", "owner", "admin", "holdings_manager", "paralegal", "viewer", "auditor", "integration"];

describe("roleAllows — full deny-by-default role/action matrix", () => {
  const expected: Record<AuthorizationRole, Set<AuthorizationAction>> = {
    system: new Set(ACTIONS),
    owner: new Set(ACTIONS),
    admin: new Set(ACTIONS),
    holdings_manager: new Set(["read", "write", "register", "renew", "export"]),
    paralegal: new Set(["read", "write", "register", "renew"]),
    viewer: new Set(["read"]),
    auditor: new Set(["read", "export"]),
    integration: new Set(["read", "write", "export"]),
  };

  it("every (role, action) pair is either granted or denied — the exact matrix, both arms", () => {
    for (const role of ROLES) {
      for (const action of ACTIONS) {
        expect(roleAllows(role, action), `${role}.${action}`).toBe(expected[role]!.has(action));
      }
    }
  });

  it("no role can perform an action outside the declared vocabulary", () => {
    for (const role of ROLES) {
      for (const action of rolePermissions[role]) {
        expect(ACTIONS, `${role} grants unknown action ${String(action)}`).toContain(action);
      }
    }
    // The exported vocabulary itself matches the domain action list.
    expect(allActions).toEqual(ACTIONS);
  });

  it("the rolePermissions source of truth matches roleAllows (no drift between the map and the predicate)", () => {
    for (const role of ROLES) {
      for (const action of ACTIONS) {
        expect(roleAllows(role, action)).toBe(rolePermissions[role].has(action));
      }
    }
  });
});

describe("hasEntityAccess — entity allowlist, never a bearer capability", () => {
  it("bypass (SYSTEM context) is unrestricted for any entity id and for none", () => {
    expect(hasEntityAccess(SYSTEM_AUTHORIZATION_CONTEXT, "any-id-1234")).toBe(true);
    expect(hasEntityAccess(SYSTEM_AUTHORIZATION_CONTEXT, undefined)).toBe(true);
  });

  it("an allowed id passes; any other id is denied (positive + negative arm)", () => {
    const ctx = { actor_id: "a", roles: ["holdings_manager"] as AuthorizationRole[], entity_ids: ["entity-A"] };
    expect(hasEntityAccess(ctx, "entity-A")).toBe(true);
    expect(hasEntityAccess(ctx, "entity-B")).toBe(false);
  });

  it("an unscoped non-bypass principal reaches NO entity — empty allowlist is deny-by-default", () => {
    const ctx = { actor_id: "a", roles: ["viewer"] as AuthorizationRole[] };
    expect(hasEntityAccess(ctx, "entity-A")).toBe(false);
    expect(hasEntityAccess(ctx, "entity-B")).toBe(false);
  });

  it("a resource with no entity to check is not blocked by scoping", () => {
    const ctx = { actor_id: "a", roles: ["viewer"] as AuthorizationRole[] };
    expect(hasEntityAccess(ctx, undefined)).toBe(true);
  });

  it("org_id and org_ids aliases count as allowed entity ids (legacy compatibility)", () => {
    expect(hasEntityAccess({ actor_id: "a", roles: [], org_id: "org-1" }, "org-1")).toBe(true);
    expect(hasEntityAccess({ actor_id: "a", roles: [], org_id: "org-1" }, "org-2")).toBe(false);
    expect(hasEntityAccess({ actor_id: "a", roles: [], org_ids: ["org-A", "org-B"] }, "org-B")).toBe(true);
    expect(hasEntityAccess({ actor_id: "a", roles: [], org_ids: ["org-A", "org-B"] }, "org-C")).toBe(false);
  });
});

describe("hasAllEntityAccess — a group resource requires EVERY entity, not any one", () => {
  const scopedA = { actor_id: "a", roles: ["holdings_manager"] as AuthorizationRole[], entity_ids: ["A"] };
  const scopedAB = { actor_id: "a", roles: ["holdings_manager"] as AuthorizationRole[], entity_ids: ["A", "B"] };

  it("passes only when the principal is scoped to every entity in the group", () => {
    expect(hasAllEntityAccess(scopedAB, ["A", "B"])).toBe(true);
    expect(hasAllEntityAccess(scopedA, ["A", "B"])).toBe(false); // ALL, not any
    expect(hasAllEntityAccess(scopedAB, ["A", "B", "C"])).toBe(false);
  });

  it("an unscoped non-bypass principal fails every non-empty group", () => {
    const unscoped = { actor_id: "a", roles: ["viewer"] as AuthorizationRole[] };
    expect(hasAllEntityAccess(unscoped, ["A"])).toBe(false);
    expect(hasAllEntityAccess(unscoped, ["A", "B"])).toBe(false);
  });

  it("bypass passes any group, and the empty group passes vacuously", () => {
    expect(hasAllEntityAccess(SYSTEM_AUTHORIZATION_CONTEXT, ["A", "B", "C"])).toBe(true);
    expect(hasAllEntityAccess(scopedA, [])).toBe(true);
  });
});

describe("allowedEntityIds — [] for every non-bypass principal, null ONLY for bypass", () => {
  it("the SYSTEM bypass context and an omitted context resolve to null (unconstrained)", () => {
    expect(allowedEntityIds(SYSTEM_AUTHORIZATION_CONTEXT)).toBeNull();
    expect(allowedEntityIds(undefined)).toBeNull(); // defaults to the SYSTEM context
  });

  it("an unscoped non-bypass principal resolves to the EMPTY array — never a wildcard", () => {
    const ctx = { actor_id: "a", roles: ["viewer"] as AuthorizationRole[] };
    expect(allowedEntityIds(ctx)).toEqual([]);
  });

  it("unions entity_id, entity_ids, org_id and org_ids into one deduplicated allowlist", () => {
    const ctx = {
      actor_id: "a",
      roles: [] as AuthorizationRole[],
      entity_id: "e1",
      entity_ids: ["e2", "e3", "e1"],
      org_id: "o1",
      org_ids: ["o2"],
    };
    const ids = allowedEntityIds(ctx)!;
    expect([...ids].sort()).toEqual(["e1", "e2", "e3", "o1", "o2"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("bypass stays null even when an entity allowlist is present", () => {
    expect(allowedEntityIds({ ...SYSTEM_AUTHORIZATION_CONTEXT, entity_ids: ["e1"] })).toBeNull();
  });
});

describe("principalCanSeeEntity", () => {
  it("unconstrained principals see everything; constrained principals only their allowlist", () => {
    expect(principalCanSeeEntity("anything", SYSTEM_AUTHORIZATION_CONTEXT)).toBe(true);
    const empty = { actor_id: "a", roles: ["viewer"] as AuthorizationRole[] };
    expect(principalCanSeeEntity("anything", empty)).toBe(false);
    const scoped = { actor_id: "a", roles: [], entity_ids: ["A"] };
    expect(principalCanSeeEntity("A", scoped)).toBe(true);
    expect(principalCanSeeEntity("B", scoped)).toBe(false);
  });
});

describe("entityScopeFilter — SQL isolation by construction", () => {
  it("returns null for an unconstrained (bypass) principal — no predicate", () => {
    expect(entityScopeFilter(SYSTEM_AUTHORIZATION_CONTEXT)).toBeNull();
  });

  it("an empty allowlist yields the always-false '1 = 0' with no params", () => {
    const empty = { actor_id: "a", roles: ["viewer"] as AuthorizationRole[] };
    expect(entityScopeFilter(empty)).toEqual({ clause: "1 = 0", params: [] });
  });

  it("a non-empty allowlist yields an exact IN clause over exactly the allowed ids", () => {
    const scoped = { actor_id: "a", roles: [], entity_ids: ["A", "B"] };
    expect(entityScopeFilter(scoped)).toEqual({ clause: "entity_id IN (?, ?)", params: ["A", "B"] });
    const single = { actor_id: "a", roles: [], entity_id: "A" };
    expect(entityScopeFilter(single)).toEqual({ clause: "entity_id IN (?)", params: ["A"] });
  });

  it("honors a custom column name and never leaks ids as literals", () => {
    const scoped = { actor_id: "a", roles: [], entity_ids: ["A"] };
    const filter = entityScopeFilter(scoped, "tenant_id")!;
    expect(filter.clause).toBe("tenant_id IN (?)");
    expect(filter.params).toEqual(["A"]);
  });
});

describe("scopeToEntities — in-memory post-filtering", () => {
  const rows = [
    { entity_id: "A", name: "a" },
    { entity_id: "B", name: "b" },
  ];

  it("an unconstrained principal receives every row unchanged", () => {
    expect(scopeToEntities(rows, SYSTEM_AUTHORIZATION_CONTEXT)).toEqual(rows);
  });

  it("a constrained principal keeps only its allowlisted rows", () => {
    const scoped = { actor_id: "a", roles: [], entity_ids: ["A"] };
    expect(scopeToEntities(rows, scoped)).toEqual([{ entity_id: "A", name: "a" }]);
  });

  it("an empty allowlist drops every row", () => {
    const empty = { actor_id: "a", roles: ["viewer"] as AuthorizationRole[] };
    expect(scopeToEntities(rows, empty)).toEqual([]);
  });
});

describe("scopesForRoles — union of role grants", () => {
  it("unions the per-role actions and deduplicates", () => {
    expect(scopesForRoles(["viewer"])).toEqual(["read"]);
    expect([...scopesForRoles(["viewer", "auditor"])].sort()).toEqual(["export", "read"]);
    expect(scopesForRoles([])).toEqual([]);
    expect(scopesForRoles(["owner"])).toEqual(allActions);
    expect(scopesForRoles(["holdings_manager"])).toEqual(["read", "write", "register", "renew", "export"]);
  });
});

describe("authorize — deny by default on BOTH dimensions", () => {
  const scopedA = { actor_id: "mgr", roles: ["holdings_manager"] as AuthorizationRole[], entity_ids: ["A"] };
  const viewerA = { actor_id: "view", roles: ["viewer"] as AuthorizationRole[], entity_ids: ["A"] };

  it("SYSTEM bypass passes any action on any resource, including foreign entities", () => {
    expect(() => authorize("admin", SYSTEM_AUTHORIZATION_CONTEXT, { entity_id: "foreign", resource: "entity" })).not.toThrow();
    expect(() => authorize("write", SYSTEM_AUTHORIZATION_CONTEXT, {})).not.toThrow();
  });

  it("an unscoped non-bypass principal is denied even for a role-allowed action — empty allowlist reaches no entity", () => {
    const unscoped = { actor_id: "view", roles: ["viewer"] as AuthorizationRole[] };
    expect(() => authorize("read", unscoped, { entity_id: "A", resource: "entity" })).toThrow(PermissionDeniedError);
  });

  it("a role that lacks the action is denied even with the entity allowed", () => {
    expect(() => authorize("write", viewerA, { entity_id: "A", resource: "asset" })).toThrow(PermissionDeniedError);
  });

  it("an entity outside the allowlist is denied even with a role that has the action", () => {
    expect(() => authorize("read", scopedA, { entity_id: "B", resource: "asset" })).toThrow(PermissionDeniedError);
  });

  it("an allowed role on an allowed entity passes", () => {
    expect(() => authorize("write", scopedA, { entity_id: "A", resource: "asset" })).not.toThrow();
  });

  it("a group resource is denied when ANY member entity is outside the allowlist", () => {
    expect(() => authorize("read", scopedA, { entity_ids: ["A", "B"], resource: "consolidation" })).toThrow(PermissionDeniedError);
    expect(() => authorize("read", scopedA, { entity_ids: ["A"], resource: "consolidation" })).not.toThrow();
    const scopedAB = { actor_id: "mgr", roles: ["holdings_manager"] as AuthorizationRole[], entity_ids: ["A", "B"] };
    expect(() => authorize("read", scopedAB, { entity_ids: ["A", "B"], resource: "consolidation" })).not.toThrow();
  });

  it("a resource with no entity binding is gated by action only — and the error names the action and resource", () => {
    expect(() => authorize("read", viewerA, {})).not.toThrow();
    try {
      authorize("write", viewerA, { resource: "settings" });
      throw new Error("expected PermissionDeniedError");
    } catch (error) {
      expect(error).toBeInstanceOf(PermissionDeniedError);
      expect((error as PermissionDeniedError).code).toBe("PERMISSION_DENIED");
      expect((error as PermissionDeniedError).message).toContain("'write'");
      expect((error as PermissionDeniedError).message).toContain("settings");
    }
  });
});

describe("authorizeAll — every listed action must pass", () => {
  const scopedA = { actor_id: "mgr", roles: ["holdings_manager"] as AuthorizationRole[], entity_ids: ["A"] };

  it("passes when every action is granted", () => {
    expect(() => authorizeAll(["read", "write"], scopedA, { entity_id: "A", resource: "asset" })).not.toThrow();
  });

  it("throws when ANY listed action is denied", () => {
    expect(() => authorizeAll(["read", "admin"], scopedA, { entity_id: "A", resource: "asset" })).toThrow(PermissionDeniedError);
  });
});

describe("SYSTEM_AUTHORIZATION_CONTEXT shape", () => {
  it("is the system actor with the system role and bypass set", () => {
    expect(SYSTEM_AUTHORIZATION_CONTEXT.actor_id).toBe("system");
    expect(SYSTEM_AUTHORIZATION_CONTEXT.roles).toEqual(["system"]);
    expect(SYSTEM_AUTHORIZATION_CONTEXT.bypass).toBe(true);
    expect(roleAllows("system", "admin")).toBe(true);
  });
});
