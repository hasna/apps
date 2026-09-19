import { afterEach, describe, expect, it } from "bun:test";
import {
  bindWorkerCustomDomain,
  createCloudflareProvider,
  ensureZoneOriginTlsMode,
  getZone,
  workerCustomDomainReady,
} from "./cloudflare.js";
import type { Domain } from "../db/domains.js";

const originalFetch = globalThis.fetch;
const originalTimeout = process.env["DOMAINS_PROVIDER_HTTP_TIMEOUT_MS"];
const originalMaxResponse = process.env["DOMAINS_PROVIDER_MAX_RESPONSE_BYTES"];

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalTimeout === undefined) delete process.env["DOMAINS_PROVIDER_HTTP_TIMEOUT_MS"];
  else process.env["DOMAINS_PROVIDER_HTTP_TIMEOUT_MS"] = originalTimeout;
  if (originalMaxResponse === undefined) delete process.env["DOMAINS_PROVIDER_MAX_RESPONSE_BYTES"];
  else process.env["DOMAINS_PROVIDER_MAX_RESPONSE_BYTES"] = originalMaxResponse;
});

function domain(name: string, registrar: string): Domain {
  return {
    id: name,
    name,
    registrar,
    status: "active",
    registered_at: null,
    expires_at: null,
    auto_renew: true,
    is_premium: false,
    premium_price: null,
    standard_price: null,
    purchase_price: null,
    purchase_date: null,
    nameservers: [],
    whois: {},
    ssl_expires_at: null,
    ssl_issuer: null,
    notes: null,
    metadata: {},
    created_at: "",
    updated_at: "",
  };
}

describe("Cloudflare API bounds", () => {
  it("times out a provider request that never returns headers", async () => {
    process.env["DOMAINS_PROVIDER_HTTP_TIMEOUT_MS"] = "10";
    globalThis.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
    await expect(getZone("proof.example", { apiToken: "token", accountId: "account" }))
      .rejects.toThrow("exceeded 10ms");
  });

  it("times out when response headers arrive but the body stalls", async () => {
    process.env["DOMAINS_PROVIDER_HTTP_TIMEOUT_MS"] = "10";
    globalThis.fetch = (async () => new Response(new ReadableStream({
      start() {
        // Deliberately never enqueue or close: the request must still time out.
      },
    }), { status: 200 })) as typeof fetch;
    await expect(getZone("proof.example", { apiToken: "token", accountId: "account" }))
      .rejects.toThrow("exceeded 10ms");
  });

  it("rejects an oversized provider response before parsing", async () => {
    process.env["DOMAINS_PROVIDER_MAX_RESPONSE_BYTES"] = "16";
    globalThis.fetch = (async () => new Response("{}", {
      status: 200,
      headers: { "content-length": "17", "content-type": "application/json" },
    })) as typeof fetch;
    await expect(getZone("proof.example", { apiToken: "token", accountId: "account" }))
      .rejects.toThrow("exceeds 16 bytes");
  });

  it("rejects runtime bounds above their fixed ceilings before provider I/O", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return Response.json({ success: true, result: [], errors: [] });
    }) as typeof fetch;
    process.env["DOMAINS_PROVIDER_HTTP_TIMEOUT_MS"] = "120001";
    await expect(getZone("proof.example", { apiToken: "token", accountId: "account" }))
      .rejects.toThrow("between 1 and 120000");
    process.env["DOMAINS_PROVIDER_HTTP_TIMEOUT_MS"] = "30000";
    process.env["DOMAINS_PROVIDER_MAX_RESPONSE_BYTES"] = "4194305";
    await expect(getZone("proof.example", { apiToken: "token", accountId: "account" }))
      .rejects.toThrow("between 1 and 4194304");
    expect(calls).toBe(0);
  });
});

describe("Cloudflare zone origin TLS", () => {
  it("sets one explicit TLS mode and requires exact GET readback", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    let mode = "flexible";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url: String(input), ...(body ? { body } : {}) });
      if (method === "PATCH") mode = String((body as { value: string }).value);
      return Response.json({ success: true, result: { id: "ssl", value: mode }, errors: [] });
    }) as typeof fetch;

    await expect(ensureZoneOriginTlsMode("zone/one", "strict", { apiToken: "token", accountId: "account" }))
      .resolves.toEqual({ mode: "strict", changed: true, downgradeRefused: false });
    expect(calls).toEqual([
      { method: "GET", url: "https://api.cloudflare.com/client/v4/zones/zone%2Fone/settings/ssl" },
      { method: "PATCH", url: "https://api.cloudflare.com/client/v4/zones/zone%2Fone/settings/ssl", body: { value: "strict" } },
      { method: "GET", url: "https://api.cloudflare.com/client/v4/zones/zone%2Fone/settings/ssl" },
    ]);
  });

  it("refuses strict-to-full without a PATCH", async () => {
    const methods: string[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      return Response.json({ success: true, result: { id: "ssl", value: "strict" }, errors: [] });
    }) as typeof fetch;

    await expect(ensureZoneOriginTlsMode("zone", "full", { apiToken: "token", accountId: "account" }))
      .resolves.toEqual({ mode: "strict", changed: false, downgradeRefused: true });
    expect(methods).toEqual(["GET"]);
  });

  for (const requested of ["full", "strict"] as const) {
    it(`refuses origin_pull-to-${requested} without a PATCH`, async () => {
      const methods: string[] = [];
      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        methods.push(init?.method ?? "GET");
        return Response.json({
          success: true,
          result: { id: "ssl", value: "origin_pull" },
          errors: [],
        });
      }) as typeof fetch;

      await expect(ensureZoneOriginTlsMode("zone", requested, {
        apiToken: "token",
        accountId: "account",
      })).resolves.toEqual({ mode: "origin_pull", changed: false, downgradeRefused: true });
      expect(methods).toEqual(["GET"]);
    });
  }

  it("rejects an unknown SSL value before PATCH", async () => {
    const methods: string[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      return Response.json({
        success: true,
        result: { id: "ssl", value: "automatic" },
        errors: [],
      });
    }) as typeof fetch;

    await expect(ensureZoneOriginTlsMode("zone", "full", {
      apiToken: "token",
      accountId: "account",
    })).rejects.toThrow("unsupported zone SSL setting automatic");
    expect(methods).toEqual(["GET"]);
  });

  it("fails when the provider readback does not match the requested mode", async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => Response.json({
      success: true,
      result: { id: "ssl", value: init?.method === "PATCH" ? "strict" : "flexible" },
      errors: [],
    })) as typeof fetch;
    await expect(ensureZoneOriginTlsMode("zone", "full", { apiToken: "token", accountId: "account" }))
      .rejects.toThrow("readback is flexible, expected full");
  });
});


describe("Cloudflare Worker Custom Domains", () => {
  it("binds an apex hostname to the reviewed Shortlinks router", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      return Response.json({ success: true, result: { id: "binding-1", hostname: "proof.click", service: "hasna-link-router", zone_id: "zone-1", enabled: true }, errors: [] });
    }) as typeof fetch;
    await expect(bindWorkerCustomDomain("proof.click", "zone-1", "hasna-link-router", { apiToken: "token", accountId: "account" }))
      .resolves.toMatchObject({ hostname: "proof.click", service: "hasna-link-router", enabled: true });
    expect(calls).toEqual([{ url: "https://api.cloudflare.com/client/v4/accounts/account/workers/domains", method: "PUT", body: { hostname: "proof.click", service: "hasna-link-router", zone_id: "zone-1" } }]);
  });

  it("requires both the provider binding and the public router probe", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.cloudflare.com")) return Response.json({ success: true, result: [{ hostname: "proof.click", service: "hasna-link-router", zone_id: "zone-1", enabled: true }], errors: [] });
      return new Response(JSON.stringify({ status: "ready", service: "hasna-link-router" }), { status: 200, headers: { "x-hasna-link-router": "hasna-link-router", "content-type": "application/json" } });
    }) as typeof fetch;
    await expect(workerCustomDomainReady("proof.click", "zone-1", "hasna-link-router", { apiToken: "token", accountId: "account" })).resolves.toBe(true);
  });
});

describe("createCloudflareProvider domain inventory", () => {
  it("syncs Cloudflare zones without overwriting existing registrars", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("page=1")) {
        return Response.json({
          success: true,
          result: [
            { id: "zone-1", name: "route53-owned.com", status: "active", name_servers: ["cf1.example", "cf2.example"] },
            { id: "zone-2", name: "zone-only.com", status: "pending", name_servers: ["cf3.example", "cf4.example"] },
          ],
          errors: [],
        });
      }
      return Response.json({ success: true, result: [], errors: [] });
    }) as typeof fetch;

    const existing = domain("route53-owned.com", "AWS Route 53");
    const created: unknown[] = [];
    const updated: unknown[] = [];
    const provider = createCloudflareProvider({ apiToken: "token", accountId: "account" });

    const result = await provider.syncToLocalDb({
      getDomainByName: (name) => name === existing.name ? existing : null,
      createDomain: (input) => {
        created.push(input);
        return domain(input.name, input.registrar ?? "");
      },
      updateDomain: (id, input) => {
        updated.push({ id, input });
        return { ...existing, ...input };
      },
    });

    expect(result).toEqual({ synced: 2, created: 1, updated: 1, errors: [] });
    expect(updated[0]).toMatchObject({
      id: "route53-owned.com",
      input: {
        nameservers: ["cf1.example", "cf2.example"],
        metadata: { cloudflare: { zone_id: "zone-1", zone_status: "active", source: "cloudflare:zones" } },
      },
    });
    expect(created[0]).toMatchObject({
      name: "zone-only.com",
      status: "discovered",
      auto_renew: false,
      nameservers: ["cf3.example", "cf4.example"],
      notes: "Discovered from Cloudflare zones; registrar ownership was not inferred.",
    });
    expect(created[0]).not.toHaveProperty("registrar");
  });

  it("mutates only changed groups when all desired proxied values are explicit", async () => {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });

      if (url.includes("/zones?name=example.com")) {
        return Response.json({
          success: true,
          result: [{ id: "zone-1", name: "example.com", status: "active", name_servers: ["cf1.example", "cf2.example"] }],
          errors: [],
        });
      }
      if (url.includes("/zones/zone-1/dns_records?type=A&name=%40")) {
        return Response.json({
          success: true,
          result: [
            { id: "old-1", type: "A", name: "@", content: "192.0.2.1", ttl: 1, proxied: true },
            { id: "old-2", type: "A", name: "@", content: "192.0.2.2", ttl: 1, proxied: false },
          ],
          errors: [],
        });
      }
      if (url.includes("/zones/zone-1/dns_records?type=CNAME&name=www")) {
        return Response.json({
          success: true,
          result: [{ id: "www-1", type: "CNAME", name: "www", content: "example.com", ttl: 300, proxied: true }],
          errors: [],
        });
      }
      return Response.json({ success: true, result: {}, errors: [] });
    }) as typeof fetch;

    const provider = createCloudflareProvider({ apiToken: "token", accountId: "account" });
    await provider.setDnsRecords("example.com", [
      { type: "CNAME", name: "www", value: "example.com", ttl: 300, proxied: true },
      { type: "A", name: "@", value: "192.0.2.10", ttl: 300, proxied: false },
      { type: "A", name: "@", value: "192.0.2.11", ttl: 300, proxied: true },
    ]);

    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual([
      "https://api.cloudflare.com/client/v4/zones/zone-1/dns_records/old-1",
      "https://api.cloudflare.com/client/v4/zones/zone-1/dns_records/old-2",
    ]);
    expect(calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual([
      { type: "A", name: "@", content: "192.0.2.10", ttl: 300, proxied: false },
      { type: "A", name: "@", content: "192.0.2.11", ttl: 300, proxied: true },
    ]);
  });

  it("returns proxied state and does not mutate an unchanged RRset", async () => {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });

      if (url.includes("/zones?name=example.com")) {
        return Response.json({
          success: true,
          result: [{ id: "zone-1", name: "example.com", status: "active", name_servers: ["cf1.example", "cf2.example"] }],
          errors: [],
        });
      }
      if (url.includes("/zones/zone-1/dns_records?per_page=100&page=1")) {
        return Response.json({
          success: true,
          result: [{ id: "a-1", type: "A", name: "@", content: "192.0.2.10", ttl: 300, proxied: true }],
          errors: [],
        });
      }
      if (url.includes("/zones/zone-1/dns_records?type=A&name=%40")) {
        return Response.json({
          success: true,
          result: [{ id: "a-1", type: "A", name: "@", content: "192.0.2.10", ttl: 300, proxied: true }],
          errors: [],
        });
      }
      return Response.json({ success: true, result: [], errors: [] });
    }) as typeof fetch;

    const provider = createCloudflareProvider({ apiToken: "token", accountId: "account" });
    expect(await provider.getDnsRecords("example.com")).toEqual([
      { type: "A", name: "@", value: "192.0.2.10", ttl: 300, priority: undefined, proxied: true },
    ]);

    calls.length = 0;
    await provider.setDnsRecords("example.com", [
      { type: "A", name: "@", value: "192.0.2.10", ttl: 300, proxied: true },
    ]);

    expect(calls.filter((c) => c.method === "DELETE" || c.method === "POST" || c.method === "PUT")).toEqual([]);
  });

  it("preserves a uniform proxied value when every changed sibling omits it", async () => {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });

      if (url.includes("/zones?name=example.com")) {
        return Response.json({
          success: true,
          result: [{ id: "zone-1", name: "example.com", status: "active", name_servers: ["cf1.example", "cf2.example"] }],
          errors: [],
        });
      }
      if (url.includes("/zones/zone-1/dns_records?type=A&name=%40")) {
        return Response.json({
          success: true,
          result: [
            { id: "a-1", type: "A", name: "@", content: "192.0.2.1", ttl: 300, proxied: true },
            { id: "a-2", type: "A", name: "@", content: "192.0.2.2", ttl: 300, proxied: true },
          ],
          errors: [],
        });
      }
      return Response.json({ success: true, result: [], errors: [] });
    }) as typeof fetch;

    const provider = createCloudflareProvider({ apiToken: "token", accountId: "account" });
    await provider.setDnsRecords("example.com", [
      { type: "A", name: "@", value: "192.0.2.1", ttl: 600 },
      { type: "A", name: "@", value: "192.0.2.2", ttl: 600 },
    ]);

    expect(calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual([
      { type: "A", name: "@", content: "192.0.2.1", ttl: 600, proxied: true },
      { type: "A", name: "@", content: "192.0.2.2", ttl: 600, proxied: true },
    ]);
  });

  it("fails before any mutation when existing proxied values are mixed and desired omits them", async () => {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });

      if (url.includes("/zones?name=example.com")) {
        return Response.json({
          success: true,
          result: [{ id: "zone-1", name: "example.com", status: "active", name_servers: ["cf1.example", "cf2.example"] }],
          errors: [],
        });
      }
      if (url.includes("/zones/zone-1/dns_records?type=CNAME&name=preview")) {
        return Response.json({
          success: true,
          result: [{ id: "preview-1", type: "CNAME", name: "preview", content: "old.example.com", ttl: 300, proxied: false }],
          errors: [],
        });
      }
      if (url.includes("/zones/zone-1/dns_records?type=A&name=%40")) {
        return Response.json({
          success: true,
          result: [
            { id: "a-1", type: "A", name: "@", content: "192.0.2.1", ttl: 300, proxied: true },
            { id: "a-2", type: "A", name: "@", content: "192.0.2.2", ttl: 300, proxied: false },
          ],
          errors: [],
        });
      }
      return Response.json({ success: true, result: [], errors: [] });
    }) as typeof fetch;

    const provider = createCloudflareProvider({ apiToken: "token", accountId: "account" });
    await expect(provider.setDnsRecords("example.com", [
      { type: "CNAME", name: "preview", value: "new.example.com", ttl: 300, proxied: false },
      { type: "A", name: "@", value: "192.0.2.1", ttl: 600 },
      { type: "A", name: "@", value: "192.0.2.2", ttl: 600 },
    ])).rejects.toThrow(/Cannot safely preserve Cloudflare proxied state for A @.*set proxied explicitly/);

    expect(calls.filter((c) => c.method === "DELETE" || c.method === "POST" || c.method === "PUT")).toEqual([]);
  });

  it("fails before mutation when a mixed explicit and omitted desired sibling is ambiguous", async () => {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });

      if (url.includes("/zones?name=example.com")) {
        return Response.json({
          success: true,
          result: [{ id: "zone-1", name: "example.com", status: "active", name_servers: ["cf1.example", "cf2.example"] }],
          errors: [],
        });
      }
      if (url.includes("/zones/zone-1/dns_records?type=A&name=%40")) {
        return Response.json({
          success: true,
          result: [
            { id: "a-1", type: "A", name: "@", content: "192.0.2.1", ttl: 300, proxied: true },
            { id: "a-2", type: "A", name: "@", content: "192.0.2.2", ttl: 300, proxied: true },
          ],
          errors: [],
        });
      }
      return Response.json({ success: true, result: [], errors: [] });
    }) as typeof fetch;

    const provider = createCloudflareProvider({ apiToken: "token", accountId: "account" });
    await expect(provider.setDnsRecords("example.com", [
      { type: "A", name: "@", value: "192.0.2.1", ttl: 600, proxied: true },
      { type: "A", name: "@", value: "192.0.2.3", ttl: 600 },
    ])).rejects.toThrow(/Cannot safely preserve Cloudflare proxied state for A @.*192\.0\.2\.3.*set proxied explicitly/);

    expect(calls.filter((c) => c.method === "DELETE" || c.method === "POST" || c.method === "PUT")).toEqual([]);
  });

  it("preserves an omitted proxied value by exact identity in a mixed desired RRset", async () => {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });

      if (url.includes("/zones?name=example.com")) {
        return Response.json({
          success: true,
          result: [{ id: "zone-1", name: "example.com", status: "active", name_servers: ["cf1.example", "cf2.example"] }],
          errors: [],
        });
      }
      if (url.includes("/zones/zone-1/dns_records?type=A&name=%40")) {
        return Response.json({
          success: true,
          result: [
            { id: "a-1", type: "A", name: "@", content: "192.0.2.1", ttl: 300, proxied: true },
            { id: "a-2", type: "A", name: "@", content: "192.0.2.2", ttl: 300, proxied: true },
          ],
          errors: [],
        });
      }
      return Response.json({ success: true, result: [], errors: [] });
    }) as typeof fetch;

    const provider = createCloudflareProvider({ apiToken: "token", accountId: "account" });
    await provider.setDnsRecords("example.com", [
      { type: "A", name: "@", value: "192.0.2.1", ttl: 600, proxied: true },
      { type: "A", name: "@", value: "192.0.2.2", ttl: 600 },
    ]);

    expect(calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual([
      { type: "A", name: "@", content: "192.0.2.1", ttl: 600, proxied: true },
      { type: "A", name: "@", content: "192.0.2.2", ttl: 600, proxied: true },
    ]);
  });

  describe("createCloudflareProvider DNS record deletion", () => {
    it("deletes only the live records matching the deleted identities (regression PLA23-00589)", async () => {
      const calls: { method: string; url: string; body?: unknown }[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method, url, body });

        if (url.includes("/zones?name=example.com")) {
          return Response.json({
            success: true,
            result: [{ id: "zone-1", name: "example.com", status: "active", name_servers: ["cf1.example"] }],
            errors: [],
          });
        }
        if (url.includes("/zones/zone-1/dns_records?type=TXT&name=%40")) {
          return Response.json({
            success: true,
            result: [
              { id: "t-1", type: "TXT", name: "@", content: "old", ttl: 300 },
              { id: "t-2", type: "TXT", name: "@", content: "keep", ttl: 300 },
              { id: "t-3", type: "TXT", name: "@", content: "other-old", ttl: 300 },
            ],
            errors: [],
          });
        }
        return Response.json({ success: true, result: [], errors: [] });
      }) as typeof fetch;

      const provider = createCloudflareProvider({ apiToken: "token", accountId: "account" });
      const ok = await provider.deleteDnsRecords("example.com", [
        { type: "TXT", name: "@", value: "old", ttl: 300 },
        { type: "TXT", name: "@", value: "other-old", ttl: 300 },
      ]);

      expect(ok).toBe(true);
      expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual([
        "https://api.cloudflare.com/client/v4/zones/zone-1/dns_records/t-1",
        "https://api.cloudflare.com/client/v4/zones/zone-1/dns_records/t-3",
      ]);
    });
  });
});
