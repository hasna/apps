import { describe, expect, test } from "bun:test";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { createHandler } from "../src/server/serve.js";
import { secretScope } from "../src/server/secret-access.js";
import type { CloudSecretsStore } from "../src/server/cloud-store.js";

const SIGNING = "test-signing-secret-please-rotate";

function fakeClient() {
  return {
    async get() { return { ok: 1 }; },
    async many() { return []; },
    async one() { return { ok: 1 }; },
    async query() { return { rows: [], rowCount: 0 }; },
    async execute() {},
  } as any;
}

// In-memory store implementing the surface createHandler calls.
function fakeStore() {
  const secrets = new Map<string, any>();
  return {
    async setSecret(key, value, type, label, expiresAt, _actor) {
      const now = new Date().toISOString();
      const entry = { key, value, type, label, expires_at: expiresAt, created_at: now, updated_at: now };
      secrets.set(key, entry);
      return entry;
    },
    async getSecret(key) { return secrets.get(key); },
    async deleteSecret(key) { return secrets.delete(key); },
    async listSecretMetadata() {
      return [...secrets.values()].map(({ value, ...m }) => m);
    },
    async searchSecretMetadata(q) {
      return [...secrets.values()].filter((s) => s.key.includes(q)).map(({ value, ...m }) => m);
    },
    async listVaultItemMetadata() { return []; },
    async searchVaultItemMetadata() { return []; },
    async getAuditLog() { return []; },
    async listUsers() { return []; },
  } as unknown as CloudSecretsStore;
}

function handler(store = fakeStore()) {
  const verifier = verifyApiKey({ app: "secrets", signingSecret: SIGNING });
  return createHandler({ client: fakeClient(), store, verifier });
}

function keyWith(scopes: string[]): string {
  return mintApiKey({ app: "secrets", scopes, signingSecret: SIGNING }).token;
}

describe("secrets serve", () => {
  test("health/version/ready need no auth", async () => {
    const h = handler();
    for (const path of ["/health", "/version", "/ready"]) {
      const res = await h(new Request(`http://x${path}`));
      const body = await res.json();
      expect(body.version).toBeDefined();
      expect(body.mode).toBe("cloud");
    }
  });

  test("openapi.json is served", async () => {
    const res = await handler()(new Request("http://x/openapi.json"));
    const doc = await res.json();
    expect(doc.openapi).toBe("3.0.3");
    expect(doc.paths["/v1/secrets"]).toBeDefined();
  });

  test("v1 rejects missing key with 401", async () => {
    const res = await handler()(new Request("http://x/v1/secrets"));
    expect(res.status).toBe(401);
  });

  test("v1 rejects a forged token", async () => {
    const bad = mintApiKey({ app: "secrets", scopes: ["secrets:*"], signingSecret: "a-different-wrong-signing-secret" }).token;
    const res = await handler()(new Request("http://x/v1/secrets", { headers: { "x-api-key": bad } }));
    expect(res.status).toBe(401);
  });

  test("read scope cannot write (403)", async () => {
    const res = await handler()(
      new Request("http://x/v1/secrets", {
        method: "POST",
        headers: { "x-api-key": keyWith(["secrets:read"]), "content-type": "application/json" },
        body: JSON.stringify({ key: "a/b", value: "v" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  test("read scopes are metadata-only and namespace-limited", async () => {
    const store = fakeStore();
    const h = handler(store);
    const admin = keyWith(["secrets:*"]);
    for (const [key, value] of [["openai/api-key", "one"], ["stripe/api-key", "two"]]) {
      const res = await h(new Request("http://x/v1/secrets", {
        method: "POST",
        headers: { "x-api-key": admin, "content-type": "application/json" },
        body: JSON.stringify({ key, value }),
      }));
      expect(res.status).toBe(200);
    }

    const readOpenAi = keyWith(["secrets:read.openai"]);
    let res = await h(new Request("http://x/v1/secrets", { headers: { "x-api-key": readOpenAi } }));
    expect((await res.json()).secrets.map((entry: any) => entry.key)).toEqual(["openai/api-key"]);

    res = await h(new Request("http://x/v1/secrets/get?key=openai/api-key", { headers: { "x-api-key": readOpenAi } }));
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe("insufficient_scope");
  });

  test("namespace write and reveal scopes cannot cross their prefix", async () => {
    const store = fakeStore();
    const h = handler(store);
    const writeOpenAi = keyWith(["secrets:write.openai"]);

    let res = await h(new Request("http://x/v1/secrets", {
      method: "POST",
      headers: { "x-api-key": writeOpenAi, "content-type": "application/json" },
      body: JSON.stringify({ key: "openai/api-key", value: "one" }),
    }));
    expect(res.status).toBe(200);

    res = await h(new Request("http://x/v1/secrets", {
      method: "POST",
      headers: { "x-api-key": writeOpenAi, "content-type": "application/json" },
      body: JSON.stringify({ key: "stripe/api-key", value: "two" }),
    }));
    expect(res.status).toBe(403);

    const revealOpenAi = keyWith(["secrets:reveal.openai"]);
    res = await h(new Request("http://x/v1/secrets/get?key=openai/api-key", { headers: { "x-api-key": revealOpenAi } }));
    expect(res.status).toBe(200);
    expect((await res.json()).value).toBe("one");
    res = await h(new Request("http://x/v1/secrets/get?key=stripe/api-key", { headers: { "x-api-key": revealOpenAi } }));
    expect(res.status).toBe(403);
  });

  test("encoded scopes can target one key containing an underscore", async () => {
    const store = fakeStore();
    const h = handler(store);
    const admin = keyWith(["secrets:*"]);
    await h(new Request("http://x/v1/secrets", {
      method: "POST",
      headers: { "x-api-key": admin, "content-type": "application/json" },
      body: JSON.stringify({ key: "openai/api_key", value: "one" }),
    }));

    const exact = keyWith([secretScope("reveal", "openai/api_key")]);
    const own = await h(new Request("http://x/v1/secrets/get?key=openai/api_key", { headers: { "x-api-key": exact } }));
    expect(own.status).toBe(200);
    const other = await h(new Request("http://x/v1/secrets/get?key=openai/other", { headers: { "x-api-key": exact } }));
    expect(other.status).toBe(403);
  });

  test("expired secrets fail closed even if a backing store returns them", async () => {
    const h = handler(fakeStore());
    const admin = keyWith(["secrets:*"]);
    const expired = new Date(Date.now() - 1000).toISOString();
    await h(new Request("http://x/v1/secrets", {
      method: "POST",
      headers: { "x-api-key": admin, "content-type": "application/json" },
      body: JSON.stringify({ key: "temp/token", value: "old", expires_at: expired }),
    }));
    const res = await h(new Request("http://x/v1/secrets/get?key=temp/token", { headers: { "x-api-key": admin } }));
    expect(res.status).toBe(404);
  });

  test("authenticated CRUD roundtrip with a wildcard key", async () => {
    const store = fakeStore();
    const h = handler(store);
    const key = keyWith(["secrets:*"]);
    const authz = { "x-api-key": key, "content-type": "application/json" };

    // create
    let res = await h(new Request("http://x/v1/secrets", { method: "POST", headers: authz, body: JSON.stringify({ key: "openai/api_key", value: "sk-123", type: "api_key" }) }));
    expect(res.status).toBe(200);
    expect((await res.json()).value).toBeUndefined(); // metadata only

    // read
    res = await h(new Request("http://x/v1/secrets/get?key=openai/api_key", { headers: { "x-api-key": key } }));
    expect(res.status).toBe(200);
    expect((await res.json()).value).toBe("sk-123");

    // list
    res = await h(new Request("http://x/v1/secrets", { headers: { "x-api-key": key } }));
    expect((await res.json()).secrets).toHaveLength(1);

    // delete
    res = await h(new Request("http://x/v1/secrets?key=openai/api_key", { method: "DELETE", headers: { "x-api-key": key } }));
    expect((await res.json()).deleted).toBe(true);

    // gone
    res = await h(new Request("http://x/v1/secrets/get?key=openai/api_key", { headers: { "x-api-key": key } }));
    expect(res.status).toBe(404);
  });
});
