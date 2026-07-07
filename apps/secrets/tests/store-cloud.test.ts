import { describe, it, expect } from "bun:test";
import type { HasnaStorageClient } from "@hasna/contracts/client/storage";
import {
  isCloudSecrets,
  resolveSecretsCloud,
  cloudSetSecret,
  cloudGetSecret,
  cloudDeleteSecret,
  cloudListSecretMetadata,
  cloudSearchSecretMetadata,
  cloudSetVaultItem,
  cloudGetVaultItem,
  cloudListVaultItemMetadata,
  cloudGetAuditLog,
  cloudRegisterUser,
  type SecretsCloud,
} from "../src/store-cloud.js";

// Build a fake transport + client that records calls and returns canned cloud
// responses, so we assert the route + envelope mapping without the network.
function fakeCloud(routes: Record<string, unknown>): { cloud: SecretsCloud; calls: any[] } {
  const calls: any[] = [];
  const lookup = (method: string, path: string) => {
    calls.push([method, path]);
    if (path in routes) return routes[path];
    return routes[`${method} ${path}`];
  };
  const transport = {
    baseUrl: "https://secrets.hasna.xyz/v1",
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
  return { cloud: { client, transport }, calls };
}

describe("secrets cloud resolver (env flip)", () => {
  it("stays local with no cloud env", () => {
    expect(isCloudSecrets({} as NodeJS.ProcessEnv)).toBe(false);
    expect(resolveSecretsCloud({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("routes to cloud with mode=self_hosted + API_URL + API_KEY", () => {
    const env = {
      HASNA_SECRETS_STORAGE_MODE: "self_hosted",
      HASNA_SECRETS_API_URL: "https://secrets.hasna.xyz",
      HASNA_SECRETS_API_KEY: "hasna_secrets_test_key",
    } as unknown as NodeJS.ProcessEnv;
    expect(isCloudSecrets(env)).toBe(true);
    expect(resolveSecretsCloud(env)?.transport.baseUrl).toBe("https://secrets.hasna.xyz/v1");
  });

  it("does NOT route to cloud when API vars set but mode local (reversible)", () => {
    const env = {
      HASNA_SECRETS_API_URL: "https://secrets.hasna.xyz",
      HASNA_SECRETS_API_KEY: "k",
    } as unknown as NodeJS.ProcessEnv;
    expect(isCloudSecrets(env)).toBe(false);
  });
});

describe("secrets cloud route mapping", () => {
  it("setSecret POSTs /secrets then re-reads the full entry via /secrets/get", async () => {
    const { cloud, calls } = fakeCloud({
      "POST /secrets": { key: "a/b", type: "api_key" },
      "GET /secrets/get": { key: "a/b", value: "v", type: "api_key", created_at: "t", updated_at: "t" },
    });
    const entry = await cloudSetSecret(cloud, "a/b", "v", "api_key");
    expect(entry.value).toBe("v");
    expect(calls.some((c) => c[0] === "POST" && c[1] === "/secrets")).toBe(true);
    expect(calls.some((c) => c[0] === "GET" && c[1] === "/secrets/get")).toBe(true);
  });

  it("getSecret hits /secrets/get?key=", async () => {
    const { cloud, calls } = fakeCloud({ "GET /secrets/get": { key: "a/b", value: "v", type: "other", created_at: "t", updated_at: "t" } });
    const entry = await cloudGetSecret(cloud, "a/b");
    expect(entry?.value).toBe("v");
    const call = calls.find((c) => c[1] === "/secrets/get");
    expect(call[2]).toEqual({ key: "a/b" });
  });

  it("deleteSecret hits DELETE /secrets?key= and reads { deleted }", async () => {
    const { cloud, calls } = fakeCloud({ "DELETE /secrets": { deleted: true } });
    expect(await cloudDeleteSecret(cloud, "a/b")).toBe(true);
    const call = calls.find((c) => c[0] === "DELETE");
    expect(call[2]).toEqual({ key: "a/b" });
  });

  it("listSecretMetadata reads { secrets }", async () => {
    const { cloud } = fakeCloud({ "GET /secrets": { secrets: [{ key: "a/b", type: "other", created_at: "t", updated_at: "t" }] } });
    expect(await cloudListSecretMetadata(cloud)).toHaveLength(1);
  });

  it("searchSecretMetadata reads { results }", async () => {
    const { cloud } = fakeCloud({ "GET /secrets/search": { results: [{ key: "a/b", type: "other", created_at: "t", updated_at: "t" }] } });
    expect(await cloudSearchSecretMetadata(cloud, "a")).toHaveLength(1);
  });

  it("setVaultItem POSTs /items, getVaultItem via client.get, list reads { items }", async () => {
    const { cloud, calls } = fakeCloud({
      "POST /items": { id: "v1", kind: "login", title: "T", domains: [], tags: [], favorite: false, data: {}, created_at: "t", updated_at: "t" },
      "GET /items/v1": { id: "v1", kind: "login", title: "T", domains: [], tags: [], favorite: false, data: {}, created_at: "t", updated_at: "t" },
      "GET /items": { items: [{ id: "v1", kind: "login", title: "T", domains: [], tags: [], favorite: false, created_at: "t", updated_at: "t" }] },
    });
    const created = await cloudSetVaultItem(cloud, { kind: "login", title: "T", data: {} });
    expect(created.id).toBe("v1");
    const got = await cloudGetVaultItem(cloud, "v1");
    expect(got?.id).toBe("v1");
    expect(calls.some((c) => c[0] === "client.get" && c[1] === "items")).toBe(true);
    expect(await cloudListVaultItemMetadata(cloud)).toHaveLength(1);
  });

  it("audit reads { entries }; registerUser POSTs /users", async () => {
    const { cloud } = fakeCloud({
      "GET /audit": { entries: [{ id: 1, action: "set", key: "a", agent: "x", timestamp: "t" }] },
      "POST /users": { id: "u1", name: "N", type: "agent", registered_at: "t" },
    });
    expect(await cloudGetAuditLog(cloud)).toHaveLength(1);
    expect((await cloudRegisterUser(cloud, "u1", "N", "agent")).id).toBe("u1");
  });
});
