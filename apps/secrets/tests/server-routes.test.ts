import { describe, expect, it } from "bun:test";
import { createHandler, type ServeDeps } from "../src/server/serve.js";
import { SECRETS_MIGRATIONS } from "../src/server/cloud-migrations.js";

function verifier(principal: { agent?: string; kid: string } = { kid: "kid-only" }) {
  return {
    async authenticate() {
      return { ok: true as const, principal };
    },
  } as ServeDeps["verifier"];
}

function client(overrides: Record<string, unknown> = {}) {
  return {
    async get() { return { ok: 1 }; },
    async many() { return []; },
    async query() { return { rows: [], rowCount: 0 }; },
    async one() { return { ok: 1 }; },
    async execute() {},
    ...overrides,
  } as ServeDeps["client"];
}

function completeStore() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const record = (method: string, args: unknown[]) => calls.push({ method, args });
  const secret = {
    key: "demo/key",
    value: "value",
    type: "other",
    created_at: "now",
    updated_at: "now",
  };
  const item = {
    id: "item/1",
    kind: "login",
    title: "Example",
    domains: [],
    tags: [],
    favorite: false,
    data: {},
    created_at: "now",
    updated_at: "now",
  };
  return {
    calls,
    async listSecretMetadata(...args: unknown[]) { record("listSecretMetadata", args); return [secret]; },
    async setSecret(...args: unknown[]) { record("setSecret", args); return secret; },
    async deleteSecret(key: string, ...args: unknown[]) { record("deleteSecret", [key, ...args]); return key !== "missing"; },
    async getSecret(key: string, ...args: unknown[]) { record("getSecret", [key, ...args]); return key === "missing" ? undefined : secret; },
    async searchSecretMetadata(...args: unknown[]) { record("searchSecretMetadata", args); return [secret]; },
    async listVaultItemMetadata(...args: unknown[]) { record("listVaultItemMetadata", args); return [item]; },
    async setVaultItem(...args: unknown[]) { record("setVaultItem", args); return item; },
    async searchVaultItemMetadata(...args: unknown[]) { record("searchVaultItemMetadata", args); return [item]; },
    async getVaultItem(id: string, ...args: unknown[]) { record("getVaultItem", [id, ...args]); return id === "missing" ? undefined : item; },
    async deleteVaultItem(id: string, ...args: unknown[]) { record("deleteVaultItem", [id, ...args]); return id !== "missing"; },
    async getAuditLog(...args: unknown[]) { record("getAuditLog", args); return []; },
    async listUsers(...args: unknown[]) { record("listUsers", args); return []; },
    async registerUser(...args: unknown[]) { record("registerUser", args); return { id: args[0], name: args[1], type: args[2] }; },
    async deleteUser(id: string) { record("deleteUser", [id]); return id !== "missing"; },
    async addFeedback(...args: unknown[]) { record("addFeedback", args); },
  };
}

function makeHandler(store = completeStore(), db = client()) {
  return {
    store,
    handle: createHandler({ client: db, store: store as any, verifier: verifier() }),
  };
}

function request(path: string, method = "GET", body?: unknown): Request {
  return new Request(`http://example.test${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function body(res: Response): Promise<any> {
  expect(res.headers.get("content-type")).toBe("application/json");
  return res.json();
}

describe("cloud server route matrix", () => {
  it("covers secret list/create/get/search/delete validation and results", async () => {
    const { handle, store } = makeHandler();

    expect(await body(await handle(request("/v1/secrets?namespace=demo")))).toHaveProperty("secrets");
    expect(store.calls.at(-1)).toEqual({ method: "listSecretMetadata", args: ["demo"] });

    let res = await handle(new Request("http://example.test/v1/secrets", { method: "POST", body: "{" }));
    expect(res.status).toBe(400);
    res = await handle(request("/v1/secrets", "POST", { key: "demo/key" }));
    expect(res.status).toBe(400);
    res = await handle(request("/v1/secrets", "POST", { key: "demo/key", value: "v", type: "invalid" }));
    expect(res.status).toBe(200);
    expect(store.calls.at(-1)?.args[2]).toBe("other");
    res = await handle(request("/v1/secrets", "POST", { key: "demo/key", value: "v", ttl: "forever" }));
    expect(res.status).toBe(400);
    expect((await body(res)).error).toContain("Invalid TTL");

    expect((await handle(request("/v1/secrets", "DELETE"))).status).toBe(400);
    expect((await handle(request("/v1/secrets?key=missing", "DELETE"))).status).toBe(404);
    expect((await handle(request("/v1/secrets?key=demo%2Fkey", "DELETE"))).status).toBe(200);

    expect((await handle(request("/v1/secrets/get"))).status).toBe(400);
    expect((await handle(request("/v1/secrets/get?key=missing"))).status).toBe(404);
    expect((await body(await handle(request("/v1/secrets/get?key=demo%2Fkey")))).value).toBe("value");
    expect((await handle(request("/v1/secrets/search"))).status).toBe(400);
    expect(await body(await handle(request("/v1/secrets/search?q=demo")))).toHaveProperty("results");
  });

  it("covers vault-item list/create/search/get/delete routes", async () => {
    const { handle, store } = makeHandler();
    expect(await body(await handle(request("/v1/items?kind=login")))).toHaveProperty("items");
    expect(store.calls.at(-1)).toEqual({ method: "listVaultItemMetadata", args: ["login"] });

    let res = await handle(new Request("http://example.test/v1/items", { method: "POST", body: "{" }));
    expect(res.status).toBe(400);
    res = await handle(request("/v1/items", "POST", { kind: "login" }));
    expect(res.status).toBe(400);
    res = await handle(request("/v1/items", "POST", { kind: "login", title: "Example" }));
    expect(res.status).toBe(200);
    expect(store.calls.at(-1)?.method).toBe("setVaultItem");

    expect((await handle(request("/v1/items/search"))).status).toBe(400);
    expect(await body(await handle(request("/v1/items/search?q=example")))).toHaveProperty("results");
    expect((await handle(request("/v1/items/missing"))).status).toBe(404);
    expect((await body(await handle(request("/v1/items/item%2F1")))).id).toBe("item/1");
    expect((await handle(request("/v1/items/missing", "DELETE"))).status).toBe(404);
    expect((await handle(request("/v1/items/item%2F1", "DELETE"))).status).toBe(200);
  });

  it("covers audit, user, feedback, and fallback routes", async () => {
    const { handle, store } = makeHandler();
    expect(await body(await handle(request("/v1/audit?key=demo%2Fkey&limit=2")))).toEqual({ entries: [] });
    expect(store.calls.at(-1)).toEqual({ method: "getAuditLog", args: ["demo/key", 2] });
    expect(await body(await handle(request("/v1/users?type=agent")))).toEqual({ users: [] });
    expect(store.calls.at(-1)).toEqual({ method: "listUsers", args: ["agent"] });

    expect((await handle(new Request("http://example.test/v1/users", { method: "POST", body: "{" }))).status).toBe(400);
    expect((await handle(request("/v1/users", "POST", { id: "u1" }))).status).toBe(400);
    expect(await body(await handle(request("/v1/users", "POST", { id: "u1", name: "User" })))).toMatchObject({
      id: "u1",
      type: "human",
    });
    expect((await handle(request("/v1/users/missing", "DELETE"))).status).toBe(404);
    expect((await handle(request("/v1/users/u%2F1", "DELETE"))).status).toBe(200);

    expect((await handle(new Request("http://example.test/v1/feedback", { method: "POST", body: "{" }))).status).toBe(400);
    expect((await handle(request("/v1/feedback", "POST", {}))).status).toBe(400);
    expect(await body(await handle(request("/v1/feedback", "POST", { message: "hello" })))).toEqual({ ok: true });
    expect(store.calls.at(-1)?.args[2]).toBe("general");
    expect((await handle(request("/does-not-exist"))).status).toBe(404);
    expect((await handle(request("/v1/items/item-1", "PATCH"))).status).toBe(404);
  });

  it("reports degraded probes and catches Error and non-Error failures", async () => {
    const unhealthy = makeHandler(completeStore(), client({ async get() { throw new Error("offline"); } }));
    let res = await unhealthy.handle(request("/health"));
    expect(res.status).toBe(503);
    expect(await body(res)).toMatchObject({ status: "degraded" });

    const unready = makeHandler(completeStore(), client({ async get() { throw "schema unavailable"; } }));
    res = await unready.handle(request("/ready"));
    expect(res.status).toBe(503);
    expect(await body(res)).toMatchObject({ status: "not_ready", pendingMigrations: [] });

    const throwsError = completeStore();
    throwsError.listSecretMetadata = async () => { throw new Error("store failed"); };
    res = await makeHandler(throwsError).handle(request("/v1/secrets"));
    expect(res.status).toBe(500);
    expect(await body(res)).toEqual({ error: "store failed" });

    const throwsString = completeStore();
    throwsString.listSecretMetadata = async () => { throw "string failure"; };
    res = await makeHandler(throwsString).handle(request("/v1/secrets"));
    expect(res.status).toBe(500);
    expect(await body(res)).toEqual({ error: "string failure" });
  });

  it("keeps an already-migrated service ready when the runtime role cannot run DDL", async () => {
    const applied = SECRETS_MIGRATIONS.map((migration) => ({
      id: migration.id,
      checksum: migration.checksum,
      applied_at: "2026-08-07T00:00:00.000Z",
    }));
    const readOnlyRuntime = makeHandler(
      completeStore(),
      client({
        async many() { return applied; },
        async execute() { throw new Error("permission denied for schema public"); },
      }),
    );

    const res = await readOnlyRuntime.handle(request("/ready"));

    expect(res.status).toBe(200);
    expect(await body(res)).toMatchObject({ status: "ok", pendingMigrations: [] });
  });

  it("keeps readiness healthy when the service role cannot read the migration ledger", async () => {
    const runtimeRole = makeHandler(
      completeStore(),
      client({
        async many() { throw new Error("permission denied for relation schema_migrations"); },
        async execute() { throw new Error("permission denied for schema public"); },
      }),
    );

    const res = await runtimeRole.handle(request("/ready"));

    expect(res.status).toBe(200);
    expect(await body(res)).toMatchObject({ status: "ok", pendingMigrations: [] });
  });
});
