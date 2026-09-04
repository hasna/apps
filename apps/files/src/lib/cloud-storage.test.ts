import { describe, expect, it } from "bun:test";
import { resolveFilesCloudStorage } from "./cloud-storage.js";

const KEY = "hasna_files_testkey_00000000000";

describe("resolveFilesCloudStorage — env-selection contract", () => {
  it("fails closed (throws) when nothing is configured — no silent local fallback", () => {
    expect(() => resolveFilesCloudStorage({})).toThrow(/HASNA_FILES_API_URL/);
    expect(() => resolveFilesCloudStorage({})).toThrow(/HASNA_FILES_API_KEY/);
    expect(() => resolveFilesCloudStorage({})).toThrow(/HASNA_FILES_LOCAL_MODE/);
  });

  it("fails closed (throws) when the API URL and key are blank", () => {
    expect(() =>
      resolveFilesCloudStorage({
        HASNA_FILES_API_URL: "  ",
        HASNA_FILES_API_KEY: "  ",
      }),
    ).toThrow(/HASNA_FILES_API_URL/);
  });

  it("is inactive (local) only when the explicit local opt-in is set", () => {
    const r = resolveFilesCloudStorage({ HASNA_FILES_LOCAL_MODE: "1" });
    expect(r.active).toBe(false);
    expect(r.client).toBeNull();
  });

  it("honours the unprefixed local opt-in alias", () => {
    const r = resolveFilesCloudStorage({ FILES_LOCAL_MODE: "true" });
    expect(r.active).toBe(false);
  });

  it("rejects falsy local opt-in values as no opt-in at all", () => {
    expect(() =>
      resolveFilesCloudStorage({ HASNA_FILES_LOCAL_MODE: "0" }),
    ).toThrow(/HASNA_FILES_API_URL/);
  });

  it("is active and targets <origin>/v1 when API_URL + API_KEY are both set", () => {
    const r = resolveFilesCloudStorage({
      HASNA_FILES_API_URL: "https://files.md",
      HASNA_FILES_API_KEY: KEY,
    });
    expect(r.active).toBe(true);
    expect(r.client).not.toBeNull();
    expect(r.client!.baseUrl).toBe("https://files.md/v1");
    expect(r.client!.name).toBe("files");
  });

  it("honours the unprefixed url/key aliases", () => {
    const r = resolveFilesCloudStorage({
      FILES_API_URL: "https://files.md",
      FILES_API_KEY: KEY,
    });
    expect(r.active).toBe(true);
    expect(r.client!.baseUrl).toBe("https://files.md/v1");
  });

  it("throws when only the API URL is set (fail-closed, no silent local fallback)", () => {
    expect(() =>
      resolveFilesCloudStorage({ HASNA_FILES_API_URL: "https://files.md" }),
    ).toThrow(/partially configured/);
  });

  it("throws when only the API key is set (fail-closed, no silent local fallback)", () => {
    expect(() => resolveFilesCloudStorage({ HASNA_FILES_API_KEY: KEY })).toThrow(
      /partially configured/,
    );
  });

  it("routes list/create/delete to <origin>/v1/sources with the bearer key", async () => {
    const calls: { url: string; method: string; auth: string | null }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const method = init?.method ?? "GET";
      calls.push({ url, method, auth: headers.get("authorization") });
      if (method === "GET") {
        return new Response(JSON.stringify([{ id: "src_1", name: "x" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (method === "POST") {
        return new Response(JSON.stringify({ id: "src_2", name: "y" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const r = resolveFilesCloudStorage(
      {
        HASNA_FILES_API_URL: "https://files.md",
        HASNA_FILES_API_KEY: KEY,
      },
      { fetchImpl: fakeFetch },
    );
    expect(r.active).toBe(true);

    const listed = await r.client!.list("sources");
    expect(listed.items.length).toBe(1);
    const created = await r.client!.create<{ id: string }>("sources", { name: "y", type: "local" });
    expect(created.id).toBe("src_2");
    await r.client!.delete("sources", "src_2");

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET https://files.md/v1/sources",
      "POST https://files.md/v1/sources",
      "DELETE https://files.md/v1/sources/src_2",
    ]);
    expect(calls.every((c) => c.auth === `Bearer ${KEY}`)).toBe(true);
  });

  it("routes the REAL dataset (files) list to <origin>/v1/files with query params + bearer key", async () => {
    const calls: { url: string; method: string; auth: string | null }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url, method: init?.method ?? "GET", auth: headers.get("authorization") });
      // The server returns a bare array of FileWithTags; the client extracts items.
      return new Response(JSON.stringify([{ id: "f_1", name: "a.txt", path: "/a.txt", size: 3, tags: [] }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const r = resolveFilesCloudStorage(
      {
        HASNA_FILES_API_URL: "https://files.md",
        HASNA_FILES_API_KEY: KEY,
      },
      { fetchImpl: fakeFetch },
    );
    expect(r.active).toBe(true);

    const listed = await r.client!.list<{ id: string }>("files", {
      query: { source_id: "src_1", ext: "txt", limit: 50, offset: 0 },
    });
    expect(listed.items.length).toBe(1);
    expect(listed.items[0]!.id).toBe("f_1");

    expect(calls.length).toBe(1);
    expect(calls[0]!.method).toBe("GET");
    // Base path + all query params must be present on the hosted request.
    expect(calls[0]!.url).toContain("https://files.md/v1/files");
    expect(calls[0]!.url).toContain("source_id=src_1");
    expect(calls[0]!.url).toContain("ext=txt");
    expect(calls[0]!.url).toContain("limit=50");
    expect(calls[0]!.auth).toBe(`Bearer ${KEY}`);
  });
});
