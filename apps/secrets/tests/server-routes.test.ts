import { describe, expect, it } from "bun:test";
import { createHandler, type ServeDeps } from "../src/server/serve.js";
import { SECRETS_MIGRATIONS } from "../src/server/cloud-migrations.js";
import { MetadataValidationError, VersionConflictError, VersionNotFoundError, type RestoreVersionOptions } from "../src/store/types.js";

const TEST_TENANT = "11111111-2222-4333-8444-555555555555";

function verifier(principal: { agent?: string; kid: string } = { kid: "kid-only" }) {
  return {
    async authenticate() {
      return { ok: true as const, principal };
    },
  } as ServeDeps["verifier"];
}

function client(overrides: Record<string, unknown> = {}) {
  return {
    async get(sql: string) {
      if (sql.includes("SELECT tenant_id FROM api_keys")) return { tenant_id: TEST_TENANT };
      return { ok: 1 };
    },
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
  const versionMeta = (version: number, overrides: Record<string, unknown> = {}) => ({
    version,
    change_kind: version === 1 ? "initial" : "set",
    created_at: "now",
    created_by: "agent",
    value_length: 5,
    fingerprint: "a1b2c3d4e5f60718",
    current: version === 2,
    ...overrides,
  });
  return {
    calls,
    async listSecretMetadata(...args: unknown[]) { record("listSecretMetadata", args); return [secret]; },
    async setSecret(...args: unknown[]) { record("setSecret", args); return { ...secret, version: 2, unchanged: false }; },
    async deleteSecret(key: string, ...args: unknown[]) { record("deleteSecret", [key, ...args]); return key !== "missing"; },
    async getSecret(key: string, ...args: unknown[]) { record("getSecret", [key, ...args]); return key === "missing" ? undefined : secret; },
    async searchSecretMetadata(...args: unknown[]) { record("searchSecretMetadata", args); return [secret]; },
    async listVersions(key: string, ...args: unknown[]) { record("listVersions", [key, ...args]); return [versionMeta(2), versionMeta(1)]; },
    async checkVersion(key: string, version: number, ...args: unknown[]) {
      record("checkVersion", [key, version, ...args]);
      if (version === 99) throw new VersionNotFoundError(`Version 99 not found for key ${key}`);
      return { ...versionMeta(version), hash: "ab".repeat(32) };
    },
    async restoreVersion(key: string, version: number, opts: RestoreVersionOptions, ...args: unknown[]) {
      record("restoreVersion", [key, version, opts, ...args]);
      if (key === "missing") throw new VersionNotFoundError(`Secret not found: ${key}`);
      if (version === 99) throw new VersionNotFoundError(`Version 99 not found for key ${key}`);
      if (opts.reason.includes("sk-synth")) {
        throw new MetadataValidationError(
          "reason contains credential-shaped content and was refused. Use a plain description without values.",
        );
      }
      if (opts.expectCurrent !== 2) {
        throw new VersionConflictError(`Current version is 2, expected ${opts.expectCurrent}.`);
      }
      return { ...versionMeta(3, { change_kind: "restore", source_version: version, current: true }), ...opts };
    },
    async pruneVersionHistory() { record("pruneVersionHistory", []); return { versions: 0 }; },
    async runVersionBackfill() { record("runVersionBackfill", []); return 0; },
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

  it("passes the authenticated API-key tenant into every active tenant-bearing write", async () => {
    const { handle, store } = makeHandler();

    expect((await handle(request("/v1/secrets", "POST", { key: "demo/key", value: "value" }))).status).toBe(200);
    expect(store.calls.at(-1)).toMatchObject({ method: "setSecret" });
    // setSecret signature: (key, value, type, label, expiresAt, actor, tenantId, opts?)
    expect(store.calls.at(-1)?.args[6]).toBe(TEST_TENANT);

    expect((await handle(request("/v1/items", "POST", { kind: "secure_note", title: "Example" }))).status).toBe(200);
    expect(store.calls.at(-1)).toMatchObject({ method: "setVaultItem" });
    expect(store.calls.at(-1)?.args.at(-1)).toBe(TEST_TENANT);

    expect((await handle(request("/v1/users", "POST", { id: "u1", name: "User" }))).status).toBe(200);
    expect(store.calls.at(-1)).toMatchObject({ method: "registerUser" });
    expect(store.calls.at(-1)?.args.at(-1)).toBe(TEST_TENANT);

    expect((await handle(request("/v1/feedback", "POST", { message: "hello" }))).status).toBe(200);
    expect(store.calls.at(-1)).toMatchObject({ method: "addFeedback" });
    expect(store.calls.at(-1)?.args.at(-1)).toBe(TEST_TENANT);
  });

  it("fails closed before writes when the authenticated key has no tenant assignment", async () => {
    const store = completeStore();
    const noTenant = client({
      async get(sql: string) {
        if (sql.includes("SELECT tenant_id FROM api_keys")) return null;
        return { ok: 1 };
      },
    });
    const handle = createHandler({ client: noTenant, store: store as any, verifier: verifier() });

    const response = await handle(request("/v1/feedback", "POST", { message: "hello" }));

    expect(response.status).toBe(403);
    expect(store.calls).toHaveLength(0);
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

  it("covers secret version list/check/restore routes with typed 404/409 mapping", async () => {
    const { handle, store } = makeHandler();

    // versions list: metadata only, never value material
    let res = await handle(request("/v1/secrets/versions"));
    expect(res.status).toBe(400);
    res = await handle(request("/v1/secrets/versions?key=demo%2Fkey&limit=200"));
    expect(res.status).toBe(400);
    res = await handle(request("/v1/secrets/versions?key=demo%2Fkey"));
    expect(res.status).toBe(200);
    const listed = await body(res);
    expect(listed.versions).toHaveLength(2);
    expect(JSON.stringify(listed)).not.toContain("value_blob");
    expect(store.calls.at(-1)).toEqual({ method: "listVersions", args: ["demo/key", "kid-only", TEST_TENANT, 20] });

    // versions check: evidence class only
    res = await handle(request("/v1/secrets/versions/check?key=demo%2Fkey"));
    expect(res.status).toBe(400);
    res = await handle(request("/v1/secrets/versions/check?key=demo%2Fkey&version=99"));
    expect(res.status).toBe(404);
    res = await handle(request("/v1/secrets/versions/check?key=demo%2Fkey&version=1"));
    expect(res.status).toBe(200);
    const check = await body(res);
    expect(check.check.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(check)).not.toContain("value_blob");

    // restore: write grant, typed not-found and conflict mapping
    res = await handle(request("/v1/secrets/restore", "POST", { key: "demo/key", version: 1 }));
    expect(res.status).toBe(400); // reason required (server-side guard)
    res = await handle(request("/v1/secrets/restore", "POST", { key: "demo/key", version: 1, reason: "x" }));
    expect(res.status).toBe(400); // expected_current_version required (CAS mandatory at the API boundary)
    res = await handle(request("/v1/secrets/restore", "POST", { key: "demo/key", version: 1, reason: "x", expected_current_version: "2" }));
    expect(res.status).toBe(400); // non-integer expected_current_version
    res = await handle(request("/v1/secrets/restore", "POST", { key: "demo/key", version: 99, reason: "x", expected_current_version: 1 }));
    expect(res.status).toBe(404);
    res = await handle(request("/v1/secrets/restore", "POST", { key: "demo/key", version: 1, reason: "x", expected_current_version: 1 }));
    expect(res.status).toBe(409);
    res = await handle(request("/v1/secrets/restore", "POST", { key: "demo/key", version: 1, reason: "x", expected_current_version: 2 }));
    expect(res.status).toBe(200);
    const restored = await body(res);
    expect(restored.restored).toMatchObject({ version: 3, change_kind: "restore", source_version: 1, current: true });
    expect(store.calls.at(-1)?.method).toBe("restoreVersion");
    expect(JSON.stringify(restored)).not.toContain("value_blob");
  });

  it("maps a credential-shaped restore reason to a typed 400 without echoing the payload", async () => {
    const { handle } = makeHandler();
    // The mock store reproduces the write-boundary guard (the real store scans
    // with scanInputExposures before persisting); this fixture asserts the ROUTE
    // maps the typed error to 400 and never echoes the offending text. The
    // shape is assembled at runtime so this file carries no literal credential.
    const credShaped = ["sk-synth", "etic-value-9f8e7d6c5b4a3f2e1d0c"].join("");
    const res = await handle(
      request("/v1/secrets/restore", "POST", {
        key: "demo/key",
        version: 1,
        reason: credShaped,
        expected_current_version: 2,
      }),
    );
    expect(res.status).toBe(400);
    const errorBody = JSON.stringify(await body(res));
    expect(errorBody).toContain("credential-shaped");
    expect(errorBody).not.toContain(credShaped);
  });

  it("POST /v1/secrets forwards version metadata options and echoes version/unchanged", async () => {
    const { handle, store } = makeHandler();
    const res = await handle(
      request("/v1/secrets", "POST", { key: "demo/key", value: "v", reason: "rotated", change_kind: "rotation", batch_id: "batch-1" }),
    );
    expect(res.status).toBe(200);
    const bodyJson = await body(res);
    expect(bodyJson).toMatchObject({ version: 2, unchanged: false });
    const call = store.calls.at(-1)!;
    expect(call.method).toBe("setSecret");
    expect((call.args.at(-1) as Record<string, unknown>)).toEqual({
      reason: "rotated",
      changeKind: "rotation",
      batchId: "batch-1",
    });
    // Metadata-only response: no value field.
    expect(JSON.stringify(bodyJson)).not.toContain('"value"');
  });
});
