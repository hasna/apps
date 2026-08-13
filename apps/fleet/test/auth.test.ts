import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { authenticateToken, isApiAuthConfigured, scopesForRoles } from "../src/server/auth.js";
import { authorize, hasEntityAccess } from "../src/services/authorization.js";
import { PermissionDeniedError } from "../src/types/index.js";
import { buildApp } from "../src/server/app.js";
import { HASNA_INC, ACME_RO } from "../src/adapters/index.js";
import { cleanupTestDatabase, useTestDatabase } from "./helpers/database.js";

const CREDS = JSON.stringify([
  { id: "viewer-1", token: "viewer-token-aaaaaaaaaaaaaaaa", roles: ["viewer"], entity_ids: [HASNA_INC] },
  { id: "editor-1", token: "editor-token-bbbbbbbbbbbbbbbb", roles: ["editor"], entity_ids: [HASNA_INC] },
  { id: "revoked-1", token: "revoked-token-cccccccccccccccc", roles: ["owner"], revoked: true },
  { id: "expired-1", token: "expired-token-dddddddddddddddd", roles: ["owner"], expires_at: "2000-01-01T00:00:00Z" },
]);

let dbPath: string;

beforeEach(() => {
  dbPath = useTestDatabase("fleet-auth");
  process.env["HASNA_FLEET_API_CREDENTIALS"] = CREDS;
});

afterEach(() => {
  cleanupTestDatabase(dbPath);
  delete process.env["HASNA_FLEET_API_CREDENTIALS"];
});

describe("credential authentication", () => {
  it("maps a valid token to a scoped principal", () => {
    const p = authenticateToken("viewer-token-aaaaaaaaaaaaaaaa");
    expect(p?.credential_id).toBe("viewer-1");
    expect(p?.scopes).toEqual(["fleet:read"]);
    expect(p?.entity_ids).toEqual([HASNA_INC]);
  });

  it("rejects an unknown token (timing-safe compare returns null)", () => {
    expect(authenticateToken("not-a-real-token")).toBeNull();
    expect(authenticateToken("")).toBeNull();
  });

  it("honors revocation and expiry", () => {
    expect(authenticateToken("revoked-token-cccccccccccccccc")).toBeNull();
    expect(authenticateToken("expired-token-dddddddddddddddd")).toBeNull();
  });

  it("derives scopes from roles", () => {
    expect(scopesForRoles(["editor"])).toEqual(["fleet:read", "fleet:write", "fleet:export"]);
    expect(scopesForRoles(["owner"])).toContain("storage:admin");
  });

  it("reports auth configured when credentials are set", () => {
    expect(isApiAuthConfigured()).toBe(true);
  });
});

describe("authorization (deny-by-default + entity scoping)", () => {
  it("denies a write action for a viewer role", () => {
    expect(() => authorize("write", { actor_id: "v", roles: ["viewer"] })).toThrow(PermissionDeniedError);
  });

  it("allows a read action for a viewer role", () => {
    expect(() => authorize("read", { actor_id: "v", roles: ["viewer"] })).not.toThrow();
  });

  it("denies cross-entity access even with the right scope", () => {
    const ctx = { actor_id: "v", roles: ["editor" as const], entity_ids: [HASNA_INC] };
    expect(hasEntityAccess(ctx, HASNA_INC)).toBe(true);
    expect(hasEntityAccess(ctx, ACME_RO)).toBe(false);
    expect(() => authorize("write", ctx, { entity_id: ACME_RO })).toThrow(PermissionDeniedError);
  });

  it("denies an unscoped non-bypass principal — strict deny-by-default (§1c)", () => {
    // An entity_id is an authorized reference, never a bearer capability. A
    // principal with NO explicit entity set resolves to the EMPTY allowed set and
    // reaches NO entity, regardless of role. Only a SYSTEM bypass is unrestricted.
    expect(hasEntityAccess({ actor_id: "o", roles: ["owner"] }, ACME_RO)).toBe(false);
    expect(hasEntityAccess({ actor_id: "s", roles: ["system"], bypass: true }, ACME_RO)).toBe(true);
  });
});

describe("serve tier auth (fail-closed, deny-by-default)", () => {
  it("fails closed when binding non-loopback without credentials", () => {
    delete process.env["HASNA_FLEET_API_CREDENTIALS"];
    expect(() => buildApp({ bindHost: "0.0.0.0" })).toThrow();
  });

  it("rejects unauthenticated /v1 on a non-loopback bind", async () => {
    const app = buildApp({ bindHost: "0.0.0.0" });
    const res = await app.fetch(new Request("http://fleet.local/v1/slos"));
    expect(res.status).toBe(401);
  });

  it("allows an authenticated in-scope read", async () => {
    const app = buildApp({ bindHost: "0.0.0.0" });
    const res = await app.fetch(
      new Request("http://fleet.local/v1/slos", { headers: { Authorization: "Bearer viewer-token-aaaaaaaaaaaaaaaa" } }),
    );
    expect(res.status).toBe(200);
  });

  it("denies a cross-entity fused read (403)", async () => {
    const app = buildApp({ bindHost: "0.0.0.0" });
    const res = await app.fetch(
      new Request(`http://fleet.local/v1/health/agents?entity_id=${ACME_RO}`, {
        headers: { Authorization: "Bearer viewer-token-aaaaaaaaaaaaaaaa" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("denies a write to a viewer (missing scope, 403)", async () => {
    const app = buildApp({ bindHost: "0.0.0.0" });
    const res = await app.fetch(
      new Request("http://fleet.local/v1/saved-views", {
        method: "POST",
        headers: { Authorization: "Bearer viewer-token-aaaaaaaaaaaaaaaa", "Content-Type": "application/json" },
        body: JSON.stringify({ entity_id: HASNA_INC, name: "x", kind: "dashboard" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("leaves /health public and correctly shaped", async () => {
    const app = buildApp({ bindHost: "0.0.0.0" });
    const res = await app.fetch(new Request("http://fleet.local/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; version: string; mode: string };
    expect(body.status).toBe("ok");
    expect(body.mode).toBe("local");
  });
});
