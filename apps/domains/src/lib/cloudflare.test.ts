import { afterEach, describe, expect, it } from "bun:test";
import { createCloudflareProvider } from "./cloudflare.js";
import type { Domain } from "../db/domains.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
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
