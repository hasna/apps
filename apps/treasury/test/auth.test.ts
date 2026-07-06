import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { authenticateToken } from "../src/server/auth.js";
import { seedFixture, scopedContext, clearCredentials, type Fixture } from "./helpers.js";
import { getEntity, listEntities } from "../src/services/entities.js";
import { recordBalance } from "../src/services/balances.js";
import { generateSweeps } from "../src/services/sweeps.js";
import type { ApiPrincipal } from "../src/server/auth.js";

let fx: Fixture;
beforeEach(async () => {
  fx = await seedFixture();
});
afterEach(() => {
  fx.cleanup();
  clearCredentials();
});

function cred(overrides: Record<string, unknown>): void {
  process.env["HASNA_TREASURY_API_CREDENTIALS"] = JSON.stringify([{ id: "c1", token: "secret-token", ...overrides }]);
}

describe("auth — credential authentication", () => {
  it("authenticates a valid bearer token to a principal", () => {
    cred({ roles: ["treasurer"], entity_ids: [fx.usId] });
    const p = authenticateToken("secret-token");
    expect(p?.credential_id).toBe("c1");
    expect(p?.scopes).toContain("treasury:write");
    expect(p?.entity_ids).toEqual([fx.usId]);
  });

  it("rejects an unknown / wrong-length token (timing-safe compare)", () => {
    cred({ roles: ["treasurer"] });
    expect(authenticateToken("wrong")).toBeNull();
    expect(authenticateToken("")).toBeNull();
  });

  it("honors revocation and expiry", () => {
    cred({ roles: ["owner"], revoked: true });
    expect(authenticateToken("secret-token")).toBeNull();
    cred({ roles: ["owner"], expires_at: "2000-01-01T00:00:00.000Z" });
    expect(authenticateToken("secret-token")).toBeNull();
  });
});

describe("auth — scope + entity authorization (deny by default)", () => {
  function principal(roles: ApiPrincipal["roles"], scopes: ApiPrincipal["scopes"], entity_ids?: string[]): ApiPrincipal {
    return { credential_id: "p", credential_type: "api_key", actor_id: "p", roles, scopes, ...(entity_ids ? { entity_ids } : {}) };
  }

  it("denies a write when the principal lacks the write scope", async () => {
    const rc = scopedContext(fx.db, principal(["analyst"], ["treasury:read", "treasury:recommend"], [fx.usId]));
    await expect(
      recordBalance(rc, { entity_id: fx.usId, account_ref: "a", account_kind: "bank", currency: "USD", amount_minor: 1 }),
    ).rejects.toThrow(/Permission denied/);
  });

  it("denies cross-entity reads (entity_id is an authorized reference, not a capability)", async () => {
    const rc = scopedContext(fx.db, principal(["treasurer"], ["treasury:read", "treasury:write"], [fx.usId]));
    await expect(getEntity(rc, { entity_id: fx.roId })).rejects.toThrow(/Permission denied/);
    // but the entity it IS scoped to resolves fine
    const us = await getEntity(rc, { entity_id: fx.usId });
    expect(us.entity_id).toBe(fx.usId);
  });

  it("deny-by-default: a principal scoped to no entities sees nothing", async () => {
    const rc = scopedContext(fx.db, principal(["treasurer"], ["treasury:read"], []));
    expect(await listEntities(rc)).toEqual([]);
    await expect(getEntity(rc, { entity_id: fx.usId })).rejects.toThrow(/Permission denied/);
  });

  it("denies recommend without the recommend scope", async () => {
    const rc = scopedContext(fx.db, principal(["auditor"], ["treasury:read", "treasury:export"], [fx.usId, fx.roId]));
    await expect(generateSweeps(rc, { base: "USD" })).rejects.toThrow(/Permission denied/);
  });
});
