import { afterEach, describe, expect, it } from "bun:test";
import { countScenarios, isCloud, listScenarios, resetTestersStore, resolveTestersStore } from "./store.js";

const CLIENT_ENV = [
  "HASNA_TESTERS_STORAGE_MODE",
  "HASNA_TESTERS_MODE",
  "HASNA_TESTERS_API_URL",
  "HASNA_TESTERS_API_KEY",
  "TESTERS_API_URL",
  "TESTERS_API_KEY",
];

function clearEnv(): void {
  for (const k of CLIENT_ENV) delete process.env[k];
  resetTestersStore();
}

afterEach(clearEnv);

describe("testers client storage resolver", () => {
  it("defaults to the local store when nothing is set", () => {
    clearEnv();
    const r = resolveTestersStore();
    expect(r.transport).toBe("local");
    expect(r.client).toBeNull();
    expect(isCloud()).toBe(false);
  });

  it("stays local in self_hosted mode without an API key (no silent drift)", () => {
    clearEnv();
    process.env.HASNA_TESTERS_STORAGE_MODE = "self_hosted";
    process.env.HASNA_TESTERS_API_URL = "https://testers.hasna.xyz";
    expect(() => resolveTestersStore()).toThrow();
  });

  it("routes to the cloud /v1 API in self_hosted mode with URL + key", () => {
    clearEnv();
    process.env.HASNA_TESTERS_STORAGE_MODE = "self_hosted";
    process.env.HASNA_TESTERS_API_URL = "https://testers.hasna.xyz";
    process.env.HASNA_TESTERS_API_KEY = "hasna_testers_test_key";
    const r = resolveTestersStore();
    expect(r.transport).toBe("cloud-http");
    expect(isCloud()).toBe(true);
    if (r.transport === "cloud-http") {
      expect(r.client.baseUrl).toBe("https://testers.hasna.xyz/v1");
      expect(r.client.name).toBe("testers");
    }
  });

  it("accepts the canonical cloud alias too", () => {
    clearEnv();
    process.env.HASNA_TESTERS_STORAGE_MODE = "cloud";
    process.env.HASNA_TESTERS_API_URL = "https://testers.hasna.xyz";
    process.env.HASNA_TESTERS_API_KEY = "hasna_testers_test_key";
    expect(resolveTestersStore().transport).toBe("cloud-http");
  });

  it("routes to cloud when only API_URL + API_KEY are set (the fleet-flip env, no mode var)", () => {
    // The fleet flip writes exactly HASNA_TESTERS_API_URL + HASNA_TESTERS_API_KEY
    // and NO *_STORAGE_MODE. Presence of both must activate the cloud client so
    // the installed CLI reaches https://testers.hasna.xyz/v1 with the bearer key.
    clearEnv();
    process.env.HASNA_TESTERS_API_URL = "https://testers.hasna.xyz";
    process.env.HASNA_TESTERS_API_KEY = "hasna_testers_test_key";
    const r = resolveTestersStore();
    expect(r.transport).toBe("cloud-http");
    expect(isCloud()).toBe(true);
    if (r.transport === "cloud-http") {
      expect(r.client.baseUrl).toBe("https://testers.hasna.xyz/v1");
    }
  });

  it("stays local when the flip env is unset (unset -> local)", () => {
    clearEnv();
    process.env.HASNA_TESTERS_API_URL = "https://testers.hasna.xyz";
    process.env.HASNA_TESTERS_API_KEY = "hasna_testers_test_key";
    expect(isCloud()).toBe(true);
    // Simulate a revert: unset the two vars.
    delete process.env.HASNA_TESTERS_API_URL;
    delete process.env.HASNA_TESTERS_API_KEY;
    resetTestersStore();
    expect(resolveTestersStore().transport).toBe("local");
    expect(isCloud()).toBe(false);
  });

  it("honors an explicit STORAGE_MODE=local override even with URL + key present (escape hatch)", () => {
    clearEnv();
    process.env.HASNA_TESTERS_STORAGE_MODE = "local";
    process.env.HASNA_TESTERS_API_URL = "https://testers.hasna.xyz";
    process.env.HASNA_TESTERS_API_KEY = "hasna_testers_test_key";
    expect(resolveTestersStore().transport).toBe("local");
    expect(isCloud()).toBe(false);
  });

  it("routes only API_KEY without URL to cloud via the default host", () => {
    // API_KEY present but no URL: mode is still implied cloud, and the URL
    // falls back to the default https://testers.hasna.xyz host.
    clearEnv();
    process.env.HASNA_TESTERS_STORAGE_MODE = "self_hosted";
    process.env.HASNA_TESTERS_API_KEY = "hasna_testers_test_key";
    const r = resolveTestersStore();
    expect(r.transport).toBe("cloud-http");
    if (r.transport === "cloud-http") {
      expect(r.client.baseUrl).toBe("https://testers.hasna.xyz/v1");
    }
  });
});

describe("testers cloud list pagination", () => {
  const realFetch = globalThis.fetch;
  function cloudEnv(): void {
    process.env.HASNA_TESTERS_STORAGE_MODE = "cloud";
    process.env.HASNA_TESTERS_API_URL = "https://testers.hasna.xyz";
    process.env.HASNA_TESTERS_API_KEY = "hasna_testers_test_key";
    resetTestersStore();
  }
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.HASNA_TESTERS_STORAGE_MODE;
    delete process.env.HASNA_TESTERS_API_URL;
    delete process.env.HASNA_TESTERS_API_KEY;
    resetTestersStore();
  });

  // The server caps a list page at 500 rows. A dataset larger than one page must
  // be fully retrieved (multi-page) before client-side filter/sort/paginate —
  // otherwise counts cap at 500 and paging past page 1 returns nothing.
  it("pages through >500 scenarios and honors caller offset/limit exactly once", async () => {
    cloudEnv();
    const total = 620;
    const all = Array.from({ length: total }, (_, i) => ({
      id: `id-${i}`,
      shortId: `TST-${i}`,
      name: `s${String(i).padStart(4, "0")}`,
      description: "",
      tags: [] as string[],
      priority: "medium",
      createdAt: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
    }));
    const seenOffsets: number[] = [];
    globalThis.fetch = (async (input: string) => {
      const url = new URL(input);
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "500");
      seenOffsets.push(offset);
      const page = all.slice(offset, offset + limit);
      return new Response(JSON.stringify({ items: page }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    // Count must reflect the full dataset, not a single 500-row page.
    expect(await countScenarios()).toBe(total);
    expect(seenOffsets).toContain(0);
    expect(seenOffsets).toContain(500);

    // Sorted by createdAt DESC (default). Page 2 (offset 10, limit 5) must be a
    // real, non-empty slice — the old double-pagination bug returned [].
    const page2 = await listScenarios({ offset: 10, limit: 5 });
    expect(page2.length).toBe(5);
    const sorted = [...all].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    expect(page2.map((s) => s.id)).toEqual(sorted.slice(10, 15).map((s) => s.id));
  });
});
