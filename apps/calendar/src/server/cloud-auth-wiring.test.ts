/**
 * Regression tests for the @hasna/calendar 0.3.6 /v1 503 incident
 * (row I38-00755, deploy-oss-fleet-0823a confirm 725517).
 *
 * MEASURED ROOT CAUSE (2026-08-23, live against the deployed calendar@0.3.6):
 *
 *   Every /v1 business route returned HTTP 503 with a VALID API key while
 *   /health returned 200. The 503 body was:
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
 *   This is the same contracts isRevoked-only class as the @hasna/todos
 *   0.15.38 /v1 503 incident (row ae34a051, incident 720366), fixed at the
 *   root by hasna/apps#769 ("wire keyStatus store hook"). Calendar carried the
 *   deprecated wiring into the 0.3.6 lockfile regeneration that moved it from
 *   @hasna/contracts ^0.4.2 to the pinned 0.13.3.
 *
 * These tests pin the wiring the incident broke: the REAL cloud.ts verifier
 * must construct (not throw) when signing secret + DB URL are configured, and
 * a keyless request must fail closed through it.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ApiKeyVerifier, ApiKeyStore } from "@hasna/contracts/auth";
import { closeCloud, getCloudVerifier, resolveSigningSecret, type CalendarApiKeyVerifier, type CalendarApiKeyStore } from "./cloud.js";

// Structural conformance (hasna/apps#1782): the local spellings this package
// PUBLISHES must accept the real @hasna/contracts values — the runtime values
// at the seam ARE the contracts objects, cast only here. A drift fails this
// assignment at compile time.
const _verifierConformance: ApiKeyVerifier = undefined as unknown as CalendarApiKeyVerifier;
const _storeConformance: ApiKeyStore = undefined as unknown as CalendarApiKeyStore;

const SIGNING_SECRET_ENV_VARS = [
  "HASNA_CALENDAR_API_SIGNING_KEY",
  "HASNA_API_SIGNING_KEY",
  "API_KEY_SIGNING_SECRET",
] as const;

const DATABASE_URL_ENV_VARS = [
  "HASNA_CALENDAR_DATABASE_URL",
  "CALENDAR_DATABASE_URL",
] as const;

/** Unreachable-but-well-formed DSN: construction must stay lazy, never connect. */
const DUMMY_DB_URL = "postgres://calendar_test:unused@127.0.0.1:1/calendar?sslmode=verify-full";
const TEST_SIGNING_SECRET = "cloud-auth-wiring-test-signing-secret";

function clearCloudEnv(): void {
  for (const name of [...SIGNING_SECRET_ENV_VARS, ...DATABASE_URL_ENV_VARS]) {
    delete process.env[name];
  }
}

function setConfiguredCloudEnv(): void {
  process.env.API_KEY_SIGNING_SECRET = TEST_SIGNING_SECRET;
  process.env.HASNA_CALENDAR_DATABASE_URL = DUMMY_DB_URL;
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
    // The 0.3.6 incident: with both configured, getCloudVerifier() threw the
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
    process.env.HASNA_CALENDAR_DATABASE_URL = DUMMY_DB_URL;
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
    const req = new Request("https://calendar.example.test/v1/events");
    const decision = await verifier.authenticate(req.headers, {
      method: "GET",
      path: "/v1/events",
      requiredScopes: ["calendar:read"],
    });
    expect(decision.ok).toBe(false);
    expect(decision.status).toBe(401);
    expect(decision.reason).toBe("missing_token");
  });
});

describe("resolveSigningSecret", () => {
  it("trims a trailing newline from a stored signing secret (hasna/apps#1543)", () => {
    // The fleet stores api-key-signing-secret values with a trailing newline
    // (64 hex chars + '\n'); the server verify path must key the HMAC with the
    // same bytes issue-key signs with, so every candidate is trimmed at read.
    const stored = "a1".repeat(32) + "\n";
    expect(resolveSigningSecret({ HASNA_CALENDAR_API_SIGNING_KEY: stored })).toBe(stored.trim());
    expect(resolveSigningSecret({ HASNA_API_SIGNING_KEY: stored })).toBe(stored.trim());
    expect(resolveSigningSecret({ API_KEY_SIGNING_SECRET: stored })).toBe(stored.trim());
  });

  it("stays undefined when no signing secret is configured", () => {
    expect(resolveSigningSecret({})).toBeUndefined();
  });
});
