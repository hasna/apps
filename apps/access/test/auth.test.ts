import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { authenticateApiRequest, authorizeApiRequest, principalToContext } from "../src/server/auth.js";

const CREDS = [
  { id: "reader", token: "tok-reader", roles: ["auditor"], entity_ids: ["E1"] },
  { id: "writer", token: "tok-writer", roles: ["identity_admin"], entity_ids: ["E1"] },
  { id: "expired", token: "tok-expired", roles: ["owner"], expires_at: "2000-01-01T00:00:00Z" },
  { id: "revoked", token: "tok-revoked", roles: ["owner"], revoked: true },
];

function req(token?: string): Request {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return new Request("http://127.0.0.1/v1/identities", { headers });
}

beforeEach(() => {
  process.env["HASNA_ACCESS_API_CREDENTIALS"] = JSON.stringify(CREDS);
});
afterEach(() => {
  delete process.env["HASNA_ACCESS_API_CREDENTIALS"];
});

describe("serve auth stack", () => {
  it("authenticates a valid token and maps roles to scopes", () => {
    const principal = authenticateApiRequest(req("tok-reader"));
    expect(principal?.credential_id).toBe("reader");
    expect(principal?.scopes).toContain("access:read");
  });

  it("rejects an unknown token (timing-safe compare, no match)", () => {
    expect(authenticateApiRequest(req("nope"))).toBeNull();
    const result = authorizeApiRequest(req("nope"), { scopes: ["access:read"] });
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(401);
  });

  it("denies by default when a required scope is missing", () => {
    const result = authorizeApiRequest(req("tok-reader"), { scopes: ["identity:admin"] });
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(403);
    expect(result.code).toBe("PERMISSION_DENIED");
  });

  it("allows when the principal has the required scope", () => {
    const result = authorizeApiRequest(req("tok-writer"), { scopes: ["identity:admin"] });
    expect(result.allowed).toBe(true);
  });

  it("enforces entity/org scoping (cross-entity read denied)", () => {
    const result = authorizeApiRequest(req("tok-reader"), { scopes: ["access:read"], entity_id: "E2" });
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(403);
  });

  it("honors expiry and revocation", () => {
    expect(authenticateApiRequest(req("tok-expired"))).toBeNull();
    expect(authenticateApiRequest(req("tok-revoked"))).toBeNull();
  });

  it("builds a service context from a principal", () => {
    const principal = authenticateApiRequest(req("tok-writer"))!;
    const ctx = principalToContext(principal);
    expect(ctx.roles).toContain("identity_admin");
    expect(ctx.entity_ids).toEqual(["E1"]);
  });

  it("requires auth when credentials are configured (no unauthenticated bypass)", () => {
    const result = authorizeApiRequest(req(), { scopes: ["access:read"] });
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(401);
  });
});
