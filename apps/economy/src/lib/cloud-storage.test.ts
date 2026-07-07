import { describe, expect, it } from "bun:test";
import { resolveEconomyCloudStorage } from "./cloud-storage.js";

const KEY = "hasna_economy_testkey_0000000000";

describe("resolveEconomyCloudStorage", () => {
  it("is inactive (local) when no mode/env is set", () => {
    const r = resolveEconomyCloudStorage({});
    expect(r.active).toBe(false);
    expect(r.client).toBeNull();
  });

  it("is inactive when mode is local even with API_URL + API_KEY", () => {
    const r = resolveEconomyCloudStorage({
      HASNA_ECONOMY_STORAGE_MODE: "local",
      HASNA_ECONOMY_API_URL: "https://economy.hasna.xyz",
      HASNA_ECONOMY_API_KEY: KEY,
    });
    expect(r.active).toBe(false);
  });

  it("throws when mode=self_hosted but the API key is missing (no silent local drift)", () => {
    expect(() =>
      resolveEconomyCloudStorage({
        HASNA_ECONOMY_STORAGE_MODE: "self_hosted",
        HASNA_ECONOMY_API_URL: "https://economy.hasna.xyz",
      }),
    ).toThrow();
  });

  it("is active and targets <origin>/v1 when mode=self_hosted + API_URL + API_KEY", () => {
    const r = resolveEconomyCloudStorage({
      HASNA_ECONOMY_STORAGE_MODE: "self_hosted",
      HASNA_ECONOMY_API_URL: "https://economy.hasna.xyz",
      HASNA_ECONOMY_API_KEY: KEY,
    });
    expect(r.active).toBe(true);
    expect(r.client).not.toBeNull();
    expect(r.client!.baseUrl).toBe("https://economy.hasna.xyz/v1");
    expect(r.client!.name).toBe("economy");
  });

  it("routes a create() write to POST <origin>/v1/budgets with the bearer key", async () => {
    const calls: { url: string; method?: string; auth?: string | null; body?: string | null }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url,
        method: init?.method,
        auth: headers.get("authorization"),
        body: init?.body ? String(init.body) : null,
      });
      return new Response(JSON.stringify({ data: { id: "b_1" } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const r = resolveEconomyCloudStorage(
      {
        HASNA_ECONOMY_STORAGE_MODE: "self_hosted",
        HASNA_ECONOMY_API_URL: "https://economy.hasna.xyz",
        HASNA_ECONOMY_API_KEY: KEY,
      },
      { fetchImpl: fakeFetch },
    );
    expect(r.active).toBe(true);

    await r.client!.create("budgets", { period: "daily", limit_usd: 1 });
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe("https://economy.hasna.xyz/v1/budgets");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.auth).toBe(`Bearer ${KEY}`);
    expect(calls[0]!.body).toContain("limit_usd");
  });
});
