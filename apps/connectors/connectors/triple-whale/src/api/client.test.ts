import { afterEach, describe, expect, test } from "bun:test";
import {
  TripleWhaleClient,
  buildUrl,
  normalizeBaseUrl,
  resolveShop,
  toApiPath,
} from "./client.js";
import { TripleWhale } from "./index.js";

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown,
) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = String(v);
    }
    recorded.push({
      url,
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    const json = handler(url, init, recorded);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async text() {
        return JSON.stringify(json ?? {});
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("TripleWhale path helpers", () => {
  test("normalizeBaseUrl strips trailing slashes and /api/v2 suffix", () => {
    expect(normalizeBaseUrl("https://api.triplewhale.com/")).toBe("https://api.triplewhale.com");
    expect(normalizeBaseUrl("https://api.triplewhale.com/api/v2")).toBe("https://api.triplewhale.com");
  });

  test("toApiPath prefixes relative paths with /api/v2", () => {
    expect(toApiPath("/users/api-keys/me")).toBe("/api/v2/users/api-keys/me");
    expect(toApiPath("/api/v2/summary-page/get-data")).toBe("/api/v2/summary-page/get-data");
    expect(toApiPath("/api/other")).toBe("/api/other");
  });

  test("buildUrl combines base, path prefix, and query params", () => {
    const url = buildUrl("https://api.triplewhale.com", "/tw-metrics/metrics-data", {
      shop_domain: "shop.example",
      start_date: "2026-01-01",
    });
    expect(url).toContain("https://api.triplewhale.com/api/v2/tw-metrics/metrics-data");
    expect(url).toContain("shop_domain=shop.example");
    expect(url).toContain("start_date=2026-01-01");
  });
});

describe("TripleWhaleClient transport", () => {
  test("sends x-api-key header and prefixes POST path", async () => {
    const recorded = installFetch(() => ({ ok: true }));
    const client = new TripleWhaleClient({
      apiKey: "tw-test-key",
      baseUrl: "https://api.triplewhale.com",
    });

    await client.request({
      path: "/summary-page/get-data",
      method: "POST",
      body: { shopDomain: "shop.myshopify.com" },
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toContain("/api/v2/summary-page/get-data");
    expect(recorded[0].method).toBe("POST");
    expect(recorded[0].headers["x-api-key"]).toBe("tw-test-key");
    const body = JSON.parse(recorded[0].body!);
    expect(body.shopDomain).toBe("shop.myshopify.com");
  });

  test("GET validate-api-key uses correct path", async () => {
    const recorded = installFetch(() => ({ name: "Test Key" }));
    const client = new TripleWhaleClient({ apiKey: "key" });
    const result = await client.request({ path: "/users/api-keys/me" });
    expect(result).toEqual({ name: "Test Key" });
    expect(recorded[0].url).toContain("/api/v2/users/api-keys/me");
    expect(recorded[0].method).toBe("GET");
    expect(recorded[0].body).toBeUndefined();
  });
});

describe("TripleWhale shop resolution", () => {
  test("resolveShop uses client default shopDomain", () => {
    const client = new TripleWhaleClient({
      apiKey: "key",
      shopDomain: "default.myshopify.com",
    });
    expect(resolveShop(client, {})).toBe("default.myshopify.com");
  });

  test("resolveShop prefers explicit --shop flag", () => {
    const client = new TripleWhaleClient({
      apiKey: "key",
      shopDomain: "default.myshopify.com",
    });
    expect(resolveShop(client, { shop: "override.myshopify.com" })).toBe("override.myshopify.com");
  });

  test("resolveShop throws when shop is missing", () => {
    const client = new TripleWhaleClient({ apiKey: "key" });
    expect(() => resolveShop(client, {})).toThrow(/provide --shop/);
  });
});

describe("TripleWhale operations", () => {
  test("exportAttributedOrders POST body includes shop and dates", async () => {
    const recorded = installFetch(() => ({ orders: [] }));
    const tw = new TripleWhale({
      apiKey: "key",
      shopDomain: "shop.myshopify.com",
    });

    await tw.exportAttributedOrders({
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });

    const call = recorded[0];
    expect(call.url).toContain("/api/v2/attribution/get-orders-with-journeys-v2");
    const body = JSON.parse(call.body!);
    expect(body.shop).toBe("shop.myshopify.com");
    expect(body.startDate).toBe("2026-01-01");
    expect(body.endDate).toBe("2026-01-31");
  });

  test("runSqlQuery shapes POST body with shopId and query", async () => {
    const recorded = installFetch(() => ({ rows: [] }));
    const tw = new TripleWhale({
      apiKey: "key",
      shopDomain: "shop.myshopify.com",
    });

    await tw.runSqlQuery({ query: "SELECT 1", currency: "USD" });

    const body = JSON.parse(recorded[0].body!);
    expect(body.shopId).toBe("shop.myshopify.com");
    expect(body.query).toBe("SELECT 1");
    expect(body.currency).toBe("USD");
  });

  test("sendLeadEvent forces pixel type lead", async () => {
    const recorded = installFetch(() => ({ accepted: true }));
    const tw = new TripleWhale({
      apiKey: "key",
      shopDomain: "shop.myshopify.com",
    });

    await tw.sendLeadEvent({ event: { email: "a@example.com" } });

    expect(recorded[0].url).toContain("/api/v2/data-in/event");
    const body = JSON.parse(recorded[0].body!);
    expect(body.type).toBe("lead");
    expect(body.shop).toBe("shop.myshopify.com");
    expect(body.email).toBe("a@example.com");
  });
});
