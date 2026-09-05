/**
 * Regression tests for the @hasna/todos 0.15.38 /v1 503 incident
 * (todos row ae34a051, incident 720366).
 *
 * MEASURED ROOT CAUSE (2026-08-21, reproduced against the exact deployed image
 * `todos@sha256:29acd21b…`, task def todos-prod:52):
 *
 *   Every /v1 business route returned HTTP 503 with a VALID API key while
 *   /health and /version returned 200. The 503 body was:
 *
 *     "verifyApiKey was given only 'isRevoked', which cannot refuse a key this
 *      service has no record of: it returns false both for an active key and
 *      for one that was never registered, so an unregistered key is
 *      irrevocable. Wire 'keyStatus: store.keyStatus' (or 'isRevoked:
 *      store.statusChecker()'), or set 'allowUnregisteredKeys: true' to accept
 *      that risk explicitly."
 *
 *   That message is thrown AT CONSTRUCTION by @hasna/contracts >= 0.8.7
 *   (contracts #62, "verifyApiKey refuses unknown key ids, and requires a
 *   status hook") when the deprecated `isRevoked`-only wiring is used. The
 *   server constructs the verifier LAZILY on the first /v1 request
 *   (getCloudVerifier in cloud.ts), and v1.ts turns the construction throw
 *   into HTTP 503. /health and /version never construct the verifier, which is
 *   why they stayed 200.
 *
 *   The version-wave lockfile regeneration (#761) moved apps/todos from the
 *   stale-locked @hasna/contracts 0.5.2 (which predates the 0.8.7 breaking
 *   change and accepted the deprecated wiring) to 0.13.1 — the deployed
 *   0.15.36 was healthy precisely because its lockfile had never been
 *   regenerated, so the image shipped contracts 0.5.2.
 *
 * These tests pin the wiring the incident broke: the REAL cloud.ts verifier
 * must construct (not throw) when signing secret + DB URL are configured, and
 * a keyless request must fail closed through it. The full valid-key → 200
 * round trip against a real Postgres lives in
 * cloud-auth-wiring.pg.test.ts (TODOS_TEST_PG_URL lane).
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ApiKeyVerifier } from "@hasna/contracts/auth";
import { closeCloud, getCloudVerifier, resolveSigningSecret } from "./cloud.js";

const SIGNING_SECRET_ENV_VARS = [
  "HASNA_TODOS_API_SIGNING_KEY",
  "HASNA_API_SIGNING_KEY",
  "API_KEY_SIGNING_SECRET",
] as const;

const DATABASE_URL_ENV_VARS = [
  "HASNA_TODOS_DATABASE_URL",
  "TODOS_DATABASE_URL",
  "DATABASE_URL",
] as const;

/** Unreachable-but-well-formed DSN: construction must stay lazy, never connect. */
const DUMMY_DB_URL = "postgres://todos_test:unused@127.0.0.1:1/todos?sslmode=disable";
const TEST_SIGNING_SECRET = "cloud-auth-wiring-test-signing-secret";

function clearCloudEnv(): void {
  for (const name of [...SIGNING_SECRET_ENV_VARS, ...DATABASE_URL_ENV_VARS]) {
    delete process.env[name];
  }
}

function setConfiguredCloudEnv(): void {
  process.env.API_KEY_SIGNING_SECRET = TEST_SIGNING_SECRET;
  process.env.DATABASE_URL = DUMMY_DB_URL;
}

describe("real /v1 verifier wiring (src/server/cloud.ts)", () => {
  beforeEach(async () => {
    clearCloudEnv();
    // Reset the module-level caches (verifier/store/client) so each test
    // exercises a fresh construction path.
    await closeCloud().catch(() => {});
  });

  afterEach(async () => {
    clearCloudEnv();
    await closeCloud().catch(() => {});
  });

  it("constructs without throwing when signing secret + DB URL are configured (incident regression)", () => {
    // The 0.15.38 incident: with both configured, getCloudVerifier() threw the
    // contracts >= 0.8.7 construction guard because cloud.ts wired the
    // deprecated `isRevoked` hook, and v1.ts turned the throw into a 503 on
    // every /v1 route.
    setConfiguredCloudEnv();
    let verifier: ApiKeyVerifier | undefined;
    expect(() => {
      verifier = getCloudVerifier();
    }).not.toThrow();
    expect(typeof verifier?.authenticate).toBe("function");
  });

  it("refuses to construct without a signing secret (fail-closed)", () => {
    process.env.DATABASE_URL = DUMMY_DB_URL;
    expect(() => getCloudVerifier()).toThrow(/signing secret/i);
  });

  it("refuses to construct without a database URL (fail-closed)", () => {
    process.env.API_KEY_SIGNING_SECRET = TEST_SIGNING_SECRET;
    expect(() => getCloudVerifier()).toThrow(/database url/i);
  });

  it("a keyless /v1 request fails closed with 401 through the real verifier", async () => {
    setConfiguredCloudEnv();
    const verifier = getCloudVerifier();
    // The server path hands `req.headers` (a Headers instance) to authenticate
    // — mirror that shape exactly.
    const req = new Request("https://todos.example.test/v1/tasks");
    const decision = await verifier.authenticate(req.headers, {
      method: "GET",
      path: "/v1/tasks",
      requiredScopes: ["todos:read"],
    });
    expect(decision.ok).toBe(false);
    expect(decision.status).toBe(401);
    expect(decision.reason).toBe("missing_token");
  });

  it("a validly-signed token with insufficient scope is refused (403, not 200)", async () => {
    setConfiguredCloudEnv();
    const { mintApiKey } = await import("@hasna/contracts/auth");
    const minted = mintApiKey({
      app: "todos",
      scopes: ["todos:read"],
      signingSecret: TEST_SIGNING_SECRET,
      agent: "wiring-test",
    });
    const verifier = getCloudVerifier();
    const req = new Request("https://todos.example.test/v1/tasks", {
      headers: { "x-api-key": minted.token },
    });
    const decision = await verifier.authenticate(req.headers, {
      method: "POST",
      path: "/v1/tasks",
      requiredScopes: ["todos:write"],
    });
    // The token is well-formed and signed; the scope refusal is decided BEFORE
    // any DB status lookup, so this is assertable without a database.
    expect(decision.ok).toBe(false);
    expect(decision.status).toBe(403);
    expect(decision.reason).toBe("insufficient_scope");
  });
});

describe("resolveSigningSecret", () => {
  it("trims a trailing newline from a stored signing secret (hasna/apps#1543)", () => {
    // The fleet stores api-key-signing-secret values with a trailing newline
    // (64 hex chars + '\n'); the server verify path must key the HMAC with the
    // same bytes issue-key signs with, so every candidate is trimmed at read.
    const stored = "a1".repeat(32) + "\n";
    expect(resolveSigningSecret({ HASNA_TODOS_API_SIGNING_KEY: stored })).toBe(stored.trim());
    expect(resolveSigningSecret({ HASNA_API_SIGNING_KEY: stored })).toBe(stored.trim());
    expect(resolveSigningSecret({ API_KEY_SIGNING_SECRET: stored })).toBe(stored.trim());
  });

  it("stays undefined when no signing secret is configured", () => {
    expect(resolveSigningSecret({})).toBeUndefined();
  });
});
