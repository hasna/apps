/**
 * Hermetic coverage for the dormant v2 identities-JWS verification path
 * (auth.ts / _AUTH-TENANCY-STANDARD-v2 §1.3). Generates a real Ed25519 key,
 * serves its public JWK from a stubbed JWKS endpoint, and asserts fail-closed
 * behaviour: a valid token binds the tenant from claims; a token that is
 * unsigned/expired/misaudienced/tenant-less is rejected. No network, no DB
 * writes beyond the in-memory store seed.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import { resolveContext, type AuthConfig } from "../../src/http/auth.js";
import { InMemoryControlPlaneStore } from "../../src/http/store-memory.js";
import { HttpError } from "../../src/http/envelope.js";
import { APP_NAME } from "../../src/http/context.js";

const JWKS_URL = "https://identities.test/v1/.well-known/jwks.json";
const KID = "test-ed25519-1";

function b64u(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function makeToken(privateKey: KeyObject, claims: Record<string, unknown>): string {
  const header = b64u(JSON.stringify({ alg: "EdDSA", kid: KID, typ: "at+jwt" }));
  const payload = b64u(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const sig = cryptoSign(null, Buffer.from(signingInput, "utf8"), privateKey);
  return `${signingInput}.${b64u(sig)}`;
}

describe("v2 identities-JWS verification (dormant path)", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = { ...(publicKey.export({ format: "jwk" }) as object), kid: KID, alg: "EdDSA" };
  const config: AuthConfig = { jwksUrl: JWKS_URL, issuer: "identities" };
  const store = new InMemoryControlPlaneStore();
  const realFetch = globalThis.fetch;
  const future = Math.floor(Date.now() / 1000) + 3600;

  beforeEach(() => {
    // Stub the JWKS endpoint so the verifier can fetch the public key.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input) === JWKS_URL) {
        return new Response(JSON.stringify({ keys: [jwk] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function req(token: string): Request {
    return new Request("https://sandboxes.test/v1/whoami", {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  test("a valid EdDSA token binds tenant/user/scopes from claims", async () => {
    const token = makeToken(privateKey, {
      iss: "identities",
      aud: APP_NAME,
      exp: future,
      tid: "11111111-1111-1111-1111-111111111111",
      uid: "22222222-2222-2222-2222-222222222222",
      pt: "user",
      scopes: ["sandboxes:read", "sandboxes:allocate"],
    });
    const ctx = await resolveContext(req(token), store, config);
    expect(ctx.via).toBe("jws");
    expect(ctx.tenantId).toBe("11111111-1111-1111-1111-111111111111");
    expect(ctx.userId).toBe("22222222-2222-2222-2222-222222222222");
    expect(ctx.principalType).toBe("user");
    expect(ctx.scopes).toEqual(["sandboxes:read", "sandboxes:allocate"]);
  });

  test("a token minted for a DIFFERENT app is rejected (403)", async () => {
    const token = makeToken(privateKey, { iss: "identities", aud: "todos", exp: future, tid: "t" });
    await expect(resolveContext(req(token), store, config)).rejects.toMatchObject({ status: 403 });
  });

  test("a token with NO audience is rejected (not treated as audience-less-ok)", async () => {
    const token = makeToken(privateKey, { iss: "identities", exp: future, tid: "t" });
    await expect(resolveContext(req(token), store, config)).rejects.toBeInstanceOf(HttpError);
  });

  test("a token with no expiry is rejected (401)", async () => {
    const token = makeToken(privateKey, { iss: "identities", aud: APP_NAME, tid: "t" });
    await expect(resolveContext(req(token), store, config)).rejects.toMatchObject({ status: 401 });
  });

  test("an expired token is rejected (401)", async () => {
    const token = makeToken(privateKey, {
      iss: "identities",
      aud: APP_NAME,
      exp: Math.floor(Date.now() / 1000) - 10,
      tid: "t",
    });
    await expect(resolveContext(req(token), store, config)).rejects.toMatchObject({ status: 401 });
  });

  test("a token from an untrusted issuer is rejected (401)", async () => {
    const token = makeToken(privateKey, { iss: "evil", aud: APP_NAME, exp: future, tid: "t" });
    await expect(resolveContext(req(token), store, config)).rejects.toMatchObject({ status: 401 });
  });

  test("a tampered signature is rejected (401)", async () => {
    const token = makeToken(privateKey, { iss: "identities", aud: APP_NAME, exp: future, tid: "t" });
    const parts = token.split(".");
    const forged = `${parts[0]}.${parts[1]}.${"A".repeat(parts[2]!.length)}`;
    await expect(resolveContext(req(forged), store, config)).rejects.toMatchObject({ status: 401 });
  });

  test("a verified token carrying no tenant claim is 403 tenant_unresolved", async () => {
    const token = makeToken(privateKey, { iss: "identities", aud: APP_NAME, exp: future });
    await expect(resolveContext(req(token), store, config)).rejects.toMatchObject({
      status: 403,
      code: "tenant_unresolved",
    });
  });
});
