import { describe, expect, it } from "bun:test";
import {
  resolveEconomyCloudStorage,
  cloudListItems,
  cloudObject,
  type ActiveEconomyCloudStorage,
} from "./cloud-storage.js";

const KEY = "hasna_economy_testkey_0000000000";

describe("resolveEconomyCloudStorage", () => {
  // Fail-closed default (owner directive 2026-09-04): without the fleet API
  // environment AND without the explicit local opt-in, resolution must throw —
  // the CLI may never silently serve the local SQLite store with a false-green
  // exit. The error names the required variables so a missing-env run is
  // actionable.
  it("throws when no mode/env is set, naming the required API environment and the local opt-in", () => {
    expect(() => resolveEconomyCloudStorage({})).toThrow(
      /HASNA_ECONOMY_API_URL and HASNA_ECONOMY_API_KEY/,
    );
    expect(() => resolveEconomyCloudStorage({})).toThrow(/HASNA_ECONOMY_LOCAL=1/);
    expect(() => resolveEconomyCloudStorage({})).toThrow(/fail\w*\s*closed/i);
  });

  // Deployment modes no longer exist (owner directive 2026-07-29). A retired
  // storage-mode variable is a hard error, never silently ignored: the station
  // wrapper used to export HASNA_ECONOMY_STORAGE_MODE=cloud, and a CLI that
  // accepted it quietly would keep serving the wrong dataset after the variable
  // stops meaning anything.
  it("throws when a retired storage-mode variable is set, even with a valid URL + key", () => {
    for (const key of [
      "HASNA_ECONOMY_STORAGE_MODE",
      "HASNA_ECONOMY_MODE",
      "ECONOMY_STORAGE_MODE",
      "ECONOMY_MODE",
    ] as const) {
      expect(() =>
        resolveEconomyCloudStorage({
          [key]: "cloud",
          HASNA_ECONOMY_API_URL: "https://economy.hasna.xyz",
          HASNA_ECONOMY_API_KEY: KEY,
        }),
      ).toThrow(new RegExp(`${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} was removed`));
    }
  });



  it("resolves the http transport when API_URL + API_KEY are set", () => {
    const r = resolveEconomyCloudStorage({
      HASNA_ECONOMY_API_URL: "https://economy.hasna.xyz",
      HASNA_ECONOMY_API_KEY: KEY,
    });
    expect(r.active).toBe(true);
    expect(r.client).not.toBeNull();
    expect(r.client!.baseUrl).toBe("https://economy.hasna.xyz/v1");
  });

  it("throws when API_URL is set without the API key (no silent local drift)", () => {
    expect(() =>
      resolveEconomyCloudStorage({
        HASNA_ECONOMY_API_URL: "https://economy.hasna.xyz",
      }),
    ).toThrow();
  });

  // Regression: todos 4704ab9f. The fleet env-flip shape is API_URL + API_KEY
  // with no storage-mode variable (modes are retired). A half-applied flip that
  // leaves API_URL set and API_KEY absent must not resolve to `local` silently:
  // the CLI would serve the local SQLite store while the operator pointed it at
  // the cloud API. The contracts seam reports the resolution as misconfigured
  // and the resolver throws.
  it("throws when API_URL is set without API_KEY (partial flip)", () => {
    expect(() =>
      resolveEconomyCloudStorage({
        HASNA_ECONOMY_API_URL: "https://economy.hasna.xyz",
      }),
    ).toThrow(/API key/i);
  });

  // The explicit local opt-in (HASNA_ECONOMY_LOCAL, alias ECONOMY_LOCAL) is the
  // only way to reach the on-box SQLite store without the fleet API env. These
  // are the negative controls for the fail-closed test above: once opted in,
  // an unconfigured machine is a legitimate local client again.
  it("is inactive (local) when the explicit local opt-in is set and no API env is set", () => {
    const r = resolveEconomyCloudStorage({ HASNA_ECONOMY_LOCAL: "1" });
    expect(r.active).toBe(false);
    expect(r.client).toBeNull();
    expect(() => resolveEconomyCloudStorage({ HASNA_ECONOMY_LOCAL: "1" })).not.toThrow();
  });

  it("accepts the unprefixed ECONOMY_LOCAL alias for the opt-in", () => {
    expect(resolveEconomyCloudStorage({ ECONOMY_LOCAL: "true" }).active).toBe(false);
  });

  it("treats blank/false-y opt-in values as not opted in (fail closed)", () => {
    for (const value of ["", "0", "false", "no", "off", "FALSE"]) {
      expect(() => resolveEconomyCloudStorage({ HASNA_ECONOMY_LOCAL: value })).toThrow(
        /HASNA_ECONOMY_API_URL/,
      );
    }
  });

  it("opt-in keeps the explicit-blank API URL/KEY pair on the local store", () => {
    // The shape spawned-CLI local-mode tests use: both tiers of the API env are
    // cleared, and local is opted into explicitly.
    const r = resolveEconomyCloudStorage({
      HASNA_ECONOMY_API_URL: "",
      HASNA_ECONOMY_API_KEY: "",
      ECONOMY_API_URL: "",
      ECONOMY_API_KEY: "",
      HASNA_ECONOMY_LOCAL: "1",
    });
    expect(r.active).toBe(false);
    expect(r.client).toBeNull();
  });

  // The opt-in is a local-mode switch, never a misconfiguration bypass: an API
  // URL present without a key still refuses to route (the contracts seam
  // reports the resolution as misconfigured), because falling back to the local
  // dataset would read the wrong store for an operator who pointed at the API.
  it("throws on API_URL without API_KEY even when the local opt-in is set", () => {
    expect(() =>
      resolveEconomyCloudStorage({
        HASNA_ECONOMY_API_URL: "https://economy.hasna.xyz",
        HASNA_ECONOMY_LOCAL: "1",
      }),
    ).toThrow(/API key/i);
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
