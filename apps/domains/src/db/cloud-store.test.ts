import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  countDomains,
  createDomain,
  deleteDomain,
  domainsCloudEnv,
  getByRegistrar,
  getDomain,
  getDomainByIdentifier,
  getDomainStats,
  isCloudMode,
  listDomains,
  listExpiring,
  resolveDomainsCloud,
  searchDomains,
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

  test("search -> GET /v1/domains?search=", async () => {
    const results = await searchDomains("routed", { ...CLOUD_ENV });
    expect(results).toHaveLength(1);
    expect(calls.some((c) => c.method === "GET" && c.url.includes("search=routed"))).toBe(true);
  });
});

describe("routed read views hit the cloud API when self_hosted", () => {
  const realFetch = globalThis.fetch;
  let calls: Array<{ method: string; url: string }>;

  beforeEach(() => {
    calls = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")) ?? "GET";
      calls.push({ method, url });
      const j = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

      if (method === "GET" && url.endsWith("/v1/stats")) {
        return j({
          total: 3, active: 2, expired: 1, transferring: 0, redemption: 0,
          auto_renew_enabled: 2, expiring_30_days: 1, ssl_expiring_30_days: 0,
        });
      }
      // get-by-id miss (name lookup) -> 404
      if (method === "GET" && /\/v1\/domains\/by-name\.example$/.test(url)) {
        return j({ error: "domain not found" }, 404);
      }
      if (method === "GET" && url.includes("/v1/domains")) {
        const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
        return j({
          domains: [
            { id: "a", name: "by-name.example", registrar: "route53", is_premium: false, status: "active", expires_at: soon, ssl_expires_at: null },
            { id: "b", name: "other.example", registrar: "gandi", is_premium: true, status: "active", expires_at: null, ssl_expires_at: soon },
          ],
          count: 2,
        });
      }
      return j({ error: "unexpected" }, 500);
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("stats -> GET /v1/stats returns DomainStats", async () => {
    const stats = await getDomainStats({ ...CLOUD_ENV });
    expect(stats.total).toBe(3);
    expect(stats.active).toBe(2);
    expect(calls.some((c) => c.url.endsWith("/v1/stats"))).toBe(true);
  });

  test("count -> derived from /v1/stats total", async () => {
    const n = await countDomains({ ...CLOUD_ENV });
    expect(n).toBe(3);
  });

  test("getDomainByIdentifier falls back to exact name match on 404", async () => {
    const d = await getDomainByIdentifier("by-name.example", { ...CLOUD_ENV });
    expect(d?.id).toBe("a");
    // first tried by-id (404), then listed by search
    expect(calls.some((c) => c.url.endsWith("/v1/domains/by-name.example"))).toBe(true);
    expect(calls.some((c) => c.url.includes("search=by-name.example"))).toBe(true);
  });

  test("getByRegistrar filters client-side (server has no registrar param)", async () => {
    const rows = await getByRegistrar("gandi", { ...CLOUD_ENV });
    expect(rows.map((d) => d.id)).toEqual(["b"]);
    // registrar must NOT be sent to the server (it would be ignored → wrong result)
    expect(calls.every((c) => !c.url.includes("registrar="))).toBe(true);
  });

  test("listDomains is_premium filter is applied client-side", async () => {
    const rows = await listDomains({ is_premium: true }, { ...CLOUD_ENV });
    expect(rows.map((d) => d.id)).toEqual(["b"]);
    expect(calls.every((c) => !c.url.includes("is_premium"))).toBe(true);
  });

  test("listExpiring filters active domains by expiry window client-side", async () => {
    const rows = await listExpiring(30, { ...CLOUD_ENV });
    expect(rows.map((d) => d.id)).toEqual(["a"]);
  });
});
