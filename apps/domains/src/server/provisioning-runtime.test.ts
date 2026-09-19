import { afterEach, describe, expect, test } from "bun:test";
import { _setFetch as setBrandsightFetch } from "../lib/brandsight.js";
import {
  canonicalDelegationRecords,
  createHostedProvisioningProviders,
} from "./provisioning-runtime.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  setBrandsightFetch(null);
});

describe("hosted provisioning provider credentials", () => {
  test("fails closed on DNS shapes that cannot be copied without semantic loss", () => {
    expect(() => canonicalDelegationRecords([
      { type: "SRV", name: "_sip._tcp", value: "sip.example", ttl: 600, priority: 10 },
    ], "proof.example")).toThrow("record type 'SRV'");
    expect(() => canonicalDelegationRecords([
      { type: "A", name: "proof.example", value: "alias.elb.amazonaws.com", ttl: 0 },
    ], "proof.example")).toThrow("TTL outside 60-86400");
  });

  test("requires a scoped Cloudflare API token and rejects global key/email fallback", () => {
    expect(() => createHostedProvisioningProviders({
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_API_KEY: "global-key",
      CLOUDFLARE_EMAIL: "operator@example.com",
      DOMAINS_REGISTRANT_SOURCE_DOMAIN: "source.example",
    })).toThrow("global API key/email authentication is not accepted");
  });

  test("requires the registrant source domain at provider construction", () => {
    expect(() => createHostedProvisioningProviders({
      CLOUDFLARE_API_TOKEN: "scoped-token",
      CLOUDFLARE_ACCOUNT_ID: "account",
    })).toThrow("DOMAINS_REGISTRANT_SOURCE_DOMAIN");
  });

  test("requires the Cloudflare account id alongside the scoped token", () => {
    expect(() => createHostedProvisioningProviders({
      CLOUDFLARE_API_TOKEN: "scoped-token",
      DOMAINS_REGISTRANT_SOURCE_DOMAIN: "source.example",
    })).toThrow("CLOUDFLARE_ACCOUNT_ID");
  });

  test("passes only bearer-token Cloudflare auth to hosted provider calls", async () => {
    const calls: Array<{ authorization: string | null; globalKey: string | null; globalEmail: string | null }> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({
        authorization: headers.get("authorization"),
        globalKey: headers.get("x-auth-key"),
        globalEmail: headers.get("x-auth-email"),
      });
      return Response.json({
        success: true,
        result: [{ id: "zone", name: "proof.example", status: "active", name_servers: ["a.ns.cloudflare.com", "b.ns.cloudflare.com"] }],
        errors: [],
      });
    }) as typeof fetch;

    const providers = createHostedProvisioningProviders({
      CLOUDFLARE_API_TOKEN: "scoped-token",
      CLOUDFLARE_ACCOUNT_ID: "account",
      DOMAINS_REGISTRANT_SOURCE_DOMAIN: "source.example",
    });
    await providers.ensureCloudflareZone("proof.example");
    expect(calls).toEqual([{
      authorization: "Bearer scoped-token",
      globalKey: null,
      globalEmail: null,
    }]);
  });

  test("constructs the hosted provider set with token-only Cloudflare auth", () => {
    const providers = createHostedProvisioningProviders({
      CLOUDFLARE_API_TOKEN: "scoped-token",
      CLOUDFLARE_ACCOUNT_ID: "account",
      DOMAINS_REGISTRANT_SOURCE_DOMAIN: "source.example",
    });
    expect(typeof providers.ensureCloudflareZone).toBe("function");
    expect(typeof providers.bindWorkerDomain).toBe("function");
    expect(typeof providers.listRoute53HostedZoneIds).toBe("function");
    expect(typeof providers.cleanupRoute53HostedZone).toBe("function");
  });

  test("fails closed before provider I/O when Brandsight credential references are absent", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return Response.json({ success: true, result: [], errors: [] });
    }) as typeof fetch;
    const providers = createHostedProvisioningProviders({
      CLOUDFLARE_API_TOKEN: "scoped-token",
      CLOUDFLARE_ACCOUNT_ID: "account",
      DOMAINS_REGISTRANT_SOURCE_DOMAIN: "source.example",
    });
    await expect(providers.getDomainDetail("proof.example", "brandsight"))
      .rejects.toThrow("BRANDSIGHT_API_KEY, BRANDSIGHT_API_SECRET, and BRANDSIGHT_CUSTOMER_ID");
    expect(calls).toBe(0);
  });

  test("copies and verifies existing Brandsight DNS before delegation without replacing unrelated groups", async () => {
    const registrarRecords = [
      { type: "A", name: "@", data: "192.0.2.10", ttl: 300 },
      { type: "MX", name: "@", data: "mail.proof.example", ttl: 600, priority: 10 },
      { type: "TXT", name: "_dmarc", data: "v=DMARC1; p=none", ttl: 600 },
      { type: "CAA", name: "@", data: "0 issue letsencrypt.org", ttl: 600 },
      { type: "NS", name: "sub", data: "ns1.delegate.example", ttl: 600 },
      { type: "NS", name: "@", data: "ns05.gcd-dns.com", ttl: 600 },
      { type: "SOA", name: "@", data: "ignored", ttl: 600 },
    ];
    setBrandsightFetch((async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/records?offset=0&limit=1000")) return Response.json(registrarRecords);
      if (url.includes("/records?offset=1000&limit=1000")) return Response.json([]);
      throw new Error(`unexpected Brandsight URL ${url}`);
    }) as typeof fetch);

    const written: Array<Record<string, unknown>> = [];
    const cloudflareReadback = registrarRecords
      .filter((record) => record.type !== "SOA" && !(record.type === "NS" && record.name === "@"))
      .map((record, index) => ({
        id: `record-${index}`,
        type: record.type,
        name: record.name === "@" ? "proof.example" : `${record.name}.proof.example`,
        content: record.data,
        ttl: record.ttl,
        ...(record.priority === undefined ? {} : { priority: record.priority }),
        ...(["A", "AAAA", "CNAME"].includes(record.type) ? { proxied: false } : {}),
      }));
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/dns_records?type=")) {
        return Response.json({ success: true, result: [], errors: [] });
      }
      if (url.includes("/dns_records?per_page=100&page=1")) {
        return Response.json({ success: true, result: cloudflareReadback, errors: [] });
      }
      if (url.endsWith("/dns_records") && method === "POST") {
        written.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ success: true, result: { id: `new-${written.length}` }, errors: [] });
      }
      throw new Error(`unexpected Cloudflare URL ${url}`);
    }) as typeof fetch;

    const providers = createHostedProvisioningProviders({
      CLOUDFLARE_API_TOKEN: "scoped-token",
      CLOUDFLARE_ACCOUNT_ID: "account",
      DOMAINS_REGISTRANT_SOURCE_DOMAIN: "source.example",
      BRANDSIGHT_API_KEY: "brandsight-key",
      BRANDSIGHT_API_SECRET: "brandsight-secret",
      BRANDSIGHT_CUSTOMER_ID: "brandsight-customer",
    });
    const evidence = await providers.preserveRegistrarDnsBeforeDelegation({
      hostname: "proof.example",
      zoneId: "zone",
      registrar: "brandsight",
    });
    expect(evidence.count).toBe(5);
    expect(evidence.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(written.map((record) => record.type).sort()).toEqual(["A", "CAA", "MX", "NS", "TXT"]);
    expect(written.find((record) => record.type === "MX")).toMatchObject({ priority: 10 });
    expect(written.find((record) => record.type === "A")).toMatchObject({ proxied: false });
    expect(written.some((record) => record.content === "ns05.gcd-dns.com")).toBe(false);
    expect(written.some((record) => record.content === "ignored")).toBe(false);
  });

  test("replaces only conflicting apex/www address records when routing an adopted website", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({
        method,
        url,
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      });
      if (method === "GET" && url.includes("type=A&name=proof.example")) {
        return Response.json({
          success: true,
          result: [{ id: "old-apex-a", type: "A", name: "proof.example", content: "192.0.2.10", ttl: 300 }],
          errors: [],
        });
      }
      if (method === "GET") return Response.json({ success: true, result: [], errors: [] });
      return Response.json({ success: true, result: { id: "ok" }, errors: [] });
    }) as typeof fetch;
    const providers = createHostedProvisioningProviders({
      CLOUDFLARE_API_TOKEN: "scoped-token",
      CLOUDFLARE_ACCOUNT_ID: "account",
      DOMAINS_REGISTRANT_SOURCE_DOMAIN: "source.example",
    });

    await providers.configureWebsiteOrigin({
      hostname: "proof.example",
      zoneId: "zone",
      originHostname: "origin.us-east-1.elb.amazonaws.com",
    });
    expect(calls.some((call) => call.method === "DELETE" && call.url.endsWith("/dns_records/old-apex-a"))).toBe(true);
    expect(calls.filter((call) => call.method === "POST").map((call) => call.body)).toEqual([
      {
        type: "CNAME", name: "proof.example", content: "origin.us-east-1.elb.amazonaws.com",
        ttl: 1, proxied: true,
      },
      {
        type: "CNAME", name: "www.proof.example", content: "origin.us-east-1.elb.amazonaws.com",
        ttl: 1, proxied: true,
      },
    ]);
    expect(calls.some((call) => call.url.includes("type=MX") || call.url.includes("type=TXT") || call.url.includes("type=CAA"))).toBe(false);
  });

  test("website readiness requires exact TLS mode, proxied records, and canonical response identity", async () => {
    let tlsMode = "full";
    let canonicalHost = "proof.example";
    let publicCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/settings/ssl")) {
        return Response.json({ success: true, result: { id: "ssl", value: tlsMode }, errors: [] });
      }
      if (url.includes("/dns_records?per_page=100&page=1")) {
        return Response.json({
          success: true,
          result: [
            { id: "apex", type: "CNAME", name: "proof.example", content: "origin.us-east-1.elb.amazonaws.com", ttl: 1, proxied: true },
            { id: "www", type: "CNAME", name: "www.proof.example", content: "origin.us-east-1.elb.amazonaws.com", ttl: 1, proxied: true },
          ],
          errors: [],
        });
      }
      publicCalls += 1;
      return new Response(`<html><head><link href="https://${canonicalHost}" rel="canonical"></head></html>`, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }) as typeof fetch;

    const providers = createHostedProvisioningProviders({
      CLOUDFLARE_API_TOKEN: "scoped-token",
      CLOUDFLARE_ACCOUNT_ID: "account",
      DOMAINS_REGISTRANT_SOURCE_DOMAIN: "source.example",
    });
    const input = {
      hostname: "proof.example",
      zoneId: "zone",
      originHostname: "origin.us-east-1.elb.amazonaws.com",
      originTlsMode: "full" as const,
    };
    await expect(providers.websiteOriginReady(input)).resolves.toBe(true);
    tlsMode = "strict";
    await expect(providers.websiteOriginReady(input)).resolves.toBe(false);
    expect(publicCalls).toBe(1);
    tlsMode = "full";
    canonicalHost = "generic-waf.example";
    await expect(providers.websiteOriginReady(input)).resolves.toBe(false);
    expect(publicCalls).toBe(2);
  });
});
