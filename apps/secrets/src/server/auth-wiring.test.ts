/**
 * Regression tests for the @hasna/secrets 0.3.4 boot-crash (todos row
 * 0650cc5e): the deprecated `isRevoked`-only verifyApiKey wiring.
 *
 * MEASURED ROOT CAUSE (2026-08-21, three independent instances):
 *
 *   secrets 0.3.4 crashed at container boot (ECS taskdef :17, auto-rolled
 *   back) with
 *
 *     "verifyApiKey was given only 'isRevoked', which cannot refuse a key this
 *      service has no record of: it returns false both for an active key and
 *      for one that was never registered, so an unregistered key is
 *      irrevocable. Wire 'keyStatus: store.keyStatus' (or 'isRevoked:
 *      store.statusChecker()'), or set 'allowUnregisteredKeys: true' to accept
 *      that risk explicitly."
 *
 *   @hasna/contracts >= 0.8.7 (contracts #62, "verifyApiKey refuses unknown
 *   key ids, and requires a status hook") throws AT CONSTRUCTION when
 *   verifyApiKey is wired with only the deprecated `isRevoked` hook.
 *   apps/secrets builds the verifier EAGERLY inside startCloudServer, so the
 *   throw was a container boot failure (unlike todos' lazy per-request
 *   construction, which 503'd every /v1 route — hasna/apps#769 fixed that
 *   with exactly this migration: `keyStatus: store.keyStatus`).
 *
 * These tests pin the corrected wiring: the REAL production construction
 * (getCloudVerifier) must construct without throwing, and authenticate() must
 * follow the keyStatus contract — a registered active key allows; an
 * unregistered (unknown) kid denies with 401 unknown_key; a revoked key
 * denies with 401 revoked; an expired key denies with 401 expired.
 */
import { describe, expect, it } from "bun:test";
import {
  ApiKeyStore,
  mintApiKey,
  type ApiKeyVerifier,
  type MintedApiKey,
} from "@hasna/contracts/auth";
import { getCloudVerifier } from "./serve.js";

const SIGNING = "test-signing-secret-please-rotate";
const APP = "secrets";

/** Minimal in-memory AuthQueryClient over a kid -> api_keys row map. */
function memoryClient(rows: Map<string, Record<string, unknown>>) {
  return {
    async many<T extends Record<string, unknown>>() {
      return [] as T[];
    },
    async get<T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      // ApiKeyStore.findByKid / status(): `SELECT * FROM api_keys WHERE kid = $1`
      if (sql.includes("WHERE kid = $1")) return (rows.get(String(params?.[0])) as T | undefined) ?? null;
      return null;
    },
    async execute() {},
  };
}

/** api_keys row for a minted key; the store must never see the plaintext token. */
function rowFor(
  minted: MintedApiKey,
  overrides: { revoked_at?: string | null; expires_at?: string | null } = {},
): Record<string, unknown> {
  return {
    kid: minted.kid,
    app: APP,
    agent: minted.claims.agent ?? null,
    scopes: JSON.stringify(minted.claims.scopes),
    token_hash: minted.tokenHash,
    issued_at: new Date(0).toISOString(),
    expires_at: overrides.expires_at ?? null,
    revoked_at: overrides.revoked_at ?? null,
    revoked_reason: null,
    last_used_at: null,
    created_by: null,
  };
}

function mintedKey(): MintedApiKey {
  return mintApiKey({
    app: APP,
    scopes: ["secrets:read", "secrets:write"],
    signingSecret: SIGNING,
    agent: "auth-wiring-test",
  });
}

describe("real cloud verifier wiring (src/server/serve.ts getCloudVerifier)", () => {
  it("constructs without throwing when wired with the keyStatus hook (0.3.4 boot-crash regression)", () => {
    // The 0.3.4 incident: verifyApiKey() threw the contracts >= 0.8.7
    // construction guard because serve.ts wired the deprecated `isRevoked`
    // hook, and the throw happened at BOOT (eager construction), crashing the
    // container.
    const keyStore = new ApiKeyStore(memoryClient(new Map()));
    let verifier: ApiKeyVerifier | undefined;
    expect(() => {
      verifier = getCloudVerifier(keyStore, SIGNING);
    }).not.toThrow();
    expect(typeof verifier?.authenticate).toBe("function");
  });

  it("a registered active key authenticates (allow)", async () => {
    const m = mintedKey();
    const rows = new Map([[m.kid, rowFor(m)]]);
    const verifier = getCloudVerifier(new ApiKeyStore(memoryClient(rows)), SIGNING);
    const decision = await verifier.authenticate({ "x-api-key": m.token });
    expect(decision.ok).toBe(true);
  });

  it("an unregistered (unknown) key is refused with 401 unknown_key", async () => {
    const m = mintedKey();
    // The kid was never inserted into api_keys: keyStatus reports "unknown".
    const verifier = getCloudVerifier(new ApiKeyStore(memoryClient(new Map())), SIGNING);
    const decision = await verifier.authenticate({ "x-api-key": m.token });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.status).toBe(401);
      expect(decision.reason).toBe("unknown_key");
    }
  });

  it("a revoked key is refused with 401 revoked", async () => {
    const m = mintedKey();
    const rows = new Map([[m.kid, rowFor(m, { revoked_at: new Date().toISOString() })]]);
    const verifier = getCloudVerifier(new ApiKeyStore(memoryClient(rows)), SIGNING);
    const decision = await verifier.authenticate({ "x-api-key": m.token });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.status).toBe(401);
      expect(decision.reason).toBe("revoked");
    }
  });

  it("an expired key is refused with 401 expired", async () => {
    const m = mintedKey();
    const rows = new Map([[m.kid, rowFor(m, { expires_at: new Date(0).toISOString() })]]);
    const verifier = getCloudVerifier(new ApiKeyStore(memoryClient(rows)), SIGNING);
    const decision = await verifier.authenticate({ "x-api-key": m.token });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.status).toBe(401);
      expect(decision.reason).toBe("expired");
    }
  });
});
