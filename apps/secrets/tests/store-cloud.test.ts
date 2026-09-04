import { describe, it, expect } from "bun:test";
import type { HasnaStorageClient } from "../src/store/contracts-client/index.js";
import { ApiStore, getStore, LocalStore, SecretDecryptionError } from "../src/store/index.js";
import { VersionConflictError, VersionNotFoundError } from "../src/store/types.js";

// Build a fake transport + client that records calls and returns canned cloud
// responses, so we assert the route + envelope mapping without the network.
function fakeClient(routes: Record<string, unknown>): { client: HasnaStorageClient; calls: any[] } {
  const calls: any[] = [];
  const transport = {
    baseUrl: "https://secrets.hasna.xyz/v1",
    request: async () => undefined,
    get: async (path: string, opts?: any) => { calls.push(["GET", path, opts?.query]); return routes[`GET ${path}`] ?? routes[path]; },
    post: async (path: string, body?: any) => { calls.push(["POST", path, body]); return routes[`POST ${path}`] ?? routes[path]; },
    put: async () => undefined,
    patch: async () => undefined,
    del: async (path: string, _b?: any, opts?: any) => { calls.push(["DELETE", path, opts?.query]); return routes[`DELETE ${path}`] ?? routes[path]; },
  } as unknown as HasnaStorageClient["transport"];
  const client = {
    name: "secrets",
    baseUrl: transport.baseUrl,
    transport,
    get: async (resource: string, id: string) => { calls.push(["client.get", resource, id]); return routes[`GET /${resource}/${id}`] ?? null; },
    list: async () => ({ items: [], total: null, cursor: null, raw: {} }),
    create: async () => ({}),
    update: async () => ({}),
    delete: async () => undefined,
  } as unknown as HasnaStorageClient;
  return { client, calls };
}

describe("secrets Store resolver (env flip)", () => {
  it("stays local with no cloud env", () => {
    const store = getStore({} as NodeJS.ProcessEnv);
    expect(store).toBeInstanceOf(LocalStore);
    expect(store.mode).toBe("local");
  });

  it("routes to api with API_URL + API_KEY", () => {
    const env = {
      HASNA_SECRETS_API_URL: "https://secrets.hasna.xyz",
      HASNA_SECRETS_API_KEY: "hasna_secrets_test_key",
    } as unknown as NodeJS.ProcessEnv;
    const store = getStore(env);
    expect(store).toBeInstanceOf(ApiStore);
    expect(store.mode).toBe("api");
    expect(store.describe().location).toBe("https://secrets.hasna.xyz");
  });

  it("rejects a retired storage-mode variable even with a valid URL + key pair", () => {
    const env = {
      HASNA_SECRETS_STORAGE_MODE: "self_hosted",
      HASNA_SECRETS_API_URL: "https://secrets.hasna.xyz",
      HASNA_SECRETS_API_KEY: "hasna_secrets_test_key",
    } as unknown as NodeJS.ProcessEnv;
    expect(() => getStore(env)).toThrow("HASNA_SECRETS_STORAGE_MODE was removed");
  });

  it("infers api from API_URL + API_KEY alone (fleet env-flip)", () => {
    const env = {
      HASNA_SECRETS_API_URL: "https://secrets.hasna.xyz",
      HASNA_SECRETS_API_KEY: "k",
    } as unknown as NodeJS.ProcessEnv;
    expect(getStore(env).mode).toBe("api");
  });
});

describe("ApiStore route mapping", () => {
  it("setSecret POSTs /secrets then re-reads the full entry via /secrets/get", async () => {
    const { client, calls } = fakeClient({
      "POST /secrets": { key: "a/b", type: "api_key" },
      "GET /secrets/get": { key: "a/b", value: "v", type: "api_key", created_at: "t", updated_at: "t" },
    });
    const entry = await new ApiStore(client).setSecret("a/b", "v", "api_key");
    expect(entry.value).toBe("v");
    expect(calls.some((c) => c[0] === "POST" && c[1] === "/secrets")).toBe(true);
    expect(calls.some((c) => c[0] === "GET" && c[1] === "/secrets/get")).toBe(true);
  });

  it("getSecret hits /secrets/get?key=", async () => {
    const { client, calls } = fakeClient({ "GET /secrets/get": { key: "a/b", value: "v", type: "other", created_at: "t", updated_at: "t" } });
    const entry = await new ApiStore(client).getSecret("a/b");
    expect(entry?.value).toBe("v");
    expect(calls.find((c) => c[1] === "/secrets/get")[2]).toEqual({ key: "a/b" });
  });

  it("maps a typed server decryption response to an actionable client error", async () => {
    const recovery = "Restore HASNA_SECRETS_MASTER_KEY, or recreate the affected entry.";
    const { client } = fakeClient({});
    client.transport.get = async () => {
      throw {
        status: 422,
        body: {
          error: "Encrypted vault data cannot be decrypted with the configured master key.",
          code: "VAULT_DECRYPTION_FAILED",
          recovery,
        },
      };
    };

    try {
      await new ApiStore(client).getSecret("a/b");
      throw new Error("expected getSecret to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(SecretDecryptionError);
      expect((error as Error).message).toContain(recovery);
    }
  });

  it("deleteSecret hits DELETE /secrets?key= and reads { deleted }", async () => {
    const { client, calls } = fakeClient({ "DELETE /secrets": { deleted: true } });
    expect(await new ApiStore(client).deleteSecret("a/b")).toBe(true);
    expect(calls.find((c) => c[0] === "DELETE")[2]).toEqual({ key: "a/b" });
  });

  it("listSecretMetadata reads { secrets }; searchSecretMetadata reads { results }", async () => {
    const store = new ApiStore(fakeClient({
      "GET /secrets": { secrets: [{ key: "a/b", type: "other", created_at: "t", updated_at: "t" }] },
      "GET /secrets/search": { results: [{ key: "a/b", type: "other", created_at: "t", updated_at: "t" }] },
    }).client);
    expect(await store.listSecretMetadata()).toHaveLength(1);
    expect(await store.searchSecretMetadata("a")).toHaveLength(1);
  });

  it("setVaultItem POSTs /items, getVaultItem via client.get, list reads { items }", async () => {
    const { client, calls } = fakeClient({
      "POST /items": { id: "v1", kind: "login", title: "T", domains: [], tags: [], favorite: false, data: {}, created_at: "t", updated_at: "t" },
      "GET /items/v1": { id: "v1", kind: "login", title: "T", domains: [], tags: [], favorite: false, data: {}, created_at: "t", updated_at: "t" },
      "GET /items": { items: [{ id: "v1", kind: "login", title: "T", domains: [], tags: [], favorite: false, created_at: "t", updated_at: "t" }] },
    });
    const store = new ApiStore(client);
    expect((await store.setVaultItem({ kind: "login", title: "T", data: {} })).id).toBe("v1");
    expect((await store.getVaultItem("v1"))?.id).toBe("v1");
    expect(calls.some((c) => c[0] === "client.get" && c[1] === "items")).toBe(true);
    expect(await store.listVaultItemMetadata()).toHaveLength(1);
  });

  it("audit reads { entries }; registerUser POSTs /users; deleteUser DELETEs /users/:id; feedback POSTs /feedback", async () => {
    const { client, calls } = fakeClient({
      "GET /audit": { entries: [{ id: 1, action: "set", key: "a", agent: "x", timestamp: "t" }] },
      "POST /users": { id: "u1", name: "N", type: "agent", registered_at: "t" },
      "DELETE /users/u1": { deleted: true },
    });
    const store = new ApiStore(client);
    expect(await store.getAuditLog()).toHaveLength(1);
    expect((await store.registerUser("u1", "N", "agent")).id).toBe("u1");
    expect(await store.deleteUser("u1")).toBe(true);
    await store.sendFeedback("hello", undefined, "general");
    expect(calls.some((c) => c[0] === "POST" && c[1] === "/feedback")).toBe(true);
  });

  it("encryptVault throws in api mode (server owns encryption)", async () => {
    const store = new ApiStore(fakeClient({}).client);
    await expect(store.encryptVault()).rejects.toThrow(/api mode/);
  });

  it("pruneExpired is a no-op in api mode", async () => {
    expect(await new ApiStore(fakeClient({}).client).pruneExpired()).toBe(0);
  });

  it("versioning: listVersions reads { versions }, checkVersion reads { check }, restoreVersion POSTs /secrets/restore", async () => {
    const versionMeta = {
      version: 1,
      change_kind: "initial",
      created_at: "t",
      created_by: "agent-1",
      value_length: 4,
      fingerprint: "a1b2c3d4e5f60718",
      current: true,
    };
    const { client, calls } = fakeClient({
      "GET /secrets/versions": { versions: [versionMeta] },
      "GET /secrets/versions/check": { check: { ...versionMeta, hash: "ab".repeat(32) } },
      "POST /secrets/restore": { restored: { ...versionMeta, version: 3, change_kind: "restore", source_version: 1 } },
    });
    const store = new ApiStore(client);

    expect(await store.listVersions("a/b")).toHaveLength(1);
    expect(calls.find((c) => c[1] === "/secrets/versions")[2]).toEqual({ key: "a/b", limit: "20" });

    const check = await store.checkVersion("a/b", 1);
    expect(check.hash).toMatch(/^[0-9a-f]{64}$/);

    const restored = await store.restoreVersion("a/b", 1, { reason: "roll back", expectCurrent: 2 });
    expect(restored).toMatchObject({ version: 3, change_kind: "restore", source_version: 1 });
    const restoreCall = calls.find((c) => c[0] === "POST" && c[1] === "/secrets/restore")!;
    expect(restoreCall[2]).toEqual({ key: "a/b", version: 1, reason: "roll back", expected_current_version: 2 });
  });

  it("versioning: maps server 404/409 to typed store errors", async () => {
    const { client } = fakeClient({});
    client.transport.get = async () => { throw { status: 404, body: {} }; };
    client.transport.post = async () => { throw { status: 409, body: { error: "Current version is 3, expected 2." } }; };
    const store = new ApiStore(client);

    await expect(store.checkVersion("a/b", 9)).rejects.toBeInstanceOf(VersionNotFoundError);
    await expect(store.restoreVersion("a/b", 1, { reason: "x", expectCurrent: 2 })).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    try {
      await store.restoreVersion("a/b", 1, { reason: "x", expectCurrent: 2 });
    } catch (error) {
      expect((error as Error).message).toContain("Current version is 3");
    }
  });

  it("versioning: setSecret forwards reason/change_kind/batch_id and reads version/unchanged from the POST response", async () => {
    const { client, calls } = fakeClient({
      "POST /secrets": { key: "a/b", type: "api_key", version: 2, unchanged: false },
      "GET /secrets/get": { key: "a/b", value: "v", type: "api_key", created_at: "t", updated_at: "t" },
    });
    const entry = await new ApiStore(client).setSecret("a/b", "v", "api_key", undefined, undefined, {
      reason: "rotated",
      changeKind: "rotation",
      batchId: "batch-1",
    });
    expect(entry.version).toBe(2);
    expect(entry.unchanged).toBe(false);
    const postCall = calls.find((c) => c[0] === "POST" && c[1] === "/secrets")!;
    expect(postCall[2]).toMatchObject({ reason: "rotated", change_kind: "rotation", batch_id: "batch-1" });
  });
});
