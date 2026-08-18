import { describe, expect, it } from "bun:test";
import {
  resolveEconomyCloudStorage,
  cloudListItems,
  cloudObject,
  type ActiveEconomyCloudStorage,
} from "./cloud-storage.js";

const KEY = "hasna_economy_testkey_0000000000";

describe("resolveEconomyCloudStorage", () => {
  it("is inactive (local) when no env is set", () => {
    const r = resolveEconomyCloudStorage({});
    expect(r.active).toBe(false);
    expect(r.client).toBeNull();
  });

  it("rejects a surviving storage-mode variable (no-compat mandate)", () => {
    // The mode concept is removed: a legacy mode variable is a hard error from
    // the contracts client resolver, never a selector and never silently ignored.
    expect(() =>
      resolveEconomyCloudStorage({
        HASNA_ECONOMY_STORAGE_MODE: "local",
        HASNA_ECONOMY_API_URL: "https://economy.hasna.xyz",
        HASNA_ECONOMY_API_KEY: KEY,
      }),
    ).toThrow(/removed/i);
  });

  it("is active (hosted) when API_URL + API_KEY are set", () => {
    const r = resolveEconomyCloudStorage({
      HASNA_ECONOMY_API_URL: "https://economy.hasna.xyz",
      HASNA_ECONOMY_API_KEY: KEY,
    });
    expect(r.active).toBe(true);
    expect(r.client).not.toBeNull();
    expect(r.client!.baseUrl).toBe("https://economy.hasna.xyz/v1");
  });

  it("throws when the API key is missing (no silent local drift)", () => {
    expect(() =>
      resolveEconomyCloudStorage({
        HASNA_ECONOMY_API_URL: "https://economy.hasna.xyz",
      }),
    ).toThrow();
  });

  // Regression: todos 4704ab9f. A half-applied flip leaves API_URL set and
  // API_KEY absent -- resolving to `local` with misconfigured=false and no
  // warning would be indistinguishable from an unconfigured machine, and the
  // CLI would serve the local SQLite store while the operator had pointed it at
  // the hosted API: a different dataset, no error, plausible numbers.
  it("throws when API_URL is set without API_KEY (partial flip)", () => {
    expect(() =>
      resolveEconomyCloudStorage({
        HASNA_ECONOMY_API_URL: "https://economy.hasna.xyz",
      }),
    ).toThrow(/API key/i);
  });

  // Guard against over-firing: an unconfigured machine is a legitimate local
  // client and must stay silent. This is the negative control for the test above
  // -- if the partial-flip fix ever starts throwing here, it has become a
  // fleet-wide outage rather than a safety check.
  it("stays silently local when neither API_URL nor API_KEY is set", () => {
    expect(() => resolveEconomyCloudStorage({})).not.toThrow();
    expect(resolveEconomyCloudStorage({}).active).toBe(false);
  });

  // A stray API key without a URL is an unconfigured machine: local stays
  // silent (misconfigured=false), because nothing selected a route.
  it("stays local when API_KEY is set without API_URL", () => {
    const r = resolveEconomyCloudStorage({ HASNA_ECONOMY_API_KEY: KEY });
    expect(r.active).toBe(false);
  });

  it("is active and targets <origin>/v1 when API_URL + API_KEY are set", () => {
    const r = resolveEconomyCloudStorage({
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

  it("cloudListItems routes a read to GET <origin>/v1/<resource> and extracts the envelope data array", async () => {
    const calls: { url: string; method?: string; auth?: string | null }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url, method: init?.method, auth: headers.get("authorization") });
      return new Response(JSON.stringify({ data: [{ id: "s1" }, { id: "s2" }], meta: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const r = resolveEconomyCloudStorage(
      {
        HASNA_ECONOMY_API_URL: "https://economy.hasna.xyz",
        HASNA_ECONOMY_API_KEY: KEY,
      },
      { fetchImpl: fakeFetch },
    );
    expect(r.active).toBe(true);

    const items = await cloudListItems(r as ActiveEconomyCloudStorage, "sessions", {
      agent: "claude",
      limit: 20,
      project: undefined, // dropped by cleanQuery
    });
    expect(items).toEqual([{ id: "s1" }, { id: "s2" }]);
    expect(calls.length).toBe(1);
    expect(calls[0]!.method ?? "GET").toBe("GET");
    expect(calls[0]!.auth).toBe(`Bearer ${KEY}`);
    expect(calls[0]!.url).toContain("https://economy.hasna.xyz/v1/sessions");
    expect(calls[0]!.url).toContain("agent=claude");
    expect(calls[0]!.url).toContain("limit=20");
    expect(calls[0]!.url).not.toContain("project");
  });

  it("cloudObject unwraps the envelope `data` object (e.g. /usage summary)", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ data: { summary: { total_usd: 1.5, sessions: 2 } }, meta: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    const r = resolveEconomyCloudStorage(
      {
        HASNA_ECONOMY_API_URL: "https://economy.hasna.xyz",
        HASNA_ECONOMY_API_KEY: KEY,
      },
      { fetchImpl: fakeFetch },
    );
    const payload = await cloudObject<{ summary: { total_usd: number; sessions: number } }>(
      r as ActiveEconomyCloudStorage,
      "/usage",
      { period: "today" },
    );
    expect(payload.summary.total_usd).toBe(1.5);
    expect(payload.summary.sessions).toBe(2);
  });
});
