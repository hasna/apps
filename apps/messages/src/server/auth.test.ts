/**
 * messages-serve credential gate (hasna/apps#1595).
 *
 * The defect these tests pin: messages authenticated /v1/* by comparing the
 * `x-api-key` header against ONE static string, so its client key could not be
 * scoped, expired or revoked and `hasna/oss/messages/api-key` could not be
 * minted like every other fleet app's. The gate now verifies contracts tokens
 * against the shared key store, and keeps the static key for one release.
 *
 * Two-sided throughout: every "must reject" has a "must accept" beside it, so
 * a gate that simply denies everything cannot pass this file.
 */
import { describe, expect, test } from "bun:test";
import { mintApiKey, type ApiKeyStatus } from "@hasna/contracts/auth";
import {
  APP,
  READ_SCOPE,
  SIGNING_SECRET_ENVS,
  STATIC_KEY_ENV,
  WRITE_SCOPE,
  createAuthGate,
  makeAuthQueryClient,
  requiredScopeFor,
  resolveSigningSecret,
  resolveStaticKey,
  secretEquals,
  type Env,
} from "./auth";

const SECRET = "test-signing-secret-for-messages";

/** A key-status resolver backed by a plain map — the revocation store, shimmed. */
function statusStore(statuses: Record<string, ApiKeyStatus>) {
  return (kid: string): Promise<ApiKeyStatus> => Promise.resolve(statuses[kid] ?? "unknown");
}

function mint(options: { scopes: string[]; ttlSeconds?: number | null; kid?: string; app?: string }) {
  return mintApiKey({
    app: options.app ?? APP,
    scopes: options.scopes,
    signingSecret: SECRET,
    ttlSeconds: options.ttlSeconds ?? null,
    agent: "fleet",
    kid: options.kid,
  });
}

function request(token?: string): Request {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers["x-api-key"] = token;
  return new Request("http://localhost/v1/agents", { headers });
}

/**
 * Gate with contracts auth on and a revocation store that holds NO rows — the
 * "this service has never heard of that kid" case, which the deprecated
 * boolean `isRevoked` hook resolved to ALLOW and `keyStatus` resolves to DENY.
 */
function gateWithEmptyStore(env: Env = {}) {
  return createAuthGate({
    env: { API_KEY_SIGNING_SECRET: SECRET, ...env },
    queryClient: { many: async () => [], get: async () => null, execute: async () => {} },
    warn: () => {},
  });
}

describe("credential resolution", () => {
  test("the signing secret is read in the documented order and trimmed (hasna/apps#1543)", () => {
    expect(SIGNING_SECRET_ENVS).toEqual([
      "API_KEY_SIGNING_SECRET",
      "HASNA_MESSAGES_API_SIGNING_KEY",
      "HASNA_API_SIGNING_KEY",
    ]);
    expect(resolveSigningSecret({ API_KEY_SIGNING_SECRET: "a", HASNA_MESSAGES_API_SIGNING_KEY: "b" })).toBe("a");
    expect(resolveSigningSecret({ HASNA_MESSAGES_API_SIGNING_KEY: "b", HASNA_API_SIGNING_KEY: "c" })).toBe("b");
    expect(resolveSigningSecret({ HASNA_API_SIGNING_KEY: "c" })).toBe("c");
    // Secrets Manager values carry a trailing newline; an untrimmed secret is
    // a different HMAC key from the one every verifier in the fleet uses.
    expect(resolveSigningSecret({ API_KEY_SIGNING_SECRET: "  a\n" })).toBe("a");
    // Two-sided: blank and absent are both "not configured".
    expect(resolveSigningSecret({ API_KEY_SIGNING_SECRET: "   " })).toBeUndefined();
    expect(resolveSigningSecret({})).toBeUndefined();
  });

  test("the legacy static key is trimmed, and blank means unset", () => {
    expect(resolveStaticKey({ [STATIC_KEY_ENV]: " sekrit \n" })).toBe("sekrit");
    expect(resolveStaticKey({ [STATIC_KEY_ENV]: "" })).toBeUndefined();
    expect(resolveStaticKey({})).toBeUndefined();
  });

  test("secretEquals compares equal and unequal values of both matching and differing length", () => {
    expect(secretEquals("abc", "abc")).toBe(true);
    expect(secretEquals("abc", "abd")).toBe(false);
    expect(secretEquals("abc", "abcd")).toBe(false);
    expect(secretEquals("", "")).toBe(true);
  });

  test("required scope follows the HTTP method", () => {
    expect(requiredScopeFor("GET")).toBe(READ_SCOPE);
    expect(requiredScopeFor("head")).toBe(READ_SCOPE);
    expect(requiredScopeFor("POST")).toBe(WRITE_SCOPE);
    expect(requiredScopeFor("DELETE")).toBe(WRITE_SCOPE);
  });

  test("no database URL means no revocation store rather than a thrown pool", () => {
    expect(makeAuthQueryClient({})).toBeNull();
    expect(makeAuthQueryClient({ HASNA_MESSAGES_DATABASE_URL: "   " })).toBeNull();
  });
});

describe("open mode (no credential configured)", () => {
  test("allows /v1/* and reports itself as open", async () => {
    const gate = createAuthGate({ env: {}, warn: () => {} });
    expect(gate.mode).toBe("open");
    expect(gate.required).toBe(false);
    expect(await gate.check(request(), "GET", "/v1/agents")).toBeNull();
  });
});

describe("legacy static key — accepted for one release", () => {
  test("the configured static key authenticates and anything else is refused", async () => {
    const warnings: string[] = [];
    const gate = createAuthGate({
      env: { [STATIC_KEY_ENV]: "sekrit" },
      warn: (m) => warnings.push(m),
    });
    expect(gate.mode).toBe("static");
    expect(gate.required).toBe(true);
    expect(await gate.check(request("sekrit"), "GET", "/v1/agents")).toBeNull();
    const denied = await gate.check(request("wrong"), "GET", "/v1/agents");
    expect(denied?.status).toBe(401);
    const missing = await gate.check(request(), "GET", "/v1/agents");
    expect(missing?.status).toBe(401);
  });

  test("warns exactly once that the static key is on its last release", async () => {
    const warnings: string[] = [];
    const gate = createAuthGate({ env: { [STATIC_KEY_ENV]: "sekrit" }, warn: (m) => warnings.push(m) });
    await gate.check(request("sekrit"), "GET", "/v1/agents");
    await gate.check(request("sekrit"), "GET", "/v1/agents");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(STATIC_KEY_ENV);
    // The warning must not contain the key itself.
    expect(warnings[0]).not.toContain("sekrit");
  });

  test("the static key is still accepted alongside contracts tokens during the transition", async () => {
    const minted = mint({ scopes: [READ_SCOPE], kid: "aaaa000000000000" });
    const gate = createAuthGate({
      env: { API_KEY_SIGNING_SECRET: SECRET, [STATIC_KEY_ENV]: "sekrit" },
      queryClient: null,
      warn: () => {},
    });
    expect(gate.mode).toBe("contracts");
    expect(await gate.check(request("sekrit"), "GET", "/v1/agents")).toBeNull();
    expect(await gate.check(request(minted.token), "GET", "/v1/agents")).toBeNull();
    expect((await gate.check(request("neither"), "GET", "/v1/agents"))?.status).toBe(401);
  });
});

describe("contracts key store", () => {
  test("a scoped, registered, unexpired token authenticates", async () => {
    const minted = mint({ scopes: [READ_SCOPE, WRITE_SCOPE], kid: "bbbb000000000000" });
    const gate = createAuthGate({
      env: { API_KEY_SIGNING_SECRET: SECRET },
      queryClient: null,
      warn: () => {},
    });
    expect(await gate.check(request(minted.token), "GET", "/v1/agents")).toBeNull();
    expect(await gate.check(request(minted.token), "POST", "/v1/messages")).toBeNull();
  });

  test("a read-only token is refused on a write and accepted on a read", async () => {
    const minted = mint({ scopes: [READ_SCOPE], kid: "cccc000000000000" });
    const gate = createAuthGate({ env: { API_KEY_SIGNING_SECRET: SECRET }, queryClient: null, warn: () => {} });
    expect(await gate.check(request(minted.token), "GET", "/v1/agents")).toBeNull();
    const denied = await gate.check(request(minted.token), "POST", "/v1/messages");
    expect(denied?.status).toBe(403);
    expect(await denied!.json()).toMatchObject({ reason: "insufficient_scope" });
  });

  test("a token minted for another app is refused", async () => {
    const foreign = mint({ scopes: ["todos:read"], app: "todos", kid: "dddd000000000000" });
    const gate = createAuthGate({ env: { API_KEY_SIGNING_SECRET: SECRET }, queryClient: null, warn: () => {} });
    expect((await gate.check(request(foreign.token), "GET", "/v1/agents"))?.status).toBe(401);
  });

  test("a token signed with a different secret is refused", async () => {
    const forged = mintApiKey({ app: APP, scopes: [READ_SCOPE], signingSecret: "a-different-signing-secret-16+", ttlSeconds: null });
    const gate = createAuthGate({ env: { API_KEY_SIGNING_SECRET: SECRET }, queryClient: null, warn: () => {} });
    expect((await gate.check(request(forged.token), "GET", "/v1/agents"))?.status).toBe(401);
  });

  test("an expired token is refused", async () => {
    const expired = mintApiKey({
      app: APP,
      scopes: [READ_SCOPE],
      signingSecret: SECRET,
      ttlSeconds: 60,
      nowMs: Date.now() - 3600_000,
      kid: "eeee000000000000",
    });
    const gate = createAuthGate({ env: { API_KEY_SIGNING_SECRET: SECRET }, queryClient: null, warn: () => {} });
    expect((await gate.check(request(expired.token), "GET", "/v1/agents"))?.status).toBe(401);
  });

  test("REVOCATION is what the static key could never do: a revoked kid is refused while an active one is not", async () => {
    const active = mint({ scopes: [READ_SCOPE], kid: "1111000000000000" });
    const revoked = mint({ scopes: [READ_SCOPE], kid: "2222000000000000" });
    const statuses = statusStore({ [active.kid]: "active", [revoked.kid]: "revoked" });

    // Drive the gate's verifier through a store whose keyStatus is the map.
    // `createAuthGate` builds the store from the query client, so the client
    // answers the store's SELECT with the row the status implies.
    const gate = createAuthGate({
      env: { API_KEY_SIGNING_SECRET: SECRET },
      queryClient: {
        many: async () => [],
        get: async (_sql, params) => {
          const kid = String((params ?? [])[0] ?? "");
          const status = await statuses(kid);
          if (status === "unknown") return null;
          return {
            kid,
            app: APP,
            agent: "fleet",
            tid: null,
            scopes: [READ_SCOPE],
            token_hash: "x",
            issued_at: new Date(Date.now() - 1000).toISOString(),
            expires_at: null,
            revoked_at: status === "revoked" ? new Date().toISOString() : null,
            revoked_reason: status === "revoked" ? "test" : null,
            last_used_at: null,
            created_by: null,
          } as never;
        },
        execute: async () => {},
      },
      warn: () => {},
    });

    expect(await gate.check(request(active.token), "GET", "/v1/agents")).toBeNull();
    const denied = await gate.check(request(revoked.token), "GET", "/v1/agents");
    expect(denied?.status).toBe(401);
  });

  test("an unregistered kid is refused once a revocation store exists", async () => {
    const orphan = mint({ scopes: [READ_SCOPE], kid: "3333000000000000" });
    const gate = gateWithEmptyStore();
    expect((await gate.check(request(orphan.token), "GET", "/v1/agents"))?.status).toBe(401);
  });

  test("a missing header is refused, and the denial body carries a reason but never the token", async () => {
    const gate = createAuthGate({ env: { API_KEY_SIGNING_SECRET: SECRET }, queryClient: null, warn: () => {} });
    const denied = await gate.check(request(), "GET", "/v1/agents");
    expect(denied?.status).toBe(401);
    const body = (await denied!.json()) as { error: string; reason: string };
    expect(body.reason).toBe("missing_token");
    expect(body.error).toBeTruthy();
  });
});
