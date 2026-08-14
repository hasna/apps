import { afterEach, describe, expect, test } from "bun:test";
import { Connector } from "./index";

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
}

function installFetch(handler: (url: string) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    recorded.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body as string | undefined,
      headers: (init?.headers as Record<string, string>) ?? {},
    });
    const json = handler(url);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "application/json" },
      async text() {
        return JSON.stringify(json ?? {});
      },
    } as unknown as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Stripe Treasury connector", () => {
  test("requires an API key", () => {
    expect(() => new Connector({ apiKey: "" })).toThrow();
  });

  test("sends Bearer auth, Stripe-Version, and connected account headers", async () => {
    const recorded = installFetch(() => ({ object: "list", data: [], has_more: false, url: "/v1/treasury/financial_accounts" }));
    const client = new Connector({ apiKey: "sk_test_123", accountId: "acct_123" });
    await client.financialAccounts.list({ limit: 1 });
    expect(recorded[0].headers["Authorization"]).toBe("Bearer sk_test_123");
    expect(recorded[0].headers["Stripe-Version"]).toBeDefined();
    expect(recorded[0].headers["Stripe-Account"]).toBe("acct_123");
  });

  test("list requests encode nested Stripe filters with bracket notation", async () => {
    const recorded = installFetch(() => ({ object: "list", data: [], has_more: false, url: "/v1/treasury/financial_accounts" }));
    const client = new Connector({ apiKey: "sk_test_123" });
    await client.financialAccounts.list({ limit: 5, created: { gt: 1700000000, lt: 1800000000 } });

    const url = new URL(recorded[0].url);
    expect(url.pathname).toBe("/v1/treasury/financial_accounts");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("created[gt]")).toBe("1700000000");
    expect(url.searchParams.get("created[lt]")).toBe("1800000000");
    expect(url.search).not.toContain("[object+Object]");
  });

  test("create posts form-encoded nested feature options", async () => {
    const recorded = installFetch(() => ({ id: "fa_123", object: "treasury.financial_account" }));
    const client = new Connector({ apiKey: "sk_test_123" });
    await client.financialAccounts.create({
      supported_currencies: ["usd"],
      features: { financial_addresses: { aba: { requested: true } } },
    });

    const call = recorded[0];
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://api.stripe.com/v1/treasury/financial_accounts");
    const body = decodeURIComponent(call.body ?? "");
    expect(body).toContain("supported_currencies[0]=usd");
    expect(body).toContain("features[financial_addresses][aba][requested]=true");
  });
});
