import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createDomain,
  deleteDomain,
  domainsCloudEnv,
  getDomain,
  isCloudMode,
  listDomains,
  resolveDomainsCloud,
} from "./cloud-store.js";

const CLOUD_ENV = {
  HASNA_DOMAINS_API_URL: "https://domains.hasna.xyz",
  HASNA_DOMAINS_API_KEY: "hasna_domains_testkey_000000000000",
};

describe("domainsCloudEnv", () => {
  test("implies self_hosted when API url + key present and no mode set", () => {
    const env = domainsCloudEnv({ ...CLOUD_ENV });
    expect(env.HASNA_DOMAINS_STORAGE_MODE).toBe("self_hosted");
  });

  test("respects an explicit local mode (stays local)", () => {
    const env = domainsCloudEnv({ ...CLOUD_ENV, HASNA_DOMAINS_STORAGE_MODE: "local" });
    expect(env.HASNA_DOMAINS_STORAGE_MODE).toBe("local");
  });

  test("does nothing when url/key are absent", () => {
    const env = domainsCloudEnv({});
    expect(env.HASNA_DOMAINS_STORAGE_MODE).toBeUndefined();
  });
});

describe("resolveDomainsCloud", () => {
  test("returns a cloud client when url + key are set (self_hosted)", () => {
    const client = resolveDomainsCloud({ ...CLOUD_ENV });
    expect(client).not.toBeNull();
    expect(client!.baseUrl).toBe("https://domains.hasna.xyz/v1");
    expect(isCloudMode({ ...CLOUD_ENV })).toBe(true);
  });

  test("returns null (local) when url/key unset", () => {
    expect(resolveDomainsCloud({})).toBeNull();
    expect(isCloudMode({})).toBe(false);
  });

  test("returns null (local) when mode explicitly local, even with url+key", () => {
    expect(resolveDomainsCloud({ ...CLOUD_ENV, HASNA_DOMAINS_STORAGE_MODE: "local" })).toBeNull();
  });
});

describe("routed CRUD hits the cloud API when self_hosted", () => {
  const realFetch = globalThis.fetch;
  let calls: Array<{ method: string; url: string; body: string | null; auth: string | null }>;

  beforeEach(() => {
    calls = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")) ?? "GET";
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const body = init?.body ? String(init.body) : null;
      calls.push({ method, url, body, auth: headers.get("authorization") });
      const id = "cloud-id-1";
      if (method === "POST" && url.endsWith("/v1/domains")) {
        return new Response(JSON.stringify({ id, name: "routed.example", status: "active" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (method === "GET" && url.endsWith(`/v1/domains/${id}`)) {
        return new Response(JSON.stringify({ id, name: "routed.example", status: "active" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (method === "GET" && url.includes("/v1/domains")) {
        return new Response(JSON.stringify({ domains: [{ id, name: "routed.example" }], count: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (method === "DELETE" && url.endsWith(`/v1/domains/${id}`)) {
        return new Response(JSON.stringify({ id, deleted: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("create -> POST /v1/domains with bearer key", async () => {
    const domain = await createDomain({ name: "routed.example" }, { ...CLOUD_ENV });
    expect(domain.id).toBe("cloud-id-1");
    const post = calls.find((c) => c.method === "POST");
    expect(post?.url).toBe("https://domains.hasna.xyz/v1/domains");
    expect(post?.auth).toBe(`Bearer ${CLOUD_ENV.HASNA_DOMAINS_API_KEY}`);
  });

  test("get -> GET /v1/domains/:id", async () => {
    const domain = await getDomain("cloud-id-1", { ...CLOUD_ENV });
    expect(domain?.id).toBe("cloud-id-1");
    expect(calls.some((c) => c.method === "GET" && c.url.endsWith("/v1/domains/cloud-id-1"))).toBe(true);
  });

  test("list -> GET /v1/domains and unwraps { domains }", async () => {
    const domains = await listDomains({ status: "active" }, { ...CLOUD_ENV });
    expect(domains).toHaveLength(1);
    expect(domains[0]!.id).toBe("cloud-id-1");
    expect(calls.some((c) => c.method === "GET" && c.url.includes("status=active"))).toBe(true);
  });

  test("delete -> DELETE /v1/domains/:id returns true", async () => {
    const ok = await deleteDomain("cloud-id-1", { ...CLOUD_ENV });
    expect(ok).toBe(true);
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/v1/domains/cloud-id-1"))).toBe(true);
  });
});
