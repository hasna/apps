import { beforeEach, describe, expect, test } from "bun:test";
import {
  ApiKeyStore,
  KEY_LIFECYCLE_BASE_PATH,
  createKeyLifecycleRoutes,
  keyLifecycleScope,
  mintApiKey,
  verifyApiKeyToken,
  type ApiKeyRecord,
  type AuthQueryClient,
  type KeyLifecycleRouter,
  type Row,
} from "../src/auth/index";

// hasna/apps#1595: a hosted service was unusable until somebody minted a client
// key by hand, inside the VPC, with the app's signing secret AND its owner
// Postgres URL. These tests pin the route that ends that: an operator-scoped
// key can mint, list and revoke over HTTPS, and nothing weaker can.

const SIGNING_SECRET = "c".repeat(64);
const APP = "messages";

/** An in-memory `AuthQueryClient`-shaped store, so the real ApiKeyStore is exercised. */
function memoryStore(): ApiKeyStore {
  const rows: Row[] = [];
  const client: AuthQueryClient = {
    async execute(sql, params = []) {
      if (/^INSERT INTO/.test(sql)) {
        const [kid, app, agent, tid, scopes, tokenHash, issuedAt, expiresAt, createdBy, revokedAt, revokedReason] =
          params as string[];
        if (rows.some((row) => row.kid === kid || row.token_hash === tokenHash)) {
          throw new Error("duplicate key");
        }
        rows.push({
          kid,
          app,
          agent: agent ?? null,
          tid: tid ?? null,
          scopes: JSON.parse(scopes as unknown as string),
          token_hash: tokenHash,
          issued_at: issuedAt,
          expires_at: expiresAt ?? null,
          created_by: createdBy ?? null,
          revoked_at: revokedAt ?? null,
          revoked_reason: revokedReason ?? null,
          last_used_at: null,
        });
      }
      // CREATE TABLE / CREATE INDEX / ALTER TABLE are no-ops here.
    },
    async get<T extends Row>(sql: string, params: readonly unknown[] = []) {
      if (/^UPDATE/.test(sql) && /revoked_at = COALESCE/.test(sql)) {
        const [kid, at, reason] = params as string[];
        const row = rows.find((candidate) => candidate.kid === kid);
        if (!row) return null;
        row.revoked_at = row.revoked_at ?? at;
        row.revoked_reason = row.revoked_reason ?? reason ?? null;
        return { kid } as unknown as T;
      }
      if (/^SELECT \* FROM/.test(sql)) {
        const [value] = params as string[];
        const row = /token_hash = \$1/.test(sql)
          ? rows.find((candidate) => candidate.token_hash === value)
          : rows.find((candidate) => candidate.kid === value);
        return (row ?? null) as T | null;
      }
      if (/^SELECT revoked_at/.test(sql)) {
        const [kid] = params as string[];
        const row = rows.find((candidate) => candidate.kid === kid);
        return (row ? ({ revoked_at: row.revoked_at } as unknown as T) : null);
      }
      return null;
    },
    async many<T extends Row>(sql: string, params: readonly unknown[] = []) {
      if (!/^SELECT \* FROM/.test(sql)) return [] as T[];
      const [app] = params as string[];
      return rows
        .filter((row) => (app ? row.app === app : true))
        .filter((row) => (/revoked_at IS NULL/.test(sql) ? row.revoked_at === null : true)) as T[];
    },
  };
  return new ApiKeyStore(client);
}

interface Fixture {
  router: KeyLifecycleRouter;
  store: ApiKeyStore;
  operatorKey: string;
  clientKey: string;
}

async function fixture(): Promise<Fixture> {
  const store = memoryStore();
  await store.ensureSchema();
  // A bootstrap key: `<app>:*` satisfies the operator scope.
  const operator = mintApiKey({ app: APP, scopes: [`${APP}:*`], agent: "bootstrap", signingSecret: SIGNING_SECRET });
  await store.insertMinted(operator, "test");
  const client = mintApiKey({ app: APP, scopes: [`${APP}:read`], agent: "fleet", signingSecret: SIGNING_SECRET });
  await store.insertMinted(client, "test");
  const router = createKeyLifecycleRoutes({
    app: APP,
    signingSecret: SIGNING_SECRET,
    store,
    keyStatus: store.keyStatus,
  });
  return { router, store, operatorKey: operator.token, clientKey: client.token };
}

function headers(key: string | null): Record<string, string> {
  return key ? { "x-api-key": key } : {};
}

let f: Fixture;
beforeEach(async () => {
  f = await fixture();
});

describe("operator key lifecycle route (hasna/apps#1595)", () => {
  test("mounts under /v1 and claims only its own paths", () => {
    expect(f.router.basePath).toBe(KEY_LIFECYCLE_BASE_PATH);
    expect(f.router.operatorScope).toBe(keyLifecycleScope(APP));
    expect(f.router.matches(`${KEY_LIFECYCLE_BASE_PATH}`)).toBe(true);
    expect(f.router.matches(`${KEY_LIFECYCLE_BASE_PATH}/abc?x=1`)).toBe(true);
    expect(f.router.matches("/v1/messages")).toBe(false);
    expect(f.router.matches("/v1/admin/keyszzz")).toBe(false);
  });

  test("mints a client key the service itself accepts, and returns it exactly once", async () => {
    const response = await f.router.handle({
      method: "POST",
      path: KEY_LIFECYCLE_BASE_PATH,
      headers: headers(f.operatorKey),
      body: { agent: "fleet", scopes: [`${APP}:read`, `${APP}:write`] },
    });
    expect(response.status).toBe(201);
    const minted = response.body as { key: string; kid: string; expires_at: string; scopes: string[] };
    expect(minted.scopes).toEqual([`${APP}:read`, `${APP}:write`]);
    expect(typeof minted.expires_at).toBe("string");

    const verified = verifyApiKeyToken(minted.key, { signingSecret: SIGNING_SECRET, expectedApp: APP });
    expect(verified.ok).toBe(true);
    expect(await f.store.status(minted.kid)).toBe("active");

    // The plaintext is never recoverable afterwards, and the listing never
    // carries the hash that would let one be checked offline.
    const listed = await f.router.handle({ method: "GET", path: KEY_LIFECYCLE_BASE_PATH, headers: headers(f.operatorKey) });
    expect(listed.status).toBe(200);
    const keys = (listed.body as { keys: Array<Record<string, unknown>> }).keys;
    const row = keys.find((entry) => entry.kid === minted.kid)!;
    expect(row.status).toBe("active");
    expect(row).not.toHaveProperty("token_hash");
    expect(JSON.stringify(listed.body)).not.toContain(minted.key);
  });

  test("a minted key that cannot be recorded is discarded, not returned", async () => {
    const store = memoryStore();
    await store.ensureSchema();
    const operator = mintApiKey({ app: APP, scopes: [`${APP}:*`], agent: "bootstrap", signingSecret: SIGNING_SECRET });
    await store.insertMinted(operator, "test");
    const router = createKeyLifecycleRoutes({
      app: APP,
      signingSecret: SIGNING_SECRET,
      keyStatus: store.keyStatus,
      store: {
        insertMinted: async () => {
          throw new Error("postgres is down");
        },
        list: (options) => store.list(options),
        revoke: (kid, reason, at) => store.revoke(kid, reason, at),
      },
    });
    const response = await router.handle({
      method: "POST",
      path: KEY_LIFECYCLE_BASE_PATH,
      headers: headers(operator.token),
      body: { agent: "fleet" },
    });
    expect(response.status).toBe(503);
    expect(response.body.reason).toBe("record_not_stored");
    expect(response.body).not.toHaveProperty("key");
  });

  test("revokes a key, and the service stops accepting it", async () => {
    const minted = (
      await f.router.handle({
        method: "POST",
        path: KEY_LIFECYCLE_BASE_PATH,
        headers: headers(f.operatorKey),
        body: { agent: "fleet" },
      })
    ).body as { kid: string };

    const revoked = await f.router.handle({
      method: "DELETE",
      path: `${KEY_LIFECYCLE_BASE_PATH}/${minted.kid}`,
      headers: headers(f.operatorKey),
      body: { reason: "rotated" },
    });
    expect(revoked.status).toBe(200);
    expect(revoked.body).toMatchObject({ kid: minted.kid, revoked: true, reason: "rotated" });
    expect(await f.store.status(minted.kid)).toBe("revoked");

    const missing = await f.router.handle({
      method: "POST",
      path: `${KEY_LIFECYCLE_BASE_PATH}/nosuchkid/revoke`,
      headers: headers(f.operatorKey),
    });
    expect(missing.status).toBe(404);
    expect(missing.body.reason).toBe("unknown_key");
  });

  test("the gate refuses everything that is not an operator key", async () => {
    const cases: Array<[string | null, number, string]> = [
      [null, 401, "missing_token"],
      ["hasna_messages_not-a-key", 401, "malformed"],
      [f.clientKey, 403, "insufficient_scope"],
    ];
    for (const [key, status, reason] of cases) {
      const response = await f.router.handle({
        method: "POST",
        path: KEY_LIFECYCLE_BASE_PATH,
        headers: headers(key),
        body: { agent: "intruder" },
      });
      expect(response.status, String(key)).toBe(status);
      expect(response.body.reason, String(key)).toBe(reason);
    }
    // Nothing was minted by any of them.
    const listed = await f.router.handle({ method: "GET", path: KEY_LIFECYCLE_BASE_PATH, headers: headers(f.operatorKey) });
    const agents = (listed.body as { keys: Array<Record<string, unknown>> }).keys.map((k) => k.agent);
    expect(agents).not.toContain("intruder");
  });

  test("a revoked operator key cannot mint", async () => {
    const verified = verifyApiKeyToken(f.operatorKey, { signingSecret: SIGNING_SECRET, expectedApp: APP });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    await f.store.revoke(verified.kid, "operator_rotated");
    const response = await f.router.handle({
      method: "POST",
      path: KEY_LIFECYCLE_BASE_PATH,
      headers: headers(f.operatorKey),
      body: { agent: "fleet" },
    });
    expect(response.status).toBe(401);
    expect(response.body.reason).toBe("revoked");
  });

  test("refuses scopes for another app, the superuser grant, and a bad ttl", async () => {
    const bad: Array<[Record<string, unknown>, string]> = [
      [{ agent: "fleet", scopes: ["todos:read"] }, "invalid_scopes"],
      [{ agent: "fleet", scopes: ["*"] }, "invalid_scopes"],
      [{ agent: "fleet", scopes: [] }, "invalid_scopes"],
      [{ agent: "   " }, "invalid_agent"],
      [{ agent: "fleet", ttl_days: 0 }, "invalid_ttl"],
      [{ agent: "fleet", ttl_days: 10_000 }, "invalid_ttl"],
      [{ agent: "fleet", tid: "bad tenant/id" }, "invalid_tid"],
    ];
    for (const [body, reason] of bad) {
      const response = await f.router.handle({
        method: "POST",
        path: KEY_LIFECYCLE_BASE_PATH,
        headers: headers(f.operatorKey),
        body,
      });
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.reason, JSON.stringify(body)).toBe(reason);
    }
  });

  test("`ttl_days: null` mints a key with no expiry", async () => {
    const response = await f.router.handle({
      method: "POST",
      path: KEY_LIFECYCLE_BASE_PATH,
      headers: headers(f.operatorKey),
      body: { agent: "fleet", ttl_days: null },
    });
    expect(response.status).toBe(201);
    expect((response.body as { expires_at: string | null }).expires_at).toBeNull();
  });

  test("a polluted Object.prototype cannot decide what gets signed", async () => {
    const proto = Object.prototype as unknown as Record<string, unknown>;
    proto.scopes = ["todos:*"];
    proto.tid = "00000000-0000-4000-8000-000000000000";
    try {
      const response = await f.router.handle({
        method: "POST",
        path: KEY_LIFECYCLE_BASE_PATH,
        headers: headers(f.operatorKey),
        body: JSON.stringify({ agent: "fleet" }),
      });
      expect(response.status).toBe(201);
      const minted = response.body as { key: string; scopes: string[]; tid: string | null };
      expect(minted.scopes).toEqual([`${APP}:read`, `${APP}:write`]);
      expect(minted.tid).toBeNull();
      const verified = verifyApiKeyToken(minted.key, { signingSecret: SIGNING_SECRET, expectedApp: APP });
      expect(verified.ok).toBe(true);
      if (verified.ok) expect(verified.tid).toBeNull();
    } finally {
      delete proto.scopes;
      delete proto.tid;
    }
  });

  test("unknown routes, methods, and bodies are refused rather than guessed", async () => {
    const notFound = await f.router.handle({ method: "GET", path: "/v1/messages", headers: headers(f.operatorKey) });
    expect(notFound.status).toBe(404);

    const badMethod = await f.router.handle({
      method: "PUT",
      path: KEY_LIFECYCLE_BASE_PATH,
      headers: headers(f.operatorKey),
    });
    expect(badMethod.status).toBe(405);

    const badBody = await f.router.handle({
      method: "POST",
      path: KEY_LIFECYCLE_BASE_PATH,
      headers: headers(f.operatorKey),
      body: "not json",
    });
    expect(badBody.status).toBe(400);
    expect(badBody.body.reason).toBe("invalid_body");

    const badKid = await f.router.handle({
      method: "DELETE",
      path: `${KEY_LIFECYCLE_BASE_PATH}/bad kid`,
      headers: headers(f.operatorKey),
    });
    expect(badKid.status).toBe(400);
    expect(badKid.body.reason).toBe("invalid_kid");
  });

  test("reads one key by kid without exposing its hash", async () => {
    const minted = (
      await f.router.handle({
        method: "POST",
        path: KEY_LIFECYCLE_BASE_PATH,
        headers: headers(f.operatorKey),
        body: { agent: "fleet" },
      })
    ).body as { kid: string; key: string };

    const read = await f.router.handle({
      method: "GET",
      path: `${KEY_LIFECYCLE_BASE_PATH}/${minted.kid}`,
      headers: headers(f.operatorKey),
    });
    expect(read.status).toBe(200);
    const record = (read.body as { key: Record<string, unknown> }).key;
    expect(record.kid).toBe(minted.kid);
    expect(record.agent).toBe("fleet");
    expect(record).not.toHaveProperty("token_hash");
    expect(JSON.stringify(read.body)).not.toContain(minted.key);
  });

  test("mounting without a key-status hook fails at boot, not on the first request", () => {
    const store = memoryStore();
    expect(() => createKeyLifecycleRoutes({ app: APP, signingSecret: SIGNING_SECRET, store })).toThrow(
      /key-status hook/,
    );
  });
});

describe("key lifecycle records", () => {
  test("the listing reports the lifecycle status a verifier would apply", async () => {
    const expired = mintApiKey({
      app: APP,
      scopes: [`${APP}:read`],
      agent: "stale",
      signingSecret: SIGNING_SECRET,
      ttlSeconds: 1,
      nowMs: 1_000,
    });
    await f.store.insertMinted(expired, "test");
    const listed = await f.router.handle({
      method: "GET",
      path: `${KEY_LIFECYCLE_BASE_PATH}?include_revoked=1`,
      headers: headers(f.operatorKey),
    });
    const rows = (listed.body as { keys: Array<Record<string, unknown>> }).keys;
    const row = rows.find((entry) => entry.kid === expired.kid) as unknown as ApiKeyRecord & { status: string };
    expect(row.status).toBe("expired");
  });
});
