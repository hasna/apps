/**
 * Regression tests for the secrets-serve /v1 auth wiring.
 *
 * MEASURED DEFECT (2026-08-23, apps/secrets at origin/main 709594ecf):
 *
 *   `bun test tests/serve.test.ts` failed 9 of 9 with
 *
 *     "verifyApiKey requires a key-status hook. Without one this service
 *      performs NO revocation check and cannot turn any of its keys off. Wire
 *      'keyStatus: store.keyStatus', or set 'allowUnregisteredKeys: true' to
 *      declare that this service intentionally cannot revoke keys."
 *
 *   thrown AT CONSTRUCTION by @hasna/contracts >= 0.8.7 (contracts #62). The
 *   test file built its verifier with neither hook; the REAL server wiring in
 *   serve.ts built it with `isRevoked: keyStore.isRevoked`, which the same
 *   guard refuses with the sibling message ("...only 'isRevoked', which cannot
 *   refuse a key this service has no record of..."). secrets-serve constructs
 *   the verifier during boot, so under the pinned contracts 0.13.4 the service
 *   could not start at all.
 *
 *   Same class as the @hasna/calendar 0.3.6 /v1 503 incident (row I38-00755,
 *   #967) and the @hasna/todos 0.15.38 one (row ae34a051, #769).
 *
 * These tests pin BOTH halves of what the fix buys:
 *   1. the real wiring constructs (the boot-time throw is gone), and
 *   2. it is STRICT — a validly-signed token with no api_keys record is
 *      denied. That second half is the behaviour `isRevoked`-only could not
 *      express, so a test that only asserted "does not throw" would pass on a
 *      wiring that accepts unregistered keys.
 */
import { describe, expect, test } from "bun:test";
import { mintApiKey } from "@hasna/contracts/auth";
import type { PoolQueryClient } from "../src/generated/storage-kit/index.js";
import { createCloudVerifier } from "../src/server/serve.js";

const SIGNING = "serve-auth-wiring-test-signing-secret";

type KeyRow = {
  kid: string;
  app: string;
  agent: string | null;
  tid: string | null;
  scopes: string;
  token_hash: string;
  issued_at: string;
  expires_at: string | null;
  created_by: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
};

/**
 * Minimal api_keys-backed client. `ApiKeyStore.keyStatus` reads exactly one
 * statement — `SELECT * FROM api_keys WHERE kid = $1` — so a kid-keyed map is
 * the whole surface needed, and an absent kid is the "never registered" case.
 */
function clientWithKeys(rows: Record<string, KeyRow> = {}): PoolQueryClient {
  return {
    async get(sql: string, params?: readonly unknown[]) {
      if (sql.includes("FROM api_keys")) return rows[String(params?.[0])] ?? null;
      return null;
    },
    async many() { return []; },
    async one() { return { ok: 1 }; },
    async query() { return { rows: [], rowCount: 0 }; },
    async execute() {},
  } as unknown as PoolQueryClient;
}

function row(kid: string, over: Partial<KeyRow> = {}): KeyRow {
  return {
    kid,
    app: "secrets",
    agent: null,
    tid: null,
    scopes: JSON.stringify(["secrets:*"]),
    token_hash: "unused-by-keyStatus",
    issued_at: new Date(0).toISOString(),
    expires_at: null,
    created_by: null,
    revoked_at: null,
    revoked_reason: null,
    ...over,
  };
}

function authenticate(verifier: ReturnType<typeof createCloudVerifier>, token?: string) {
  const headers = new Headers(token ? { "x-api-key": token } : {});
  return verifier.authenticate(headers, {
    method: "GET",
    path: "/v1/secrets",
    requiredScopes: ["secrets:read"],
  });
}

describe("real secrets-serve /v1 verifier wiring (src/server/serve.ts)", () => {
  test("constructs without throwing (contracts key-status guard regression)", () => {
    let verifier: ReturnType<typeof createCloudVerifier> | undefined;
    expect(() => {
      verifier = createCloudVerifier(clientWithKeys(), SIGNING);
    }).not.toThrow();
    expect(verifier?.app).toBe("secrets");
    expect(typeof verifier?.authenticate).toBe("function");
  });

  test("a validly-signed key with NO api_keys record is denied (strict keyStatus)", async () => {
    const minted = mintApiKey({ app: "secrets", scopes: ["secrets:*"], signingSecret: SIGNING });
    // Nothing registered: this is precisely the token `isRevoked`-only wiring
    // accepted, because it answers `false` (not revoked) for an unknown kid.
    const decision = await authenticate(createCloudVerifier(clientWithKeys(), SIGNING), minted.token);
    expect(decision.ok).toBe(false);
    expect(decision.ok === false && decision.status).toBe(401);
    expect(decision.ok === false && decision.reason).toBe("unknown_key");
  });

  test("a registered, active key is allowed", async () => {
    const minted = mintApiKey({ app: "secrets", scopes: ["secrets:*"], signingSecret: SIGNING });
    const verifier = createCloudVerifier(clientWithKeys({ [minted.kid]: row(minted.kid) }), SIGNING);
    const decision = await authenticate(verifier, minted.token);
    expect(decision.ok).toBe(true);
    expect(decision.ok === true && decision.principal.kid).toBe(minted.kid);
  });

  test("a registered but revoked key is denied", async () => {
    const minted = mintApiKey({ app: "secrets", scopes: ["secrets:*"], signingSecret: SIGNING });
    const revoked = row(minted.kid, { revoked_at: new Date(0).toISOString(), revoked_reason: "test" });
    const verifier = createCloudVerifier(clientWithKeys({ [minted.kid]: revoked }), SIGNING);
    const decision = await authenticate(verifier, minted.token);
    expect(decision.ok).toBe(false);
    expect(decision.ok === false && decision.status).toBe(401);
  });

  test("a registered but expired key is denied", async () => {
    const minted = mintApiKey({ app: "secrets", scopes: ["secrets:*"], signingSecret: SIGNING });
    const expired = row(minted.kid, { expires_at: new Date(Date.now() - 60_000).toISOString() });
    const verifier = createCloudVerifier(clientWithKeys({ [minted.kid]: expired }), SIGNING);
    const decision = await authenticate(verifier, minted.token);
    expect(decision.ok).toBe(false);
    expect(decision.ok === false && decision.status).toBe(401);
  });

  test("a keyless request fails closed with 401 missing_token", async () => {
    const decision = await authenticate(createCloudVerifier(clientWithKeys(), SIGNING));
    expect(decision.ok).toBe(false);
    expect(decision.ok === false && decision.status).toBe(401);
    expect(decision.ok === false && decision.reason).toBe("missing_token");
  });

  test("a forged token (wrong signing secret) is denied even when its kid is registered", async () => {
    const forged = mintApiKey({ app: "secrets", scopes: ["secrets:*"], signingSecret: "a-different-wrong-secret" });
    const verifier = createCloudVerifier(clientWithKeys({ [forged.kid]: row(forged.kid) }), SIGNING);
    const decision = await authenticate(verifier, forged.token);
    expect(decision.ok).toBe(false);
    expect(decision.ok === false && decision.status).toBe(401);
  });
});
