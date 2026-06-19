import { afterEach, describe, it, expect } from "bun:test";
import {
  resolveBrandsightConfig,
  brandsightCapability,
  getDnsRecords,
  listDomains,
  monitorBrand,
  registerBrandsightDomain,
  renewDomain,
  setDnsRecords,
  _setFetch,
} from "./brandsight.js";

afterEach(() => {
  _setFetch(null);
  delete process.env["BRANDSIGHT_API_KEY"];
  delete process.env["BRANDSIGHT_DEMO_STUBS"];
  delete process.env["BRANDSIGHT_ALLOW_STUBS"];
});

describe("resolveBrandsightConfig", () => {
  it("reads standard BRANDSIGHT env names", () => {
    const c = resolveBrandsightConfig({
      BRANDSIGHT_API_KEY: "k",
      BRANDSIGHT_API_SECRET: "s",
      BRANDSIGHT_CUSTOMER_ID: "c",
      BRANDSIGHT_SHOPPER_ID: "sh",
    });
    expect(c.apiKey).toBe("k");
    expect(c.apiSecret).toBe("s");
    expect(c.customerId).toBe("c");
    expect(c.shopperId).toBe("sh");
  });

  it("does not rely on org-scoped Brandsight env aliases", () => {
    const c = resolveBrandsightConfig({
      ACME_BRANDSIGHT_API_KEY: "k",
      ACME_BRANDSIGHT_API_SECRET: "s",
    });
    expect(c.apiKey).toBe("");
    expect(c.apiSecret).toBeUndefined();
  });

  it("defaults to empty apiKey when credentials are missing", () => {
    expect(resolveBrandsightConfig({}).apiKey).toBe("");
  });
});

describe("brandsightCapability", () => {
  it("is always gated, configured when full creds present", () => {
    const cap = brandsightCapability({
      BRANDSIGHT_API_KEY: "k", BRANDSIGHT_API_SECRET: "s", BRANDSIGHT_CUSTOMER_ID: "c",
    });
    expect(cap.configured).toBe(true);
    expect(cap.gated).toBe(true);
  });

  it("ignores org-scoped credentials unless users map them to standard env names", () => {
    const cap = brandsightCapability({
      ACME_BRANDSIGHT_API_KEY: "k",
      ACME_BRANDSIGHT_API_SECRET: "s",
      ACME_BRANDSIGHT_CUSTOMER_ID: "c",
    });
    expect(cap.configured).toBe(false);
    expect(cap.gated).toBe(true);
  });

  it("not configured when creds missing", () => {
    expect(brandsightCapability({}).configured).toBe(false);
  });
});

describe("Brandsight Domain API", () => {
  it("uses official v2 customer domains endpoint with sso-key auth and marker pagination", async () => {
    const first = Array.from({ length: 500 }, (_, i) => ({
      domain: `domain-${String(i).padStart(3, "0")}.com`,
      status: "ACTIVE",
      expiresAt: "2027-01-01T00:00:00Z",
      renewAuto: true,
      nameServers: ["ns1.example.com", "ns2.example.com"],
    }));
    const second = [{
      domain: "final.example",
      status: "PARKED",
      expiresAt: "2028-01-01T00:00:00Z",
      renewAuto: false,
      nameServers: [],
    }];
    const seen: string[] = [];

    _setFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push(url);
      expect((init?.headers as Record<string, string>).Authorization).toBe("sso-key key:secret");
      if (url.includes("marker=domain-499.com")) {
        return new Response(JSON.stringify(second), { status: 200 });
      }
      return new Response(JSON.stringify(first), { status: 200 });
    }) as typeof fetch);

    const domains = await listDomains({
      apiKey: "key",
      apiSecret: "secret",
      customerId: "customer",
    });

    expect(domains).toHaveLength(501);
    expect(domains[0]).toMatchObject({
      domain: "domain-000.com",
      expires: "2027-01-01T00:00:00Z",
      auto_renew: true,
      nameservers: ["ns1.example.com", "ns2.example.com"],
    });
    expect(seen[0]).toContain("https://api.godaddy.com/v2/customers/customer/domains?limit=500");
    expect(seen[1]).toContain("marker=domain-499.com");
  });

  it("builds the documented registration consent, agreement, validate, and register flow", async () => {
    const calls: { url: string; method?: string; body?: unknown }[] = [];

    _setFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      expect((init?.headers as Record<string, string>).Authorization).toBe("sso-key key:secret");

      if (url.includes("/domains/available")) {
        return new Response(JSON.stringify({
          domain: "example.com",
          available: true,
          price: 12.34,
          currency: "USD",
          registryPremiumPricing: false,
        }), { status: 200 });
      }
      if (url.includes("/domains/register/schema/com")) {
        return new Response(JSON.stringify({ id: "schema" }), { status: 200 });
      }
      if (url.includes("/domains/agreements")) {
        return new Response(JSON.stringify([{ agreementKey: "DNRA" }]), { status: 200 });
      }
      if (url.includes("/domains/register/validate")) {
        expect(body).toMatchObject({
          domain: "example.com",
          period: 2,
          renewAuto: false,
          consent: { agreementKeys: ["DNRA"], currency: "USD", price: 12.34 },
        });
        return new Response("", { status: 204 });
      }
      if (url.endsWith("/customers/customer/domains/register")) {
        return new Response(JSON.stringify({ id: "reg-123" }), { status: 202 });
      }
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch);

    const result = await registerBrandsightDomain(
      "example.com",
      {
        first_name: "Ada",
        last_name: "Lovelace",
        email: "ada@example.com",
        phone: "+1.5555555555",
        address_line_1: "1 Main St",
        city: "New York",
        state: "NY",
        country_code: "US",
        zip_code: "10001",
      },
      { years: 2, autoRenew: false },
      { apiKey: "key", apiSecret: "secret", customerId: "customer" },
    );

    expect(result).toEqual({ success: true, orderId: "reg-123", operationId: "reg-123", chargedAmount: "12.34" });
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.godaddy.com/v2/domains/available?domain=example.com&period=2&type=REGISTRATION&optimizeFor=ACCURACY",
      "https://api.godaddy.com/v2/customers/customer/domains/register/schema/com",
      "https://api.godaddy.com/v2/customers/customer/domains/agreements?privacy=false&tlds=com",
      "https://api.godaddy.com/v2/customers/customer/domains/register/validate",
      "https://api.godaddy.com/v2/customers/customer/domains/register",
    ]);
  });

  it("renews with a current quote and consent payload", async () => {
    _setFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect((init?.headers as Record<string, string>).Authorization).toBe("sso-key key:secret");
      if (url.endsWith("/customers/customer/domains/example.com")) {
        return new Response(JSON.stringify({
          domain: "example.com",
          status: "ACTIVE",
          expiresAt: "2027-01-01T00:00:00Z",
          renewAuto: true,
          nameServers: [],
        }), { status: 200 });
      }
      if (url.includes("/domains/available")) {
        expect(url).toContain("type=RENEWAL");
        return new Response(JSON.stringify({
          domain: "example.com",
          available: true,
          price: 10,
          currency: "USD",
          registryPremiumPricing: false,
        }), { status: 200 });
      }
      if (url.endsWith("/customers/customer/domains/example.com/renew")) {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          expires: "2027-01-01T00:00:00Z",
          period: 1,
          consent: { agreedBy: "shopper", currency: "USD", price: 10, registryPremiumPricing: false },
        });
        return new Response(JSON.stringify({ id: "renew-123" }), { status: 202 });
      }
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch);

    await expect(renewDomain("example.com", 1, {
      apiKey: "key",
      apiSecret: "secret",
      customerId: "customer",
      shopperId: "shopper",
    })).resolves.toEqual({ success: true, orderId: "renew-123" });
  });

  it("paginates DNS records using offset as a page number", async () => {
    const first = Array.from({ length: 1000 }, (_, i) => ({
      type: "TXT",
      name: `record-${i}`,
      data: "value",
      ttl: 600,
    }));
    const second = [{ type: "TXT", name: "final", data: "value", ttl: 600 }];
    const urls: string[] = [];

    _setFetch((async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("offset=1")) {
        return new Response(JSON.stringify(second), { status: 200 });
      }
      return new Response(JSON.stringify(first), { status: 200 });
    }) as typeof fetch);

    const records = await getDnsRecords("example.com", {
      apiKey: "key",
      apiSecret: "secret",
      customerId: "customer",
    });

    expect(records).toHaveLength(1001);
    expect(urls[0]).toContain("offset=0&limit=1000");
    expect(urls[1]).toContain("offset=1&limit=1000");
  });

  it("normalizes Brandsight DNS TTLs to the documented 600 second minimum", async () => {
    _setFetch((async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual([
        { type: "A", name: "@", data: "192.0.2.10", ttl: 600 },
        { type: "TXT", name: "@", data: "hello", ttl: 900 },
      ]);
      return new Response("", { status: 200 });
    }) as typeof fetch);

    await expect(setDnsRecords("example.com", [
      { type: "A", name: "@", data: "192.0.2.10", ttl: 0 },
      { type: "TXT", name: "@", data: "hello", ttl: 900 },
    ], {
      apiKey: "key",
      apiSecret: "secret",
      customerId: "customer",
    })).resolves.toBe(true);
  });

  it("does not silently return demo brand-monitor stubs unless explicitly enabled", async () => {
    process.env["BRANDSIGHT_API_KEY"] = "key";
    _setFetch((async () => {
      throw new Error("network down");
    }) as typeof fetch);

    await expect(monitorBrand("example")).rejects.toThrow(/network down/);

    process.env["BRANDSIGHT_DEMO_STUBS"] = "1";
    await expect(monitorBrand("example")).resolves.toMatchObject({ brand: "example", stub: true });
  });
});
