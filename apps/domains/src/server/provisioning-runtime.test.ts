import { afterEach, describe, expect, test } from "bun:test";
import { createHostedProvisioningProviders } from "./provisioning-runtime.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("hosted provisioning provider credentials", () => {
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
