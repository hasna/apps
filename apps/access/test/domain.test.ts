import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { createIdentity, getIdentity, listIdentities, setIdentityStatus } from "../src/services/identities.js";
import { registerCredential, listCredentials } from "../src/services/credentials.js";
import { grantScope, effectiveScopes, listScopes } from "../src/services/scopes.js";
import { requestElevation, approveElevation, expireElevations, listElevations } from "../src/services/elevations.js";
import { scheduleReview, setReviewStatus } from "../src/services/reviews.js";
import { executeRevocation } from "../src/services/revocations.js";
import { issueToken, verifyToken, revokeToken } from "../src/services/tokens.js";
import { PermissionDeniedError, ValidationError } from "../src/types/index.js";
import { SYSTEM_AUTHORIZATION_CONTEXT, type AuthorizationContext } from "../src/services/authorization.js";
import { cleanupTestDatabase, useTestDatabase } from "./helpers/database.js";

let dbPath: string;
const E1 = randomUUID();
const E2 = randomUUID();

beforeEach(() => {
  dbPath = useTestDatabase("access-domain");
});
afterEach(() => {
  cleanupTestDatabase(dbPath);
  delete process.env["HASNA_ACCESS_TOKEN_SIGNING_KEY"];
  delete process.env["ACCESS_TOKEN_SIGNING_KEY"];
  delete process.env["HASNA_ACCESS_TOKEN_SIGNING_KEY_FILE"];
  delete process.env["ACCESS_TOKEN_SIGNING_KEY_FILE"];
  delete process.env["HASNA_ACCESS_BIND_HOST"];
  delete process.env["ACCESS_BIND_HOST"];
  delete process.env["HASNA_ACCESS_MCP_BIND_HOST"];
  delete process.env["ACCESS_MCP_BIND_HOST"];
  delete process.env["HASNA_ACCESS_STORAGE_MODE"];
});

function newIdentity(entityId = E1) {
  return createIdentity({ entity_id: entityId, kind: "agent", name: "bot" });
}

describe("identities", () => {
  it("creates and reads an identity anchored to an entity", () => {
    const created = newIdentity();
    expect(created.entity_id).toBe(E1);
    expect(getIdentity(created.id).name).toBe("bot");
  });

  it("rejects a non-UUID entity_id", () => {
    expect(() => createIdentity({ entity_id: "not-a-uuid", kind: "agent", name: "x" })).toThrow(ValidationError);
  });

  it("lifecycle status transitions are audited", () => {
    const created = newIdentity();
    expect(setIdentityStatus(created.id, "suspended").status).toBe("suspended");
  });
});

describe("entity scoping (deny by default)", () => {
  it("denies a principal scoped to E1 from reading an E2 identity", () => {
    const e2Identity = newIdentity(E2);
    const ctx: AuthorizationContext = { actor_id: "reader", roles: ["auditor"], entity_ids: [E1] };
    expect(() => getIdentity(e2Identity.id, ctx)).toThrow(PermissionDeniedError);
  });

  it("filters list results to the principal's allowed entities", () => {
    newIdentity(E1);
    newIdentity(E2);
    const ctx: AuthorizationContext = { actor_id: "reader", roles: ["auditor"], entity_ids: [E1] };
    const visible = listIdentities({}, ctx);
    expect(visible.every((i) => i.entity_id === E1)).toBe(true);
  });
});

describe("credentials store references only", () => {
  it("registers a secret reference", () => {
    const id = newIdentity();
    const cred = registerCredential({ identity_id: id.id, name: "prod key", kind: "api_key", secret_ref: "hasna/agents/bot/token" });
    expect(cred.secret_ref).toBe("hasna/agents/bot/token");
    expect(listCredentials({ identity_id: id.id })).toHaveLength(1);
  });

  it("rejects a raw secret value masquerading as a ref", () => {
    const id = newIdentity();
    expect(() => registerCredential({ identity_id: id.id, name: "leak", kind: "api_key", secret_ref: "sk-ant-abc123" })).toThrow(ValidationError);
    expect(() => registerCredential({ identity_id: id.id, name: "plain", kind: "api_key", secret_ref: "plainref" })).toThrow(ValidationError);
  });
});

describe("scopes + JIT elevation", () => {
  it("grants a permanent scope and reports it as effective", () => {
    const id = newIdentity();
    grantScope({ identity_id: id.id, scope: "wallets:read" });
    expect(effectiveScopes(id.id)).toContain("wallets:read");
    expect(listScopes({ identity_id: id.id })).toHaveLength(1);
  });

  it("a JIT elevation is pending until approval, then grants a temporary scope until it expires", () => {
    const id = newIdentity();
    const elevation = requestElevation({ identity_id: id.id, scope: "secrets:write", reason: "rotate", ttl_minutes: 60 });
    expect(elevation.status).toBe("pending");
    expect(effectiveScopes(id.id)).not.toContain("secrets:write");
    const approved = approveElevation(elevation.id, "andrei");
    expect(approved.status).toBe("active");
    expect(effectiveScopes(id.id)).toContain("secrets:write");
    const pendingExpiry = requestElevation({ identity_id: id.id, scope: "pending:expired", reason: "x", expires_at: new Date(Date.now() + 200).toISOString() });
    const activeExpiry = requestElevation({ identity_id: id.id, scope: "active:expired", reason: "x", expires_at: new Date(Date.now() + 200).toISOString() });
    approveElevation(activeExpiry.id, "andrei");
    Bun.sleepSync(250);
    const swept = expireElevations();
    expect(swept.expired).toBeGreaterThanOrEqual(2);
    expect(listElevations({ identity_id: id.id, status: "expired" }).length).toBeGreaterThanOrEqual(1);
    expect(listElevations({ identity_id: id.id, status: "expired" }).map((row) => row.id)).toContain(pendingExpiry.id);
    expect(effectiveScopes(id.id)).not.toContain("active:expired");
  });
});

describe("access reviews", () => {
  it("schedules and completes a recertification review", () => {
    const review = scheduleReview({ entity_id: E1, name: "Q3 recert" });
    expect(review.status).toBe("scheduled");
    expect(setReviewStatus(review.id, "completed", undefined, "andrei").status).toBe("completed");
  });
});

describe("tokens (MCP bearer-token issuer)", () => {
  it("issues, verifies, and revokes a token", () => {
    const id = newIdentity();
    grantScope({ identity_id: id.id, scope: "wallets:read" });
    const issued = issueToken({ identity_id: id.id });
    expect(issued.record).not.toHaveProperty("token_hash");
    const verified = verifyToken(issued.token);
    expect(verified.valid).toBe(true);
    expect(verified.identity_id).toBe(id.id);
    expect(verified.scopes).toContain("wallets:read");
    revokeToken(issued.record.id, "compromised");
    expect(() => verifyToken(issued.token)).toThrow(/revoked/);
  });

  it("refuses to issue a token with un-granted scopes", () => {
    const id = newIdentity();
    expect(() => issueToken({ identity_id: id.id, scopes: ["secrets:*"] })).toThrow(ValidationError);
  });

  it("refuses non-SYSTEM token entity widening outside the identity home entity", () => {
    const id = newIdentity(E1);
    grantScope({ identity_id: id.id, scope: "wallets:read" });
    const issuerCtx: AuthorizationContext = { actor_id: "issuer", roles: ["issuer"], entity_ids: [E1, E2] };
    expect(() => issueToken({ identity_id: id.id, scopes: ["wallets:read"], entity_ids: [E1, E2] }, issuerCtx)).toThrow(ValidationError);

    const systemIssued = issueToken(
      { identity_id: id.id, scopes: ["wallets:read"], entity_ids: [E1, E2] },
      SYSTEM_AUTHORIZATION_CONTEXT,
    );
    expect(verifyToken(systemIssued.token).entity_ids).toEqual([E1, E2]);
  });

  it("enforces signing key posture and TTL ceilings", () => {
    const id = newIdentity();
    process.env["HASNA_ACCESS_BIND_HOST"] = "0.0.0.0";
    expect(() => issueToken({ identity_id: id.id })).toThrow(ValidationError);

    process.env["HASNA_ACCESS_TOKEN_SIGNING_KEY"] = "x".repeat(32);
    const issued = issueToken({ identity_id: id.id, ttl_minutes: 60 });
    expect(verifyToken(issued.token).valid).toBe(true);
    expect(() => issueToken({ identity_id: id.id, ttl_minutes: 61 })).toThrow(ValidationError);

    delete process.env["HASNA_ACCESS_BIND_HOST"];
    delete process.env["HASNA_ACCESS_TOKEN_SIGNING_KEY"];
    expect(() => issueToken({ identity_id: id.id, ttl_minutes: 24 * 60 + 1 })).toThrow(ValidationError);
  });

  it("fails closed instead of using the dev signing key in cloud mode", () => {
    process.env["HASNA_ACCESS_STORAGE_MODE"] = "cloud";
    expect(() => issueToken({ identity_id: "not-read" })).toThrow(ValidationError);
    expect(() => verifyToken("a.b.c")).toThrow(/signing key/);
  });
});

describe("one-click revocation", () => {
  it("cascades across an identity, revoking credentials/scopes/tokens", () => {
    const id = newIdentity();
    registerCredential({ identity_id: id.id, name: "k", kind: "api_key", secret_ref: "hasna/x/y" });
    grantScope({ identity_id: id.id, scope: "wallets:read" });
    issueToken({ identity_id: id.id, scopes: ["wallets:read"] });
    const result = executeRevocation({ identity_id: id.id, target_type: "identity", reason: "offboarded" });
    expect(result.affected).toBeGreaterThanOrEqual(3);
    expect(getIdentity(id.id).status).toBe("suspended");
    expect(listCredentials({ identity_id: id.id, status: "active" })).toHaveLength(0);
  });
});
